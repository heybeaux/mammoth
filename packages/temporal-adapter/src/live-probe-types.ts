import type { AdapterCapability } from '@mammoth/adapter-contracts';
import type { WorkerBundleManifest } from './readiness.js';

export interface TemporalLiveProbeInput {
  readonly manifest: WorkerBundleManifest;
  readonly challengeId: string;
  readonly cycle: number;
  readonly signalObserved: boolean;
}

export interface TemporalLiveProbeResult {
  readonly manifest: WorkerBundleManifest;
  readonly challengeId: string;
  readonly cycle: number;
  readonly observed: {
    readonly continuedAsNew: boolean;
    readonly signal: boolean;
    readonly timer: boolean;
    readonly retry: boolean;
    readonly activityResult: string;
  };
}

export interface TemporalCancellationProbeInput {
  readonly challengeId: string;
}

export interface TemporalCancellationProbeResult {
  readonly challengeId: string;
  readonly cancellationObserved: boolean;
}

export interface TemporalLiveProbeExecution {
  readonly manifest: WorkerBundleManifest;
  readonly probedCapabilities: readonly AdapterCapability[];
  readonly workflowId: string;
  readonly runId: string;
  readonly replayed: boolean;
  readonly cancellationObserved: boolean;
}
