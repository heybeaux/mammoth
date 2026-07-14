import { describe, expect, it } from 'vitest';
import { canonicalDigest } from '@mammoth/work-queue';
import type {
  P7ResearchInspection,
  P7ResearchRunRequest,
  P7ResearchStatus,
} from '@mammoth/workflow';
import {
  executeP7ResearchShell,
  type P7CellExecutionResult,
  type P7LiveResearchWorkflowInput,
  type P7ResearchActivities,
} from '../src/index.js';

const digest = canonicalDigest({ fixture: 'p7-shell' });

function request(): P7ResearchRunRequest {
  return {
    applicationContractMajor: 1,
    workflowVersion: 1,
    charterDigest: digest,
    topology: {
      topologyId: 'topology-1',
      topologyDigest: digest,
      dependencyDigest: digest,
      programId: 'program-1',
      workItemId: 'work-1',
      criterion: {
        criterionId: 'criterion-1',
        criterionVersion: 1,
        criterionDigest: digest,
        branchId: 'main',
      },
      topologyPlanVersion: '1.0.0',
      plannerPolicyVersion: '1.0.0',
      templateCatalogVersion: '1.0.0',
    },
    modelWorkPolicyDigest: digest,
    modelProfileVersionId: 'profile-1',
    modelProfileVersionDigest: digest,
    promptTemplateDigest: digest,
    toolContractDigest: digest,
    outputSchemaDigest: digest,
    budget: {
      inputTokens: 100,
      outputTokens: 50,
      currencyMicros: 0,
      wallClockMs: 30_000,
      toolCalls: 0,
    },
  };
}

function workflowInput(): P7LiveResearchWorkflowInput {
  return {
    request: request(),
    cells: ['one', 'two', 'three'].map((cellId) => ({
      cellId,
      modelWorkId: `work-${cellId}`,
      modelWorkIdentityDigest: digest,
      providerAttemptId: `attempt-${cellId}`,
      providerAttemptDigest: digest,
    })),
  };
}

class FixtureActivities implements P7ResearchActivities {
  readonly calls: string[] = [];
  readonly results = new Map<
    string,
    Omit<P7CellExecutionResult, 'authoritativeStatus'>
  >();
  finalized: P7ResearchStatus | undefined;
  current: P7ResearchStatus | undefined;

  ensureRun(input: {
    readonly runId: string;
    readonly cells: readonly { readonly cellId: string }[];
  }): Promise<P7ResearchStatus> {
    this.calls.push('ensure');
    this.current ??= {
      runId: input.runId,
      state: 'accepted',
      authoritativeRevision: 0,
      completedCellIds: [],
      failedCellIds: [],
      cancelledCellIds: [],
      unresolvedCellIds: input.cells.map(({ cellId }) => cellId),
      receiptIds: [],
    };
    return Promise.resolve(this.current);
  }

  reconstructRun(runId: string): Promise<P7ResearchStatus> {
    return Promise.resolve(
      this.finalized ?? {
        runId,
        state: 'running',
        authoritativeRevision: 0,
        completedCellIds: [],
        failedCellIds: [],
        cancelledCellIds: [],
        unresolvedCellIds: [],
        receiptIds: [],
      },
    );
  }

  executeCell(input: {
    readonly cell: { readonly cellId: string };
  }): Promise<P7CellExecutionResult> {
    this.calls.push(`cell:${input.cell.cellId}`);
    const result = this.results.get(input.cell.cellId) ?? {
      cellId: input.cell.cellId,
      status: 'completed',
      retryable: false,
      receiptIds: [`receipt-${input.cell.cellId}`],
    };
    const current = this.requireCurrent();
    const unresolved = current.unresolvedCellIds.filter(
      (cellId) => cellId !== input.cell.cellId,
    );
    if (result.status === 'failed' && result.retryable)
      unresolved.push(input.cell.cellId);
    this.current = {
      ...current,
      state: result.status === 'failed' ? 'partial' : 'running',
      authoritativeRevision: current.authoritativeRevision + 1,
      completedCellIds:
        result.status === 'completed'
          ? [...current.completedCellIds, input.cell.cellId]
          : current.completedCellIds,
      failedCellIds:
        result.status === 'failed'
          ? [...current.failedCellIds, input.cell.cellId]
          : current.failedCellIds,
      cancelledCellIds:
        result.status === 'cancelled'
          ? [...current.cancelledCellIds, input.cell.cellId]
          : current.cancelledCellIds,
      unresolvedCellIds: unresolved,
      receiptIds: [...current.receiptIds, ...result.receiptIds],
    };
    return Promise.resolve({ ...result, authoritativeStatus: this.current });
  }

