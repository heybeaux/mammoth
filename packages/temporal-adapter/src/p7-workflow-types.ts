import type {
  P7ResearchInspection,
  P7ResearchRunRequest,
  P7ResearchStatus,
} from '@mammoth/workflow/p7-contract';

export const P7_MODEL_PROVIDER_TASK_QUEUE = 'mammoth-local-large-v1';

export interface P7LiveCellIdentity {
  readonly cellId: string;
  readonly modelWorkId: string;
  readonly modelWorkIdentityDigest: string;
  readonly providerAttemptId: string;
  readonly providerAttemptDigest: string;
}

export interface P7LiveResearchWorkflowInput {
  readonly request: P7ResearchRunRequest;
  readonly cells: readonly P7LiveCellIdentity[];
  readonly carry?: P7LiveResearchCarry;
}

export interface P7LiveResearchCarry {
  readonly authoritativeRevision: number;
  readonly completedCellIds: readonly string[];
  readonly failedCellIds: readonly string[];
  readonly cancelledCellIds: readonly string[];
  readonly unresolvedCellIds: readonly string[];
  readonly receiptIds: readonly string[];
  readonly processedSignalIds: readonly string[];
}

export interface P7CellExecutionResult {
  readonly cellId: string;
  readonly status: 'completed' | 'failed' | 'cancelled';
  readonly retryable: boolean;
  readonly receiptIds: readonly string[];
  readonly failureCode?: string;
  readonly authoritativeStatus: P7ResearchStatus;
}

export type P7ResearchControlSignal =
  | {
      readonly kind: 'resume';
      readonly signalId: string;
      readonly expectedRevision: number;
    }
  | {
      readonly kind: 'cancel';
      readonly signalId: string;
      readonly expectedRevision: number;
      readonly reason: string;
    };

export interface P7ResearchWorkflowResult extends P7ResearchStatus {
  readonly partial: boolean;
}

export interface P7ResearchActivities {
  ensureRun(input: {
    readonly runId: string;
    readonly request: P7ResearchRunRequest;
    readonly cells: readonly P7LiveCellIdentity[];
  }): Promise<P7ResearchStatus>;
  reconstructRun(runId: string): Promise<P7ResearchStatus>;
  executeCell(input: {
    readonly runId: string;
    readonly request: P7ResearchRunRequest;
    readonly cells: readonly P7LiveCellIdentity[];
    readonly cell: P7LiveCellIdentity;
  }): Promise<P7CellExecutionResult>;
  recordCancellation(input: {
    readonly runId: string;
    readonly request: P7ResearchRunRequest;
    readonly cells: readonly P7LiveCellIdentity[];
    readonly reason: string;
    readonly completedCellIds: readonly string[];
    readonly failedCellIds: readonly string[];
    readonly unresolvedCellIds: readonly string[];
  }): Promise<{
    readonly receiptId: string;
    readonly authoritativeStatus: P7ResearchStatus;
  }>;
  finalizeRun(input: {
    readonly request: P7ResearchRunRequest;
    readonly cells: readonly P7LiveCellIdentity[];
    readonly status: P7ResearchStatus;
  }): Promise<P7ResearchStatus>;
  inspectRun(runId: string): Promise<P7ResearchInspection>;
}
