import type { SourceTransport } from '@mammoth/retrieval';

export interface RuntimeClaimProposal {
  id: string;
  canonicalText: string;
  subject: string;
  predicate: string;
  object: string;
  /** Exact source text that deterministically establishes the claim. */
  supportingQuote: string;
}

export interface RuntimeCharter {
  programId: string;
  criterionId: string;
  title: string;
  question: string;
  sourceUrl: string;
  evidencePolicyId: string;
  evidencePolicyVersion: string;
  proposals: readonly RuntimeClaimProposal[];
}

export interface RuntimeOptions {
  rootDirectory: string;
  charter: RuntimeCharter;
  transport: SourceTransport;
  resolveHost?: (hostname: string) => Promise<readonly string[]>;
  now?: () => Date;
  /** Test/operator fault boundary. Throwing simulates a process interruption. */
  onStage?: (stage: RuntimeStage) => void | Promise<void>;
}

export type RuntimeStage =
  | 'snapshot_committed'
  | 'claims_assessed'
  | 'ledger_committed'
  | 'report_compiled';

export interface RuntimeArtifactPaths {
  programDirectory: string;
  ledger: string;
  workflow: string;
  queue: string;
  governance: string;
  report: string;
  manifest: string;
  traces: string;
  receipt: string;
}

export interface RuntimeResult {
  programId: string;
  executionId: string;
  status: 'completed';
  publicationStatus: 'evidence_complete';
  supportedClaimIds: string[];
  unresolvedClaimIds: string[];
  snapshotDigest: string;
  paths: RuntimeArtifactPaths;
}

export type RuntimeErrorCode =
  | 'INVALID_CHARTER'
  | 'WORKFLOW_FAILED'
  | 'RETRIEVAL_FAILED'
  | 'CLAIM_COMMIT_DENIED'
  | 'REPORT_COMPILATION_FAILED';

export class RuntimeExecutionError extends Error {
  public constructor(
    public readonly code: RuntimeErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'RuntimeExecutionError';
  }
}
