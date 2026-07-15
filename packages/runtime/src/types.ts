import type { SourceTransport } from '@mammoth/retrieval';

export interface EntailmentVerification {
  entails: boolean;
  receiptId: string;
  verifierId: string;
  verifierVersion: string;
}

export interface RuntimeClaimProposal {
  id: string;
  canonicalText: string;
  subject: string;
  predicate: string;
  object: string;
  /** Exact source text that deterministically establishes the claim. */
  supportingQuote: string;
  /** Optional declared locator. When present it must exactly select supportingQuote. */
  locator?: { startOffset: number; endOffset: number };
}

export interface RuntimeCharter {
  programId: string;
  criterionId: string;
  title: string;
  question: string;
  sourceUrl: string;
  evidencePolicyId: string;
  evidencePolicyVersion: string;
  sourceExpiresAt?: string;
  sourceRevalidateAfter?: string;
  budgetLimit?: RuntimeBudgetAmount;
  proposals: readonly RuntimeClaimProposal[];
}

export interface RuntimeOptions {
  rootDirectory: string;
  charter: RuntimeCharter;
  transport?: SourceTransport;
  verifyEntailment(input: {
    claim: RuntimeClaimProposal;
    sourceText: string;
    quote: string;
    locator: { startOffset: number; endOffset: number };
    snapshotDigest: string;
  }): Promise<EntailmentVerification> | EntailmentVerification;
  retrievalUsage?: {
    estimated: RuntimeBudgetAmount;
    actual: RuntimeBudgetAmount;
  };
  resolveHost?: (hostname: string) => Promise<readonly string[]>;
  now?: () => Date;
  /** Test/operator fault boundary. Throwing simulates a process interruption. */
  onStage?: (stage: RuntimeStage) => void | Promise<void>;
}

export type RuntimeStage =
  | 'snapshot_committed'
  | 'budget_committed'
  | 'claims_assessed'
  | 'ledger_committed'
  | 'report_compiled'
  | 'receipt_committed';

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
  snapshot: string;
  assessments: string;
  charter: string;
  audit: string;
  revalidation: string;
}

export interface RuntimeBudgetAmount {
  costUsd: number;
  tokens: number;
  durationMs: number;
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

export interface RuntimeAuditEvent {
  eventId: string;
  sequence: number;
  previousHash: string;
  eventHash: string;
  kind: 'stage.committed' | 'runtime.completed';
  stage: RuntimeStage | 'completed';
  programId: string;
  occurredAt: string;
}

export interface RuntimeAuditArtifact {
  schemaVersion: 1;
  streamId: string;
  events: RuntimeAuditEvent[];
  eventCount: number;
  highWaterSequence: number;
  headHash: string;
}

export type RuntimeErrorCode =
  | 'INVALID_CHARTER'
  | 'WORKFLOW_FAILED'
  | 'RETRIEVAL_FAILED'
  | 'INVALID_LOCATOR'
  | 'ARTIFACT_INTEGRITY_FAILED'
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
