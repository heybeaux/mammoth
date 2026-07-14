export type P6CellBoundary =
  | 'budget_reserved'
  | 'cell_dispatched'
  | 'cell_completed'
  | 'budget_settled';

export type P6TopologyCancellationPoint =
  | 'before_dispatch'
  | 'during_cell'
  | 'after_child_before_synthesis'
  | 'during_synthesis'
  | 'during_settlement';

export interface P6TopologyIdentity {
  readonly topologyId: string;
  readonly programId: string;
  readonly criterionId: string;
  readonly criterionVersion: number;
  readonly criterionDigest: string;
  readonly topologyPlanVersion: '1.0.0';
  readonly plannerPolicyVersion: '1.0.0';
  readonly templateCatalogVersion: '1.0.0';
  readonly inputDigest: string;
  readonly budgetPolicyVersion: '1.0.0';
}

export interface P6TopologyCellIdentity {
  readonly cellId: string;
  readonly nodeId: string;
  readonly templateId: string;
  readonly templateVersion: '1.0.0';
  readonly dependencyDigest: string;
  readonly workItemContractDigest: string;
  readonly criterionId: string;
  readonly criterionVersion: number;
  readonly criterionDigest: string;
  readonly role: string;
}

export interface P6TopologyWorkflowInput {
  readonly identity: P6TopologyIdentity;
  readonly attemptId: string;
  readonly runPartition: string;
  readonly concurrencyLimit: number;
  readonly cells: readonly P6TopologyCellIdentity[];
  readonly resumeFrom?: {
    readonly completedCellIds: readonly string[];
    readonly receiptIds: readonly string[];
  };
  readonly cancelAt?: P6TopologyCancellationPoint;
}

export interface P6TopologyBoundaryReceipt {
  readonly boundary: P6CellBoundary | P6TopologyCancellationPoint;
  readonly cellId: string;
  readonly activityId: string;
  readonly receiptId: string;
  readonly duplicate: boolean;
  readonly authoritativeRevision: number;
}

export interface P6TopologyWorkflowResult {
  readonly status: 'completed' | 'cancelled';
  readonly workflowId: string;
  readonly completedCellIds: readonly string[];
  readonly childWorkflowIds: readonly string[];
  readonly receiptIds: readonly string[];
  readonly partial: boolean;
  readonly cancellationPoint?: P6TopologyCancellationPoint;
  readonly carryRequired: boolean;
}

export interface P6TopologyActivities {
  runCellBoundary(input: {
    readonly topology: P6TopologyIdentity;
    readonly cell: P6TopologyCellIdentity;
    readonly parentWorkflowId: string;
    readonly childWorkflowId: string;
    readonly boundary: P6CellBoundary;
    readonly attemptId: string;
    readonly activityId: string;
  }): Promise<P6TopologyBoundaryReceipt>;
  recordTopologyCancellation(input: {
    readonly topology: P6TopologyIdentity;
    readonly parentWorkflowId: string;
    readonly cancellationPoint: P6TopologyCancellationPoint;
    readonly completedCellIds: readonly string[];
    readonly receiptIds: readonly string[];
    readonly attemptId: string;
    readonly activityId: string;
  }): Promise<P6TopologyBoundaryReceipt>;
}

export function deriveP6TopologyWorkflowId(
  identity: P6TopologyIdentity,
): string {
  return [
    'mammoth',
    'p6',
    'topology',
    encode(identity.topologyId),
    encode(identity.programId),
    encode(identity.criterionId),
    encode(String(identity.criterionVersion)),
    encode(identity.criterionDigest),
    encode(identity.inputDigest),
  ].join(':');
}

export function deriveP6ChildWorkflowId(input: {
  readonly topologyId: string;
  readonly cellId: string;
  readonly attemptId: string;
  readonly workflowMajor: 1;
  readonly runPartition: string;
}): string {
  return [
    'mammoth',
    'p6',
    'cell',
    encode(input.topologyId),
    encode(input.cellId),
    encode(input.attemptId),
    encode(String(input.workflowMajor)),
    encode(input.runPartition),
  ].join(':');
}

export function deriveP6ActivityId(input: {
  readonly workflowId: string;
  readonly cellId: string;
  readonly boundary: P6CellBoundary | P6TopologyCancellationPoint;
  readonly attemptId: string;
  readonly operationKind: 'durable-boundary' | 'cancel';
}): string {
  return [
    'mammoth',
    'p6',
    'activity',
    encode(input.workflowId),
    encode(input.cellId),
    encode(input.boundary),
    encode(input.attemptId),
    encode(input.operationKind),
  ].join(':');
}

function encode(value: string): string {
  return encodeURIComponent(value);
}
