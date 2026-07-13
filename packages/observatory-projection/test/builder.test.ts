import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { canonicalDigest } from '@mammoth/domain';
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
});

function withP4(input: Record<string, unknown>): Record<string, unknown> {
  const criterion = input.criterion as Record<string, unknown>;
  return {
    ...input,
    cells: [
      withDigest({
        id: 'cell-divergence',
        programId: 'program-p2',
        cellPlanId: 'cell-plan-divergence',
        cellPlanVersion: 'v1',
        branchId: 'main',
        role: 'divergence',
        status: 'succeeded',
        criterionId: criterion.id,
        criterionVersion: String(criterion.version),
        criterionDigest: criterion.canonicalDigest,
        workItemIds: ['work-item-position'],
        receiptIds: ['receipt-cell'],
        authoritativeRevision: 4,
      }),
    ],
    positions: [
      withDigest({
        id: 'position-unsupported',
        cellId: 'cell-divergence',
        claimIds: ['claim-unresolved'],
        evidenceIds: ['evidence-support'],
        modelProfileId: 'model-lineage-qwen',
        criterionId: criterion.id,
        criterionVersion: String(criterion.version),
        criterionDigest: criterion.canonicalDigest,
        status: 'rejected',
        rejectedResidueId: 'residue-position',
        authoritativeRevision: 4,
      }),
    ],
    reviews: [
      withDigest({
        id: 'review-position',
        cellId: 'cell-divergence',
        positionId: 'position-unsupported',
        reviewerModelProfileId: 'model-lineage-frontier',
        assignmentId: 'assignment-review-1',
        verdict: 'reject',
        status: 'completed',
        receiptIds: ['receipt-review'],
        authoritativeRevision: 4,
      }),
    ],
    modelLineages: [
      withDigest({
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
        id: 'correlation-review-panel',
        modelLineageIds: ['model-lineage-qwen', 'model-lineage-frontier'],
        policyVersion: 'correlation-v1',
        score: 0.25,
        status: 'unknown_penalized',
        reasonCodes: ['unknown-lineage-penalty'],
        authoritativeRevision: 4,
      }),
    ],
    dissentReports: [
      withDigest({
        id: 'dissent-position',
        positionId: 'position-unsupported',
        claimIds: ['claim-unresolved'],
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
