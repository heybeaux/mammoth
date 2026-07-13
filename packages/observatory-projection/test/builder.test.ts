import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  MODEL_LINEAGE_POLICY_VERSION,
  RESEARCH_CELL_CONTRACT_VERSION,
  canonicalDigest,
  cellInputDigest,
  correlationAssessmentDigest,
  dissentReportDigest,
  modelProfileVersionDigest,
  researchPositionDigest,
  researchReviewDigest,
  type CellInput,
  type CorrelationAssessment,
  type DissentReport,
  type ModelProfileVersion,
  type ResearchPosition,
  type ResearchReview,
} from '@mammoth/domain';
import { describe, expect, it } from 'vitest';
import {
  ObservatoryProjectionV1Schema,
  buildObservatoryProjectionV1,
} from '../src/index.js';

const fixturePath = fileURLToPath(
  new URL(
    '../../../evals/fixtures/p2/observatory-projection-input.json',
    import.meta.url,
  ),
);
const projectionPath = fileURLToPath(
  new URL(
    '../../../evals/fixtures/p2/observatory-projection.json',
    import.meta.url,
  ),
);
const temporalLinkPath = fileURLToPath(
  new URL(
    '../../../evals/fixtures/p3/temporal-observatory-link.json',
    import.meta.url,
  ),
);

async function fixture(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(fixturePath, 'utf8')) as Record<
    string,
    unknown
  >;
}

