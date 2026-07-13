import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import {
  P3_TASK_QUEUES,
  P3_WORKFLOW_CONTRACTS,
  RESEARCH_PROGRAM_STAGE_IDS,
  RESEARCH_PROGRAM_SUPPORTED_VERSIONS,
  RESEARCH_PROGRAM_WORKFLOW_V1,
  WORKFLOW_QUERY_KINDS,
  applyWorkflowControlSignal,
  createContinueAsNewCarry,
  deriveWorkflowId,
  parseContinueAsNewCarry,
  parseWorkflowControlSignal,
  parseWorkflowQuery,
  reconstructAfterContinueAsNew,
  replayResearchProgramWorkflow,
  supportedWorkflowVersion,
  type ProgramBranchIdentity,
  type ResearchProgramReplayEvent,
  type ResearchProgramReplayInput,
} from '../src/index.js';

interface ReplayFixture {
  readonly input: ResearchProgramReplayInput;
  readonly history: readonly ResearchProgramReplayEvent[];
  readonly expected: {
    readonly workflowId: string;
    readonly terminalStage: string;
    readonly lastResultDigest: string;
    readonly productRevisionId: string;
  };
}

const identity: ProgramBranchIdentity = {
  programId: 'program.alpha',
  criterionVersion: 'criterion.v1',
  branchId: 'main',
};

