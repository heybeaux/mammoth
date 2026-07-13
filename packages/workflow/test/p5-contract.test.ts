import { describe, expect, it, vi } from 'vitest';
import {
  createP5DivergenceReviewCarry,
  deriveP4CellWorkItemId,
  deriveP5ActivityId,
  deriveP5DivergenceReviewWorkflowId,
  parseP5DivergenceReviewCarry,
  reconstructP5DivergenceReviewAfterContinueAsNew,
  type P4CellPlanIdentity,
  type P4CellWorkItemIdentity,
  type P5DivergenceReviewIdentity,
} from '../src/index.js';

const digest =
  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

const cellPlan: P4CellPlanIdentity = {
  programId: 'program-p5',
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

describe('P5 divergence/review workflow contracts', () => {
  it('derives stable workflow and Activity IDs from versioned work identities', () => {
    const workflowId = deriveP5DivergenceReviewWorkflowId(identity);
    expect(workflowId).toContain('DivergenceReviewWorkflow');
    expect(deriveP5DivergenceReviewWorkflowId({ ...identity })).toBe(
      workflowId,
    );
    expect(
      deriveP5DivergenceReviewWorkflowId({
        ...identity,
        reviewWorkItem: {
          ...reviewWorkItem,
          workItemVersion: 'review-v2',
        },
      }),
    ).not.toBe(workflowId);

    expect(
      deriveP5ActivityId({
        workflowId,
        boundary: 'position_committed',
        attemptId: 'attempt-1',
        operationKind: 'commit-position',
      }),
    ).toBe(
      deriveP5ActivityId({
        workflowId,
        boundary: 'position_committed',
        attemptId: 'attempt-1',
        operationKind: 'commit-position',
      }),
    );
  });

  it('carries only stable identifiers and bounded receipts across continueAsNew', async () => {
    const carry = createP5DivergenceReviewCarry({
      identity,
      completedBoundaries: ['budget_reserved', 'position_committed'],
      receiptIds: ['receipt-budget', 'receipt-position'],
    });
    expect(carry).toMatchObject({
      p5ContractMajor: 1,
      p5WorkflowVersion: 1,
      p5WorkflowId: deriveP5DivergenceReviewWorkflowId(identity),
      stableWorkItemId: deriveP4CellWorkItemId(positionWorkItem),
      reviewStableWorkItemId: deriveP4CellWorkItemId(reviewWorkItem),
      completedBoundaries: ['budget_reserved', 'position_committed'],
    });
    expect(JSON.stringify(carry)).not.toContain('productState');
    expect(JSON.stringify(carry)).not.toContain('TemporalHistory');
    expect(JSON.stringify(carry)).not.toContain('reviewerContext');

    const loadDivergenceReviewState = vi.fn(() =>
      Promise.resolve({ authoritativeRevision: 9 }),
    );
    await expect(
      reconstructP5DivergenceReviewAfterContinueAsNew(carry, identity, {
        loadDivergenceReviewState,
      }),
    ).resolves.toEqual({ authoritativeRevision: 9 });
    expect(loadDivergenceReviewState).toHaveBeenCalledWith({
      identity,
      completedBoundaries: ['budget_reserved', 'position_committed'],
      receiptIds: ['receipt-budget', 'receipt-position'],
    });
  });

  it('fails closed on hidden product state, identity drift, unsupported versions, and oversized carry', async () => {
    const carry = createP5DivergenceReviewCarry({
      identity,
      completedBoundaries: ['budget_reserved'],
      receiptIds: ['receipt-budget'],
    });
    expect(() =>
      parseP5DivergenceReviewCarry({
        ...carry,
        positionText: 'hidden product state',
      }),
    ).toThrow('P5 divergence/review carry has invalid fields');
    expect(() =>
      parseP5DivergenceReviewCarry({
        ...carry,
        p5WorkflowVersion: 2,
      }),
    ).toThrow('unsupported P5 divergence/review workflow version');
    expect(() =>
      parseP5DivergenceReviewCarry({
        ...carry,
        completedBoundaries: [
          'budget_reserved',
          'position_dispatched',
          'position_committed',
          'position_revealed',
        ],
      }),
    ).toThrow('P5 continue-as-new carry is too large');
    await expect(
      reconstructP5DivergenceReviewAfterContinueAsNew(
        carry,
        {
          ...identity,
          reviewWorkItem: { ...reviewWorkItem, workItemId: 'review-b' },
        },
        { loadDivergenceReviewState: vi.fn() },
      ),
    ).rejects.toThrow('P5 carry workflow identity mismatch');
  });
});
