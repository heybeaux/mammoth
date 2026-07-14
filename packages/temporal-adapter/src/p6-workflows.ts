import {
  continueAsNew,
  defineQuery,
  executeChild,
  proxyActivities,
  setHandler,
  workflowInfo,
} from '@temporalio/workflow';
import {
  P6_CONTINUE_AS_NEW_MAX_COMPLETED_CELLS,
  P6_TOPOLOGY_CELL_BOUNDARIES,
} from './p6-workflow-shell.js';
import {
  deriveP6ActivityId,
  deriveP6ChildWorkflowId,
  deriveP6TopologyWorkflowId,
  type P6CellBoundary,
  type P6TopologyActivities,
  type P6TopologyCancellationPoint,
  type P6TopologyCellIdentity,
  type P6TopologyWorkflowInput,
  type P6TopologyWorkflowResult,
} from './p6-workflow-types.js';

export const p6TopologyStateQuery = defineQuery<{
  readonly workflowId: string;
  readonly runId: string;
  readonly completedCellIds: readonly string[];
  readonly receiptIds: readonly string[];
  readonly cancellationPoint?: P6TopologyCancellationPoint;
}>('p6Topology.state.v1');

const activities = proxyActivities<P6TopologyActivities>({
  startToCloseTimeout: '30 seconds',
  heartbeatTimeout: '10 seconds',
  retry: { initialInterval: '250 milliseconds', maximumAttempts: 3 },
});

interface P6CellWorkflowInput {
  readonly topology: P6TopologyWorkflowInput['identity'];
  readonly cell: P6TopologyCellIdentity;
  readonly parentWorkflowId: string;
  readonly childWorkflowId: string;
  readonly attemptId: string;
  readonly cancelAt?: P6TopologyCancellationPoint;
}

interface P6CellWorkflowResult {
  readonly status: 'completed' | 'cancelled';
  readonly cellId: string;
  readonly receiptIds: readonly string[];
  readonly cancellationPoint?: P6TopologyCancellationPoint;
}

const cancellationBeforeBoundary: Partial<
  Record<P6TopologyCancellationPoint, P6CellBoundary>
> = {
  before_dispatch: 'cell_dispatched',
  during_cell: 'cell_completed',
  during_settlement: 'budget_settled',
};

export async function p6TopologyCellWorkflow(
  input: P6CellWorkflowInput,
): Promise<P6CellWorkflowResult> {
  if (workflowInfo().workflowId !== input.childWorkflowId)
    throw new Error('P6 child workflow ID does not match stable cell identity');
  const receiptIds: string[] = [];
  for (const boundary of P6_TOPOLOGY_CELL_BOUNDARIES) {
    if (
      input.cancelAt &&
      cancellationBeforeBoundary[input.cancelAt] === boundary
    ) {
      const receipt = await activities.recordTopologyCancellation({
        topology: input.topology,
        parentWorkflowId: input.parentWorkflowId,
        cancellationPoint: input.cancelAt,
        completedCellIds: [],
        receiptIds,
        attemptId: input.attemptId,
        activityId: deriveP6ActivityId({
          workflowId: input.parentWorkflowId,
          cellId: input.cell.cellId,
          boundary: input.cancelAt,
          attemptId: input.attemptId,
          operationKind: 'cancel',
        }),
      });
      return {
        status: 'cancelled',
        cellId: input.cell.cellId,
        receiptIds: appendUnique(receiptIds, receipt.receiptId),
        cancellationPoint: input.cancelAt,
      };
    }
    const receipt = await activities.runCellBoundary({
      topology: input.topology,
      cell: input.cell,
      parentWorkflowId: input.parentWorkflowId,
      childWorkflowId: input.childWorkflowId,
      boundary,
      attemptId: input.attemptId,
      activityId: deriveP6ActivityId({
        workflowId: input.parentWorkflowId,
        cellId: input.cell.cellId,
        boundary,
        attemptId: input.attemptId,
        operationKind: 'durable-boundary',
      }),
    });
    if (!receiptIds.includes(receipt.receiptId))
      receiptIds.push(receipt.receiptId);
  }
  return {
    status: 'completed',
    cellId: input.cell.cellId,
    receiptIds,
  };
}

