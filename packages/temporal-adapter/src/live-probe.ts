import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Connection, Client } from '@temporalio/client';
import { NativeConnection, Worker } from '@temporalio/worker';
import {
  TEMPORAL_WORKFLOW_CAPABILITIES,
  type AdapterCapability,
} from '@mammoth/adapter-contracts';
import type { TemporalAdapterConfig } from './config.js';
import {
  liveProbeManifestQuery,
  liveProbeSignal,
  temporalCancellationProbeWorkflow,
  temporalReadinessProbeWorkflow,
} from './live-probe-workflows.js';
import * as activities from './live-probe-activities.js';
import type { TemporalLiveProbeExecution } from './live-probe-types.js';
import type {
  WorkerBundleManifest,
  WorkerBundleManifestEvidence,
  WorkerBundleManifestProbe,
} from './readiness.js';

export interface TemporalLiveProbeEnvironment {
  readonly client: Client;
  readonly nativeConnection: NativeConnection;
  readonly namespace?: string;
}

export interface TemporalLiveProbeOptions {
  readonly config: TemporalAdapterConfig;
  readonly environment?: TemporalLiveProbeEnvironment;
  readonly challengeId?: string;
}

export class TemporalSdkWorkerManifestProbe
  implements WorkerBundleManifestProbe
{
  async probe(options: {
    readonly config: TemporalAdapterConfig;
  }): Promise<WorkerBundleManifestEvidence> {
    const execution = await runTemporalLiveProbe({ config: options.config });
    return {
      manifest: execution.manifest,
      probedCapabilities: execution.probedCapabilities,
      live: true,
    };
  }
}

export async function runTemporalLiveProbe(
  options: TemporalLiveProbeOptions,
): Promise<TemporalLiveProbeExecution> {
  const manifest = temporalWorkerBundleManifest(options.config);
  const challengeId = options.challengeId ?? randomUUID();
  const workflowId = `mammoth-temporal-probe-${challengeId}`;
  const cancellationWorkflowId = `${workflowId}-cancel`;
  const owned = await resolveEnvironment(options);
  const worker = await Worker.create({
    connection: owned.environment.nativeConnection,
    namespace: owned.environment.namespace ?? options.config.namespace,
    taskQueue: options.config.taskQueue,
    identity: `${options.config.workflowBundleId}:${options.config.workerBuildId}`,
    buildId: options.config.workerBuildId,
    workflowsPath: fileURLToPath(
      new URL('./live-probe-workflows.ts', import.meta.url),
    ),
    activities,
  });

  try {
    const result = await worker.runUntil(async () => {
      const handle = await owned.environment.client.workflow.start(
        temporalReadinessProbeWorkflow,
        {
          workflowId,
          taskQueue: options.config.taskQueue,
          args: [
            {
              manifest,
              challengeId,
              cycle: 0,
              signalObserved: false,
            },
          ],
        },
      );
      const queriedManifest = await handle.query(liveProbeManifestQuery);
      await handle.signal(liveProbeSignal, challengeId);
      const workflowResult = await handle.result();
      const history = await handle.fetchHistory();
      await Worker.runReplayHistory(
        {
          workflowsPath: fileURLToPath(
            new URL('./live-probe-workflows.ts', import.meta.url),
          ),
        },
        history,
        workflowId,
      );

      const cancellation = await owned.environment.client.workflow.start(
        temporalCancellationProbeWorkflow,
        {
          workflowId: cancellationWorkflowId,
          taskQueue: options.config.taskQueue,
          args: [{ challengeId }],
        },
      );
      await cancellation.cancel();
      const cancellationResult = await cancellation.result();

      return {
        queriedManifest,
        workflowResult,
        cancellationResult,
        runId: handle.firstExecutionRunId,
      };
    });

    const probedCapabilities = observedCapabilities({
      manifest,
      queriedManifest: result.queriedManifest,
      workflowResult: result.workflowResult,
      cancellationObserved: result.cancellationResult.cancellationObserved,
      replayed: true,
    });
    return {
      manifest,
      probedCapabilities,
      workflowId,
      runId: result.runId,
      replayed: true,
      cancellationObserved: result.cancellationResult.cancellationObserved,
    };
  } finally {
    await owned.close();
  }
}

export function temporalWorkerBundleManifest(
  config: TemporalAdapterConfig,
): WorkerBundleManifest {
  return {
    schemaVersion: 1,
    bundleId: config.workflowBundleId,
    workerBuildId: config.workerBuildId,
    taskQueue: config.taskQueue,
    contractMajor: 1,
    capabilities: TEMPORAL_WORKFLOW_CAPABILITIES,
  };
}

function observedCapabilities(options: {
  readonly manifest: WorkerBundleManifest;
  readonly queriedManifest: WorkerBundleManifest;
  readonly workflowResult: Awaited<
    ReturnType<typeof temporalReadinessProbeWorkflow>
  >;
  readonly cancellationObserved: boolean;
  readonly replayed: boolean;
}): readonly AdapterCapability[] {
  const observed = new Set<AdapterCapability>([
    'clean-shutdown',
    'health-reporting',
  ]);
  if (sameManifest(options.queriedManifest, options.manifest)) {
    observed.add('queries');
  }
  if (options.workflowResult.observed.signal) observed.add('signals');
  if (options.workflowResult.observed.timer) observed.add('durable-timers');
  if (options.workflowResult.observed.retry) observed.add('retry-scheduling');
  if (options.workflowResult.observed.continuedAsNew) {
    observed.add('continue-as-new');
    observed.add('durable-restart');
  }
  if (options.workflowResult.challengeId.length > 0) {
    observed.add('task-queue-polling');
  }
  if (options.cancellationObserved) observed.add('cooperative-cancellation');
  if (options.replayed) observed.add('deterministic-replay');
  return TEMPORAL_WORKFLOW_CAPABILITIES.filter((capability) =>
    observed.has(capability),
  );
}

async function resolveEnvironment(options: TemporalLiveProbeOptions): Promise<{
  readonly environment: TemporalLiveProbeEnvironment;
  close(): Promise<void>;
}> {
  if (options.environment !== undefined) {
    return {
      environment: options.environment,
      close: () => Promise.resolve(),
    };
  }
  const connection = await Connection.connect({
    address: options.config.address,
  });
  const nativeConnection = await NativeConnection.connect({
    address: options.config.address,
  });
  return {
    environment: {
      client: new Client({
        connection,
        namespace: options.config.namespace,
      }),
      nativeConnection,
      namespace: options.config.namespace,
    },
    close: async () => {
      await nativeConnection.close();
      await connection.close();
    },
  };
}

function sameManifest(
  left: WorkerBundleManifest,
  right: WorkerBundleManifest,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
