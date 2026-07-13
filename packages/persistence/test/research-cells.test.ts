import { describe, expect, it } from 'vitest';
import {
  RESEARCH_CELL_CONTRACT_VERSION,
  canonicalDigest,
  cellInputDigest,
  researchPositionDigest,
  type CellInput,
} from '@mammoth/domain';
import {
  AdmissionDecisionRecordSchema,
  InMemoryResearchCellRepository,
  P4_ADMISSION_POLICY_DIGEST,
  P4_ADMISSION_POLICY_VERSION,
  PersistenceIntegrityError,
  PersistenceConflictError,
  RejectedAuditResidueRecordSchema,
  ReviewAssignmentRecordSchema,
  assertPayloadDigest,
  parseResearchCellState,
  type BudgetReservationRecord,
  type CellAttemptRecord,
  type CellPlanRecord,
  type CancellationReceiptRecord,
  type IsolationCommitRecord,
  type ResearchPositionRecord,
} from '../src/index.js';

const now = '2026-07-13T18:00:00.000Z';

describe('research-cell persistence ports', () => {
  it('requires an integrity-bearing admitted decision envelope', () => {
    const admitted = {
      decision: 'admitted',
      policyVersion: P4_ADMISSION_POLICY_VERSION,
      policyDigest: P4_ADMISSION_POLICY_DIGEST,
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
    expect(() =>
      AdmissionDecisionRecordSchema.parse({
        ...admitted,
        policyVersion: 'caller-authored',
      }),
    ).toThrow();
    expect(() =>
      AdmissionDecisionRecordSchema.parse({
        ...admitted,
        policyDigest: canonicalDigest({ policy: 'caller-authored' }),
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
      modelLineageEdges: [],
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

  it('enforces commit-before-reveal and reconstructs P5 authority after restart', async () => {
    const repository = new InMemoryResearchCellRepository();
    const plan = cellPlan();
    await repository.createCellPlan(plan);
    const position = positionRecord(plan);
    await repository.recordPosition(position);
    const reveal = {
      id: 'reveal-1',
      positionId: position.id,
      cellPlanId: plan.id,
      programId: plan.programId,
      revealDigest: canonicalDigest({ reveal: position.id }),
      revealedToPositionIds: ['position-peer'],
      auditSequence: 2,
      revealedAt: now,
    };

    await expect(repository.recordIsolationReveal(reveal)).rejects.toThrow(
      PersistenceIntegrityError,
    );

    const commit: IsolationCommitRecord = {
      id: 'commit-1',
      positionId: position.id,
      cellPlanId: plan.id,
      programId: plan.programId,
      workItemId: plan.workItemId,
      criterionId: plan.criterionId,
      criterionDigest: plan.criterionDigest,
      inputDigest: plan.inputDigest,
      outputDigest: position.positionDigest,
      positionDigest: position.positionDigest,
      isolationProtocolVersion: '1.0.0',
      auditSequence: 1,
      committedAt: now,
    };
    await repository.recordIsolationCommit(commit);
    await repository.recordIsolationReveal(reveal);

    const restarted = new InMemoryResearchCellRepository(
      await repository.reconstructProgram('program-1'),
    );
    const reconstructed = await restarted.reconstructProgram('program-1');
    expect(reconstructed.isolationCommits).toEqual([commit]);
    expect(reconstructed.isolationReveals).toEqual([reveal]);
    await expect(repository.recordIsolationCommit(commit)).rejects.toThrow(
      PersistenceConflictError,
    );
  });

  it('deduplicates stable budget effects and rejects over-settlement and release-after-settlement', async () => {
    const repository = new InMemoryResearchCellRepository();
    const plan = cellPlan();
    await repository.createCellPlan(plan);
    const attempt: CellAttemptRecord = {
      id: 'attempt-1',
      cellPlanId: plan.id,
      workItemId: plan.workItemId,
      programId: plan.programId,
      attempt: 1,
      ownerId: 'worker-1',
      fencingToken: 7,
      state: 'started',
      startedAt: now,
      updatedAt: now,
    };
    await repository.recordCellAttempt(attempt);
    const reservation: BudgetReservationRecord = {
      id: 'reservation-1',
      stableIdentity: 'budget:program-1:work-1:attempt-1',
      programId: 'program-1',
      workItemId: 'work-1',
      attemptId: attempt.id,
      ceiling: { costUsd: 2, tokens: 200, durationMs: 2_000 },
      state: 'reserved',
      revision: 0,
      createdAt: now,
      updatedAt: now,
    };
    await expect(
      repository.recordBudgetReservation(reservation),
    ).resolves.toEqual(reservation);
    await expect(
      repository.recordBudgetReservation(reservation),
    ).resolves.toEqual(reservation);
    await expect(
      repository.recordBudgetSettlement({
        id: 'settlement-over',
        stableIdentity: 'settlement:over',
        reservationId: reservation.id,
        amount: { costUsd: 3, tokens: 1, durationMs: 1 },
        payload: { settlement: 'over' },
        receiptDigest: canonicalDigest({ settlement: 'over' }),
        settledAt: now,
      }),
    ).rejects.toThrow(PersistenceIntegrityError);

    const settlement = {
      id: 'settlement-1',
      stableIdentity: 'settlement:reservation-1',
      reservationId: reservation.id,
      amount: { costUsd: 1, tokens: 150, durationMs: 1_000 },
      payload: { settlement: 'ok' },
      receiptDigest: canonicalDigest({ settlement: 'ok' }),
      settledAt: now,
    };
    await expect(
      repository.recordBudgetSettlement(settlement),
    ).resolves.toEqual(settlement);
    await expect(
      repository.recordBudgetSettlement(settlement),
    ).resolves.toEqual(settlement);
    await expect(
      repository.recordBudgetRelease({
        id: 'release-1',
        stableIdentity: 'release:reservation-1',
        reservationId: reservation.id,
        reason: 'unused',
        payload: { release: 'too-late' },
        receiptDigest: canonicalDigest({ release: 'too-late' }),
        releasedAt: now,
      }),
    ).rejects.toThrow(PersistenceConflictError);
  });

  it('records honest partial cancellation receipts without duplicating delivery', async () => {
    const repository = new InMemoryResearchCellRepository();
    const plan = cellPlan();
    await repository.createCellPlan(plan);
    const partial = { draft: 'partial answer retained' };
    const attempt: CellAttemptRecord = {
      id: 'attempt-cancel',
      cellPlanId: plan.id,
      workItemId: plan.workItemId,
      programId: plan.programId,
      attempt: 1,
      ownerId: 'worker-1',
      fencingToken: 4,
      state: 'started',
      partialResult: partial,
      partialResultDigest: canonicalDigest(partial),
      startedAt: now,
      updatedAt: now,
    };
    await repository.recordCellAttempt(attempt);
    const reservation: BudgetReservationRecord = {
      id: 'reservation-cancel',
      stableIdentity: 'budget:cancel',
      programId: 'program-1',
      workItemId: 'work-1',
      attemptId: attempt.id,
      ceiling: { costUsd: 5, tokens: 500, durationMs: 5_000 },
      state: 'reserved',
      revision: 0,
      createdAt: now,
      updatedAt: now,
    };
    await repository.recordBudgetReservation(reservation);
    const receiptPayload = { cancelled: true, phase: 'during_generation' };
    const cancellation: CancellationReceiptRecord = {
      id: 'cancel-1',
      stableIdentity: 'cancel:program-1:work-1:attempt-cancel',
      reservationId: reservation.id,
      attemptId: attempt.id,
      programId: 'program-1',
      workItemId: 'work-1',
      cancellationPhase: 'during_generation',
      consumed: { costUsd: 1, tokens: 100, durationMs: 1_000 },
      released: { costUsd: 4, tokens: 400, durationMs: 4_000 },
      partialResult: partial,
      partialResultDigest: canonicalDigest(partial),
      payload: receiptPayload,
      receiptDigest: canonicalDigest(receiptPayload),
      cancelledAt: now,
    };
    await expect(
      repository.recordCancellationReceipt(cancellation),
    ).resolves.toEqual(cancellation);
    await expect(
      repository.recordCancellationReceipt(cancellation),
    ).resolves.toEqual(cancellation);
    const reconstructed = await repository.reconstructProgram('program-1');
    expect(reconstructed.cancellationReceipts).toEqual([cancellation]);
    expect(reconstructed.budgetReservations?.[0]?.state).toBe('cancelled');
  });
});

function cellPlan(): CellPlanRecord {
  const input: CellInput = {
    schemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
    claimIds: [],
    evidenceIds: [],
    hypothesisIds: [],
    artifactIds: [],
  };
  const inputDigest = cellInputDigest(input);
  const criterionDigest = canonicalDigest({ criterion: 'one' });
  return {
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
        criterionDigest,
        branchId: 'main',
      },
      branchId: 'main',
      input,
      inputDigest,
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
    criterionDigest,
    planVersion: 'cell-plan@1',
    templateVersion: '1',
    branchId: 'main',
    role: 'lateralist',
    inputDigest,
    outputContractVersion: RESEARCH_CELL_CONTRACT_VERSION,
    status: 'planned',
    revision: 0,
    fencingToken: 0,
    createdAt: now,
    updatedAt: now,
  };
}

function positionRecord(plan: CellPlanRecord): ResearchPositionRecord {
  const contract = {
    id: 'position-1',
    schemaVersion: RESEARCH_CELL_CONTRACT_VERSION as '1.0.0',
    programId: plan.programId,
    cellPlanId: plan.id,
    workItemId: plan.workItemId,
    authorAgentId: 'author-1',
    role: plan.role,
    criterionRef: plan.contract.criterionRef,
    modelProfileVersionId: 'model-version-1',
    inputDigest: plan.inputDigest,
    outputSchemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
    answer: 'A committed isolated position.',
    claimIds: [],
    evidenceIds: [],
    hypothesisIds: [],
    artifactIds: [],
    proposalRefs: [],
    assumptions: ['assumption retained'],
    dissent: [],
    proposedFalsifiers: ['falsifier retained'],
    usage: { inputTokens: 10, outputTokens: 20, costUsd: 0.01, latencyMs: 300 },
    uncertaintyCodes: ['uncertain'],
    failureCodes: [],
    receiptRefs: [],
    canonicalDigest: canonicalDigest({ placeholder: true }),
    createdAt: now,
  };
  const canonical = {
    ...contract,
    canonicalDigest: researchPositionDigest(contract),
  };
  return {
    contract: canonical,
    admission: {
      decision: 'admitted',
      policyVersion: P4_ADMISSION_POLICY_VERSION,
      policyDigest: P4_ADMISSION_POLICY_DIGEST,
      subjectDigest: canonical.canonicalDigest,
      reasonCodes: ['admitted'],
      decidedAt: now,
    },
    id: canonical.id,
    cellPlanId: canonical.cellPlanId,
    programId: canonical.programId,
    workItemId: canonical.workItemId,
    criterionId: canonical.criterionRef.criterionId,
    criterionDigest: canonical.criterionRef.criterionDigest,
    modelProfileId: 'model-profile-1',
    modelProfileVersionId: canonical.modelProfileVersionId,
    inputDigest: canonical.inputDigest,
    outputSchemaVersion: canonical.outputSchemaVersion,
    positionDigest: canonical.canonicalDigest,
    claimIds: canonical.claimIds,
    evidenceIds: canonical.evidenceIds,
    hypothesisIds: canonical.hypothesisIds,
    proposalRefs: canonical.proposalRefs,
    usage: canonical.usage,
    uncertaintyCodes: canonical.uncertaintyCodes,
    failureCodes: canonical.failureCodes,
    body: canonical,
    recordedAt: now,
  };
}