export async function p6TopologyWorkflow(
  input: P6TopologyWorkflowInput,
): Promise<P6TopologyWorkflowResult> {
  if (input.concurrencyLimit < 1)
    throw new Error('P6 topology concurrency limit must be positive');
  const workflowId = deriveP6TopologyWorkflowId(input.identity);
  if (workflowInfo().workflowId !== workflowId)
    throw new Error('P6 workflow ID does not match stable topology identity');

  let completedCellIds = [...(input.resumeFrom?.completedCellIds ?? [])];
  let receiptIds = [...(input.resumeFrom?.receiptIds ?? [])];
  const cancellationPoint = input.cancelAt;
  const childWorkflowIds: string[] = [];
  let carryRequired = false;

  setHandler(p6TopologyStateQuery, () => ({
    workflowId,
    runId: workflowInfo().runId,
    completedCellIds,
    receiptIds,
    ...(cancellationPoint === undefined ? {} : { cancellationPoint }),
  }));

  for (const cell of input.cells) {
    const childWorkflowId = deriveP6ChildWorkflowId({
      topologyId: input.identity.topologyId,
      cellId: cell.cellId,
      attemptId: input.attemptId,
      workflowMajor: 1,
      runPartition: input.runPartition,
    });
    childWorkflowIds.push(childWorkflowId);
    if (completedCellIds.includes(cell.cellId)) continue;
    const child = await executeChild(p6TopologyCellWorkflow, {
      workflowId: childWorkflowId,
      args: [
        {
          topology: input.identity,
          cell,
          parentWorkflowId: workflowId,
          childWorkflowId,
          attemptId: input.attemptId,
          ...(cancellationPoint === undefined
            ? {}
            : { cancelAt: cancellationPoint }),
        },
      ],
    });
    receiptIds = appendAllUnique(receiptIds, child.receiptIds);
    if (child.status === 'cancelled') {
      if (child.cancellationPoint === undefined)
        throw new Error(
          'P6 child workflow cancelled without cancellation point',
        );
      return {
        status: 'cancelled',
        workflowId,
        completedCellIds,
        childWorkflowIds,
        receiptIds,
        partial: true,
        cancellationPoint: child.cancellationPoint,
        carryRequired,
      };
    }
    completedCellIds = appendUnique(completedCellIds, child.cellId);
    if (
      input.resumeFrom === undefined &&
      completedCellIds.length >= P6_CONTINUE_AS_NEW_MAX_COMPLETED_CELLS &&
      completedCellIds.length < input.cells.length
    ) {
      carryRequired = true;
      await continueAsNew<typeof p6TopologyWorkflow>({
        ...input,
        resumeFrom: { completedCellIds, receiptIds },
      });
    }
  }

  if (
    cancellationPoint === 'after_child_before_synthesis' ||
    cancellationPoint === 'during_synthesis'
  ) {
    const receipt = await activities.recordTopologyCancellation({
      topology: input.identity,
      parentWorkflowId: workflowId,
      cancellationPoint,
      completedCellIds,
      receiptIds,
      attemptId: input.attemptId,
      activityId: deriveP6ActivityId({
        workflowId,
        cellId: 'synthesis',
        boundary: cancellationPoint,
        attemptId: input.attemptId,
        operationKind: 'cancel',
      }),
    });
    return {
      status: 'cancelled',
      workflowId,
      completedCellIds,
      childWorkflowIds,
      receiptIds: appendUnique(receiptIds, receipt.receiptId),
      partial: true,
      cancellationPoint,
      carryRequired,
    };
  }

  return {
    status: 'completed',
    workflowId,
    completedCellIds,
    childWorkflowIds,
    receiptIds,
    partial: false,
    carryRequired,
  };
}

function appendAllUnique(
  values: readonly string[],
  additions: readonly string[],
): string[] {
  return additions.reduce(
    (current, value) => appendUnique(current, value),
    [...values],
  );
}

function appendUnique(values: readonly string[], value: string): string[] {
  return values.includes(value) ? [...values] : [...values, value];
}
