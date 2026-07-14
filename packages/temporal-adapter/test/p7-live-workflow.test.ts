import { fileURLToPath } from 'node:url';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { describe, expect, it } from 'vitest';
import {
  deriveP7ResearchRunId,
  type P7ResearchStatus,
} from '@mammoth/workflow';
import {
  P7_MODEL_PROVIDER_TASK_QUEUE,
  p7LiveResearchWorkflow,
  p7ResearchStateQuery,
  type P7LiveResearchWorkflowInput,
  type P7ResearchActivities,
} from '../src/index.js';

const digest =
  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

describe('P7 live Temporal workflow', () => {
  it('survives bounded continue-as-new and replays without provider bytes in history', async () => {
    const environment = await TestWorkflowEnvironment.createLocal();
    const workflowTaskQueue = 'mammoth-p7-live-workflow';
    const workflowsPath = fileURLToPath(
      new URL('../src/p7-workflows.ts', import.meta.url),
    );
    const fixture = createActivities();
    const activityWorker = await Worker.create({
      connection: environment.nativeConnection,
      ...(environment.namespace === undefined
        ? {}
        : { namespace: environment.namespace }),
      taskQueue: P7_MODEL_PROVIDER_TASK_QUEUE,
      activities: fixture.activities,
    });
    const workflowWorker = await Worker.create({
      connection: environment.nativeConnection,
      ...(environment.namespace === undefined
        ? {}
        : { namespace: environment.namespace }),
      taskQueue: workflowTaskQueue,
      workflowsPath,
    });
    const activityRun = activityWorker.run();
    try {
      const observed = await workflowWorker.runUntil(async () => {
        const input = workflowInput();
        const workflowId = deriveP7ResearchRunId(input.request);
        const handle = await environment.client.workflow.start(
          p7LiveResearchWorkflow,
          {
            workflowId,
            taskQueue: workflowTaskQueue,
            args: [input],
          },
        );
        const initial = await handle.query(p7ResearchStateQuery);
        const result = await handle.result();
        const history = await handle.fetchHistory();
        await Worker.runReplayHistory({ workflowsPath }, history, workflowId);
        return {
          initial,
          result,
          history: JSON.stringify(history),
        };
      });
      expect(observed.initial.runId).toBe(
        deriveP7ResearchRunId(workflowInput().request),
      );
      expect(observed.result).toMatchObject({
        state: 'completed',
        completedCellIds: ['cell-one', 'cell-two', 'cell-three'],
        unresolvedCellIds: [],
        partial: false,
      });
      expect(fixture.executed).toEqual(['cell-one', 'cell-two', 'cell-three']);
      expect(observed.history).not.toContain('raw provider response');
    } finally {
      activityWorker.shutdown();
      await activityRun;
      await environment.teardown();
    }
  }, 120_000);
});

function workflowInput(): P7LiveResearchWorkflowInput {
  return {
    request: {
      applicationContractMajor: 1,
      workflowVersion: 1,
      charterDigest: digest,
      topology: {
        topologyId: 'topology-p7-live',
        topologyDigest: digest,
        dependencyDigest: digest,
        programId: 'program-p7-live',
        workItemId: 'work-p7-live',
        criterion: {
          criterionId: 'criterion-p7-live',
          criterionVersion: 1,
          criterionDigest: digest,
          branchId: 'main',
        },
        topologyPlanVersion: '1.0.0',
        plannerPolicyVersion: '1.0.0',
        templateCatalogVersion: '1.0.0',
      },
      modelWorkPolicyDigest: digest,
      modelProfileVersionId: 'profile-p7-live',
      modelProfileVersionDigest: digest,
      promptTemplateDigest: digest,
      toolContractDigest: digest,
      outputSchemaDigest: digest,
      budget: {
        inputTokens: 100,
        outputTokens: 100,
        currencyMicros: 0,
        wallClockMs: 30_000,
        toolCalls: 0,
      },
    },
    cells: ['one', 'two', 'three'].map((name) => ({
      cellId: `cell-${name}`,
      modelWorkId: `work-${name}`,
      modelWorkIdentityDigest: digest,
      providerAttemptId: `attempt-${name}`,
      providerAttemptDigest: digest,
    })),
  };
}

function createActivities(): {
  readonly activities: P7ResearchActivities;
  readonly executed: string[];
} {
  const input = workflowInput();
  const executed: string[] = [];
  let current: P7ResearchStatus = {
    runId: deriveP7ResearchRunId(input.request),
    state: 'accepted',
    authoritativeRevision: 0,
    completedCellIds: [],
    failedCellIds: [],
    cancelledCellIds: [],
    unresolvedCellIds: input.cells.map(({ cellId }) => cellId),
    receiptIds: [],
  };
  return {
    executed,
    activities: {
      ensureRun: () => Promise.resolve(current),
      reconstructRun: () => Promise.resolve(current),
      executeCell: ({ cell }) => {
        executed.push(cell.cellId);
        current = {
          ...current,
          state: 'running',
          authoritativeRevision: current.authoritativeRevision + 1,
          completedCellIds: [...current.completedCellIds, cell.cellId],
          unresolvedCellIds: current.unresolvedCellIds.filter(
            (cellId) => cellId !== cell.cellId,
          ),
          receiptIds: [...current.receiptIds, `receipt:${cell.cellId}`],
        };
        return Promise.resolve({
          cellId: cell.cellId,
          status: 'completed',
          retryable: false,
          receiptIds: [`receipt:${cell.cellId}`],
          authoritativeStatus: current,
        });
      },
      recordCancellation: ({ runId }) => {
        const receiptId = `cancel:${runId}`;
        current = {
          ...current,
          state: 'cancelled',
          authoritativeRevision: current.authoritativeRevision + 1,
          cancelledCellIds: [...current.unresolvedCellIds],
          unresolvedCellIds: [],
          receiptIds: [...current.receiptIds, receiptId],
        };
        return Promise.resolve({ receiptId, authoritativeStatus: current });
      },
      finalizeRun: ({ status }) => {
        current = status;
        return Promise.resolve(current);
      },
      inspectRun: () =>
        Promise.resolve({
          ...current,
          charterDigest: input.request.charterDigest,
          topologyId: input.request.topology.topologyId,
          topologyDigest: input.request.topology.topologyDigest,
        }),
    },
  };
}
