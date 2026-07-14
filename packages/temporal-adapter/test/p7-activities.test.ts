import { describe, expect, it } from 'vitest';
import type {
  P7GovernedCellExecutor,
  P7ResearchAuthorityReader,
} from '@mammoth/p7-application-service';
import type {
  P7ResearchInspection,
  P7ResearchRunRequest,
  P7ResearchStatus,
} from '@mammoth/workflow';
import { P7ResearchActivityFacade } from '../src/index.js';

const digest =
  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const request = {
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
    inputTokens: 1,
    outputTokens: 1,
    currencyMicros: 0,
    wallClockMs: 1,
    toolCalls: 0,
  },
} satisfies P7ResearchRunRequest;

const status: P7ResearchStatus = {
  runId: 'run-1',
  state: 'accepted',
  authoritativeRevision: 0,
  completedCellIds: [],
  failedCellIds: [],
  cancelledCellIds: [],
  unresolvedCellIds: ['cell-1'],
  receiptIds: [],
};

class Authority implements P7ResearchAuthorityReader {
  current = status;
  register(): Promise<void> {
    return Promise.resolve();
  }
  status(): Promise<P7ResearchStatus> {
    return Promise.resolve(this.current);
  }
  inspect(): Promise<P7ResearchInspection> {
    return Promise.resolve({
      ...this.current,
      charterDigest: digest,
      topologyId: 'topology-1',
      topologyDigest: digest,
    });
  }
}

const executor: P7GovernedCellExecutor = {
  execute: (input) =>
    Promise.resolve({
      cellId: input.cell.cellId,
      status: 'completed',
      retryable: false,
      receiptIds: [],
      authoritativeStatus: { ...status, state: 'completed' },
    }),
  cancel: (input) =>
    Promise.resolve({
      receiptId: `cancel:${input.runId}`,
      authoritativeStatus: { ...status, state: 'cancelled' },
    }),
};

describe('P7 Temporal Activity facade', () => {
  it('accepts only the authoritative topology cell set', async () => {
    const authority = new Authority();
    const facade = new P7ResearchActivityFacade(authority, executor);
    await expect(
      facade.ensureRun({
        runId: status.runId,
        request,
        cells: [cell('cell-1')],
      }),
    ).resolves.toEqual(status);
    await expect(
      facade.ensureRun({
        runId: status.runId,
        request,
        cells: [cell('cell-other')],
      }),
    ).rejects.toThrow('authoritative topology');
  });

  it('refuses workflow completion ahead of product authority', async () => {
    const authority = new Authority();
    const facade = new P7ResearchActivityFacade(authority, executor);
    await expect(
      facade.finalizeRun({
        request,
        cells: [cell('cell-1')],
        status: { ...status, state: 'completed', unresolvedCellIds: [] },
      }),
    ).rejects.toThrow('ahead of authority');
  });
});

function cell(cellId: string) {
  return {
    cellId,
    modelWorkId: `work-${cellId}`,
    modelWorkIdentityDigest: digest,
    providerAttemptId: `attempt-${cellId}`,
    providerAttemptDigest: digest,
  };
}
