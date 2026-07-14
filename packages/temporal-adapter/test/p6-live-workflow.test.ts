import { fileURLToPath } from 'node:url';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { describe, expect, it } from 'vitest';
import {
  deriveP6TopologyWorkflowId,
  p6TopologyStateQuery,
  p6TopologyWorkflow,
  type P6TopologyActivities,
  type P6TopologyBoundaryReceipt,
  type P6TopologyCancellationPoint,
  type P6TopologyCellIdentity,
  type P6TopologyWorkflowInput,
} from '../src/index.js';

const digest =
  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

const topology: P6TopologyWorkflowInput['identity'] = {
  topologyId: 'topology-p6-live',
  programId: 'program-p6-live',
  criterionId: 'criterion-p6-live',
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

describe('P6 live Temporal topology workflow', () => {
  it('runs parent/child workflows with query state, continue-as-new, and replay', async () => {
    const testEnv = await TestWorkflowEnvironment.createLocal();
    const taskQueue = 'mammoth-p6-live-topology';
    const workflowsPath = fileURLToPath(
      new URL('../src/p6-workflows.ts', import.meta.url),
    );
    try {
      const worker = await Worker.create({
        connection: testEnv.nativeConnection,
        ...(testEnv.namespace === undefined
          ? {}
          : { namespace: testEnv.namespace }),
        taskQueue,
        workflowsPath,
        activities: createActivities(),
      });
      const result = await worker.runUntil(async () => {
        const handle = await testEnv.client.workflow.start(p6TopologyWorkflow, {
          workflowId: deriveP6TopologyWorkflowId(topology),
          taskQueue,
          args: [input()],
        });
        let queried = await handle.query(p6TopologyStateQuery);
        for (let index = 0; index < 20; index += 1) {
          if (queried.receiptIds.length > 0) break;
          await testEnv.sleep('100 milliseconds');
          queried = await handle.query(p6TopologyStateQuery);
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

      expect(result.queried.workflowId).toBe(
        deriveP6TopologyWorkflowId(topology),
      );
      expect(result.completed).toMatchObject({
        status: 'completed',
        partial: false,
        completedCellIds: cells.map(({ cellId }) => cellId),
      });
      expect(result.completed.childWorkflowIds).toHaveLength(3);
      expect(result.completed.receiptIds.length).toBeGreaterThan(0);
      expect(result.historyLength).toBeGreaterThan(0);
    } finally {
      await testEnv.teardown();
    }
  }, 120_000);

  it.each([
    'before_dispatch',
    'during_cell',
    'after_child_before_synthesis',
    'during_synthesis',
    'during_settlement',
  ] as const)(
    'records honest P6 cancellation receipt for %s',
    async (cancelAt: P6TopologyCancellationPoint) => {
      const testEnv = await TestWorkflowEnvironment.createLocal();
      const taskQueue = `mammoth-p6-live-cancel-${cancelAt}`;
      const workflowsPath = fileURLToPath(
        new URL('../src/p6-workflows.ts', import.meta.url),
      );
      const cancellationTopology = {
        ...topology,
        topologyId: `topology-p6-live-${cancelAt}`,
      };
      try {
        const worker = await Worker.create({
          connection: testEnv.nativeConnection,
          ...(testEnv.namespace === undefined
            ? {}
            : { namespace: testEnv.namespace }),
          taskQueue,
          workflowsPath,
          activities: createActivities(),
        });
        const result = await worker.runUntil(async () => {
          const handle = await testEnv.client.workflow.start(
            p6TopologyWorkflow,
            {
              workflowId: deriveP6TopologyWorkflowId(cancellationTopology),
              taskQueue,
              args: [
                input({
                  identity: cancellationTopology,
                  attemptId: `attempt-${cancelAt}`,
                  cancelAt,
                }),
              ],
            },
          );
          return handle.result();
        });

        expect(result).toMatchObject({
          status: 'cancelled',
          partial: true,
          cancellationPoint: cancelAt,
        });
        expect(result.receiptIds.at(-1)).toBe(`receipt:cancel:${cancelAt}`);
      } finally {
        await testEnv.teardown();
      }
    },
    120_000,
  );

  it('recovers after worker replacement and client handle loss without duplicate receipts', async () => {
    const testEnv = await TestWorkflowEnvironment.createLocal();
    const taskQueue = 'mammoth-p6-live-recovery';
    const workflowsPath = fileURLToPath(
      new URL('../src/p6-workflows.ts', import.meta.url),
    );
    const recoveryTopology = {
      ...topology,
      topologyId: 'topology-p6-recovery',
    };
    const workflowId = deriveP6TopologyWorkflowId(recoveryTopology);
    const receipts = new Map<string, string>();
    try {
      const firstWorker = await Worker.create({
        connection: testEnv.nativeConnection,
        ...(testEnv.namespace === undefined
          ? {}
          : { namespace: testEnv.namespace }),
        taskQueue,
        workflowsPath,
        activities: createActivities(receipts),
      });
      await firstWorker.runUntil(async () => {
        await testEnv.client.workflow.start(p6TopologyWorkflow, {
          workflowId,
          taskQueue,
          args: [input({ identity: recoveryTopology })],
        });
        await testEnv.sleep('500 milliseconds');
      });

      const secondWorker = await Worker.create({
        connection: testEnv.nativeConnection,
        ...(testEnv.namespace === undefined
          ? {}
          : { namespace: testEnv.namespace }),
        taskQueue,
        workflowsPath,
        activities: createActivities(receipts),
      });
      const result = await secondWorker.runUntil(async () => {
        const handle =
          testEnv.client.workflow.getHandle<typeof p6TopologyWorkflow>(
            workflowId,
          );
        return handle.result();
      });

      expect(result.status).toBe('completed');
      expect(new Set(result.receiptIds).size).toBe(result.receiptIds.length);
      expect(receipts.size).toBe(result.receiptIds.length);
    } finally {
      await testEnv.teardown();
    }
  }, 120_000);
});

function input(
  overrides: Partial<P6TopologyWorkflowInput> = {},
): P6TopologyWorkflowInput {
  return {
    identity: topology,
    attemptId: 'attempt-p6-live',
    runPartition: 'main',
    concurrencyLimit: 2,
    cells,
    ...overrides,
  };
}

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

function createActivities(
  receipts = new Map<string, string>(),
): P6TopologyActivities {
  return {
    runCellBoundary: async (request): Promise<P6TopologyBoundaryReceipt> => {
      await Promise.resolve();
      const existing = receipts.get(request.activityId);
      const receiptId =
        existing ?? `receipt:${request.cell.cellId}:${request.boundary}`;
      receipts.set(request.activityId, receiptId);
      return {
        boundary: request.boundary,
        cellId: request.cell.cellId,
        activityId: request.activityId,
        receiptId,
        duplicate: existing !== undefined,
        authoritativeRevision: receipts.size,
      };
    },
    recordTopologyCancellation: async (
      request,
    ): Promise<P6TopologyBoundaryReceipt> => {
      await Promise.resolve();
      const existing = receipts.get(request.activityId);
      const receiptId =
        existing ?? `receipt:cancel:${request.cancellationPoint}`;
      receipts.set(request.activityId, receiptId);
      return {
        boundary: request.cancellationPoint,
        cellId: 'topology',
        activityId: request.activityId,
        receiptId,
        duplicate: existing !== undefined,
        authoritativeRevision: receipts.size,
      };
    },
  };
}
