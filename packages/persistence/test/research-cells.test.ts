import { describe, expect, it } from 'vitest';
import {
  RESEARCH_CELL_CONTRACT_VERSION,
  canonicalDigest,
  cellInputDigest,
  type CellInput,
} from '@mammoth/domain';
import {
  AdmissionDecisionRecordSchema,
  PersistenceIntegrityError,
  RejectedAuditResidueRecordSchema,
  ReviewAssignmentRecordSchema,
  assertPayloadDigest,
  parseResearchCellState,
  type CellPlanRecord,
} from '../src/index.js';

const now = '2026-07-13T18:00:00.000Z';

describe('research-cell persistence ports', () => {
  it('requires an integrity-bearing admitted decision envelope', () => {
    const admitted = {
      decision: 'admitted',
      policyVersion: 'admission@1',
      policyDigest: canonicalDigest({ policy: 'admission@1' }),
      subjectDigest: canonicalDigest({ position: 'one' }),
      reasonCodes: ['admitted'],
      decidedAt: now,
    };
    expect(AdmissionDecisionRecordSchema.parse(admitted)).toEqual(admitted);
    expect(() =>
      AdmissionDecisionRecordSchema.parse({
        ...admitted,
        decision: 'rejected',
      }),
    ).toThrow();
  });

  it('rejects review-assignment metadata drift from the immutable contract', () => {
    const contract = {
      id: 'assignment-1',
      schemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
      programId: 'program-1',
      workItemId: 'review-work-1',
      targetPositionId: 'position-1',
      reviewerAgentId: 'reviewer-1',
      reviewerModelProfileVersionId: 'version-reviewer',
      reviewerRole: 'falsifier',
      targetAuthorAgentId: 'author-1',
      targetModelProfileVersionId: 'version-author',
      targetRole: 'lateralist',
      criterionRef: {
        criterionId: 'criterion-1',
        criterionVersion: 1,
        criterionDigest: canonicalDigest({ criterion: 'one' }),
        branchId: 'main',
      },
      blind: true,
      assignedAt: now,
    };
    const record = {
      contract,
      id: contract.id,
      programId: contract.programId,
      workItemId: contract.workItemId,
      targetPositionId: contract.targetPositionId,
      reviewerAgentId: contract.reviewerAgentId,
      reviewerModelProfileVersionId: contract.reviewerModelProfileVersionId,
      reviewerRole: contract.reviewerRole,
      targetAuthorAgentId: contract.targetAuthorAgentId,
      targetModelProfileVersionId: contract.targetModelProfileVersionId,
      targetRole: contract.targetRole,
      criterionId: contract.criterionRef.criterionId,
      criterionDigest: contract.criterionRef.criterionDigest,
      blind: contract.blind,
      assignmentDigest: canonicalDigest(contract),
      recordedAt: now,
    };
    expect(ReviewAssignmentRecordSchema.parse(record)).toEqual(record);
    expect(() =>
      ReviewAssignmentRecordSchema.parse({
        ...record,
        reviewerRole: 'same-author-role',
      }),
    ).toThrow(/drifts from domain contract/);
  });

  it('accepts canonical cell-plan records with pinned criterion and input digests', () => {
    const input: CellInput = {
      schemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
      claimIds: [],
      evidenceIds: [],
      hypothesisIds: [],
      artifactIds: [],
    };
    const digest = cellInputDigest(input);
    const plan: CellPlanRecord = {
      contract: {
        id: 'cell-plan-1',
        schemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
        programId: 'program-1',
        workItemId: 'work-1',
        templateId: 'template-divergence',
        templateVersion: 1,
        criterionRef: {
          criterionId: 'criterion-1',
          criterionVersion: 1,
          criterionDigest: canonicalDigest({ criterion: 'one' }),
          branchId: 'main',
        },
        branchId: 'main',
        input,
        inputDigest: digest,
        outputContract: {
          kind: 'positions',
          minimumCount: 1,
          schemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
        },
        plannedAt: now,
      },
      id: 'cell-plan-1',
      programId: 'program-1',
      workItemId: 'work-1',
      criterionId: 'criterion-1',
      criterionDigest: canonicalDigest({ criterion: 'one' }),
      planVersion: 'cell-plan@1',
      templateVersion: '1',
      branchId: 'main',
      role: 'lateralist',
      inputDigest: digest,
      outputContractVersion: RESEARCH_CELL_CONTRACT_VERSION,
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
      reviewAssignments: [],
      reviews: [],
      dissentReports: [],
      correlationAssessments: [],
      rejectedResidue: [],
      receipts: [],
    });

    expect(reconstructed.cellPlans[0]).toEqual(plan);

    expect(() =>
      parseResearchCellState({
        ...reconstructed,
        cellPlans: [
          {
            ...plan,
            contract: {
              ...plan.contract,
              criterionRef: {
                ...plan.contract.criterionRef,
                criterionDigest: canonicalDigest({ criterion: 'drifted' }),
              },
            },
          },
        ],
      }),
    ).toThrow(/drifts from domain contract/);
  });

  it('rejects malformed residue digests before adapter writes', () => {
    expect(() =>
      RejectedAuditResidueRecordSchema.parse({
        id: 'rejected-1',
        programId: 'program-1',
        subjectType: 'position',
        subjectId: 'position-1',
        reasonCode: 'criterion-drift',
        policyVersion: 'admission@1',
        policyDigest: canonicalDigest({ policy: 'admission@1' }),
        reasonCodes: ['criterion-drift'],
        decision: 'rejected',
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
