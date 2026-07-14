import {
  deriveP7ResearchRunId,
  type P7ResearchStatus,
} from '@mammoth/workflow/p7-contract';
import type {
  P7LiveResearchCarry,
  P7LiveResearchWorkflowInput,
  P7ResearchActivities,
  P7ResearchWorkflowResult,
} from './p7-workflow-types.js';

export const P7_CONTINUE_AS_NEW_MAX_CELL_RESULTS = 2;

export interface P7ShellControl {
  readonly cancellationReason?: string;
}

export async function executeP7ResearchShell(
  input: P7LiveResearchWorkflowInput,
  activities: P7ResearchActivities,
  control: P7ShellControl = {},
): Promise<P7ResearchWorkflowResult> {
  const runId = deriveP7ResearchRunId(input.request);
  let authoritative = await activities.ensureRun({
    runId,
    request: input.request,
    cells: input.cells,
  });
  assertStatus(runId, authoritative);
  if (input.carry) assertCarryMatches(input.carry, authoritative);
  let processed = 0;

  for (const cell of input.cells) {
    if (!authoritative.unresolvedCellIds.includes(cell.cellId)) continue;
    if (control.cancellationReason) {
      const cancellation = await activities.recordCancellation({
        runId,
        request: input.request,
        cells: input.cells,
        reason: control.cancellationReason,
        completedCellIds: authoritative.completedCellIds,
        failedCellIds: authoritative.failedCellIds,
        unresolvedCellIds: authoritative.unresolvedCellIds,
      });
      assertStatus(runId, cancellation.authoritativeStatus);
      authoritative = await activities.finalizeRun({
        request: input.request,
        cells: input.cells,
        status: cancellation.authoritativeStatus,
      });
      assertStatus(runId, authoritative);
      return { ...authoritative, partial: true };
    }

    const result = await activities.executeCell({
      runId,
      request: input.request,
      cells: input.cells,
      cell,
    });
    assertStatus(runId, result.authoritativeStatus);
    authoritative = result.authoritativeStatus;
    processed += 1;
    if (
      processed >= P7_CONTINUE_AS_NEW_MAX_CELL_RESULTS &&
      authoritative.unresolvedCellIds.length > 0
    ) {
      return { ...authoritative, partial: true };
    }
  }

  const proposed: P7ResearchStatus = {
    ...authoritative,
    state:
      authoritative.failedCellIds.length > 0 ||
      authoritative.cancelledCellIds.length > 0 ||
      authoritative.unresolvedCellIds.length > 0
        ? 'partial'
        : 'completed',
  };
  authoritative = await activities.finalizeRun({
    request: input.request,
    cells: input.cells,
    status: proposed,
  });
  assertStatus(runId, authoritative);
  const partial =
    authoritative.state !== 'completed' ||
    authoritative.failedCellIds.length > 0 ||
    authoritative.cancelledCellIds.length > 0 ||
    authoritative.unresolvedCellIds.length > 0;
  return { ...authoritative, partial };
}

export function carryFrom(status: {
  readonly authoritativeRevision: number;
  readonly completedCellIds: readonly string[];
  readonly failedCellIds: readonly string[];
  readonly cancelledCellIds: readonly string[];
  readonly unresolvedCellIds: readonly string[];
  readonly receiptIds: readonly string[];
  readonly processedSignalIds?: readonly string[];
}): P7LiveResearchCarry {
  return {
    authoritativeRevision: status.authoritativeRevision,
    completedCellIds: [...status.completedCellIds],
    failedCellIds: [...status.failedCellIds],
    cancelledCellIds: [...status.cancelledCellIds],
    unresolvedCellIds: [...status.unresolvedCellIds],
    receiptIds: [...status.receiptIds],
    processedSignalIds: [...(status.processedSignalIds ?? [])],
  };
}

function assertCarryMatches(
  carry: P7LiveResearchCarry,
  authoritative: P7ResearchStatus,
): void {
  if (
    carry.authoritativeRevision !== authoritative.authoritativeRevision ||
    !same(carry.completedCellIds, authoritative.completedCellIds) ||
    !same(carry.failedCellIds, authoritative.failedCellIds) ||
    !same(carry.cancelledCellIds, authoritative.cancelledCellIds) ||
    !same(carry.unresolvedCellIds, authoritative.unresolvedCellIds) ||
    !same(carry.receiptIds, authoritative.receiptIds)
  ) {
    throw new Error('P7 Temporal carry does not match authoritative state');
  }
}

function same(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    [...left].sort().every((value, index) => value === [...right].sort()[index])
  );
}

function assertStatus(runId: string, status: P7ResearchStatus): void {
  if (status.runId !== runId)
    throw new Error('P7 Activity returned status for a different run');
}