describe('ObservatoryProjectionV1', () => {
  it('matches the checked-in deterministic projection fixture', async () => {
    const projection = buildObservatoryProjectionV1(await fixture());
    const expected = JSON.parse(
      await readFile(projectionPath, 'utf8'),
    ) as unknown;
    expect(projection).toEqual(expected);
    expect(ObservatoryProjectionV1Schema.parse(projection)).toEqual(projection);
  });

  it('is deterministic across authoritative input ordering', async () => {
    const input = await fixture();
    const reordered = {
      ...input,
      claims: [...(input.claims as unknown[])].reverse(),
      evidence: [...(input.evidence as unknown[])].reverse(),
      claimEvidenceEdges: [
        ...(input.claimEvidenceEdges as unknown[]),
      ].reverse(),
      auditEvents: [...(input.auditEvents as unknown[])].reverse(),
    };
    expect(buildObservatoryProjectionV1(reordered)).toEqual(
      buildObservatoryProjectionV1(input),
    );
  });

  it('preserves contradicted and unresolved claims without promoting them', async () => {
    const projection = buildObservatoryProjectionV1(await fixture());
    const claims = projection.nodes.filter((node) => node.kind === 'claim');
    expect(claims.map(({ id, status }) => [id, status])).toEqual([
      ['claim-contradicted', 'contradicted'],
      ['claim-supported', 'supported'],
      ['claim-unresolved', 'unresolved'],
    ]);
    expect(
      projection.dossier.excludedClaims.map(({ claimId }) => claimId),
    ).toEqual(['claim-contradicted', 'claim-unresolved']);
  });

  it('keeps dossier sentences on their authoritative provenance chain', async () => {
    const projection = buildObservatoryProjectionV1(await fixture());
    expect(projection.dossier.sentences[0]?.bindings[0]).toMatchObject({
      claimId: 'claim-supported',
      assessmentId: 'assessment-supported',
      policyId: 'policy-1',
      evidenceId: 'evidence-support',
      snapshotDigest:
        'sha256:1111111111111111111111111111111111111111111111111111111111111111',
      locator: { lineStart: 4, lineEnd: 4 },
    });
  });

  it('fails closed on invalid schema and dangling provenance', async () => {
    const input = await fixture();
    expect(() =>
      buildObservatoryProjectionV1({ ...input, schemaVersion: 2 }),
    ).toThrow();
    const edges = input.claimEvidenceEdges as Record<string, unknown>[];
    expect(() =>
      buildObservatoryProjectionV1({
        ...input,
        claimEvidenceEdges: [{ ...edges[0], evidenceId: 'missing' }],
      }),
    ).toThrow(/dangling/);
  });

  it('rejects authority mismatches outside dossier traces', async () => {
    const input = await fixture();
    const claims = input.claims as Record<string, unknown>[];
    expect(() =>
      buildObservatoryProjectionV1({
        ...input,
        claims: claims.map((claim) =>
          claim.id === 'claim-supported'
            ? { ...claim, status: 'unresolved' }
            : claim,
        ),
      }),
    ).toThrow(/disagrees with its assessment/);

    const evidence = input.evidence as Record<string, unknown>[];
    expect(() =>
      buildObservatoryProjectionV1({
        ...input,
        evidence: evidence.map((artifact) => ({
          ...artifact,
          sourceLineageId: 'missing-lineage',
        })),
      }),
    ).toThrow(/unknown lineage/);
  });

  it('links deterministic Temporal operations without making history authoritative', async () => {
    const input = await fixture();
    const temporalExecution = JSON.parse(
      await readFile(temporalLinkPath, 'utf8'),
    ) as Record<string, unknown>;
    const projection = buildObservatoryProjectionV1({
      ...input,
      temporalExecution,
    });

    expect(projection.temporalExecution).toMatchObject({
      workflowId: 'mammoth:program-p2:main',
      taskQueue: 'mammoth-research-control-v1',
      metrics: {
        retryCount: 1,
        duplicateEffectsPrevented: 1,
      },
    });
    expect(
      projection.timeline
        .filter((event) => 'source' in event)
        .map(({ kind }) => kind),
    ).toEqual([
      'workflow_started',
      'continue_as_new',
      'timer',
      'signal',
      'human_gate',
      'cancellation',
      'retry',
      'terminal',
    ]);
    expect(projection.integrity.canonicalDigest).toBe(
      'sha256:9b55e685f9811a3278a7d39fd7414798784369a31b5c33b66ffd52e00bf639b9',
    );

    const reordered = {
      ...input,
      temporalExecution: {
        ...temporalExecution,
        events: [
          ...(temporalExecution.events as Record<string, unknown>[]),
        ].reverse(),
        logs: [
          ...(temporalExecution.logs as Record<string, unknown>[]),
        ].reverse(),
      },
    };
    expect(buildObservatoryProjectionV1(reordered)).toEqual(projection);
  });

  it('fails closed on Temporal links to another run or future authority', async () => {
    const input = await fixture();
    const temporalExecution = JSON.parse(
      await readFile(temporalLinkPath, 'utf8'),
    ) as Record<string, unknown>;
    const events = temporalExecution.events as Record<string, unknown>[];
    expect(() =>
      buildObservatoryProjectionV1({
        ...input,
        temporalExecution: {
          ...temporalExecution,
          events: [{ ...events[0], runId: 'another-run' }],
        },
      }),
    ).toThrow(/another run/);
    expect(() =>
      buildObservatoryProjectionV1({
        ...input,
        temporalExecution: {
          ...temporalExecution,
          events: [{ ...events[0], authoritativeRevision: 13 }],
        },
      }),
    ).toThrow(/future authoritative revision/);
    expect(() =>
      buildObservatoryProjectionV1({
        ...input,
        temporalExecution: {
          ...temporalExecution,
          runChain: [
            ...(temporalExecution.runChain as Record<string, unknown>[]),
            {
              runId: 'continued-run',
              continuedFromRunId: 'wrong-parent',
            },
          ],
          runId: 'continued-run',
        },
      }),
    ).toThrow(/continue-as-new chain/);
    expect(() =>
      buildObservatoryProjectionV1({
        ...input,
        temporalExecution: {
          ...temporalExecution,
          metrics: {
            ...(temporalExecution.metrics as Record<string, unknown>),
            retryCount: 2,
          },
        },
      }),
    ).toThrow(/retry metric/);
    expect(() =>
      buildObservatoryProjectionV1({
        ...input,
        temporalExecution: {
          ...temporalExecution,
          metrics: {
            ...(temporalExecution.metrics as Record<string, unknown>),
            duplicateEffectsPrevented: 0,
          },
        },
      }),
    ).toThrow(/duplicate-effect metric/);
  });

  it('projects P4 cells, reviews, model lineage, dissent, rejected residue, and receipts deterministically', async () => {
    const input = withP4(await fixture());
    const projection = buildObservatoryProjectionV1(input);

    expect(projection.nodes.map((node) => [node.kind, node.id])).toContainEqual(
      ['research_cell', 'cell-divergence'],
    );
    expect(projection.nodes.map((node) => [node.kind, node.id])).toContainEqual(
      ['model_lineage', 'model-lineage-qwen'],
    );
    expect(projection.nodes.map((node) => [node.kind, node.id])).toContainEqual(
      ['rejected_residue', 'residue-position'],
    );
    expect(
      projection.nodes.find(
        (node) =>
          node.kind === 'correlation' && node.id === 'correlation-review-panel',
      ),
    ).toMatchObject({
      policyVersion: MODEL_LINEAGE_POLICY_VERSION,
      modelLineageIds: ['model-lineage-frontier', 'model-lineage-qwen'],
      contractDigest: (
        input.correlations as { contract: { canonicalDigest: string } }[]
      )[0]?.contract.canonicalDigest,
    });
    expect(
      projection.nodes.find(
        (node) => node.kind === 'dissent' && node.id === 'dissent-position',
      ),
    ).toMatchObject({
      positionIds: ['position-unsupported'],
      claimIds: ['claim-unresolved'],
      evidenceIds: ['evidence-support'],
      criterionId: 'criterion-1',
      contractDigest: (
        input.dissentReports as { contract: { canonicalDigest: string } }[]
      )[0]?.contract.canonicalDigest,
    });
    expect(
      projection.edges.map((edge) => [edge.kind, edge.from, edge.to]),
    ).toContainEqual(['reviews', 'review-position', 'position-unsupported']);
    expect(
      projection.edges.map((edge) => [edge.kind, edge.from, edge.to]),
    ).toContainEqual([
      'rejected_for',
      'residue-position',
      'position-unsupported',
    ]);
    expect(buildObservatoryProjectionV1(reorderP4(input))).toEqual(projection);
  });

  it('fails closed on P4 future authority, digest mismatch, broken references, and lineage cycles', async () => {
    const input = withP4(await fixture());

    const [sourceCorrelation] = input.correlations as Record<string, unknown>[];
    const [sourceDissent] = input.dissentReports as Record<string, unknown>[];
    if (!sourceCorrelation || !sourceDissent)
      throw new Error('P4 fixture must contain correlation and dissent');
    expect(() =>
      buildObservatoryProjectionV1({
        ...input,
        correlations: [
          withDigest({
            ...sourceCorrelation,
            policyVersion: 'drifted-policy',
          }),
        ],
      }),
    ).toThrow(/correlation projection metadata drifts/);
    expect(() =>
      buildObservatoryProjectionV1({
        ...input,
        dissentReports: [
          withDigest({
            ...sourceDissent,
            evidenceIds: [],
          }),
        ],
      }),
    ).toThrow(/dissent projection metadata drifts/);

    const [sourceCell] = input.cells as Record<string, unknown>[];
    if (!sourceCell) throw new Error('P4 fixture must contain a cell');
    const sourceContract = sourceCell.contract as Record<string, unknown>;
    const driftedCell = withDigest({
      ...sourceCell,
      contract: {
        ...sourceContract,
        criterionRef: {
          ...(sourceContract.criterionRef as Record<string, unknown>),
          criterionVersion: 99,
        },
      },
    });
    expect(() =>
      buildObservatoryProjectionV1({ ...input, cells: [driftedCell] }),
    ).toThrow(/drifts from authoritative contract/);

    expect(() =>
      buildObservatoryProjectionV1({
        ...input,
        positions: [
          withDigest({
            ...(input.positions as Record<string, unknown>[])[0],
            authoritativeRevision: 13,
          }),
        ],
      }),
    ).toThrow(/future authority/);
    expect(() =>
      buildObservatoryProjectionV1({
        ...input,
        positions: [
          {
            ...(input.positions as Record<string, unknown>[])[0],
            claimIds: ['missing-claim'],
          },
        ],
      }),
    ).toThrow(/digest mismatch/);
    const broken = withDigest({
      ...((input.positions as Record<string, unknown>[])[0] ?? {}),
      claimIds: ['missing-claim'],
    });
    expect(() =>
      buildObservatoryProjectionV1({
        ...input,
        positions: [broken],
      }),
    ).toThrow(/unknown claim/);
    const cyclicParent = withDigest({
      ...((input.modelLineages as Record<string, unknown>[])[0] ?? {}),
      parentModelLineageIds: ['model-lineage-child'],
    });
    const cyclicChild = withDigest({
      contract: modelVersionContract({
        id: 'model-lineage-child',
        provider: 'local',
        family: 'qwen',
        checkpoint: 'derived',
        lineageKind: 'known',
      }),
      id: 'model-lineage-child',
      provider: 'local',
      family: 'qwen',
      checkpoint: 'derived',
      modelProfileVersion: 'v1',
      parentModelLineageIds: ['model-lineage-qwen'],
      sharedDerivationIds: [],
      unknownLineage: false,
      authoritativeRevision: 4,
    });
    expect(() =>
      buildObservatoryProjectionV1({
        ...input,
        modelLineages: [cyclicParent, cyclicChild],
      }),
    ).toThrow(/model lineage cycle/);
  });

  it('projects P5 isolation, attribution, spend, partial results, and receipts without reviewer leakage', async () => {
    const input = withP5(withP4(await fixture()));
    const projection = buildObservatoryProjectionV1(input);

    expect(
      projection.nodes.find(
        (node) => node.kind === 'p5_isolation' && node.id === 'p5-run-1',
      ),
    ).toMatchObject({
      workflowId: 'mammoth:DivergenceReviewWorkflow:v1:p5-run-1',
      sequenceState: 'settled',
      authorAgentId: 'agent-qwen',
      authorModelProfileVersionId: 'model-lineage-qwen',
      sanitizedContextDigest:
        'sha256:1212121212121212121212121212121212121212121212121212121212121212',
      reservedUsd: 1,
      consumedUsd: 0.6,
      releasedUsd: 0.4,
    });
    expect(JSON.stringify(projection)).not.toContain('authorConfidence');
    expect(JSON.stringify(projection)).not.toContain('upstreamPassMarkers');
    expect(
      projection.edges.map((edge) => [edge.kind, edge.from, edge.to]),
    ).toContainEqual(['emitted_receipt', 'p5-run-1', 'receipt-settlement']);
  });

  it('fails closed on P5 impossible sequence, digest drift, overspend, broken refs, reviewer leakage, and Temporal product state', async () => {
    const input = withP5(withP4(await fixture()));
    const [run] = input.isolationRuns as Record<string, unknown>[];
    if (!run) throw new Error('P5 fixture must contain an isolation run');

    expect(() =>
      buildObservatoryProjectionV1({
        ...input,
        isolationRuns: [
          withDigest({
            ...run,
            commitSequence: ['budget_reserved', 'position_committed'],
          }),
        ],
      }),
    ).toThrow(/impossible sequence/);
    expect(() =>
      buildObservatoryProjectionV1({
        ...input,
        isolationRuns: [
          withDigest({
            ...run,
            revealedPositionDigest:
              'sha256:3434343434343434343434343434343434343434343434343434343434343434',
          }),
        ],
      }),
    ).toThrow(/reveal digest mismatch/);
    expect(() =>
      buildObservatoryProjectionV1({
        ...input,
        isolationRuns: [
          withDigest({
            ...run,
            settlement: {
              settlementId: 'settlement-1',
              consumedUsd: 0.8,
              releasedUsd: 0.4,
              receiptId: 'receipt-settlement',
            },
          }),
        ],
      }),
    ).toThrow(/overspends reservation/);
    expect(() =>
      buildObservatoryProjectionV1({
        ...input,
        isolationRuns: [
          withDigest({
            ...run,
            reviewerVisibleFields: ['claimIds', 'authorAgentId'],
          }),
        ],
      }),
    ).toThrow(/leaks reviewer context/);
    expect(() =>
      buildObservatoryProjectionV1({
        ...input,
        isolationRuns: [
          withDigest({
            ...run,
            partialResultReceiptIds: ['missing-receipt'],
          }),
        ],
      }),
    ).toThrow(/unknown receipt/);
    expect(() =>
      buildObservatoryProjectionV1({
        ...input,
        temporalExecution: {
          workflowId: 'mammoth:DivergenceReviewWorkflow:v1:p5-run-1',
          runId: 'run-1',
          runChain: [{ runId: 'run-1' }],
          workflowType: 'DivergenceReviewWorkflow',
          taskQueue: 'mammoth-research-control-v1',
          contractVersion: '1',
          currentDurableStep: String(run.committedPositionDigest),
          attempt: 1,
          events: [],
          metrics: {
            workflowLatencyMs: 0,
            activityLatencyMs: 0,
            retryCount: 0,
            duplicateEffectsPrevented: 0,
            failClosedStartupCount: 0,
          },
          logs: [],
        },
      }),
    ).toThrow(/hides product state in Temporal/);
  });
});

