import { fileURLToPath } from 'node:url';
import type {
  P4CellPlanIdentity,
  P4CellWorkItemIdentity,
} from '@mammoth/workflow/p4-contract';
import {
  deriveP5DivergenceReviewWorkflowId,
  type P5DivergenceReviewIdentity,
} from '@mammoth/workflow/p5-contract';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { describe, expect, it } from 'vitest';
import {
  p5DivergenceReviewStateQuery,
  p5DivergenceReviewWorkflow,
  type P5DivergenceReviewActivities,
} from '../src/index.js';

const digest =
  'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

const cellPlan: P4CellPlanIdentity = {
  programId: 'program-p5-live',
  criterion: {
    criterionId: 'criterion-p5-live',
    criterionVersion: 1,
    criterionDigest: digest,
    branchId: 'main',
  },
  cellPlanId: 'cell-plan-p5-live',
  cellPlanVersion: 'cell-plan-v1',
  branchId: 'main',
  role: 'divergence',
};

const positionWorkItem: P4CellWorkItemIdentity = {
  cellPlan,
  workItemId: 'position-live',
  workItemVersion: 'position-v1',
  workRole: 'divergence',
};

const reviewWorkItem: P4CellWorkItemIdentity = {
  cellPlan: { ...cellPlan, role: 'falsification' },
  workItemId: 'review-live',
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

describe('P5 live Temporal divergence/review workflow', () => {
  it('runs with stable IDs, query state, continue-as-new, and replayable history', async () => {
    const testEnv = await TestWorkflowEnvironment.createTimeSkipping();
    const taskQueue = 'mammoth-p5-live-workflow';
    const workflowsPath = fileURLToPath(
      new URL('../src/p5-workflows.ts', import.meta.url),
    );
    const receipts = new Map<string, string>();
    const activities: P5DivergenceReviewActivities = {
      runBoundary: async (input) => {
        await Promise.resolve();
        const existing = receipts.get(input.activityId);
        const receiptId = existing ?? `receipt:${input.boundary}`;
        receipts.set(input.activityId, receiptId);
        return {
          boundary: input.boundary,
          activityId: input.activityId,
          receiptId,
          duplicate: existing !== undefined,
          authoritativeRevision: receipts.size,
        };
      },
      recordCancellation: async (input) => {
        await Promise.resolve();
        return {
          boundary: input.cancellationPoint,
          activityId: input.activityId,
          receiptId: `receipt:cancel:${input.cancellationPoint}`,
          duplicate: false,
          authoritativeRevision: receipts.size + 1,
        };
      },
    };
    try {
      const worker = await Worker.create({
        connection: testEnv.nativeConnection,
        ...(testEnv.namespace === undefined
          ? {}
          : { namespace: testEnv.namespace }),
        taskQueue,
        workflowsPath,
        activities,
      });
      const result = await worker.runUntil(async () => {
        const handle = await testEnv.client.workflow.start(
          p5DivergenceReviewWorkflow,
          {
            workflowId: deriveP5DivergenceReviewWorkflowId(identity),
            taskQueue,
            args: [{ identity, attemptId: 'attempt-live' }],
          },
        );
        let queried = await handle.query(p5DivergenceReviewStateQuery);
        for (let index = 0; index < 20; index += 1) {
          if (queried.completedBoundaries.length > 0) break;
          await testEnv.sleep('100 milliseconds');
          queried = await handle.query(p5DivergenceReviewStateQuery);
        }
        const completed = await handle.result();
        const history = await handle.fetchHistory();
        await Worker.runReplayHistory(
          { workflowsPath },
          history,
          handle.workflowId,
        );
        return {
          queried,
          completed,
          historyLength: history.events?.length ?? 0,
        };
      });

      expect(result.queried.completedBoundaries.length).toBeGreaterThan(0);
      expect(result.completed).toMatchObject({
        status: 'completed',
        partial: false,
        completedBoundaries: [
          'budget_reserved',
          'position_dispatched',
          'position_committed',
          'position_revealed',
          'review_assigned',
          'review_committed',
          'budget_settled',
        ],
      });
      expect(result.completed.receiptIds).toHaveLength(7);
      expect(result.historyLength).toBeGreaterThan(0);
    } finally {
      await testEnv.teardown();
    }
  }, 120_000);
});
