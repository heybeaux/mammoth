import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { describe, expect, it } from 'vitest';

const tsxCli = fileURLToPath(
  new URL('../node_modules/tsx/dist/cli.mjs', import.meta.url),
);
const workerEntry = fileURLToPath(
  new URL('../src/recovery-probe-worker.ts', import.meta.url),
);
const clientEntry = fileURLToPath(
  new URL('../src/recovery-probe-client.ts', import.meta.url),
);
const workflowsPath = fileURLToPath(
  new URL('../src/recovery-probe-workflows.ts', import.meta.url),
);

describe('Temporal process recovery matrix', () => {
  it('survives CLI, workflow-worker, and Activity-worker process loss with bounded replayable history', async () => {
    const testEnv = await TestWorkflowEnvironment.createLocal();
    const root = await mkdtemp(join(tmpdir(), 'mammoth-temporal-recovery-'));
    const namespace = testEnv.namespace ?? 'default';
    const taskQueue = 'mammoth-process-recovery-test';
    const workflowId = 'mammoth:recovery:process-kill';
    const receiptPath = join(root, 'effect-receipt.json');
    const children = new Set<ChildProcessWithoutNullStreams>();

    try {
      const firstWorkflowWorker = await startWorker(
        'workflow',
        testEnv.address,
        namespace,
        taskQueue,
        {},
        children,
      );
      const started = await runClient(
        'start',
        testEnv.address,
        namespace,
        taskQueue,
        workflowId,
        {
          checkpoint: 'resume-after-process-loss',
          effectKey: 'provider:recovery:stable-effect',
          receiptPath,
          authoritativeRevision: 12,
          authorityDigest:
            'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        },
      );
      expect(started).toMatchObject({ workflowId });

      firstWorkflowWorker.kill('SIGKILL');
      await exited(firstWorkflowWorker);
      children.delete(firstWorkflowWorker);

      await startWorker(
        'workflow',
        testEnv.address,
        namespace,
        taskQueue,
        {},
        children,
      );
      await expect(
        runClient('query', testEnv.address, namespace, taskQueue, workflowId),
      ).resolves.toEqual({
        durableStep: 'awaiting_worker_restart',
        authoritativeRevision: 12,
        authorityDigest:
          'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        signalAccepted: false,
      });

      const crashingActivityWorker = await startWorker(
        'activity',
        testEnv.address,
        namespace,
        taskQueue,
        { MAMMOTH_RECOVERY_CRASH_AFTER_EFFECT: '1' },
        children,
      );
      await runClient(
        'signal',
        testEnv.address,
        namespace,
        taskQueue,
        workflowId,
        'resume-after-process-loss',
      );
      const crash = await exited(crashingActivityWorker, 15_000);
      expect(
        crash.signal === 'SIGKILL' || crash.code === 137,
        `expected hard Activity-worker death, got ${String(crash.code)}/${String(crash.signal)}`,
      ).toBe(true);
      children.delete(crashingActivityWorker);

      await startWorker(
        'activity',
        testEnv.address,
        namespace,
        taskQueue,
        {},
        children,
      );
      const result = await runClient(
        'result',
        testEnv.address,
        namespace,
        taskQueue,
        workflowId,
      );
      expect(result).toMatchObject({
        workflowId,
        durableStep: 'completed',
        authoritativeRevision: 12,
        effect: {
          effectKey: 'provider:recovery:stable-effect',
          duplicatePrevented: true,
          providerCallCount: 1,
        },
      });
      expect(JSON.parse(await readFile(receiptPath, 'utf8'))).toEqual({
        schemaVersion: 1,
        effectKey: 'provider:recovery:stable-effect',
        providerCallCount: 1,
      });

      const handle = testEnv.client.workflow.getHandle(workflowId);
      const history = await handle.fetchHistory();
      expect(history.events?.length ?? 0).toBeGreaterThan(0);
      expect(history.events?.length ?? Number.POSITIVE_INFINITY).toBeLessThan(
        40,
      );
      expect(JSON.stringify(history)).not.toMatch(
        /canonicalText|evidence artifact|dossier sentence/i,
      );
      await Worker.runReplayHistory({ workflowsPath }, history, workflowId);
    } finally {
      await Promise.all([...children].map(stopChild));
      await testEnv.teardown();
      await rm(root, { recursive: true, force: true });
    }
  }, 120_000);
});

async function startWorker(
  mode: 'workflow' | 'activity',
  address: string,
  namespace: string,
  taskQueue: string,
  extraEnv: NodeJS.ProcessEnv,
  children: Set<ChildProcessWithoutNullStreams>,
): Promise<ChildProcessWithoutNullStreams> {
  const child = spawn(
    process.execPath,
    [tsxCli, workerEntry, mode, address, namespace, taskQueue],
    {
      env: { ...process.env, ...extraEnv },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  children.add(child);
  await waitForOutput(child, `MAMMOTH_RECOVERY_WORKER_READY:${mode}`);
  return child;
}

async function runClient(
  command: 'start' | 'query' | 'signal' | 'result',
  address: string,
  namespace: string,
  taskQueue: string,
  workflowId: string,
  payload?: unknown,
): Promise<unknown> {
  const args = [
    tsxCli,
    clientEntry,
    command,
    address,
    namespace,
    taskQueue,
    workflowId,
    ...(payload === undefined ? [] : [JSON.stringify(payload)]),
  ];
  const child = spawn(process.execPath, args, {
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const output = await collect(child);
  const prefix = 'MAMMOTH_RECOVERY_CLIENT_RESULT:';
  const line = output.stdout
    .split('\n')
    .find((candidate) => candidate.startsWith(prefix));
  if (!line)
    throw new Error(`recovery client emitted no result: ${output.stdout}`);
  return JSON.parse(line.slice(prefix.length)) as unknown;
}

function waitForOutput(
  child: ChildProcessWithoutNullStreams,
  marker: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      reject(new Error(`worker readiness timeout: ${stdout}\n${stderr}`));
    }, 15_000);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.includes(marker)) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      reject(
        new Error(
          `worker exited before ready (${String(code)}/${String(signal)}): ${stderr}`,
        ),
      );
    });
  });
}

async function collect(child: ChildProcessWithoutNullStreams): Promise<{
  readonly stdout: string;
  readonly stderr: string;
}> {
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const status = await exited(child, 30_000);
  if (status.code !== 0) {
    throw new Error(
      `recovery client failed (${String(status.code)}/${String(status.signal)}): ${stderr}`,
    );
  }
  return { stdout, stderr };
}

function exited(
  child: ChildProcessWithoutNullStreams,
  timeoutMs = 10_000,
): Promise<{
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('child process exit timeout'));
    }, timeoutMs);
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
  });
}

async function stopChild(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await exited(child).catch(() => {
    child.kill('SIGKILL');
  });
}
