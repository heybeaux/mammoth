import { createServer, type Server } from 'node:net';
import { describe, expect, it } from 'vitest';
import {
  ADAPTER_CONTRACT_VERSION,
  TEMPORAL_WORKFLOW_CAPABILITIES,
  verifyWorkflowOrchestratorConformance,
  type AdapterDescriptor,
} from '@mammoth/adapter-contracts';
import {
  TemporalStartupError,
  TemporalWorkflowOrchestratorAdapter,
  assertTemporalStartupReady,
  evaluateTemporalReadiness,
  loadTemporalAdapterConfig,
  temporalAdapterDescriptor,
  type CommandRunner,
  type CommandResult,
} from '../src/index.js';

class FakeRunner implements CommandRunner {
  readonly calls: string[] = [];

  constructor(private readonly outcomes: ReadonlyMap<string, number>) {}

  run(command: string, args: readonly string[]): Promise<CommandResult> {
    const key = [command, ...args].join(' ');
    this.calls.push(key);
    const exitCode = this.outcomes.get(key) ?? 1;
    return Promise.resolve({ stdout: '', stderr: '', exitCode });
  }
}

describe('Temporal adapter descriptor and readiness', () => {
  it('publishes a contract-major-1 workflow-orchestrator descriptor', () => {
    const config = loadTemporalAdapterConfig({});
    const descriptor = temporalAdapterDescriptor({
      config,
      checkedAt: '2026-07-11T00:00:00.000Z',
      health: 'healthy',
    });
    expect(descriptor).toEqual({
      id: 'temporal:mammoth-local:research-control',
      kind: 'workflow-orchestrator',
      contractVersion: ADAPTER_CONTRACT_VERSION,
      implementationVersion: '0.1.0',
      profile: 'production-like-local',
      capabilities: TEMPORAL_WORKFLOW_CAPABILITIES,
      health: 'healthy',
      checkedAt: '2026-07-11T00:00:00.000Z',
    } satisfies AdapterDescriptor);
  });

  it('reports every fail-closed readiness cause', () => {
    expect(
      evaluateTemporalReadiness({
        serviceReachable: false,
        namespaceAvailable: false,
        taskQueueAvailable: false,
        contractCompatible: false,
        missingCapabilities: ['workflow-signals'],
        checkedAt: '2026-07-11T00:00:00.000Z',
      }),
    ).toEqual({
      ready: false,
      checkedAt: '2026-07-11T00:00:00.000Z',
      failures: [
        'service-unreachable',
        'namespace-unavailable',
        'task-queue-unavailable',
        'contract-incompatible',
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
        runner: new FakeRunner(new Map()),
        now: () => new Date('2026-07-11T00:00:00.000Z'),
      }),
    ).rejects.toThrow(TemporalStartupError);
  });

  it('refuses startup when namespace or task queue checks fail', async () => {
    await withTcpServer(async (port) => {
      const config = loadTemporalAdapterConfig({
        MAMMOTH_TEMPORAL_PORT: String(port),
        MAMMOTH_TEMPORAL_READINESS_TIMEOUT_MS: '500',
      });
      await expect(
        assertTemporalStartupReady({
          config,
          runner: new FakeRunner(new Map()),
          now: () => new Date('2026-07-11T00:00:00.000Z'),
        }),
      ).rejects.toMatchObject({
        readiness: {
          failures: ['namespace-unavailable', 'task-queue-unavailable'],
        },
      });
    });
  });

  it('passes the shared workflow-orchestrator conformance helper when ready', async () => {
    await withTcpServer(async (port) => {
      const config = loadTemporalAdapterConfig({
        MAMMOTH_TEMPORAL_PORT: String(port),
        MAMMOTH_TEMPORAL_READINESS_TIMEOUT_MS: '500',
      });
      const runner = new FakeRunner(
        new Map([
          [
            `temporal operator namespace describe --address 127.0.0.1:${String(port)} --namespace mammoth-local`,
            0,
          ],
          [
            `temporal task-queue describe --address 127.0.0.1:${String(port)} --namespace mammoth-local --task-queue research-control`,
            0,
          ],
        ]),
      );
      await verifyWorkflowOrchestratorConformance({
        open: () =>
          new TemporalWorkflowOrchestratorAdapter(
            config,
            runner,
            undefined,
            () => new Date('2026-07-11T00:00:00.000Z'),
          ),
      });
    });
  });
});

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