  recordCancellation(input: { readonly runId: string }): Promise<{
    readonly receiptId: string;
    readonly authoritativeStatus: P7ResearchStatus;
  }> {
    this.calls.push('cancel');
    const current = this.requireCurrent();
    const receiptId = `cancel-${input.runId}`;
    this.current = {
      ...current,
      state: 'cancelled',
      authoritativeRevision: current.authoritativeRevision + 1,
      cancelledCellIds: [
        ...current.cancelledCellIds,
        ...current.unresolvedCellIds,
      ],
      unresolvedCellIds: [],
      receiptIds: [...current.receiptIds, receiptId],
    };
    return Promise.resolve({
      receiptId,
      authoritativeStatus: this.current,
    });
  }

  finalizeRun(input: {
    readonly status: P7ResearchStatus;
  }): Promise<P7ResearchStatus> {
    this.calls.push(`finalize:${input.status.state}`);
    this.finalized = input.status;
    this.current = input.status;
    return Promise.resolve(input.status);
  }

  inspectRun(runId: string): Promise<P7ResearchInspection> {
    return Promise.resolve({
      ...(this.finalized ?? {
        runId,
        state: 'running' as const,
        authoritativeRevision: 0,
        completedCellIds: [],
        failedCellIds: [],
        cancelledCellIds: [],
        unresolvedCellIds: [],
        receiptIds: [],
      }),
      charterDigest: digest,
      topologyId: 'topology-1',
      topologyDigest: digest,
    });
  }

  private requireCurrent(): P7ResearchStatus {
    if (!this.current) throw new Error('fixture run was not ensured');
    return this.current;
  }
}

describe('P7 live-research workflow shell', () => {
  it('bounds carry without duplicating completed provider work', async () => {
    const activities = new FixtureActivities();
    const first = await executeP7ResearchShell(workflowInput(), activities);
    expect(first).toMatchObject({
      state: 'running',
      completedCellIds: ['one', 'two'],
      unresolvedCellIds: ['three'],
      partial: true,
    });
    const resumed = await executeP7ResearchShell(
      {
        ...workflowInput(),
        carry: {
          authoritativeRevision: first.authoritativeRevision,
          completedCellIds: first.completedCellIds,
          failedCellIds: first.failedCellIds,
          cancelledCellIds: first.cancelledCellIds,
          unresolvedCellIds: first.unresolvedCellIds,
          receiptIds: first.receiptIds,
          processedSignalIds: [],
        },
      },
      activities,
    );
    expect(resumed).toMatchObject({
      state: 'completed',
      completedCellIds: ['one', 'two', 'three'],
      partial: false,
    });
    expect(activities.calls.filter((call) => call === 'cell:one')).toHaveLength(
      1,
    );
  });

  it('preserves retryable failure as honest unresolved partial state', async () => {
    const activities = new FixtureActivities();
    activities.results.set('one', {
      cellId: 'one',
      status: 'failed',
      retryable: true,
      failureCode: 'provider_unavailable',
      receiptIds: ['failure-one'],
    });
    const result = await executeP7ResearchShell(
      { ...workflowInput(), cells: workflowInput().cells.slice(0, 1) },
      activities,
    );
    expect(result).toMatchObject({
      state: 'partial',
      failedCellIds: ['one'],
      unresolvedCellIds: ['one'],
      receiptIds: ['failure-one'],
      partial: true,
    });
  });

  it('records cancellation before dispatch and labels every unresolved cell', async () => {
    const activities = new FixtureActivities();
    const result = await executeP7ResearchShell(workflowInput(), activities, {
      cancellationReason: 'operator request',
    });
    expect(result).toMatchObject({
      state: 'cancelled',
      completedCellIds: [],
      cancelledCellIds: ['one', 'two', 'three'],
      unresolvedCellIds: [],
      partial: true,
    });
    expect(activities.calls).not.toContain('cell:one');
  });
});
