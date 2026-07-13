import type {
  P4CellPlanIdentity,
  P4CellWorkItemIdentity,
  P5DivergenceReviewIdentity,
} from '@mammoth/workflow';
import { describe, expect, it, vi } from 'vitest';
import {
  P5_DIVERGENCE_REVIEW_BOUNDARIES,
  executeP5DivergenceReviewShell,
  type P5DivergenceReviewActivities,
} from '../src/index.js';

const digest =
  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

const cellPlan: P4CellPlanIdentity = {
  programId: 'program-p5-temporal',
  criterion: {
    criterionId: 'criterion-p5',
    criterionVersion: 1,
    criterionDigest: digest,
    branchId: 'main',
  },
  cellPlanId: 'cell-plan-p5',
  cellPlanVersion: 'cell-plan-v1',
  branchId: 'main',
  role: 'divergence',
};

const positionWorkItem: P4CellWorkItemIdentity = {
  cellPlan,
  workItemId: 'position-a',
  workItemVersion: 'position-v1',
  workRole: 'divergence',
};

const reviewWorkItem: P4CellWorkItemIdentity = {
  cellPlan: { ...cellPlan, role: 'falsification' },
  workItemId: 'review-a',
  workItemVersion: 'review-v1',
  workRole: 'falsification',
};

const identity: P5DivergenceReviewIdentity = {
  positionWorkItem,
  reviewWorkItem,
  isolationProtocolVersion: '1.0.0',
  assignmentPolicyVersion: '1.0.0',
  sanitizedContextContractVersion: '1.0.0',
};

describe('P5 Temporal divergence/review shell', () => {
  it('uses stable idempotency identities and bounded continue-as-new carry', async () => {
    const activities = fakeActivities();
    const firstRun = await executeP5DivergenceReviewShell(
      { identity, attemptId: 'attempt-1' },
      activities,
    );
    expect(firstRun.carryRequired).toBe(true);
    expect(firstRun.completedBoundaries).toEqual([
      'budget_reserved',
      'position_dispatched',
      'position_committed',
    ]);
    expect(
      activities.runBoundary.mock.calls.map(([input]) => [
        input.boundary,
        input.activityId,
      ]),
    ).toEqual([
      ['budget_reserved', activities.runBoundary.mock.calls[0]?.[0].activityId],
      [
        'position_dispatched',
        activities.runBoundary.mock.calls[1]?.[0].activityId,
      ],
      [
        'position_committed',
        activities.runBoundary.mock.calls[2]?.[0].activityId,
      ],
    ]);

    const secondRun = await executeP5DivergenceReviewShell(
      {
        identity,
        attemptId: 'attempt-1',
        resumeFrom: {
          completedBoundaries: firstRun.completedBoundaries,
          receiptIds: firstRun.receiptIds,
        },
      },
      activities,
    );
    expect(secondRun.completedBoundaries).toEqual(
      P5_DIVERGENCE_REVIEW_BOUNDARIES,
    );
    expect(new Set(secondRun.receiptIds).size).toBe(
      secondRun.receiptIds.length,
    );
  });

  it.each([
    ['before_dispatch', ['budget_reserved']],
    ['during_generation', ['budget_reserved', 'position_dispatched']],
    [
      'after_commit_before_reveal',
      ['budget_reserved', 'position_dispatched', 'position_committed'],
    ],
    [
      'during_review',
      [
        'budget_reserved',
        'position_dispatched',
        'position_committed',
        'position_revealed',
        'review_assigned',
      ],
    ],
    [
      'during_settlement',
      [
        'budget_reserved',
        'position_dispatched',
        'position_committed',
        'position_revealed',
        'review_assigned',
        'review_committed',
      ],
    ],
  ] as const)(
    'returns honest partial results for cancellation %s',
    async (cancelAt, expectedCompleted) => {
      const activities = fakeActivities();
      const result = await executeP5DivergenceReviewShell(
        { identity, attemptId: 'attempt-cancel', cancelAt },
        activities,
      );
      expect(result).toMatchObject({
        status: 'cancelled',
        partial: true,
        cancellationPoint: cancelAt,
        completedBoundaries: expectedCompleted,
      });
      expect(activities.recordCancellation).toHaveBeenCalledTimes(1);
      expect(result.receiptIds.at(-1)).toBe(`receipt:cancel:${cancelAt}`);
    },
  );

  it('does not duplicate authoritative effects on duplicate activity delivery', async () => {
    const activities = fakeActivities();
    const first = await executeP5DivergenceReviewShell(
      { identity, attemptId: 'attempt-dup' },
      activities,
    );
    const duplicate = await executeP5DivergenceReviewShell(
      { identity, attemptId: 'attempt-dup' },
      activities,
    );
    expect(duplicate.receiptIds).toEqual(first.receiptIds);
    expect(
      activities.runBoundary.mock.results.some(
        (result) => result.type === 'return',
      ),
    ).toBe(true);
  });
});

function fakeActivities() {
  const seen = new Map<string, string>();
  const runBoundary = vi.fn<P5DivergenceReviewActivities['runBoundary']>(
    async (input) => {
      await Promise.resolve();
      const existing = seen.get(input.activityId);
      const receiptId = existing ?? `receipt:${input.boundary}`;
      seen.set(input.activityId, receiptId);
      return {
        boundary: input.boundary,
        activityId: input.activityId,
        receiptId,
        duplicate: existing !== undefined,
        authoritativeRevision: seen.size,
      };
    },
  );
  const recordCancellation = vi.fn<
    P5DivergenceReviewActivities['recordCancellation']
  >(async (input) => {
    await Promise.resolve();
    return {
      boundary: input.cancellationPoint,
      activityId: input.activityId,
      receiptId: `receipt:cancel:${input.cancellationPoint}`,
      duplicate: false,
      authoritativeRevision: 100,
    };
  });
  return {
    runBoundary,
    recordCancellation,
  };
}