function withP4(input: Record<string, unknown>): Record<string, unknown> {
  const criterion = input.criterion as Record<string, unknown>;
  const criterionRef = {
    criterionId: String(criterion.id),
    criterionVersion: Number(criterion.version),
    criterionDigest: String(criterion.canonicalDigest),
    branchId: 'main',
  };
  const cellInput: CellInput = {
    schemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
    claimIds: ['claim-unresolved'],
    evidenceIds: ['evidence-support'],
    hypothesisIds: [],
    artifactIds: [],
  };
  const authoritativeInputDigest = cellInputDigest(cellInput);
  const cellContract = {
    id: 'cell-plan-divergence',
    schemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
    programId: 'program-p2',
    workItemId: 'work-item-position',
    templateId: 'template-divergence',
    templateVersion: 1,
    criterionRef,
    branchId: 'main',
    input: cellInput,
    inputDigest: authoritativeInputDigest,
    outputContract: {
      kind: 'positions' as const,
      minimumCount: 1,
      schemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
    },
    plannedAt: '2026-07-13T18:00:00.000Z',
  };
  const qwen = modelVersionContract({
    id: 'model-lineage-qwen',
    provider: 'local',
    family: 'qwen',
    checkpoint: 'qwen3',
    lineageKind: 'known',
  });
  const frontier = modelVersionContract({
    id: 'model-lineage-frontier',
    provider: 'cloud',
    family: 'frontier',
    checkpoint: 'checkpoint-1',
    lineageKind: 'unknown',
  });
  const positionContract = positionContractForProjection(
    criterionRef,
    authoritativeInputDigest,
  );
  const reviewContract = reviewContractForProjection(criterionRef);
  const correlationContractBase: CorrelationAssessment = {
    id: 'correlation-review-panel',
    schemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
    policyVersion: MODEL_LINEAGE_POLICY_VERSION,
    subjectModelProfileVersionId: 'model-lineage-qwen',
    candidateModelProfileVersionId: 'model-lineage-frontier',
    independent: false,
    correlationScore: 0.6,
    reasonCodes: ['unknown_lineage'],
    assessedAt: '2026-07-13T18:00:00.000Z',
    canonicalDigest:
      'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  };
  const correlationContract = {
    ...correlationContractBase,
    canonicalDigest: correlationAssessmentDigest(correlationContractBase),
  };
  const dissentContractBase: DissentReport = {
    id: 'dissent-position',
    schemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
    programId: 'program-p2',
    cellPlanId: 'cell-plan-divergence',
    criterionRef,
    positionIds: ['position-unsupported'],
    claimIds: ['claim-unresolved'],
    evidenceIds: ['evidence-support'],
    unresolvedReasonCodes: ['minority-report-retained'],
    canonicalDigest:
      'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    createdAt: '2026-07-13T18:00:00.000Z',
  };
  const dissentContract = {
    ...dissentContractBase,
    canonicalDigest: dissentReportDigest(dissentContractBase),
  };
  return {
    ...input,
    cells: [
      withDigest({
        contract: cellContract,
        id: 'cell-divergence',
        programId: 'program-p2',
        cellPlanId: 'cell-plan-divergence',
        cellPlanVersion: 'v1',
        branchId: 'main',
        role: 'divergence',
        status: 'succeeded',
        criterionId: criterion.id,
        criterionVersion: Number(criterion.version),
        criterionDigest: criterion.canonicalDigest,
        workItemIds: ['work-item-position'],
        receiptIds: ['receipt-cell'],
        authoritativeRevision: 4,
      }),
    ],
    positions: [
      withDigest({
        contract: positionContract,
        id: 'position-unsupported',
        cellId: 'cell-divergence',
        claimIds: ['claim-unresolved'],
        evidenceIds: ['evidence-support'],
        modelProfileVersionId: 'model-lineage-qwen',
        criterionId: criterion.id,
        criterionVersion: Number(criterion.version),
        criterionDigest: criterion.canonicalDigest,
        status: 'rejected',
        rejectedResidueId: 'residue-position',
        authoritativeRevision: 4,
      }),
    ],
    reviews: [
      withDigest({
        contract: reviewContract,
        id: 'review-position',
        cellId: 'cell-divergence',
        positionId: 'position-unsupported',
        reviewerModelProfileVersionId: 'model-lineage-frontier',
        assignmentId: 'assignment-review-1',
        verdict: 'reject',
        status: 'completed',
        receiptIds: ['receipt-review'],
        authoritativeRevision: 4,
      }),
    ],
    modelLineages: [
      withDigest({
        contract: qwen,
        id: 'model-lineage-qwen',
        provider: 'local',
        family: 'qwen',
        checkpoint: 'qwen3',
        modelProfileVersion: 'v1',
        parentModelLineageIds: [],
        sharedDerivationIds: [],
        unknownLineage: false,
        authoritativeRevision: 4,
      }),
      withDigest({
        contract: frontier,
        id: 'model-lineage-frontier',
        provider: 'cloud',
        family: 'frontier',
        checkpoint: 'checkpoint-1',
        modelProfileVersion: 'v1',
        parentModelLineageIds: [],
        sharedDerivationIds: [],
        unknownLineage: true,
        authoritativeRevision: 4,
      }),
    ],
    correlations: [
      withDigest({
        contract: correlationContract,
        id: 'correlation-review-panel',
        modelLineageIds: ['model-lineage-qwen', 'model-lineage-frontier'],
        policyVersion: MODEL_LINEAGE_POLICY_VERSION,
        score: 0.6,
        status: 'unknown_penalized',
        reasonCodes: ['unknown_lineage'],
        authoritativeRevision: 4,
      }),
    ],
    dissentReports: [
      withDigest({
        contract: dissentContract,
        id: 'dissent-position',
        positionIds: ['position-unsupported'],
        claimIds: ['claim-unresolved'],
        evidenceIds: ['evidence-support'],
        status: 'preserved',
        reasonCodes: ['minority-report-retained'],
        authoritativeRevision: 4,
      }),
    ],
    rejectedResidue: [
      withDigest({
        id: 'residue-position',
        sourceId: 'position-unsupported',
        sourceKind: 'position',
        reasonCodes: ['missing-direct-evidence'],
        retainedArtifactDigest:
          'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
        authoritativeRevision: 4,
      }),
    ],
    receipts: [
      withDigest({
        id: 'receipt-cell',
        workItemId: 'work-item-position',
        status: 'succeeded',
        artifactDigest:
          'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        authoritativeRevision: 4,
      }),
      withDigest({
        id: 'receipt-review',
        workItemId: 'assignment-review-1',
        status: 'succeeded',
        artifactDigest:
          'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
        authoritativeRevision: 4,
      }),
    ],
  };
}

function withP5(input: Record<string, unknown>): Record<string, unknown> {
  const position = (
    input.positions as { contract: { canonicalDigest: string } }[]
  )[0];
  if (!position) throw new Error('P4 fixture must contain a position');
  return {
    ...input,
    receipts: [
      ...(input.receipts as Record<string, unknown>[]),
      withDigest({
        id: 'receipt-reservation',
        workItemId: 'reservation-1',
        status: 'succeeded',
        artifactDigest:
          'sha256:1111111111111111111111111111111111111111111111111111111111111111',
        authoritativeRevision: 4,
      }),
      withDigest({
        id: 'receipt-settlement',
        workItemId: 'settlement-1',
        status: 'succeeded',
        artifactDigest:
          'sha256:2222222222222222222222222222222222222222222222222222222222222222',
        authoritativeRevision: 4,
      }),
      withDigest({
        id: 'receipt-partial',
        workItemId: 'partial-1',
        status: 'partial',
        artifactDigest:
          'sha256:3333333333333333333333333333333333333333333333333333333333333333',
        authoritativeRevision: 4,
      }),
    ],
    isolationRuns: [
      withDigest({
        id: 'p5-run-1',
        workflowId: 'mammoth:DivergenceReviewWorkflow:v1:p5-run-1',
        isolationProtocolVersion: '1.0.0',
        sanitizedContextContractVersion: '1.0.0',
        assignmentPolicyVersion: '1.0.0',
        positionId: 'position-unsupported',
        reviewId: 'review-position',
        assignmentId: 'assignment-review-1',
        sanitizedContextDigest:
          'sha256:1212121212121212121212121212121212121212121212121212121212121212',
        committedPositionDigest: position.contract.canonicalDigest,
        revealedPositionDigest: position.contract.canonicalDigest,
        commitSequence: [
          'budget_reserved',
          'position_dispatched',
          'position_committed',
          'position_revealed',
          'review_assigned',
          'review_committed',
          'budget_settled',
        ],
        authorAttribution: {
          authorAgentId: 'agent-qwen',
          authorModelProfileVersionId: 'model-lineage-qwen',
        },
        reviewerVisibleFields: ['claimIds', 'evidenceIds', 'answer'],
        prohibitedReviewerFieldDigests: [
          'sha256:5656565656565656565656565656565656565656565656565656565656565656',
        ],
        correlationId: 'correlation-review-panel',
        dissentId: 'dissent-position',
        residueIds: ['residue-position'],
        reservation: {
          reservationId: 'reservation-1',
          amountUsd: 1,
          receiptId: 'receipt-reservation',
        },
        settlement: {
          settlementId: 'settlement-1',
          consumedUsd: 0.6,
          releasedUsd: 0.4,
          receiptId: 'receipt-settlement',
        },
        partialResultReceiptIds: ['receipt-partial'],
        retryReceiptIds: [],
        effectReceiptIds: ['receipt-reservation', 'receipt-settlement'],
        authoritativeRevision: 4,
      }),
    ],
  };
}

function modelVersionContract(input: {
  id: string;
  provider: string;
  family: string;
  checkpoint: string;
  lineageKind: 'known' | 'unknown';
}): ModelProfileVersion {
  const base: ModelProfileVersion = {
    id: input.id,
    profileId: `${input.id}-profile`,
    schemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
    provider: input.provider,
    providerModelId: input.id,
    family: input.family,
    checkpoint: input.checkpoint,
    contextWindow: 128_000,
    modalities: ['text'],
    locality: input.provider === 'local' ? 'local' : 'cloud',
    dataPolicyId: 'public-redacted-only',
    costProfileId: 'cost-default',
    lineage: {
      kind: input.lineageKind,
      trainingLineageIds: [],
      fineTuneLineageIds: [],
      sharedDerivationIds: [],
      parentVersionIds: [],
    },
    immutableDigest:
      'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    recordedAt: '2026-07-13T18:00:00.000Z',
  };
  return { ...base, immutableDigest: modelProfileVersionDigest(base) };
}

function positionContractForProjection(
  criterionRef: {
    criterionId: string;
    criterionVersion: number;
    criterionDigest: string;
    branchId: string;
  },
  inputDigest: string,
): ResearchPosition {
  const base: ResearchPosition = {
    id: 'position-unsupported',
    schemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
    programId: 'program-p2',
    cellPlanId: 'cell-plan-divergence',
    workItemId: 'work-item-position',
    authorAgentId: 'agent-qwen',
    role: 'divergence',
    criterionRef,
    modelProfileVersionId: 'model-lineage-qwen',
    inputDigest,
    outputSchemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
    answer: 'unsupported candidate',
    claimIds: ['claim-unresolved'],
    evidenceIds: ['evidence-support'],
    hypothesisIds: [],
    artifactIds: [],
    proposalRefs: [{ kind: 'claim', id: 'claim-unresolved' }],
    assumptions: [],
    dissent: [],
    proposedFalsifiers: [],
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      costUsd: 0,
      latencyMs: 1,
    },
    uncertaintyCodes: [],
    failureCodes: [],
    receiptRefs: [],
    canonicalDigest:
      'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    createdAt: '2026-07-13T18:00:00.000Z',
  };
  return { ...base, canonicalDigest: researchPositionDigest(base) };
}

