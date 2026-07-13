import { TestWorkflowEnvironment } from '@temporalio/testing';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runTemporalRecoveryProbe } from '../src/index.js';

const packageRoot = resolve(import.meta.dirname, '..');
const workerScript = resolve(packageRoot, 'src/recovery-probe-worker.ts');
const clientScript = resolve(packageRoot, 'src/recovery-probe-client.ts');

describe('Temporal SDK recovery probe', () => {
  it('survives worker replacement, ignores stale signals, and deduplicates an ambiguous effect', async () => {
    const testEnv = await TestWorkflowEnvironment.createLocal();
    try {
      const execution = await runTemporalRecoveryProbe({
        environment: {
          client: testEnv.client,
          nativeConnection: testEnv.nativeConnection,
          ...(testEnv.namespace === undefined
            ? {}
            : { namespace: testEnv.namespace }),
        },
        namespace: testEnv.namespace ?? 'default',
        taskQueue: 'mammoth-recovery-probe-test',
        challengeId: 'worker-restart',
      });

      expect(execution.workerRestarted).toBe(true);
      expect(execution.stateBeforeRestart).toEqual({
        durableStep: 'waiting_for_release',
        staleSignalsIgnored: 0,
      });
      expect(execution.stateAfterStaleSignal).toEqual({
        durableStep: 'waiting_for_release',
        staleSignalsIgnored: 1,
      });
      expect(execution.result).toEqual({
        challengeId: 'worker-restart',
        receiptRef: 'receipt:recovery:worker-restart',
        staleSignalsIgnored: 1,
      });
      expect(execution.activityAttempts).toBe(2);
      expect(execution.providerEffects).toBe(1);
      expect(execution.duplicateEffectsPrevented).toBe(1);
      expect(execution.diagnostics.map(({ outcome }) => outcome)).toEqual([
        'recovered',
        'ignored',
        'recovered',
        'deduplicated',
      ]);
    } finally {
      await testEnv.teardown();
    }
  }, 120_000);

  it('survives SIGKILL of separate workflow, Activity, and CLI processes', async () => {
    const testEnv = await TestWorkflowEnvironment.createLocal();
    const directory = await mkdtemp(join(tmpdir(), 'mammoth-p3-recovery-'));
    const taskQueue = `mammoth-process-recovery-${String(process.pid)}`;
    const namespace = testEnv.namespace ?? 'default';
    const workflowId = `mammoth-process-recovery-${String(process.pid)}`;
    const receiptPath = join(directory, 'effect-receipt.json');
    const children = new Set<ChildProcessWithoutNullStreams>();
    const launch = (
      script: string,
      args: readonly string[],
      env: NodeJS.ProcessEnv = process.env,
    ) => {
      const child = spawn('pnpm', ['exec', 'tsx', script, ...args], {
        cwd: packageRoot,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      children.add(child);
      child.once('exit', () => children.delete(child));
      return child;
    };
    const workerArgs = [testEnv.address, namespace, taskQueue] as const;
    let workflowWorker: ChildProcessWithoutNullStreams | undefined;
    let activityWorker: ChildProcessWithoutNullStreams | undefined;
    try {
      workflowWorker = launch(workerScript, ['workflow', ...workerArgs]);
      activityWorker = launch(workerScript, ['activity', ...workerArgs], {
        ...process.env,
        MAMMOTH_RECOVERY_CRASH_AFTER_EFFECT: '1',
      });
      await Promise.all([
        waitForOutput(workflowWorker, 'MAMMOTH_RECOVERY_WORKER_READY:workflow'),
        waitForOutput(activityWorker, 'MAMMOTH_RECOVERY_WORKER_READY:activity'),
      ]);

      const input = {
        checkpoint: 'release-after-restart',
        effectKey: `effect:${workflowId}`,
        receiptPath,
        authoritativeRevision: 12,
        authorityDigest: 'sha256:authority-before-process-kills',
      };
      const started = await runClient(
        launch,
        testEnv.address,
        namespace,
        taskQueue,
        workflowId,
        'start',
        input,
      );
      expect(started).toMatchObject({ workflowId });
      expect(
        await runClient(
          launch,
          testEnv.address,
          namespace,
          taskQueue,
          workflowId,
          'query',
        ),
      ).toMatchObject({
        durableStep: 'awaiting_worker_restart',
        signalAccepted: false,
        authoritativeRevision: 12,
      });

      workflowWorker.kill('SIGKILL');
      await waitForExit(workflowWorker);
      workflowWorker = launch(workerScript, ['workflow', ...workerArgs]);
      await waitForOutput(
        workflowWorker,
        'MAMMOTH_RECOVERY_WORKER_READY:workflow',
      );

      await runClient(
        launch,
        testEnv.address,
        namespace,
        taskQueue,
        workflowId,
        'signal',
        'stale-checkpoint',
      );
      expect(
        await runClient(
          launch,
          testEnv.address,
          namespace,
          taskQueue,
          workflowId,
          'query',
        ),
      ).toMatchObject({
        durableStep: 'awaiting_worker_restart',
        signalAccepted: false,
      });

      const abandonedCli = launch(clientScript, [
        'result',
        testEnv.address,
        namespace,
        taskQueue,
        workflowId,
      ]);
      await delay(150);
      abandonedCli.kill('SIGKILL');
      await waitForExit(abandonedCli);

      await runClient(
        launch,
        testEnv.address,
        namespace,
        taskQueue,
        workflowId,
        'signal',
        input.checkpoint,
      );
      await waitForExit(activityWorker);
      expect(activityWorker.exitCode).not.toBe(0);
      activityWorker = launch(workerScript, ['activity', ...workerArgs]);
      await waitForOutput(
        activityWorker,
        'MAMMOTH_RECOVERY_WORKER_READY:activity',
      );

      const result = await runClient(
        launch,
        testEnv.address,
        namespace,
        taskQueue,
        workflowId,
        'result',
      );
      expect(result).toMatchObject({
        workflowId,
        durableStep: 'completed',
        authoritativeRevision: 12,
        authorityDigest: input.authorityDigest,
        effect: {
          effectKey: input.effectKey,
          duplicatePrevented: true,
          providerCallCount: 1,
        },
      });
    } finally {
      for (const child of children) child.kill('SIGKILL');
      await Promise.all([...children].map((child) => waitForExit(child)));
      await testEnv.teardown();
      await rm(directory, { recursive: true, force: true });
    }
  }, 120_000);

  it('continues the same open run after a persistent Temporal service restart', async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'mammoth-p3-service-recovery-'),
    );
    const dbFilename = join(directory, 'temporal.db');
    const namespace = `mammoth-recovery-${String(process.pid)}`;
    let testEnv = await TestWorkflowEnvironment.createLocal({
      server: { dbFilename, namespace },
    });
    const taskQueue = `mammoth-service-recovery-${String(process.pid)}`;
    const workflowId = `mammoth-service-recovery-${String(process.pid)}`;
    const children = new Set<ChildProcessWithoutNullStreams>();
    const launch: Launch = (script, args, env = process.env) => {
      const child = spawn('pnpm', ['exec', 'tsx', script, ...args], {
        cwd: packageRoot,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      children.add(child);
      child.once('exit', () => children.delete(child));
      return child;
    };
    try {
      let workflowWorker = launch(workerScript, [
        'workflow',
        testEnv.address,
        namespace,
        taskQueue,
      ]);
      let activityWorker = launch(workerScript, [
        'activity',
        testEnv.address,
        namespace,
        taskQueue,
      ]);
      await Promise.all([
        waitForOutput(workflowWorker, 'MAMMOTH_RECOVERY_WORKER_READY:workflow'),
        waitForOutput(activityWorker, 'MAMMOTH_RECOVERY_WORKER_READY:activity'),
      ]);
      const input = {
        checkpoint: 'release-after-service-restart',
        effectKey: `effect:${workflowId}`,
        receiptPath: join(directory, 'effect-receipt.json'),
        authoritativeRevision: 21,
        authorityDigest: 'sha256:authority-before-service-restart',
      };
      const started = await runClient(
        launch,
        testEnv.address,
        namespace,
        taskQueue,
        workflowId,
        'start',
        input,
      );
      const originalRunId = started.runId;
      expect(originalRunId).toMatch(/[0-9a-f-]{36}/);

      workflowWorker.kill('SIGKILL');
      activityWorker.kill('SIGKILL');
      await Promise.all([
        waitForExit(workflowWorker),
        waitForExit(activityWorker),
      ]);
      await testEnv.teardown();

      testEnv = await TestWorkflowEnvironment.createLocal({
        server: { dbFilename, namespace },
      });
      workflowWorker = launch(workerScript, [
        'workflow',
        testEnv.address,
        namespace,
        taskQueue,
      ]);
      activityWorker = launch(workerScript, [
        'activity',
        testEnv.address,
        namespace,
        taskQueue,
      ]);
      await Promise.all([
        waitForOutput(workflowWorker, 'MAMMOTH_RECOVERY_WORKER_READY:workflow'),
        waitForOutput(activityWorker, 'MAMMOTH_RECOVERY_WORKER_READY:activity'),
      ]);

      expect(
        await runClient(
          launch,
          testEnv.address,
          namespace,
          taskQueue,
          workflowId,
          'query',
        ),
      ).toMatchObject({
        durableStep: 'awaiting_worker_restart',
        authoritativeRevision: 21,
        authorityDigest: input.authorityDigest,
      });
      await runClient(
        launch,
        testEnv.address,
        namespace,
        taskQueue,
        workflowId,
        'signal',
        input.checkpoint,
      );
      const result = await runClient(
        launch,
        testEnv.address,
        namespace,
        taskQueue,
        workflowId,
        'result',
      );
      expect(result).toMatchObject({
        runId: originalRunId,
        workflowId,
        durableStep: 'completed',
        authoritativeRevision: 21,
        authorityDigest: input.authorityDigest,
        effect: { providerCallCount: 1 },
      });
    } finally {
      for (const child of children) child.kill('SIGKILL');
      await Promise.all([...children].map((child) => waitForExit(child)));
      await testEnv.teardown().catch(() => undefined);
      await rm(directory, { recursive: true, force: true });
    }
  }, 120_000);
});

type Launch = (
  script: string,
  args: readonly string[],
  env?: NodeJS.ProcessEnv,
) => ChildProcessWithoutNullStreams;

async function runClient(
  launch: Launch,
  address: string,
  namespace: string,
  taskQueue: string,
  workflowId: string,
  command: 'start' | 'query' | 'signal' | 'result',
  payload?: unknown,
): Promise<Record<string, unknown>> {
  const child = launch(clientScript, [
    command,
    address,
    namespace,
    taskQueue,
    workflowId,
    ...(payload === undefined ? [] : [JSON.stringify(payload)]),
  ]);
  const output = await collectSuccessfulOutput(child);
  const marker = 'MAMMOTH_RECOVERY_CLIENT_RESULT:';
  const line = output.split('\n').find((entry) => entry.startsWith(marker));
  if (!line)
    throw new Error(`recovery client result marker missing:\n${output}`);
  return JSON.parse(line.slice(marker.length)) as Record<string, unknown>;
}

function waitForOutput(
  child: ChildProcessWithoutNullStreams,
  marker: string,
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    let output = '';
    const consume = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes(marker)) {
        cleanup();
        resolvePromise();
      }
    };
    const exited = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      reject(
        new Error(
          `process exited before ${marker}: ${String(code)} ${String(signal)}\n${output}`,
        ),
      );
    };
    const cleanup = () => {
      child.stdout.off('data', consume);
      child.stderr.off('data', consume);
      child.off('exit', exited);
    };
    child.stdout.on('data', consume);
    child.stderr.on('data', consume);
    child.once('exit', exited);
  });
}

function collectSuccessfulOutput(
  child: ChildProcessWithoutNullStreams,
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise(output);
      else
        reject(
          new Error(
            `recovery client failed: ${String(code)} ${String(signal)}\n${output}`,
          ),
        );
    });
  });
}

function waitForExit(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null)
    return Promise.resolve();
  return new Promise((resolvePromise) => {
    child.once('exit', () => {
      resolvePromise();
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}