describe('P3 deterministic workflow contract foundation', () => {
  it('freezes workflow names, versions, and architecture task queues', () => {
    expect(
      Object.values(P3_WORKFLOW_CONTRACTS).map(({ name }) => name),
    ).toEqual([
      'ResearchProgramWorkflow',
      'AcquisitionWorkflow',
      'HypothesisCampaignWorkflow',
      'ExperimentWorkflow',
      'RevalidationWorkflow',
      'ReportCompilationWorkflow',
      'HumanReviewWorkflow',
    ]);
    expect(
      Object.values(P3_WORKFLOW_CONTRACTS).map(
        ({ supportedVersions }) => supportedVersions,
      ),
    ).toEqual([[1], [1], [1], [1], [1], [1], [1]]);
    expect(P3_TASK_QUEUES).toEqual([
      'research-control',
      'local-small',
      'local-large',
      'cloud-frontier',
      'retrieval',
      'experiment',
      'human-gate',
    ]);
    for (const kind of Object.keys(P3_WORKFLOW_CONTRACTS)) {
      const workflow = supportedWorkflowVersion(
        kind as keyof typeof P3_WORKFLOW_CONTRACTS,
      );
      expect(P3_TASK_QUEUES).toContain(workflow.taskQueue);
      expect(workflow).toMatchObject({ contractMajor: 1, version: 1 });
    }
  });

  it('rejects unsupported workflow versions and contract drift', () => {
    expect(() => supportedWorkflowVersion('research-program', 0)).toThrow(
      'unsupported workflow version',
    );
    expect(() => supportedWorkflowVersion('research-program', 2)).toThrow(
      'unsupported workflow version',
    );
    const workflow = supportedWorkflowVersion('research-program');
    expect(() =>
      deriveWorkflowId({ ...workflow, name: 'ExperimentWorkflow' }, identity),
    ).toThrow('workflow contract does not match its registered kind');
    expect(() =>
      deriveWorkflowId({ ...workflow, contractMajor: 2 } as never, identity),
    ).toThrow('unsupported workflow contract major');
  });

  it('derives collision-resistant IDs from contract and branch identity only', () => {
    const workflow = supportedWorkflowVersion('research-program');
    const delimited = {
      programId: 'program:alpha',
      criterionVersion: 'criterion/v1',
      branchId: 'branch/main',
    };
    const first = deriveWorkflowId(workflow, delimited);
    expect(deriveWorkflowId(workflow, { ...delimited })).toBe(first);
    expect(
      deriveWorkflowId(workflow, {
        programId: 'program',
        criterionVersion: 'alpha:criterion/v1',
        branchId: 'branch/main',
      }),
    ).not.toBe(first);
  });

  it('rejects unstable or unversioned workflow identity inputs', () => {
    const workflow = supportedWorkflowVersion('research-program');
    expect(() =>
      deriveWorkflowId(workflow, {
        ...identity,
        attempt: 2,
      } as ProgramBranchIdentity),
    ).toThrow('program branch identity has invalid fields');
    expect(() =>
      deriveWorkflowId(workflow, {
        ...identity,
        startedAt: '2026-07-13T00:00:00.000Z',
        randomId: 'random',
      } as ProgramBranchIdentity),
    ).toThrow('program branch identity has invalid fields');
    expect(() =>
      deriveWorkflowId(workflow, { ...identity, branchId: ' main' }),
    ).toThrow('branchId must be a stable');
    expect(() =>
      deriveWorkflowId(workflow, { ...identity, criterionVersion: '' }),
    ).toThrow('criterionVersion must be a stable');
  });

  it('freezes deterministic research stage order and routing', () => {
    expect(RESEARCH_PROGRAM_SUPPORTED_VERSIONS).toEqual([1]);
    expect(RESEARCH_PROGRAM_WORKFLOW_V1.workflow).toEqual(
      supportedWorkflowVersion('research-program', 1),
    );
    expect(
      RESEARCH_PROGRAM_WORKFLOW_V1.steps.map(({ stageId }) => stageId),
    ).toEqual(RESEARCH_PROGRAM_STAGE_IDS);
    expect(
      RESEARCH_PROGRAM_WORKFLOW_V1.steps.map(({ taskQueue }) => taskQueue),
    ).toEqual([
      'research-control',
      'retrieval',
      'research-control',
      'research-control',
      'research-control',
      'research-control',
    ]);
  });

  it('replays every supported research workflow version from a checked fixture', async () => {
    const fixture = await loadFixture();
    expect(RESEARCH_PROGRAM_SUPPORTED_VERSIONS).toEqual([
      fixture.input.workflowVersion,
    ]);
    expect(
      replayResearchProgramWorkflow(fixture.input, fixture.history),
    ).toMatchObject({
      workflowId: fixture.expected.workflowId,
      completedStages: RESEARCH_PROGRAM_STAGE_IDS,
      terminalStage: fixture.expected.terminalStage,
      lastResultDigest: fixture.expected.lastResultDigest,
      productRevisionId: fixture.expected.productRevisionId,
    });
  });

  it('fails replay on definition, sequence, digest, and product-state drift', async () => {
    const fixture = await loadFixture();
    expect(() =>
      replayResearchProgramWorkflow(
        { ...fixture.input, workflowVersion: 2 } as never,
        fixture.history,
      ),
    ).toThrow('unsupported workflow version');

    const stageDrift = fixture.history.map((event) => ({ ...event }));
    const second = stageDrift[1];
    if (!second) throw new Error('fixture missing second event');
    stageDrift[1] = { ...second, stageId: 'assess-claims' };
    expect(() =>
      replayResearchProgramWorkflow(fixture.input, stageDrift),
    ).toThrow(
      'replay event stage mismatch at sequence 2: expected snapshot-source, received assess-claims',
    );

    const sequenceDrift = fixture.history.map((event) => ({ ...event }));
    const firstSequence = sequenceDrift[0];
    if (!firstSequence) throw new Error('fixture missing first event');
    sequenceDrift[0] = { ...firstSequence, sequence: 2 };
    expect(() =>
      replayResearchProgramWorkflow(fixture.input, sequenceDrift),
    ).toThrow('replay event sequence mismatch');

    const digestDrift = fixture.history.map((event) => ({ ...event }));
    const firstDigest = digestDrift[0];
    if (!firstDigest) throw new Error('fixture missing first event');
    digestDrift[0] = { ...firstDigest, resultDigest: 'not-a-digest' };
    expect(() =>
      replayResearchProgramWorkflow(fixture.input, digestDrift),
    ).toThrow('invalid replay result digest');

    expect(() =>
      replayResearchProgramWorkflow(
        fixture.input,
        fixture.history.map((event, index) =>
          index === 0
            ? ({ ...event, productState: { claims: ['invented'] } } as never)
            : event,
        ),
      ),
    ).toThrow('replay event has invalid fields');
  });

  it('validates closed signal and query schemas', () => {
    expect(
      parseWorkflowControlSignal({
        signalId: 'signal-1',
        expectedRevision: 2,
        kind: 'human-gate-decision',
        gateId: 'gate-1',
        decision: 'approve',
        receiptId: 'receipt-1',
      }),
    ).toMatchObject({ kind: 'human-gate-decision', decision: 'approve' });
    expect(
      parseWorkflowControlSignal({
        signalId: 'signal-2',
        expectedRevision: 3,
        kind: 'criterion-branch',
        criterionVersion: 'criterion.v2',
        branchId: 'branch.v2',
      }),
    ).toMatchObject({ kind: 'criterion-branch' });
    expect(() =>
      parseWorkflowControlSignal({
        signalId: 'signal-3',
        expectedRevision: 0,
        kind: 'pause',
        uiState: { selected: true },
      }),
    ).toThrow('signal has invalid fields');
    expect(WORKFLOW_QUERY_KINDS).toHaveLength(6);
    for (const kind of WORKFLOW_QUERY_KINDS) {
      expect(parseWorkflowQuery({ kind })).toEqual({ kind });
    }
    expect(() =>
      parseWorkflowQuery({ kind: 'program-state', rawDatabase: true }),
    ).toThrow('query has invalid fields');
  });

  it('applies signals once and preserves revision on stale, duplicate, or rejected input', () => {
    const initial = {
      revision: 3,
      status: 'running' as const,
      processedSignalIds: ['seen'],
      activeBranch: identity,
    };
    const stale = applyWorkflowControlSignal(initial, {
      signalId: 'late',
      expectedRevision: 2,
      kind: 'pause',
    });
    expect(stale).toEqual({ outcome: 'stale', state: initial });
    const duplicate = applyWorkflowControlSignal(initial, {
      signalId: 'seen',
      expectedRevision: 3,
      kind: 'pause',
    });
    expect(duplicate).toEqual({ outcome: 'duplicate', state: initial });
    const rejected = applyWorkflowControlSignal(initial, {
      signalId: 'invalid-resume',
      expectedRevision: 3,
      kind: 'resume',
    });
    expect(rejected).toEqual({ outcome: 'rejected', state: initial });
    const applied = applyWorkflowControlSignal(initial, {
      signalId: 'current',
      expectedRevision: 3,
      kind: 'pause',
    });
    expect(applied).toMatchObject({
      outcome: 'applied',
      state: {
        revision: 4,
        status: 'paused',
        processedSignalIds: ['seen', 'current'],
      },
    });
    if (applied.outcome !== 'applied') throw new Error('signal not applied');
    expect(
      applyWorkflowControlSignal(applied.state, {
        signalId: 'current',
        expectedRevision: 4,
        kind: 'pause',
      }),
    ).toEqual({ outcome: 'duplicate', state: applied.state });
  });

  it('carries stable identifiers only and reconstructs product state through a port', async () => {
    const workflow = supportedWorkflowVersion('acquisition');
    const carry = createContinueAsNewCarry(workflow, identity);
    expect(Object.keys(carry).sort()).toEqual([
      'branchId',
      'criterionVersion',
      'programId',
      'workflowId',
      'workflowKind',
      'workflowVersion',
    ]);
    expect(JSON.stringify(carry)).not.toContain('productState');
    expect(JSON.stringify(carry)).not.toContain('attempt');
    expect(JSON.stringify(carry)).not.toContain('continuedAt');

    const load = vi.fn(() => Promise.resolve({ authoritativeRevision: 9 }));
    await expect(
      reconstructAfterContinueAsNew(carry, { load }),
    ).resolves.toEqual({ authoritativeRevision: 9 });
    expect(load).toHaveBeenCalledWith(identity);

    expect(() =>
      parseContinueAsNewCarry({
        ...carry,
        productState: { claims: ['leaked'] },
      }),
    ).toThrow('continue-as-new carry has invalid fields');
    expect(() =>
      parseContinueAsNewCarry({ ...carry, workflowId: 'wrong' }),
    ).toThrow('continue-as-new workflow identity mismatch');
  });
});

async function loadFixture(): Promise<ReplayFixture> {
  return JSON.parse(
    await readFile(
      new URL('./fixtures/research-program-v1-replay.json', import.meta.url),
      'utf8',
    ),
  ) as ReplayFixture;
}