function reviewContractForProjection(criterionRef: {
  criterionId: string;
  criterionVersion: number;
  criterionDigest: string;
  branchId: string;
}): ResearchReview {
  const base: ResearchReview = {
    id: 'review-position',
    schemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
    assignmentId: 'assignment-review-1',
    programId: 'program-p2',
    workItemId: 'assignment-review-1',
    targetPositionId: 'position-unsupported',
    reviewerAgentId: 'agent-frontier',
    reviewerModelProfileVersionId: 'model-lineage-frontier',
    reviewerRole: 'falsification',
    criterionRef,
    inputDigest:
      'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    outputSchemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
    verdict: 'reject',
    reasonCodes: ['missing-direct-evidence'],
    checkedClaimIds: ['claim-unresolved'],
    checkedEvidenceIds: ['evidence-support'],
    checkedHypothesisIds: [],
    checkedArtifactIds: [],
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      costUsd: 0,
      latencyMs: 1,
    },
    uncertaintyCodes: [],
    failureCodes: [],
    receiptRefs: [],
    canonicalDigest:
      'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    createdAt: '2026-07-13T18:00:00.000Z',
  };
  return { ...base, canonicalDigest: researchReviewDigest(base) };
}

function withDigest<T extends Record<string, unknown>>(record: T): T {
  const withoutDigest: Record<string, unknown> = { ...record };
  delete withoutDigest.recordDigest;
  return {
    ...withoutDigest,
    recordDigest: canonicalDigest(withoutDigest),
  } as unknown as T;
}

function reorderP4(input: Record<string, unknown>): Record<string, unknown> {
  return {
    ...input,
    cells: [...(input.cells as unknown[])].reverse(),
    positions: [...(input.positions as unknown[])].reverse(),
    reviews: [...(input.reviews as unknown[])].reverse(),
    modelLineages: [...(input.modelLineages as unknown[])].reverse(),
    correlations: [...(input.correlations as unknown[])].reverse(),
    dissentReports: [...(input.dissentReports as unknown[])].reverse(),
    rejectedResidue: [...(input.rejectedResidue as unknown[])].reverse(),
    receipts: [...(input.receipts as unknown[])].reverse(),
  };
}
