import { describe, expect, it } from 'vitest';
import { canonicalDigest } from '@mammoth/domain';
import {
  PersistenceIntegrityError,
  RejectedAuditResidueSchema,
  assertPayloadDigest,
  parseResearchCellState,
  type CellPlan,
} from '../src/index.js';

const now = '2026-07-13T18:00:00.000Z';

describe('research-cell persistence ports', () => {
  it('accepts canonical cell-plan records with pinned criterion and input digests', () => {
    const plan: CellPlan = {
      id: 'cell-plan-1',
      programId: 'program-1',
      workItemId: 'work-1',
      criterionId: 'criterion-1',
      criterionDigest: canonicalDigest({ criterion: 'one' }),
      planVersion: 'cell-plan@1',
      templateVersion: 'divergence@1',
      branchId: 'main',
      role: 'lateralist',
      inputDigest: canonicalDigest({ input: 'one' }),
      outputContractVersion: 'position@1',
      status: 'planned',
      revision: 0,
      fencingToken: 0,
      createdAt: now,
      updatedAt: now,
    };

    const reconstructed = parseResearchCellState({
      programId: 'program-1',
      modelProfiles: [],
      modelProfileVersions: [],
      cellPlans: [plan],
      positions: [],
      reviews: [],
      dissentReports: [],
      correlationAssessments: [],
      rejectedResidue: [],
      receipts: [],
    });

    expect(reconstructed.cellPlans[0]).toEqual(plan);
  });

  it('rejects malformed residue digests before adapter writes', () => {
    expect(() =>
      RejectedAuditResidueSchema.parse({
        id: 'rejected-1',
        programId: 'program-1',
        subjectType: 'position',
        subjectId: 'position-1',
        reasonCode: 'criterion-drift',
        policyVersion: 'admission@1',
        payloadDigest: 'sha256:not-a-digest',
        payload: { rejected: true },
        recordedAt: now,
      }),
    ).toThrow();
  });

  it('fails closed when an integrity-bearing payload digest is wrong', () => {
    expect(() => {
      assertPayloadDigest(
        { rejected: true },
        canonicalDigest({ rejected: false }),
        'rejected residue',
      );
    }).toThrow(PersistenceIntegrityError);
  });
});
