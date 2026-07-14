import { canonicalDigest } from '@mammoth/domain';
import { describe, expect, it } from 'vitest';
import {
  buildP6TopologyProjection,
  type P6TopologyProjectionInput,
} from '../src/index.js';

const digest = `sha256:${'d'.repeat(64)}`;

function cell(
  overrides: Partial<P6TopologyProjectionInput['cells'][number]> = {},
): P6TopologyProjectionInput['cells'][number] {
  const withoutDigest = {
    id: 'cell-synthesis',
    templateId: 'template-synthesis',
    templateVersion: '1.0.0' as const,
    stableIdentityDigest: digest,
    state: 'complete' as const,
    dependencyCellIds: ['cell-divergence'],
    claimIds: ['claim-supported'],
    evidenceIds: ['evidence-supported'],
    dissentIds: ['dissent-minority'],
    receiptRefs: [{ receiptId: 'receipt-synthesis', digest }],
    reservationUsd: 10,
    consumedUsd: 6,
    releasedUsd: 4,
    retryCount: 1,
    partialFailure: false,
    temporalWorkflowId: 'workflow-topology-cell-synthesis',
    authoritativeRevision: 7,
    ...overrides,
  };
  return {
    ...withoutDigest,
    recordDigest: canonicalDigest(withoutDigest),
  };
}

function fixture(): P6TopologyProjectionInput {
  return {
    schemaVersion: 1,
    extensionVersion: '1.0.0',
    generatedAt: '2026-07-13T20:00:00.000Z',
    authoritativeRevision: 7,
    auditHeadHash: digest,
    complete: true,
    omissions: [],
    topology: {
      id: 'topology-p6',
      programId: 'program-p6',
      criterionId: 'criterion-p6',
      criterionVersion: 1,
      criterionDigest: digest,
      planDigest: digest,
      budgetCeilingUsd: 25,
      concurrencyLimit: 2,
    },
    cells: [
      cell({
        id: 'cell-divergence',
        templateId: 'template-divergence',
        dependencyCellIds: [],
        consumedUsd: 3,
        releasedUsd: 2,
        reservationUsd: 5,
        receiptRefs: [{ receiptId: 'receipt-divergence', digest }],
      }),
      cell(),
    ],
    synthesis: {
      manifestId: 'synthesis-manifest',
      admittedClaimIds: ['claim-supported'],
      preservedDissentIds: ['dissent-minority'],
      unresolvedIssueIds: ['issue-boundary'],
      sentenceTraceDigest: digest,
    },
    writeAttempts: [],
  };
}

describe('P6 topology projection', () => {
  it('builds a deterministic read-only topology projection extension', () => {
    const input = fixture();
    const projection = buildP6TopologyProjection(input);

    expect(projection.cells.map(({ id }) => id)).toEqual([
      'cell-divergence',
      'cell-synthesis',
    ]);
    expect(projection.synthesis).toMatchObject({
      admittedClaimIds: ['claim-supported'],
      preservedDissentIds: ['dissent-minority'],
    });
    expect(projection.integrity.canonicalDigest).toMatch(/^sha256:/);
    expect(
      buildP6TopologyProjection({
        ...input,
        cells: [...input.cells].reverse(),
      }),
    ).toEqual(projection);
  });

  it('fails closed on future authority, broken references, and digest mismatch', () => {
    const input = fixture();
    expect(() =>
      buildP6TopologyProjection({
        ...input,
        cells: [cell({ authoritativeRevision: 8 })],
      }),
    ).toThrow(/future authority/);
    expect(() =>
      buildP6TopologyProjection({
        ...input,
        cells: [cell({ dependencyCellIds: ['missing-cell'] })],
      }),
    ).toThrow(/broken dependency/);
    expect(() =>
      buildP6TopologyProjection({
        ...input,
        cells: [{ ...cell(), recordDigest: `sha256:${'e'.repeat(64)}` }],
      }),
    ).toThrow(/digest mismatch/);
  });

  it('fails closed on projection writes, hidden Temporal authority, overspend, and silent omissions', () => {
    const input = fixture();
    expect(() =>
      buildP6TopologyProjection({
        ...input,
        writeAttempts: [
          {
            id: 'write-attempt',
            attemptedAt: '2026-07-13T20:00:00.000Z',
            target: 'topology_cells',
          },
        ],
      }),
    ).toThrow(/read-only/);
    expect(() =>
      buildP6TopologyProjection({
        ...input,
        cells: [cell({ hiddenTemporalProductStateDigest: digest })],
      }),
    ).toThrow(/hidden Temporal product state/);
    expect(() =>
      buildP6TopologyProjection({
        ...input,
        cells: [cell({ consumedUsd: 8, releasedUsd: 4, reservationUsd: 10 })],
      }),
    ).toThrow(/overspends/);
    expect(() =>
      buildP6TopologyProjection({
        ...input,
        cells: [
          cell({
            id: 'cell-divergence',
            templateId: 'template-divergence',
            dependencyCellIds: [],
            claimIds: [],
          }),
          cell({ claimIds: [] }),
        ],
      }),
    ).toThrow(/silently omits/);
  });
});
