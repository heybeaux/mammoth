import type {
  ProgramBranchIdentity,
  ResearchProgramStageId,
  ResearchProgramWorkflowVersion,
  WorkflowControlState,
} from '@mammoth/workflow';

export interface ResearchProgramWorkflowInput {
  readonly identity: ProgramBranchIdentity;
  readonly workflowVersion: ResearchProgramWorkflowVersion;
  readonly cycle?: number;
  /** A deterministic gate specification; the decision itself arrives by signal. */
  readonly humanGate?: {
    readonly gateId: string;
    readonly beforeStage: ResearchProgramStageId;
    readonly timeoutMs: number;
  };
}

export interface ResearchStageReceipt {
  readonly stageId: ResearchProgramStageId;
  readonly receiptId: string;
  readonly productRevisionId: string;
}

export interface ResearchProgramDurableState {
  readonly completedStages: readonly ResearchProgramStageId[];
  readonly receipts: readonly ResearchStageReceipt[];
  readonly receiptReferences?: readonly string[];
  readonly humanGate?: ResearchProgramWorkflowInput['humanGate'];
  readonly activeBranch?: ProgramBranchIdentity;
  /** Persisted orchestration metadata; never authoritative product state. */
  readonly control?: WorkflowControlState;
  readonly retry: {
    readonly stageId?: ResearchProgramStageId;
    readonly attempt: number;
  };
}

export interface PendingHumanGate {
  readonly gateId: string;
  readonly beforeStage: ResearchProgramStageId;
  readonly status: 'pending' | 'approved' | 'rejected' | 'expired';
  readonly receiptId?: string;
}

export interface ResearchProgramInspection {
  readonly workflowId: string;
  readonly runId: string;
  readonly workflowVersion: ResearchProgramWorkflowVersion;
  readonly cycle: number;
  readonly revision: number;
  /** Control-plane branch selection; product state remains activity-owned. */
  readonly activeBranch: ProgramBranchIdentity;
  readonly status:
    | 'running'
    | 'paused'
    | 'waiting-human'
    | 'cancelled'
    | 'failed'
    | 'completed';
  readonly durableStep?: ResearchProgramStageId;
  readonly completedStages: readonly ResearchProgramStageId[];
  readonly pendingGates: readonly PendingHumanGate[];
  readonly cancellation: {
    readonly requested: boolean;
    readonly reason?: string;
  };
  readonly retry: ResearchProgramDurableState['retry'];
  readonly receiptReferences: readonly string[];
  readonly processedSignalIds: readonly string[];
}

export interface ResearchProgramResult {
  readonly status: 'completed' | 'cancelled' | 'rejected' | 'gate-timeout';
  readonly workflowId: string;
  readonly completedStages: readonly ResearchProgramStageId[];
  readonly activeBranch: ProgramBranchIdentity;
  readonly receiptReferences: readonly string[];
  readonly partial: boolean;
  readonly reason?: string;
}

export interface ResearchProgramActivities {
  ensureResearchProgramControlPlan(input: {
    readonly identity: ProgramBranchIdentity;
    readonly humanGate?: ResearchProgramWorkflowInput['humanGate'];
  }): Promise<void>;
  loadResearchProgramState(
    identity: ProgramBranchIdentity,
  ): Promise<ResearchProgramDurableState>;
  executeResearchStage(input: {
    readonly identity: ProgramBranchIdentity;
    readonly workflowVersion: ResearchProgramWorkflowVersion;
    readonly stageId: ResearchProgramStageId;
  }): Promise<ResearchStageReceipt>;
  recordHumanGateDecision(input: {
    readonly identity: ProgramBranchIdentity;
    readonly gateId: string;
    readonly decision: 'approve' | 'reject';
    readonly receiptId: string;
  }): Promise<void>;
  recordCriterionBranch(input: {
    readonly workflowIdentity: ProgramBranchIdentity;
    readonly activeBranch: ProgramBranchIdentity;
  }): Promise<void>;
  saveResearchProgramControlState(input: {
    readonly identity: ProgramBranchIdentity;
    readonly control: WorkflowControlState;
  }): Promise<void>;
  recordResearchProgramTermination(input: {
    readonly identity: ProgramBranchIdentity;
    readonly status: 'cancelled' | 'rejected' | 'gate-timeout';
    readonly completedStages: readonly ResearchProgramStageId[];
    readonly receiptReferences: readonly string[];
    readonly reason?: string;
  }): Promise<{ readonly receiptId: string }>;
}
