import {
  continueAsNew,
  defineQuery,
  defineSignal,
  proxyActivities,
  setHandler,
  workflowInfo,
} from '@temporalio/workflow';
import {
  P5_CONTINUE_AS_NEW_MAX_BOUNDARIES,
  createP5DivergenceReviewCarry,
  deriveP5ActivityId,
  deriveP5DivergenceReviewWorkflowId,
  type P5CancellationPoint,
  type P5DurableBoundary,
} from '@mammoth/workflow/p5-contract';
import type {
  P5DivergenceReviewActivities,
  P5DivergenceReviewResult,
  P5DivergenceReviewWorkflowInput,
} from './p5-workflow-types.js';

export const p5DivergenceReviewCancelSignal = defineSignal<
  [P5CancellationPoint]
>('p5DivergenceReview.cancel.v1');
export const p5DivergenceReviewStateQuery = defineQuery<{
  readonly workflowId: string;
  readonly runId: string;
  readonly completedBoundaries: readonly P5DurableBoundary[];
  readonly receiptIds: readonly string[];
  readonly cancellationPoint?: P5CancellationPoint;
}>('p5DivergenceReview.state.v1');

const activities = proxyActivities<P5DivergenceReviewActivities>({
  startToCloseTimeout: '30 seconds',
  heartbeatTimeout: '10 seconds',
  retry: { initialInterval: '250 milliseconds', maximumAttempts: 3 },
});

export const P5_DIVERGENCE_REVIEW_WORKFLOW_BOUNDARIES: readonly P5DurableBoundary[] =
  [
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

export async function p5DivergenceReviewWorkflow(
  input: P5DivergenceReviewWorkflowInput,
): Promise<P5DivergenceReviewResult> {
  const workflowId = deriveP5DivergenceReviewWorkflowId(input.identity);
  if (workflowInfo().workflowId !== workflowId) {
    throw new Error('P5 workflow ID does not match stable divergence identity');
  }
  let completedBoundaries = [...(input.resumeFrom?.completedBoundaries ?? [])];
  let receiptIds = [...(input.resumeFrom?.receiptIds ?? [])];
  const completed = new Set(completedBoundaries);
  let cancellationPoint = input.cancelAt;

  setHandler(p5DivergenceReviewCancelSignal, (next) => {
    cancellationPoint = next;
  });
  setHandler(p5DivergenceReviewStateQuery, () => ({
    workflowId,
    runId: workflowInfo().runId,
    completedBoundaries,
    receiptIds,
    ...(cancellationPoint === undefined ? {} : { cancellationPoint }),
  }));

  for (const boundary of P5_DIVERGENCE_REVIEW_WORKFLOW_BOUNDARIES) {
    if (completed.has(boundary)) continue;
    if (
      cancellationPoint &&
      cancellationBeforeBoundary[cancellationPoint] === boundary
    ) {
      const receipt = await activities.recordCancellation({
        identity: input.identity,
        workflowId,
        cancellationPoint,
        completedBoundaries,
        receiptIds,
        attemptId: input.attemptId,
        activityId: deriveP5ActivityId({
          workflowId,
          boundary: cancellationPoint,
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
        cancellationPoint,
        carryRequired: false,
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
      input.resumeFrom === undefined &&
      completedBoundaries.length >= P5_CONTINUE_AS_NEW_MAX_BOUNDARIES &&
      completedBoundaries.length <
        P5_DIVERGENCE_REVIEW_WORKFLOW_BOUNDARIES.length
    ) {
      createP5DivergenceReviewCarry({
        identity: input.identity,
        completedBoundaries,
        receiptIds,
      });
      await continueAsNew<typeof p5DivergenceReviewWorkflow>({
        ...input,
        resumeFrom: { completedBoundaries, receiptIds },
      });
    }
  }

  return {
    status: 'completed',
    workflowId,
    completedBoundaries,
    receiptIds,
    partial: false,
    carryRequired: false,
  };
}
