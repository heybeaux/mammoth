import type {
  P7GovernedCellExecutor,
  P7ResearchAuthorityReader,
} from '@mammoth/p7-application-service';
import type {
  P7ResearchActivities,
  P7CellExecutionResult,
} from './p7-workflow-types.js';

/** Temporal Activity facade over deterministic application services. */
export class P7ResearchActivityFacade implements P7ResearchActivities {
  constructor(
    private readonly authority: P7ResearchAuthorityReader,
    private readonly cells: P7GovernedCellExecutor,
  ) {}

  async ensureRun(input: Parameters<P7ResearchActivities['ensureRun']>[0]) {
    await this.authority.register(input.request);
    const status = await this.authority.status(input.runId);
    const expected = [...input.cells.map(({ cellId }) => cellId)].sort();
    const actual = [
      ...status.completedCellIds,
      ...status.cancelledCellIds,
      ...status.unresolvedCellIds,
    ].sort();
    if (!same(expected, actual))
      throw new Error('P7 workflow cells do not match authoritative topology');
    return status;
  }

  reconstructRun(runId: string) {
    return this.authority.status(runId);
  }

  executeCell(
    input: Parameters<P7ResearchActivities['executeCell']>[0],
  ): Promise<P7CellExecutionResult> {
    return this.cells.execute(input);
  }

  recordCancellation(
    input: Parameters<P7ResearchActivities['recordCancellation']>[0],
  ) {
    return this.cells.cancel({
      runId: input.runId,
      request: input.request,
      cells: input.cells,
      reason: input.reason,
    });
  }

  async finalizeRun(input: Parameters<P7ResearchActivities['finalizeRun']>[0]) {
    const authoritative = await this.authority.status(input.status.runId);
    if (
      input.status.state === 'completed' &&
      authoritative.state !== 'completed'
    ) {
      throw new Error('P7 workflow cannot finalize ahead of authority');
    }
    return authoritative;
  }

  inspectRun(runId: string) {
    return this.authority.inspect(runId);
  }
}

function same(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}
