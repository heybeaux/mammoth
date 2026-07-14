import {
  deriveP6ActivityId,
  deriveP6ChildWorkflowId,
  deriveP6TopologyWorkflowId,
  type P6CellBoundary,
  type P6TopologyActivities,
  type P6TopologyCancellationPoint,
  type P6TopologyWorkflowInput,
  type P6TopologyWorkflowResult,
} from './p6-workflow-types.js';

export const P6_TOPOLOGY_CELL_BOUNDARIES: readonly P6CellBoundary[] = [
  'budget_reserved',
  'cell_dispatched',
  'cell_completed',
  'budget_settled',
];

export const P6_CONTINUE_AS_NEW_MAX_COMPLETED_CELLS = 2;

const cancellationBeforeBoundary: Record<
  P6TopologyCancellationPoint,
  P6CellBoundary
> = {
  before_dispatch: 'cell_dispatched',
  during_cell: 'cell_completed',
  during_settlement: 'budget_settled',
};

export async function executeP6TopologyShell(
  input: P6TopologyWorkflowInput,
  activities: P6TopologyActivities,
): Promise<P6TopologyWorkflowResult> {
  if (input.concurrencyLimit < 1)
    throw new Error('P6 topology concurrency limit must be positive');
  const workflowId = deriveP6TopologyWorkflowId(input.identity);
  const completed = new Set(input.resumeFrom?.completedCellIds ?? []);
  let completedCellIds = [...completed];
  let receiptIds = [...(input.resumeFrom?.receiptIds ?? [])];
  const childWorkflowIds: string[] = [];
  let carryRequired = false;

  for (const cell of input.cells) {
    const childWorkflowId = deriveP6ChildWorkflowId({
      topologyId: input.identity.topologyId,
      cellId: cell.cellId,
      attemptId: input.attemptId,
      workflowMajor: 1,
      runPartition: input.runPartition,
    });
    childWorkflowIds.push(childWorkflowId);
    if (completed.has(cell.cellId)) continue;

    for (const boundary of P6_TOPOLOGY_CELL_BOUNDARIES) {
      if (
        input.cancelAt &&
        cancellationBeforeBoundary[input.cancelAt] === boundary
      ) {
        const receipt = await activities.recordTopologyCancellation({
          topology: input.identity,
          parentWorkflowId: workflowId,
          cancellationPoint: input.cancelAt,
          completedCellIds,
          receiptIds,
          attemptId: input.attemptId,
          activityId: deriveP6ActivityId({
            workflowId,
            cellId: cell.cellId,
            boundary: input.cancelAt,
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
          cancellationPoint: input.cancelAt,
          carryRequired,
        };
      }

      const receipt = await activities.runCellBoundary({
        topology: input.identity,
        cell,
        parentWorkflowId: workflowId,
        childWorkflowId,
        boundary,
        attemptId: input.attemptId,
        activityId: deriveP6ActivityId({
          workflowId,
          cellId: cell.cellId,
          boundary,
          attemptId: input.attemptId,
          operationKind: 'durable-boundary',
        }),
      });
      receiptIds = appendUnique(receiptIds, receipt.receiptId);
    }
    completed.add(cell.cellId);
    completedCellIds = [...completedCellIds, cell.cellId];
    if (
      input.resumeFrom === undefined &&
      completedCellIds.length >= P6_CONTINUE_AS_NEW_MAX_COMPLETED_CELLS &&
      completedCellIds.length < input.cells.length
    ) {
      carryRequired = true;
      break;
    }
  }

  const complete = completedCellIds.length === input.cells.length;
  return {
    status: complete ? 'completed' : 'cancelled',
    workflowId,
    completedCellIds,
    childWorkflowIds,
    receiptIds,
    partial: !complete,
    carryRequired,
  };
}

function appendUnique(values: readonly string[], value: string): string[] {
  return values.includes(value) ? [...values] : [...values, value];
}
