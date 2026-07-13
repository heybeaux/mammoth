import { createServer, type Server } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import {
  ADAPTER_CONTRACT_VERSION,
  TEMPORAL_WORKFLOW_CAPABILITIES,
  verifyWorkflowRuntimeConformance,
  type WorkflowRuntimeDescriptor,
} from '@mammoth/adapter-contracts';
import {
  TemporalStartupError,
  TemporalDevServerService,
  TemporalShutdownError,
  TemporalWorkflowRuntimeAdapter,
  assertTemporalStartupReady,
  evaluateTemporalReadiness,
  loadTemporalAdapterConfig,
  temporalAdapterDescriptor,
  type CommandRunner,
  type CommandResult,
} from '../src/index.js';

class FakeRunner implements CommandRunner {
  readonly calls: string[] = [];

  constructor(
    private readonly outcome: (
      command: string,
      args: readonly string[],
    ) => CommandResult,
  ) {}

  run(command: string, args: readonly string[]): Promise<CommandResult> {
    this.calls.push([command, ...args].join(' '));
    return Promise.resolve(this.outcome(command, args));
  }
}

describe('Temporal adapter descriptor and readiness', () => {
  it('publishes the additive major-1 workflow-runtime descriptor', () => {
    const config = loadTemporalAdapterConfig({});
    const descriptor = temporalAdapterDescriptor({
      config,
      checkedAt: '2026-07-13T00:00:00.000Z',
      health: 'healthy',
    });
    expect(descriptor).toEqual({
      id: 'temporal:mammoth-local:mammoth-research-control-v1',
      kind: 'workflow-runtime',
      contractVersion: ADAPTER_CONTRACT_VERSION,
      implementationVersion: '0.1.0',
      profile: 'production-like-local',
      capabilities: TEMPORAL_WORKFLOW_CAPABILITIES,
      health: 'healthy',
      checkedAt: '2026-07-13T00:00:00.000Z',
      namespace: 'mammoth-local',
      taskQueue: 'mammoth-research-control-v1',
      retentionDays: 7,
      workflowBundleId: 'mammoth-probe-v1',
      workerBuildId: 'mammoth-p3-t1',
    } satisfies WorkflowRuntimeDescriptor);
  });

  it('reports every fail-closed readiness cause', () => {
    expect(
      evaluateTemporalReadiness({
        serviceReachable: false,
        namespaceAvailable: false,
        namespaceRetentionMatches: false,
        taskQueueAvailable: false,
        workerCompatible: false,
        contractCompatible: false,
        missingCapabilities: ['signals'],
        checkedAt: '2026-07-13T00:00:00.000Z',
      }),
    ).toEqual({
      ready: false,
      checkedAt: '2026-07-13T00:00:00.000Z',
      failures: [
        'service-unavailable',
        'namespace-unavailable',
        'task-queue-unavailable',
        'contract-version-mismatch',
        'missing-capability',
      ],
    });
  });

  it('refuses startup when the Temporal service is unavailable', async () => {
    const config = loadTemporalAdapterConfig({
      MAMMOTH_TEMPORAL_PORT: '17999',
      MAMMOTH_TEMPORAL_READINESS_TIMEOUT_MS: '500',
    });
    await expect(
      assertTemporalStartupReady({
        config,
        runner: failureRunner(),
        now: () => new Date('2026-07-13T00:00:00.000Z'),
      }),
    ).rejects.toThrow(TemporalStartupError);
  });

  it.each([
    ['namespace-unavailable', () => failureRunner()],
    [
      'namespace-retention-mismatch',
      () => metadataRunner('retention:3d', compatiblePoller()),
    ],
    ['task-queue-unavailable', () => metadataRunner('retention:7d', undefined)],
    [
      'worker-incompatible',
      () =>
        metadataRunner('retention:7d', '{"pollers":[{"identity":"other"}]}'),
    ],
  ] as const)('fails closed for %s', async (failure, runnerFactory) => {
    await withTcpServer(async (port) => {
      const config = loadTemporalAdapterConfig({
        MAMMOTH_TEMPORAL_PORT: String(port),
        MAMMOTH_TEMPORAL_READINESS_TIMEOUT_MS: '500',
      });
      try {
        await assertTemporalStartupReady({ config, runner: runnerFactory() });
        throw new Error('expected Temporal startup to fail closed');
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(TemporalStartupError);
        expect((error as TemporalStartupError).readiness.failures).toContain(
          failure,
        );
      }
    });
  });

  it('passes shared lifecycle conformance with compatible namespace and poller', async () => {
    await withTcpServer(async (port) => {
      const config = loadTemporalAdapterConfig({
        MAMMOTH_TEMPORAL_PORT: String(port),
        MAMMOTH_TEMPORAL_READINESS_TIMEOUT_MS: '500',
      });
      await verifyWorkflowRuntimeConformance({
        open: () =>
          new TemporalWorkflowRuntimeAdapter(
            config,
            metadataRunner('retention:7d', compatiblePoller()),
            undefined,
            () => new Date('2026-07-13T00:00:00.000Z'),
          ),
      });
    });
  });

  it('never creates or updates a namespace during adapter startup', async () => {
    await withTcpServer(async (port) => {
      const config = loadTemporalAdapterConfig({
        MAMMOTH_TEMPORAL_PORT: String(port),
        MAMMOTH_TEMPORAL_READINESS_TIMEOUT_MS: '500',
      });
      const runner = metadataRunner('retention:7d', compatiblePoller());
      await assertTemporalStartupReady({ config, runner });
      expect(runner.calls.some((call) => call.includes(' create '))).toBe(
        false,
      );
      expect(runner.calls.some((call) => call.includes(' update '))).toBe(
        false,
      );
    });
  });

  it('bounds shutdown, closes admission, and makes repeated shutdown idempotent', async () => {
    await withTcpServer(async (port) => {
      const config = {
        ...loadTemporalAdapterConfig({
          MAMMOTH_TEMPORAL_PORT: String(port),
          MAMMOTH_TEMPORAL_READINESS_TIMEOUT_MS: '500',
        }),
        shutdownTimeoutMs: 20,
      };
      const runner = metadataRunner('retention:7d', compatiblePoller());
      const service = new TemporalDevServerService(config, runner);
      vi.spyOn(service, 'stop').mockImplementation(
        () => new Promise<void>(() => undefined),
      );
      const adapter = new TemporalWorkflowRuntimeAdapter(
        config,
        runner,
        service,
      );
      await adapter.start();
      await expect(adapter.shutdown()).rejects.toBeInstanceOf(
        TemporalShutdownError,
      );
      expect(adapter.descriptor().health).toBe('unavailable');
      await expect(adapter.shutdown()).resolves.toBeUndefined();
    });
  });
});

function failureRunner(): FakeRunner {
  return new FakeRunner(() => ({ stdout: '', stderr: '', exitCode: 1 }));
}

function metadataRunner(
  namespaceOutput: string,
  taskQueueOutput: string | undefined,
): FakeRunner {
  return new FakeRunner((_command, args) => {
    if (args.includes('namespace')) {
      return { stdout: namespaceOutput, stderr: '', exitCode: 0 };
    }
    return taskQueueOutput === undefined
      ? { stdout: '', stderr: 'missing queue', exitCode: 1 }
      : { stdout: taskQueueOutput, stderr: '', exitCode: 0 };
  });
}

function compatiblePoller(): string {
  return JSON.stringify({
    pollers: [{ identity: 'mammoth-probe-v1', workerBuildId: 'mammoth-p3-t1' }],
  });
}

async function withTcpServer<T>(operation: (port: number) => Promise<T>) {
  const server = await listen();
  try {
    const address = server.address();
    if (typeof address !== 'object' || address === null) {
      throw new Error('expected TCP server address');
    }
    return await operation(address.port);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

function listen(): Promise<Server> {
  const server = createServer((socket) => {
    socket.end();
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve(server);
    });
  });
}
