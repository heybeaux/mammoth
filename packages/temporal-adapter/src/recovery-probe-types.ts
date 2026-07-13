export interface TemporalRecoveryProbeInput {
  readonly checkpoint: string;
  readonly effectKey: string;
  readonly receiptPath: string;
  readonly authoritativeRevision: number;
  readonly authorityDigest: string;
}

export interface TemporalProcessRecoveryProbeState {
  readonly durableStep:
    | 'awaiting_worker_restart'
    | 'running_activity'
    | 'completed';
  readonly authoritativeRevision: number;
  readonly authorityDigest: string;
  readonly signalAccepted: boolean;
}

export interface TemporalRecoveryProbeResult {
  readonly workflowId: string;
  readonly runId: string;
  readonly durableStep: 'completed';
  readonly authoritativeRevision: number;
  readonly authorityDigest: string;
  readonly effect: {
    readonly effectKey: string;
    readonly duplicatePrevented: boolean;
    readonly providerCallCount: number;
  };
}

export interface TemporalRecoveryProbeLegacyResult {
  readonly challengeId: string;
  readonly receiptRef: string;
  readonly staleSignalsIgnored: number;
}

export interface TemporalRecoveryProbeState {
  readonly durableStep:
    | 'waiting_for_release'
    | 'running_activity'
    | 'completed';
  readonly staleSignalsIgnored: number;
}

export interface TemporalRecoveryProbeExecution {
  readonly workflowId: string;
  readonly runId: string;
  readonly workerRestarted: boolean;
  readonly stateBeforeRestart: TemporalRecoveryProbeState;
  readonly stateAfterStaleSignal: TemporalRecoveryProbeState;
  readonly result: TemporalRecoveryProbeLegacyResult;
  readonly activityAttempts: number;
  readonly providerEffects: number;
  readonly duplicateEffectsPrevented: number;
  readonly diagnostics: readonly {
    readonly boundary: string;
    readonly outcome: string;
    readonly detail: string;
  }[];
}
