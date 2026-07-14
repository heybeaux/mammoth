import { describe, expect, it } from 'vitest';
import {
  P7ResearchApplicationService,
  type P7ResearchAuthorityReader,
  type P7ResearchOrchestrationPort,
} from '../src/index.js';
import {
  deriveP7ResearchRunId,
  type P7ResearchInspection,
  type P7ResearchRunRequest,
  type P7ResearchStatus,
} from '@mammoth/workflow';

const digest =
  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

const request: P7ResearchRunRequest = {
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

class Fixture
  implements P7ResearchOrchestrationPort, P7ResearchAuthorityReader
{
  readonly calls: string[] = [];
  current: P7ResearchStatus = status('accepted', 0);

  register(): Promise<void> {
    this.calls.push('register');
    return Promise.resolve();
  }

  start(input: P7ResearchRunRequest): Promise<{ readonly runId: string }> {
    this.calls.push('start');
    return Promise.resolve({ runId: deriveP7ResearchRunId(input) });
  }

  resume(input: { readonly expectedRevision: number }): Promise<void> {
    this.calls.push(`resume:${String(input.expectedRevision)}`);
    this.current = status('running', input.expectedRevision + 1);
    return Promise.resolve();
  }

  cancel(input: { readonly expectedRevision: number }): Promise<void> {
    this.calls.push(`cancel:${String(input.expectedRevision)}`);
    this.current = status('cancelled', input.expectedRevision + 1);
    return Promise.resolve();
  }

  status(): Promise<P7ResearchStatus> {
    return Promise.resolve(this.current);
  }

  inspect(): Promise<P7ResearchInspection> {
    return Promise.resolve({
      ...this.current,
      charterDigest: digest,
      topologyId: request.topology.topologyId,
      topologyDigest: request.topology.topologyDigest,
    });
  }
}

describe('P7 research application service', () => {
  it('starts through orchestration but returns authoritative state', async () => {
    const fixture = new Fixture();
    const service = new P7ResearchApplicationService(fixture, fixture);
    await expect(service.run(request)).resolves.toEqual(status('accepted', 0));
    expect(fixture.calls).toEqual(['register', 'start']);
  });

  it('binds resume and cancel to the authoritative revision', async () => {
    const fixture = new Fixture();
    const service = new P7ResearchApplicationService(fixture, fixture);
    fixture.current = status('partial', 4);
    await expect(service.resume(fixture.current.runId)).resolves.toMatchObject({
      state: 'running',
      authoritativeRevision: 5,
    });
    await expect(service.cancel(fixture.current.runId)).resolves.toMatchObject({
      state: 'cancelled',
      authoritativeRevision: 6,
    });
    expect(fixture.calls).toEqual(['resume:4', 'cancel:5']);
  });

  it('does not signal completed or already-cancelled runs', async () => {
    const fixture = new Fixture();
    const service = new P7ResearchApplicationService(fixture, fixture);
    fixture.current = status('completed', 8);
    await service.cancel(fixture.current.runId);
    await expect(service.resume(fixture.current.runId)).rejects.toThrow(
      'not resumable',
    );
    expect(fixture.calls).toEqual([]);
  });
});

function status(
  state: P7ResearchStatus['state'],
  revision: number,
): P7ResearchStatus {
  return {
    runId: deriveP7ResearchRunId(request),
    state,
    authoritativeRevision: revision,
    completedCellIds: state === 'completed' ? ['cell-1'] : [],
    failedCellIds: [],
    cancelledCellIds: [],
    unresolvedCellIds: state === 'completed' ? [] : ['cell-1'],
    receiptIds: [],
  };
}
