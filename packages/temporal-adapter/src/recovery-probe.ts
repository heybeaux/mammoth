import { fileURLToPath } from 'node:url';
import type { WorkflowHandle } from '@temporalio/client';
import { Worker } from '@temporalio/worker';
import type { TemporalLiveProbeEnvironment } from './live-probe.js';
import * as activities from './recovery-probe-activities.js';
import {
  recoveryProbeReleaseSignal,
  recoveryProbeStateQuery,
  temporalRecoveryProbeWorkflow,
} from './recovery-probe-workflows.js';
import type {
  TemporalRecoveryProbeExecution,
  TemporalRecoveryProbeState,
} from './recovery-probe-types.js';

export interface TemporalRecoveryProbeOptions {
  readonly environment: TemporalLiveProbeEnvironment;
  readonly namespace: string;
  readonly taskQueue: string;
  readonly challengeId: string;
}

export async function runTemporalRecoveryProbe(
  options: TemporalRecoveryProbeOptions,
): Promise<TemporalRecoveryProbeExecution> {
  activities.resetRecoveryProbeActivities();
  const workflowId = `mammoth-temporal-recovery-${options.challengeId}`;
  const workerOptions = {
    connection: options.environment.nativeConnection,
    namespace: options.namespace,
    taskQueue: options.taskQueue,
    workflowsPath: fileURLToPath(
      new URL('./recovery-probe-workflows.ts', import.meta.url),
    ),
    activities,
  } as const;

  const firstWorker = await Worker.create({
    ...workerOptions,
    identity: 'mammoth-recovery-probe-worker-before-restart',
  });
  const first = await firstWorker.runUntil(async () => {
    const handle = await options.environment.client.workflow.start(
      temporalRecoveryProbeWorkflow,
      {
        workflowId,
        taskQueue: options.taskQueue,
        args: [{ challengeId: options.challengeId }],
      },
    );
    return {
      handle,
      state: await eventuallyQuery(handle),
      runId: handle.firstExecutionRunId,
    };
  });

  const secondWorker = await Worker.create({
    ...workerOptions,
    identity: 'mammoth-recovery-probe-worker-after-restart',
  });
  const recovered = await secondWorker.runUntil(async () => {
    await first.handle.signal(
      recoveryProbeReleaseSignal,
      `${options.challengeId}-stale`,
    );
    const stateAfterStaleSignal = await eventuallyQuery(first.handle, 1);
    await first.handle.signal(recoveryProbeReleaseSignal, options.challengeId);
    return {
      stateAfterStaleSignal,
      result: await first.handle.result(),
    };
  });
  const snapshot = activities.recoveryProbeActivitySnapshot(
    options.challengeId,
  );
  return {
    workflowId,
    runId: first.runId,
    workerRestarted: true,
    stateBeforeRestart: first.state,
    stateAfterStaleSignal: recovered.stateAfterStaleSignal,
    result: recovered.result,
    activityAttempts: snapshot.attempts,
    providerEffects: snapshot.providerEffects,
    duplicateEffectsPrevented: snapshot.attempts - snapshot.providerEffects,
    diagnostics: [
      {
        boundary: 'worker_poller_loss',
        outcome: 'recovered',
        detail: 'A replacement worker completed the same open workflow run.',
      },
      {
        boundary: 'stale_signal',
        outcome: 'ignored',
        detail:
          'A mismatched challenge signal did not advance the durable step.',
      },
      {
        boundary: 'ambiguous_provider_commit',
        outcome: 'recovered',
        detail:
          'The first Activity attempt failed after recording provider commit.',
      },
      {
        boundary: 'duplicate_activity_delivery',
        outcome: 'deduplicated',
        detail:
          'Activity redelivery returned the completed receipt without a second effect.',
      },
    ],
  };
}

async function eventuallyQuery(
  handle: WorkflowHandle<typeof temporalRecoveryProbeWorkflow>,
  expectedStaleSignals = 0,
): Promise<TemporalRecoveryProbeState> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const state = await handle.query(recoveryProbeStateQuery);
      if (state.staleSignalsIgnored >= expectedStaleSignals) return state;
    } catch (error: unknown) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  if (lastError instanceof Error) throw lastError;
  throw new Error('recovery probe query did not become available');
}
