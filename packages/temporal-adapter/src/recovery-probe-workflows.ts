import {
  condition,
  defineQuery,
  defineSignal,
  proxyActivities,
  setHandler,
  workflowInfo,
} from '@temporalio/workflow';
import type {
  TemporalRecoveryProbeLegacyResult,
  TemporalRecoveryProbeInput,
  TemporalRecoveryProbeResult,
  TemporalProcessRecoveryProbeState,
} from './recovery-probe-types.js';

interface RecoveryProbeActivities {
  recoveryProbeEffect(input: {
    readonly effectKey: string;
    readonly receiptPath: string;
  }): Promise<{
    readonly effectKey: string;
    readonly duplicatePrevented: boolean;
    readonly providerCallCount: number;
  }>;
  recoveryProbeAmbiguousEffect(challengeId: string): Promise<string>;
}

const activities = proxyActivities<RecoveryProbeActivities>({
  startToCloseTimeout: '3 seconds',
  heartbeatTimeout: '1 second',
  retry: {
    initialInterval: '100 milliseconds',
    maximumInterval: '500 milliseconds',
    maximumAttempts: 3,
  },
});

export const recoveryAdvanceSignal =
  defineSignal<[checkpoint: string]>('recoveryAdvance');
export const recoveryStateQuery =
  defineQuery<TemporalProcessRecoveryProbeState>('recoveryState');

export const recoveryProbeReleaseSignal = defineSignal<[challengeId: string]>(
  'recoveryProbeRelease',
);
export const recoveryProbeStateQuery = defineQuery<{
  readonly durableStep:
    | 'waiting_for_release'
    | 'running_activity'
    | 'completed';
  readonly staleSignalsIgnored: number;
}>('recoveryProbeState');

/**
 * A deliberately small deterministic program used only by the P3 recovery gate.
 * Product authority remains represented by opaque revision and digest references.
 */
export async function temporalProcessRecoveryProbeWorkflow(
  input: TemporalRecoveryProbeInput,
): Promise<TemporalRecoveryProbeResult> {
  let advanced = false;
  let durableStep: TemporalProcessRecoveryProbeState['durableStep'] =
    'awaiting_worker_restart';
  setHandler(recoveryAdvanceSignal, (checkpoint) => {
    if (checkpoint === input.checkpoint) advanced = true;
  });
  setHandler(recoveryStateQuery, () => ({
    durableStep,
    authoritativeRevision: input.authoritativeRevision,
    authorityDigest: input.authorityDigest,
    signalAccepted: advanced,
  }));

  await condition(() => advanced);
  durableStep = 'running_activity';
  const effect = await activities.recoveryProbeEffect({
    effectKey: input.effectKey,
    receiptPath: input.receiptPath,
  });
  durableStep = 'completed';
  return {
    workflowId: workflowInfo().workflowId,
    runId: workflowInfo().runId,
    durableStep,
    authoritativeRevision: input.authoritativeRevision,
    authorityDigest: input.authorityDigest,
    effect,
  };
}

/** In-process worker replacement probe retained for the fast live verification gate. */
export async function temporalRecoveryProbeWorkflow(input: {
  readonly challengeId: string;
}): Promise<TemporalRecoveryProbeLegacyResult> {
  let released = false;
  let staleSignalsIgnored = 0;
  let durableStep: 'waiting_for_release' | 'running_activity' | 'completed' =
    'waiting_for_release';
  setHandler(recoveryProbeReleaseSignal, (challengeId) => {
    if (challengeId === input.challengeId) released = true;
    else staleSignalsIgnored += 1;
  });
  setHandler(recoveryProbeStateQuery, () => ({
    durableStep,
    staleSignalsIgnored,
  }));
  await condition(() => released);
  durableStep = 'running_activity';
  const receiptRef = await activities.recoveryProbeAmbiguousEffect(
    input.challengeId,
  );
  durableStep = 'completed';
  return { challengeId: input.challengeId, receiptRef, staleSignalsIgnored };
}
