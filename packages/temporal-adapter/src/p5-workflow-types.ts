import type {
  P5CancellationPoint,
  P5DivergenceReviewIdentity,
  P5DurableBoundary,
} from '@mammoth/workflow';

export interface P5DivergenceReviewWorkflowInput {
  readonly identity: P5DivergenceReviewIdentity;
  readonly attemptId: string;
  readonly resumeFrom?: {
    readonly completedBoundaries: readonly P5DurableBoundary[];
    readonly receiptIds: readonly string[];
  };
  readonly cancelAt?: P5CancellationPoint;
}

export interface P5BoundaryReceipt {
  readonly boundary: P5DurableBoundary | P5CancellationPoint;
  readonly activityId: string;
  readonly receiptId: string;
  readonly duplicate: boolean;
  readonly authoritativeRevision: number;
}

export interface P5DivergenceReviewResult {
  readonly status: 'completed' | 'cancelled';
  readonly workflowId: string;
  readonly completedBoundaries: readonly P5DurableBoundary[];
  readonly receiptIds: readonly string[];
  readonly partial: boolean;
  readonly cancellationPoint?: P5CancellationPoint;
  readonly carryRequired: boolean;
}

export interface P5DivergenceReviewActivities {
  runBoundary(input: {
    readonly identity: P5DivergenceReviewIdentity;
    readonly workflowId: string;
    readonly boundary: P5DurableBoundary;
    readonly attemptId: string;
    readonly activityId: string;
  }): Promise<P5BoundaryReceipt>;
  recordCancellation(input: {
    readonly identity: P5DivergenceReviewIdentity;
    readonly workflowId: string;
    readonly cancellationPoint: P5CancellationPoint;
    readonly completedBoundaries: readonly P5DurableBoundary[];
    readonly receiptIds: readonly string[];
    readonly attemptId: string;
    readonly activityId: string;
  }): Promise<P5BoundaryReceipt>;
}
