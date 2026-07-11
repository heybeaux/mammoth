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
  operator: string;
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

export type RuntimeProgramStatus =
  | 'pending'
  | 'running'
  | 'waiting'
  | 'paused'
  | 'interrupted'
  | 'completed'
  | 'cancelled';

export interface RuntimeProgramStatusResult {
  programId: string;
  status: RuntimeProgramStatus;
  executionId?: string;
  updatedAt?: string;
  resumable: boolean;
  paths: RuntimeArtifactPaths;
  error?: string;
}

export interface RuntimeProgramReference {
  rootDirectory: string;
  programId: string;
}

export interface RuntimeResumeOptions extends RuntimeProgramReference {
  transport: SourceTransport;
  resolveHost?: (hostname: string) => Promise<readonly string[]>;
  now?: () => Date;
  onStage?: (stage: RuntimeStage) => void | Promise<void>;
}

export interface RuntimeCancelOptions extends RuntimeProgramReference {
  now?: () => Date;
}

export interface RuntimePartialReceipt {
  id: string;
  programId: string;
  executionId?: string;
  status: 'cancelled';
  publicationStatus: 'partial';
  completedArtifacts: Record<string, string>;
  missingArtifacts: string[];
  issuedAt: string;
  integrityHash: string;
}

export interface RuntimeInspection {
  status: RuntimeProgramStatusResult;
  artifacts: Record<
    string,
    { path: string; present: boolean; byteLength?: number }
  >;
  receipt?: unknown;
  executions: {
    id: string;
    status: string;
    attempt: number;
    updatedAt: string;
    error?: string;
  }[];
  ledger?: {
    claimCount: number;
    evidenceCount: number;
    assessmentCount: number;
  };
}

export type RuntimeErrorCode =
  | 'INVALID_CHARTER'
  | 'WORKFLOW_FAILED'
  | 'RETRIEVAL_FAILED'
  | 'CLAIM_COMMIT_DENIED'
  | 'REPORT_COMPILATION_FAILED'
  | 'PROGRAM_NOT_FOUND'
  | 'INVALID_PROGRAM_ID'
  | 'PROGRAM_CANCELLED'
  | 'PROGRAM_NOT_RESUMABLE';

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
