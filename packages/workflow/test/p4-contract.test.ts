import { describe, expect, it, vi } from 'vitest';
import {
  P4_CELL_ROLES,
  createP4CellPlanApplicationContract,
  createP4CellPlanContinueAsNewCarry,
  createP4CellWorkItemApplicationContract,
  createP4CellWorkItemContinueAsNewCarry,
  deriveP4CellPlanId,
  deriveP4CellWorkItemId,
  deriveP4ResearchCellWorkflowId,
  parseP4CellPlanContinueAsNewCarry,
  parseP4CellWorkItemContinueAsNewCarry,
  reconstructP4CellPlanAfterContinueAsNew,
  reconstructP4CellWorkItemAfterContinueAsNew,
  type P4CellPlanIdentity,
  type P4CellWorkItemIdentity,
} from '../src/index.js';

const digestA =
  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const digestB =
  'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const digestC =
  'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';

const cellPlan: P4CellPlanIdentity = {
  programId: 'program-alpha',
  criterion: {
    criterionId: 'criterion-alpha',
    criterionVersion: 2,
    criterionDigest: digestA,
    branchId: 'branch-main',
  },
  cellPlanId: 'cell-plan-divergence',
  cellPlanVersion: 'cell-plan-v3',
  branchId: 'branch-main',
  role: 'divergence',
};

const workItem: P4CellWorkItemIdentity = {
  cellPlan,
  workItemId: 'work-item-position',
  workItemVersion: 'work-item-v1',
  workRole: 'falsification',
};

describe('P4 cell workflow and application carriage contracts', () => {
  it('freezes supported cell roles and derives IDs from criterion digest, plan version, branch, and role', () => {
    expect(P4_CELL_ROLES).toEqual([
      'landscape',
      'divergence',
      'prior_art',
      'falsification',
      'experiment',
      'synthesis',
    ]);

    const planId = deriveP4CellPlanId(cellPlan);
    expect(planId).toContain('cell-plan');
    expect(deriveP4CellPlanId({ ...cellPlan })).toBe(planId);
    expect(
      deriveP4CellPlanId({
        ...cellPlan,
        criterion: { ...cellPlan.criterion, criterionDigest: digestB },
      }),
    ).not.toBe(planId);
    expect(
      deriveP4CellPlanId({ ...cellPlan, cellPlanVersion: 'cell-plan-v4' }),
    ).not.toBe(planId);
    expect(deriveP4CellPlanId({ ...cellPlan, role: 'synthesis' })).not.toBe(
      planId,
    );
    expect(deriveP4ResearchCellWorkflowId(cellPlan)).toContain(
      encodeURIComponent(planId),
    );
  });

  it('creates closed versioned application contracts for plans and work items', () => {
    const plan = createP4CellPlanApplicationContract({
      identity: cellPlan,
      planInputDigest: digestB,
      outputContractDigest: digestC,
    });
    expect(plan).toMatchObject({
      contractMajor: 1,
      schemaVersion: 1,
      stableCellPlanId: deriveP4CellPlanId(cellPlan),
    });

    const item = createP4CellWorkItemApplicationContract({
      identity: workItem,
      workInputDigest: digestB,
      requiredOutputDigest: digestC,
    });
    expect(item).toMatchObject({
      contractMajor: 1,
      schemaVersion: 1,
      stableWorkItemId: deriveP4CellWorkItemId(workItem),
    });
    expect(() =>
      createP4CellPlanApplicationContract({
        identity: { ...cellPlan, startedAt: '2026-07-13T00:00:00Z' } as never,
        planInputDigest: digestB,
        outputContractDigest: digestC,
      }),
    ).toThrow('P4 cell plan identity has invalid fields');
    expect(() =>
      createP4CellWorkItemApplicationContract({
        identity: workItem,
        workInputDigest: 'not-a-digest',
        requiredOutputDigest: digestC,
      }),
    ).toThrow('workInputDigest must be a sha256 digest');
  });

  it('carries stable identifiers only across continueAsNew and reconstructs through ports', async () => {
    const planCarry = createP4CellPlanContinueAsNewCarry(cellPlan);
    expect(Object.keys(planCarry).sort()).toEqual([
      'branchId',
      'cellPlanId',
      'cellPlanVersion',
      'contractMajor',
      'criterionDigest',
      'criterionId',
      'criterionVersion',
      'programId',
      'role',
      'stableCellPlanId',
      'workflowId',
      'workflowVersion',
    ]);
    expect(JSON.stringify(planCarry)).not.toContain('productState');
    expect(JSON.stringify(planCarry)).not.toContain('positionText');
    expect(JSON.stringify(planCarry)).not.toContain('TemporalHistory');

    const loadCellPlan = vi.fn(() =>
      Promise.resolve({ authoritativeRevision: 41 }),
    );
    await expect(
      reconstructP4CellPlanAfterContinueAsNew(planCarry, { loadCellPlan }),
    ).resolves.toEqual({ authoritativeRevision: 41 });
    expect(loadCellPlan).toHaveBeenCalledWith(cellPlan);

    const itemCarry = createP4CellWorkItemContinueAsNewCarry(workItem);
    expect(Object.keys(itemCarry).sort()).toEqual([
      'branchId',
      'cellPlanId',
      'cellPlanVersion',
      'contractMajor',
      'criterionDigest',
      'criterionId',
      'criterionVersion',
      'programId',
      'role',
      'stableCellPlanId',
      'stableWorkItemId',
      'workItemId',
      'workItemVersion',
      'workRole',
      'workflowId',
      'workflowVersion',
    ]);

    const loadCellWorkItem = vi.fn(() =>
      Promise.resolve({ authoritativeRevision: 42 }),
    );
    await expect(
      reconstructP4CellWorkItemAfterContinueAsNew(itemCarry, {
        loadCellWorkItem,
      }),
    ).resolves.toEqual({ authoritativeRevision: 42 });
    expect(loadCellWorkItem).toHaveBeenCalledWith(workItem);
  });

  it('fails closed on carry authority drift, identity mismatch, and leaked product state', () => {
    const planCarry = createP4CellPlanContinueAsNewCarry(cellPlan);
    expect(() =>
      parseP4CellPlanContinueAsNewCarry({
        ...planCarry,
        productState: { claims: ['invented'] },
      }),
    ).toThrow('P4 cell-plan continue-as-new carry has invalid fields');
    expect(() =>
      parseP4CellPlanContinueAsNewCarry({
        ...planCarry,
        criterionDigest: digestB,
      }),
    ).toThrow('P4 cell-plan carry identity mismatch');
    expect(() =>
      parseP4CellPlanContinueAsNewCarry({
        ...planCarry,
        workflowId: 'wrong',
      }),
    ).toThrow('P4 cell workflow identity mismatch');
    expect(() =>
      parseP4CellPlanContinueAsNewCarry({
        ...planCarry,
        criterionVersion: 'criterion-v2',
      }),
    ).toThrow('criterionVersion must be a positive integer');

    const itemCarry = createP4CellWorkItemContinueAsNewCarry(workItem);
    expect(() =>
      parseP4CellWorkItemContinueAsNewCarry({
        ...itemCarry,
        workRole: 'synthesis',
      }),
    ).toThrow('P4 cell work-item carry identity mismatch');
  });
});
