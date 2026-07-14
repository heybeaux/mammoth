import { describe, expect, it, vi } from 'vitest';
import {
  P6_TOPOLOGY_CELL_BOUNDARIES,
  executeP6TopologyShell,
} from '../src/p6-workflow-shell.js';
import {
  deriveP6ChildWorkflowId,
  deriveP6TopologyWorkflowId,
  type P6TopologyActivities,
  type P6TopologyCellIdentity,
  type P6TopologyIdentity,
} from '../src/p6-workflow-types.js';

const digest =
  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

const topology: P6TopologyIdentity = {
  topologyId: 'topology-p6',
  programId: 'program-p6',
  criterionId: 'criterion-p6',
  criterionVersion: 1,
  criterionDigest: digest,
  topologyPlanVersion: '1.0.0',
  plannerPolicyVersion: '1.0.0',
  templateCatalogVersion: '1.0.0',
  inputDigest: digest,
  budgetPolicyVersion: '1.0.0',
};

const cells: readonly P6TopologyCellIdentity[] = [
  cell('landscape', 'retriever'),
  cell('divergence', 'lateralist'),
  cell('synthesis', 'compiler'),
];

describe('P6 Temporal parent/child topology shell', () => {
  it('derives stable parent and child workflow IDs and carries bounded history', async () => {
    const activities = fakeActivities();
    const first = await executeP6TopologyShell(
      {
        identity: topology,
        attemptId: 'attempt-1',
        runPartition: 'main',
        concurrencyLimit: 2,
        cells,
      },
      activities,
    );

    expect(first.workflowId).toBe(deriveP6TopologyWorkflowId(topology));
    expect(first.carryRequired).toBe(true);
    expect(first.completedCellIds).toEqual([
      'cell-landscape',
      'cell-divergence',
    ]);
    expect(first.childWorkflowIds).toEqual(
      cells.slice(0, 2).map((candidate) =>
        deriveP6ChildWorkflowId({
          topologyId: topology.topologyId,
          cellId: candidate.cellId,
          attemptId: 'attempt-1',
          workflowMajor: 1,
          runPartition: 'main',
        }),
      ),
    );
    expect(activities.runCellBoundary).toHaveBeenCalledTimes(
      2 * P6_TOPOLOGY_CELL_BOUNDARIES.length,
    );

    const second = await executeP6TopologyShell(
      {
        identity: topology,
        attemptId: 'attempt-1',
        runPartition: 'main',
        concurrencyLimit: 2,
        cells,
        resumeFrom: {
          completedCellIds: first.completedCellIds,
          receiptIds: first.receiptIds,
        },
      },
      activities,
    );
    expect(second.status).toBe('completed');
    expect(second.completedCellIds).toEqual(cells.map(({ cellId }) => cellId));
    expect(new Set(second.receiptIds).size).toBe(second.receiptIds.length);
  });

  it.each([
    ['before_dispatch', []],
    ['during_cell', []],
    ['during_settlement', []],
  ] as const)(
    'propagates cancellation %s with honest partial receipts',
    async (cancelAt, expectedCompleted) => {
      const activities = fakeActivities();
      const result = await executeP6TopologyShell(
        {
          identity: topology,
          attemptId: 'attempt-cancel',
          runPartition: 'main',
          concurrencyLimit: 1,
          cells,
          cancelAt,
        },
        activities,
      );
      expect(result).toMatchObject({
        status: 'cancelled',
        partial: true,
        cancellationPoint: cancelAt,
        completedCellIds: expectedCompleted,
      });
      expect(activities.recordTopologyCancellation).toHaveBeenCalledTimes(1);
      expect(result.receiptIds.at(-1)).toBe(`receipt:cancel:${cancelAt}`);
    },
  );

  it('does not duplicate authoritative receipts when activity delivery repeats', async () => {
    const activities = fakeActivities();
    const first = await executeP6TopologyShell(
      {
        identity: topology,
        attemptId: 'attempt-dup',
        runPartition: 'main',
        concurrencyLimit: 2,
        cells: cells.slice(0, 1),
      },
      activities,
    );
    const duplicate = await executeP6TopologyShell(
      {
        identity: topology,
        attemptId: 'attempt-dup',
        runPartition: 'main',
        concurrencyLimit: 2,
        cells: cells.slice(0, 1),
      },
      activities,
    );
    expect(duplicate.receiptIds).toEqual(first.receiptIds);
  });
});

function cell(templateId: string, role: string): P6TopologyCellIdentity {
  return {
    cellId: `cell-${templateId}`,
    nodeId: `node-${templateId}`,
    templateId,
    templateVersion: '1.0.0',
    dependencyDigest: digest,
    workItemContractDigest: digest,
    criterionId: topology.criterionId,
    criterionVersion: topology.criterionVersion,
    criterionDigest: topology.criterionDigest,
    role,
  };
}

function fakeActivities() {
  const seen = new Map<string, string>();
  const runCellBoundary = vi.fn<P6TopologyActivities['runCellBoundary']>(
    async (input) => {
      await Promise.resolve();
      const receiptId =
        seen.get(input.activityId) ??
        `receipt:${input.cell.cellId}:${input.boundary}`;
      const duplicate = seen.has(input.activityId);
      seen.set(input.activityId, receiptId);
      return {
        boundary: input.boundary,
        cellId: input.cell.cellId,
        activityId: input.activityId,
        receiptId,
        duplicate,
        authoritativeRevision: seen.size,
      };
    },
  );
  const recordTopologyCancellation = vi.fn<
    P6TopologyActivities['recordTopologyCancellation']
  >(async (input) => {
    await Promise.resolve();
    return {
      boundary: input.cancellationPoint,
      cellId: 'topology',
      activityId: input.activityId,
      receiptId: `receipt:cancel:${input.cancellationPoint}`,
      duplicate: false,
      authoritativeRevision: 100,
    };
  });
  return { runCellBoundary, recordTopologyCancellation };
}
