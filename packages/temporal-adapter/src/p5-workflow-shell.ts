import {
  P5_CONTINUE_AS_NEW_MAX_BOUNDARIES,
  createP5DivergenceReviewCarry,
  deriveP5ActivityId,
  deriveP5DivergenceReviewWorkflowId,
  type P5CancellationPoint,
  type P5DurableBoundary,
} from '@mammoth/workflow';
import type {
  P5DivergenceReviewActivities,
  P5DivergenceReviewResult,
  P5DivergenceReviewWorkflowInput,
} from './p5-workflow-types.js';

export const P5_DIVERGENCE_REVIEW_BOUNDARIES: readonly P5DurableBoundary[] = [
  'budget_reserved',
  'position_dispatched',
  'position_committed',
  'position_revealed',
  'review_assigned',
  'review_committed',
  'budget_settled',
];

const cancellationBeforeBoundary: Record<
  P5CancellationPoint,
  P5DurableBoundary
> = {
  before_dispatch: 'position_dispatched',
  during_generation: 'position_committed',
  after_commit_before_reveal: 'position_revealed',
  during_review: 'review_committed',
  during_settlement: 'budget_settled',
};

export async function executeP5DivergenceReviewShell(
  input: P5DivergenceReviewWorkflowInput,
  activities: P5DivergenceReviewActivities,
): Promise<P5DivergenceReviewResult> {
  const workflowId = deriveP5DivergenceReviewWorkflowId(input.identity);
  let completedBoundaries = [...(input.resumeFrom?.completedBoundaries ?? [])];
  let receiptIds = [...(input.resumeFrom?.receiptIds ?? [])];
  const completed = new Set(completedBoundaries);
  let carryRequired = false;

  for (const boundary of P5_DIVERGENCE_REVIEW_BOUNDARIES) {
    if (completed.has(boundary)) continue;
    if (
      input.cancelAt &&
      cancellationBeforeBoundary[input.cancelAt] === boundary
    ) {
      const receipt = await activities.recordCancellation({
        identity: input.identity,
        workflowId,
        cancellationPoint: input.cancelAt,
        completedBoundaries,
        receiptIds,
        attemptId: input.attemptId,
        activityId: deriveP5ActivityId({
          workflowId,
          boundary: input.cancelAt,
          attemptId: input.attemptId,
          operationKind: 'cancel',
        }),
      });
      return {
        status: 'cancelled',
        workflowId,
        completedBoundaries,
        receiptIds: [...receiptIds, receipt.receiptId],
        partial: true,
        cancellationPoint: input.cancelAt,
        carryRequired,
      };
    }

    const receipt = await activities.runBoundary({
      identity: input.identity,
      workflowId,
      boundary,
      attemptId: input.attemptId,
      activityId: deriveP5ActivityId({
        workflowId,
        boundary,
        attemptId: input.attemptId,
        operationKind: 'durable-boundary',
      }),
    });
    if (!completed.has(boundary)) {
      completed.add(boundary);
      completedBoundaries = [...completedBoundaries, boundary];
    }
    if (!receiptIds.includes(receipt.receiptId))
      receiptIds = [...receiptIds, receipt.receiptId];
    if (
      input.cancelAt === undefined &&
      input.resumeFrom === undefined &&
      completedBoundaries.length >= P5_CONTINUE_AS_NEW_MAX_BOUNDARIES
    ) {
      createP5DivergenceReviewCarry({
        identity: input.identity,
        completedBoundaries,
        receiptIds,
      });
      carryRequired =
        completedBoundaries.length < P5_DIVERGENCE_REVIEW_BOUNDARIES.length;
      if (carryRequired) break;
    }
  }

  return {
    status:
      completedBoundaries.length === P5_DIVERGENCE_REVIEW_BOUNDARIES.length
        ? 'completed'
        : 'cancelled',
    workflowId,
    completedBoundaries,
    receiptIds,
    partial:
      completedBoundaries.length !== P5_DIVERGENCE_REVIEW_BOUNDARIES.length,
    carryRequired,
  };
}
