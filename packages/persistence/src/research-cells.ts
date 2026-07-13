import {
  CellPlanSchema,
  CorrelationAssessmentSchema,
  DigestSchema,
  DissentReportSchema,
  ModelProfileSchema,
  ModelProfileVersionSchema,
  ModelUsageSchema,
  ProposalReferenceSchema,
  ResearchPositionSchema,
  ReviewAssignmentSchema,
  ResearchReviewSchema,
  canonicalDigest,
  type Digest,
} from '@mammoth/domain';
import { z } from 'zod';

export type { Digest } from '@mammoth/domain';

export type CellPlanStatus =
  | 'planned'
  | 'leased'
  | 'completed'
  | 'failed'
  | 'cancelled';

export const P4_ADMISSION_POLICY_VERSION = '1.0.0';
export const P4_ADMISSION_POLICY_DIGEST = canonicalDigest({
  policy: 'research-cell-admission',
  version: P4_ADMISSION_POLICY_VERSION,
});
export const P5_BUDGET_CANCELLATION_CONTRACT_VERSION = '1.0.0';

const BudgetAmountSchema = z
  .object({
    costUsd: z.number().finite().nonnegative(),
    tokens: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative(),
  })
  .strict();

const OperationalMetadataSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const AdmissionDecisionRecordSchema = z
  .object({
    decision: z.literal('admitted'),
    policyVersion: z.literal(P4_ADMISSION_POLICY_VERSION),
    policyDigest: z.literal(P4_ADMISSION_POLICY_DIGEST),
    subjectDigest: DigestSchema,
    reasonCodes: z.array(z.string().min(1)).min(1),
    decidedAt: z.string().datetime(),
  })
  .strict();

export const ModelLineageEdgeRecordSchema = z
  .object({
    childVersionId: z.string().min(1),
    parentVersionId: z.string().min(1),
    edgeKind: z.enum(['parent', 'alias']),
    createdAt: z.string().datetime(),
  })
  .strict()
  .superRefine((edge, context) => {
    if (edge.childVersionId === edge.parentVersionId)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['parentVersionId'],
        message: 'model lineage edge cannot reference itself',
      });
  });

/** Persistence records wrap, and never redefine, authoritative domain data. */
export const ModelProfileRecordSchema = OperationalMetadataSchema.extend({
  contract: ModelProfileSchema,
  id: z.string().min(1),
  provider: z.string().min(1),
  canonicalName: z.string().min(1),
  familyId: z.string().min(1),
  active: z.boolean(),
  aliases: z.array(z.string().min(1)),
})
  .strict()
  .superRefine((record, context) => {
    if (
      record.id !== record.contract.id ||
      record.provider !== record.contract.provider ||
      record.canonicalName !== record.contract.displayName ||
      record.familyId !== record.contract.family
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['contract'],
        message: 'model profile record metadata drifts from domain contract',
      });
  });

export const ModelProfileVersionRecordSchema = z
  .object({
    contract: ModelProfileVersionSchema,
    id: z.string().min(1),
    profileId: z.string().min(1),
    profileRevision: z.number().int().positive(),
    provider: z.string().min(1),
    modelName: z.string().min(1),
    checkpoint: z.string().min(1),
    familyId: z.string().min(1),
    lineageStatus: z.enum(['known', 'unknown']),
    trainingLineageIds: z.array(z.string().min(1)),
    fineTuneLineageIds: z.array(z.string().min(1)),
    sharedDerivationIds: z.array(z.string().min(1)),
    locality: z.enum(['local', 'cloud']),
    modalities: z.array(z.string().min(1)),
    contextWindow: z.number().int().positive(),
    dataPolicyId: z.string().min(1),
    costProfileId: z.string().min(1),
    declaredAt: z.string().datetime(),
    metadata: z.unknown(),
  })
  .strict()
  .superRefine((record, context) => {
    const contract = record.contract;
    if (
      record.id !== contract.id ||
      record.profileId !== contract.profileId ||
      record.provider !== contract.provider ||
      record.modelName !== contract.providerModelId ||
      record.checkpoint !== contract.checkpoint ||
      record.familyId !== contract.family ||
      record.lineageStatus !== contract.lineage.kind ||
      !sameValues(
        record.trainingLineageIds,
        contract.lineage.trainingLineageIds,
      ) ||
      !sameValues(
        record.fineTuneLineageIds,
        contract.lineage.fineTuneLineageIds,
      ) ||
      !sameValues(
        record.sharedDerivationIds,
        contract.lineage.sharedDerivationIds,
      ) ||
      record.locality !== contract.locality ||
      !sameValues(record.modalities, contract.modalities) ||
      record.contextWindow !== contract.contextWindow ||
      record.dataPolicyId !== contract.dataPolicyId ||
      record.costProfileId !== contract.costProfileId ||
      record.declaredAt !== contract.recordedAt
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['contract'],
        message: 'model version record metadata drifts from domain contract',
      });
  });

export const CellPlanRecordSchema = OperationalMetadataSchema.extend({
  contract: CellPlanSchema,
  id: z.string().min(1),
  programId: z.string().min(1),
  workItemId: z.string().min(1),
  criterionId: z.string().min(1),
  criterionDigest: DigestSchema,
  planVersion: z.string().min(1),
  templateVersion: z.string().min(1),
  branchId: z.string().min(1),
  role: z.string().min(1),
  inputDigest: DigestSchema,
  outputContractVersion: z.string().min(1),
  status: z.enum(['planned', 'leased', 'completed', 'failed', 'cancelled']),
  fencingToken: z.number().int().nonnegative(),
})
  .strict()
  .superRefine((record, context) => {
    const contract = record.contract;
    if (
      record.id !== contract.id ||
      record.programId !== contract.programId ||
      record.workItemId !== contract.workItemId ||
      record.criterionId !== contract.criterionRef.criterionId ||
      record.criterionDigest !== contract.criterionRef.criterionDigest ||
      record.branchId !== contract.branchId ||
      record.inputDigest !== contract.inputDigest ||
      record.templateVersion !== String(contract.templateVersion) ||
      record.outputContractVersion !== contract.outputContract.schemaVersion
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['contract'],
        message: 'cell plan record metadata drifts from domain contract',
      });
  });

export const ResearchPositionRecordSchema = z
  .object({
    contract: ResearchPositionSchema,
    admission: AdmissionDecisionRecordSchema,
    id: z.string().min(1),
    cellPlanId: z.string().min(1),
    programId: z.string().min(1),
    workItemId: z.string().min(1),
    criterionId: z.string().min(1),
    criterionDigest: DigestSchema,
    modelProfileId: z.string().min(1),
    modelProfileVersionId: z.string().min(1),
    inputDigest: DigestSchema,
    outputSchemaVersion: z.string().min(1),
    positionDigest: DigestSchema,
    claimIds: z.array(z.string().min(1)),
    evidenceIds: z.array(z.string().min(1)),
    hypothesisIds: z.array(z.string().min(1)),
    proposalRefs: z.array(ProposalReferenceSchema),
    usage: ModelUsageSchema,
    uncertaintyCodes: z.array(z.string().min(1)),
    failureCodes: z.array(z.string().min(1)),
    body: z.unknown(),
    recordedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((record, context) => {
    if (
      record.id !== record.contract.id ||
      record.admission.subjectDigest !== record.contract.canonicalDigest ||
      record.cellPlanId !== record.contract.cellPlanId ||
      record.programId !== record.contract.programId ||
      record.workItemId !== record.contract.workItemId ||
      record.positionDigest !== record.contract.canonicalDigest ||
      record.modelProfileVersionId !== record.contract.modelProfileVersionId ||
      record.inputDigest !== record.contract.inputDigest ||
      record.outputSchemaVersion !== record.contract.outputSchemaVersion ||
      record.criterionId !== record.contract.criterionRef.criterionId ||
      record.criterionDigest !== record.contract.criterionRef.criterionDigest ||
      !sameValues(record.claimIds, record.contract.claimIds) ||
      !sameValues(record.evidenceIds, record.contract.evidenceIds) ||
      !sameValues(record.hypothesisIds, record.contract.hypothesisIds) ||
      !sameJson(record.proposalRefs, record.contract.proposalRefs) ||
      !sameJson(record.usage, record.contract.usage) ||
      !sameValues(record.uncertaintyCodes, record.contract.uncertaintyCodes) ||
      !sameValues(record.failureCodes, record.contract.failureCodes) ||
      !sameJson(record.body, record.contract) ||
      record.recordedAt !== record.contract.createdAt
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['contract'],
        message: 'position record metadata drifts from domain contract',
      });
  });
export const ReviewAssignmentRecordSchema = z
  .object({
    contract: ReviewAssignmentSchema,
    id: z.string().min(1),
    programId: z.string().min(1),
    workItemId: z.string().min(1),
    targetPositionId: z.string().min(1),
    reviewerAgentId: z.string().min(1),
    reviewerModelProfileVersionId: z.string().min(1),
    reviewerRole: z.string().min(1),
    targetAuthorAgentId: z.string().min(1),
    targetModelProfileVersionId: z.string().min(1),
    targetRole: z.string().min(1),
    criterionId: z.string().min(1),
    criterionDigest: DigestSchema,
    blind: z.boolean(),
    assignmentDigest: DigestSchema,
    recordedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((record, context) => {
    const contract = record.contract;
    if (
      record.id !== contract.id ||
      record.programId !== contract.programId ||
      record.workItemId !== contract.workItemId ||
      record.targetPositionId !== contract.targetPositionId ||
      record.reviewerAgentId !== contract.reviewerAgentId ||
      record.reviewerModelProfileVersionId !==
        contract.reviewerModelProfileVersionId ||
      record.reviewerRole !== contract.reviewerRole ||
      record.targetAuthorAgentId !== contract.targetAuthorAgentId ||
      record.targetModelProfileVersionId !==
        contract.targetModelProfileVersionId ||
      record.targetRole !== contract.targetRole ||
      record.criterionId !== contract.criterionRef.criterionId ||
      record.criterionDigest !== contract.criterionRef.criterionDigest ||
      record.blind !== contract.blind ||
      record.assignmentDigest !== canonicalDigest(contract) ||
      record.recordedAt !== contract.assignedAt
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['contract'],
        message: 'review assignment metadata drifts from domain contract',
      });
  });
export const ResearchReviewRecordSchema = z
  .object({
    contract: ResearchReviewSchema,
    admission: AdmissionDecisionRecordSchema,
    id: z.string().min(1),
    assignmentId: z.string().min(1),
    positionId: z.string().min(1),
    cellPlanId: z.string().min(1),
    programId: z.string().min(1),
    workItemId: z.string().min(1),
    criterionId: z.string().min(1),
    criterionDigest: DigestSchema,
    modelProfileId: z.string().min(1),
    modelProfileVersionId: z.string().min(1),
    reviewerRole: z.string().min(1),
    inputDigest: DigestSchema,
    outputSchemaVersion: z.string().min(1),
    reviewDigest: DigestSchema,
    verdict: z.enum(['admit', 'reject', 'revise', 'unresolved']),
    claimIds: z.array(z.string().min(1)),
    evidenceIds: z.array(z.string().min(1)),
    hypothesisIds: z.array(z.string().min(1)),
    usage: ModelUsageSchema,
    uncertaintyCodes: z.array(z.string().min(1)),
    failureCodes: z.array(z.string().min(1)),
    reasons: z.array(z.string().min(1)),
    body: z.unknown(),
    recordedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((record, context) => {
    if (
      record.id !== record.contract.id ||
      record.admission.subjectDigest !== record.contract.canonicalDigest ||
      record.assignmentId !== record.contract.assignmentId ||
      record.positionId !== record.contract.targetPositionId ||
      record.programId !== record.contract.programId ||
      record.workItemId !== record.contract.workItemId ||
      record.reviewDigest !== record.contract.canonicalDigest ||
      record.modelProfileVersionId !==
        record.contract.reviewerModelProfileVersionId ||
      record.criterionId !== record.contract.criterionRef.criterionId ||
      record.criterionDigest !== record.contract.criterionRef.criterionDigest ||
      record.inputDigest !== record.contract.inputDigest ||
      record.outputSchemaVersion !== record.contract.outputSchemaVersion ||
      record.verdict !== record.contract.verdict ||
      !sameValues(record.claimIds, record.contract.checkedClaimIds) ||
      !sameValues(record.evidenceIds, record.contract.checkedEvidenceIds) ||
      !sameValues(record.hypothesisIds, record.contract.checkedHypothesisIds) ||
      !sameJson(record.usage, record.contract.usage) ||
      !sameValues(record.uncertaintyCodes, record.contract.uncertaintyCodes) ||
      !sameValues(record.failureCodes, record.contract.failureCodes) ||
      !sameValues(record.reasons, record.contract.reasonCodes) ||
      !sameJson(record.body, record.contract) ||
      record.recordedAt !== record.contract.createdAt
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['contract'],
        message: 'review record metadata drifts from domain contract',
      });
  });
export const DissentReportRecordSchema = z
  .object({
    contract: DissentReportSchema,
    id: z.string().min(1),
    cellPlanId: z.string().min(1),
    programId: z.string().min(1),
    criterionId: z.string().min(1),
    criterionDigest: DigestSchema,
    authorModelProfileVersionId: z.string().min(1),
    reportDigest: DigestSchema,
    claimIds: z.array(z.string().min(1)),
    evidenceIds: z.array(z.string().min(1)),
    minorityPositionIds: z.array(z.string().min(1)),
    body: z.unknown(),
    recordedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((record, context) => {
    if (
      record.id !== record.contract.id ||
      record.cellPlanId !== record.contract.cellPlanId ||
      record.programId !== record.contract.programId ||
      record.reportDigest !== record.contract.canonicalDigest ||
      record.criterionId !== record.contract.criterionRef.criterionId ||
      record.criterionDigest !== record.contract.criterionRef.criterionDigest ||
      !sameValues(record.claimIds, record.contract.claimIds) ||
      !sameValues(record.evidenceIds, record.contract.evidenceIds) ||
      !sameValues(record.minorityPositionIds, record.contract.positionIds) ||
      !sameJson(record.body, record.contract) ||
      record.recordedAt !== record.contract.createdAt
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['contract'],
        message: 'dissent record metadata drifts from domain contract',
      });
  });
export const CorrelationAssessmentRecordSchema = z
  .object({
    contract: CorrelationAssessmentSchema,
    id: z.string().min(1),
    leftModelProfileVersionId: z.string().min(1),
    rightModelProfileVersionId: z.string().min(1),
    policyVersion: z.string().min(1),
    correlationScore: z.number().min(0).max(1),
    independenceVerdict: z.enum(['independent', 'correlated', 'unknown']),
    reasons: z.array(z.string().min(1)),
    assessmentDigest: DigestSchema,
    assessedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((record, context) => {
    if (
      record.id !== record.contract.id ||
      record.leftModelProfileVersionId !==
        record.contract.subjectModelProfileVersionId ||
      record.rightModelProfileVersionId !==
        record.contract.candidateModelProfileVersionId ||
      record.policyVersion !== record.contract.policyVersion ||
      record.correlationScore !== record.contract.correlationScore ||
      record.independenceVerdict !==
        (record.contract.independent ? 'independent' : 'correlated') ||
      !sameValues(record.reasons, record.contract.reasonCodes) ||
      record.assessmentDigest !== record.contract.canonicalDigest ||
      record.assessedAt !== record.contract.assessedAt
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['contract'],
        message: 'correlation record metadata drifts from domain contract',
      });
  });

export const RejectedAuditResidueRecordSchema = z
  .object({
    id: z.string().min(1),
    decision: z.literal('rejected'),
    programId: z.string().min(1),
    subjectType: z.enum([
      'model-profile-version',
      'cell-plan',
      'position',
      'review',
      'dissent',
      'correlation',
      'receipt',
    ]),
    subjectId: z.string().min(1),
    reasonCode: z.string().min(1),
    policyVersion: z.string().min(1),
    policyDigest: DigestSchema,
    reasonCodes: z.array(z.string().min(1)).min(1),
    payloadDigest: DigestSchema,
    payload: z.unknown(),
    recordedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((record, context) => {
    if (!record.reasonCodes.includes(record.reasonCode))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reasonCodes'],
        message: 'rejected decision must retain its primary reason code',
      });
  });

export const CellReceiptRecordSchema = z
  .object({
    id: z.string().min(1),
    programId: z.string().min(1),
    subjectType: z.string().min(1),
    subjectId: z.string().min(1),
    workItemId: z.string().min(1),
    receiptKind: z.string().min(1),
    receiptDigest: DigestSchema,
    payload: z.unknown(),
    createdAt: z.string().datetime(),
  })
  .strict();

export const IsolationCommitRecordSchema = z
  .object({
    id: z.string().min(1),
    positionId: z.string().min(1),
    cellPlanId: z.string().min(1),
    programId: z.string().min(1),
    workItemId: z.string().min(1),
    criterionId: z.string().min(1),
    criterionDigest: DigestSchema,
    inputDigest: DigestSchema,
    outputDigest: DigestSchema,
    positionDigest: DigestSchema,
    isolationProtocolVersion: z.literal('1.0.0'),
    auditSequence: z.number().int().nonnegative(),
    committedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((record, context) => {
    if (record.positionDigest !== record.outputDigest)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['outputDigest'],
        message: 'isolation commit output digest must bind the position digest',
      });
  });

export const IsolationRevealRecordSchema = z
  .object({
    id: z.string().min(1),
    positionId: z.string().min(1),
    cellPlanId: z.string().min(1),
    programId: z.string().min(1),
    revealDigest: DigestSchema,
    revealedToPositionIds: z.array(z.string().min(1)),
    auditSequence: z.number().int().nonnegative(),
    revealedAt: z.string().datetime(),
  })
  .strict();

export const SanitizedReviewContextRecordSchema = z
  .object({
    id: z.string().min(1),
    assignmentId: z.string().min(1),
    targetPositionId: z.string().min(1),
    programId: z.string().min(1),
    contractVersion: z.literal('1.0.0'),
    contextDigest: DigestSchema,
    payload: z.unknown(),
    createdAt: z.string().datetime(),
  })
  .strict()
  .superRefine((record, context) => {
    if (canonicalDigest(record.payload) !== record.contextDigest)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['contextDigest'],
        message: 'sanitized review context digest mismatch',
      });
  });

export const CellAttemptRecordSchema = z
  .object({
    id: z.string().min(1),
    cellPlanId: z.string().min(1),
    workItemId: z.string().min(1),
    programId: z.string().min(1),
    attempt: z.number().int().positive(),
    ownerId: z.string().min(1),
    fencingToken: z.number().int().positive(),
    state: z.enum([
      'started',
      'committed',
      'revealed',
      'settling',
      'completed',
      'failed',
      'cancelled',
    ]),
    partialResultDigest: DigestSchema.optional(),
    partialResult: z.unknown().optional(),
    startedAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((record, context) => {
    if (
      record.partialResultDigest &&
      canonicalDigest(record.partialResult) !== record.partialResultDigest
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['partialResultDigest'],
        message: 'partial result digest mismatch',
      });
  });

export const BudgetReservationRecordSchema = z
  .object({
    id: z.string().min(1),
    stableIdentity: z.string().min(1),
    programId: z.string().min(1),
    workItemId: z.string().min(1),
    attemptId: z.string().min(1),
    ceiling: BudgetAmountSchema,
    state: z.enum(['reserved', 'settled', 'released', 'cancelled']),
    revision: z.number().int().nonnegative(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type BudgetReservationRecord = z.infer<
  typeof BudgetReservationRecordSchema
>;

export const BudgetSettlementRecordSchema = z
  .object({
    id: z.string().min(1),
    stableIdentity: z.string().min(1),
    reservationId: z.string().min(1),
    amount: BudgetAmountSchema,
    receiptDigest: DigestSchema,
    payload: z.unknown(),
    settledAt: z.string().datetime(),
  })
  .strict()
  .superRefine((record, context) => {
    if (canonicalDigest(record.payload) !== record.receiptDigest)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['receiptDigest'],
        message: 'settlement receipt digest mismatch',
      });
  });
export type BudgetSettlementRecord = z.infer<
  typeof BudgetSettlementRecordSchema
>;

export const BudgetReleaseRecordSchema = z
  .object({
    id: z.string().min(1),
    stableIdentity: z.string().min(1),
    reservationId: z.string().min(1),
    reason: z.string().min(1),
    receiptDigest: DigestSchema,
    payload: z.unknown(),
    releasedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((record, context) => {
    if (canonicalDigest(record.payload) !== record.receiptDigest)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['receiptDigest'],
        message: 'release receipt digest mismatch',
      });
  });
export type BudgetReleaseRecord = z.infer<typeof BudgetReleaseRecordSchema>;

export const ProviderChargeRecordSchema = z
  .object({
    id: z.string().min(1),
    stableIdentity: z.string().min(1),
    reservationId: z.string().min(1),
    provider: z.string().min(1),
    providerReceiptId: z.string().min(1),
    amount: BudgetAmountSchema,
    receiptDigest: DigestSchema,
    payload: z.unknown(),
    chargedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((record, context) => {
    if (canonicalDigest(record.payload) !== record.receiptDigest)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['receiptDigest'],
        message: 'provider charge receipt digest mismatch',
      });
  });
export type ProviderChargeRecord = z.infer<typeof ProviderChargeRecordSchema>;

export const CancellationReceiptRecordSchema = z
  .object({
    id: z.string().min(1),
    stableIdentity: z.string().min(1),
    reservationId: z.string().min(1).optional(),
    attemptId: z.string().min(1),
    programId: z.string().min(1),
    workItemId: z.string().min(1),
    cancellationPhase: z.enum([
      'before_dispatch',
      'during_generation',
      'after_commit_before_reveal',
      'during_review',
      'during_settlement',
    ]),
    consumed: BudgetAmountSchema,
    released: BudgetAmountSchema,
    partialResultDigest: DigestSchema.optional(),
    partialResult: z.unknown().optional(),
    receiptDigest: DigestSchema,
    payload: z.unknown(),
    cancelledAt: z.string().datetime(),
  })
  .strict()
  .superRefine((record, context) => {
    if (canonicalDigest(record.payload) !== record.receiptDigest)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['receiptDigest'],
        message: 'cancellation receipt digest mismatch',
      });
    if (
      record.partialResultDigest &&
      canonicalDigest(record.partialResult) !== record.partialResultDigest
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['partialResultDigest'],
        message: 'cancellation partial result digest mismatch',
      });
  });
export type CancellationReceiptRecord = z.infer<
  typeof CancellationReceiptRecordSchema
>;

export type ModelProfileRecord = z.infer<typeof ModelProfileRecordSchema>;
export type ModelProfileVersionRecord = z.infer<
  typeof ModelProfileVersionRecordSchema
>;
export type ModelLineageEdgeRecord = z.infer<
  typeof ModelLineageEdgeRecordSchema
>;
export type CellPlanRecord = z.infer<typeof CellPlanRecordSchema>;
export type ResearchPositionRecord = z.infer<
  typeof ResearchPositionRecordSchema
>;
export type ResearchReviewRecord = z.infer<typeof ResearchReviewRecordSchema>;
export type ReviewAssignmentRecord = z.infer<
  typeof ReviewAssignmentRecordSchema
>;
export type DissentReportRecord = z.infer<typeof DissentReportRecordSchema>;
export type CorrelationAssessmentRecord = z.infer<
  typeof CorrelationAssessmentRecordSchema
>;
export type RejectedAuditResidueRecord = z.infer<
  typeof RejectedAuditResidueRecordSchema
>;
export type CellReceiptRecord = z.infer<typeof CellReceiptRecordSchema>;
export type IsolationCommitRecord = z.infer<typeof IsolationCommitRecordSchema>;
export type IsolationRevealRecord = z.infer<typeof IsolationRevealRecordSchema>;
export type SanitizedReviewContextRecord = z.infer<
  typeof SanitizedReviewContextRecordSchema
>;
export type CellAttemptRecord = z.infer<typeof CellAttemptRecordSchema>;

export type AdmissionPersistenceResult<T> =
  | { readonly decision: 'admitted'; readonly record: T }
  | {
      readonly decision: 'rejected';
      readonly residue: RejectedAuditResidueRecord;
    };

export interface ModelProfileWrite {
  readonly id: string;
  readonly provider: string;
  readonly canonicalName: string;
  readonly familyId: string;
  readonly contract: z.infer<typeof ModelProfileSchema>;
  readonly active: boolean;
  readonly aliases: readonly string[];
  /** Omit only when creating a profile; updates require the observed revision. */
  readonly expectedRevision?: number;
}

export interface CellPlanStatusUpdate {
  readonly id: string;
  readonly expectedRevision: number;
  readonly expectedFencingToken: number;
  readonly nextStatus: CellPlanStatus;
  readonly terminalReason?: string;
}

export interface ReconstructedResearchCellState {
  readonly programId: string;
  readonly modelProfiles: readonly ModelProfileRecord[];
  readonly modelProfileVersions: readonly ModelProfileVersionRecord[];
  readonly modelLineageEdges: readonly ModelLineageEdgeRecord[];
  readonly cellPlans: readonly CellPlanRecord[];
  readonly positions: readonly ResearchPositionRecord[];
  readonly reviewAssignments: readonly ReviewAssignmentRecord[];
  readonly reviews: readonly ResearchReviewRecord[];
  readonly dissentReports: readonly DissentReportRecord[];
  readonly correlationAssessments: readonly CorrelationAssessmentRecord[];
  readonly rejectedResidue: readonly RejectedAuditResidueRecord[];
  readonly receipts: readonly CellReceiptRecord[];
  readonly isolationCommits?: readonly IsolationCommitRecord[];
  readonly isolationReveals?: readonly IsolationRevealRecord[];
  readonly sanitizedReviewContexts?: readonly SanitizedReviewContextRecord[];
  readonly cellAttempts?: readonly CellAttemptRecord[];
  readonly budgetReservations?: readonly BudgetReservationRecord[];
  readonly budgetSettlements?: readonly BudgetSettlementRecord[];
  readonly budgetReleases?: readonly BudgetReleaseRecord[];
  readonly providerCharges?: readonly ProviderChargeRecord[];
  readonly cancellationReceipts?: readonly CancellationReceiptRecord[];
}

export interface ModelLineageRepository {
  upsertModelProfile(input: ModelProfileWrite): Promise<ModelProfileRecord>;
  appendModelProfileVersion(
    input: ModelProfileVersionRecord,
  ): Promise<ModelProfileVersionRecord>;
  readModelProfile(id: string): Promise<ModelProfileRecord | undefined>;
  readModelProfileVersion(
    id: string,
  ): Promise<ModelProfileVersionRecord | undefined>;
  listModelProfileVersions(
    profileId: string,
  ): Promise<readonly ModelProfileVersionRecord[]>;
  listModelLineageEdges(
    versionId: string,
  ): Promise<readonly ModelLineageEdgeRecord[]>;
}

export interface ResearchCellRepository {
  createCellPlan(input: CellPlanRecord): Promise<CellPlanRecord>;
  updateCellPlanStatus(input: CellPlanStatusUpdate): Promise<CellPlanRecord>;
  recordPosition(
    input: ResearchPositionRecord,
  ): Promise<AdmissionPersistenceResult<ResearchPositionRecord>>;
  recordReviewAssignment(
    input: ReviewAssignmentRecord,
  ): Promise<ReviewAssignmentRecord>;
  recordReview(
    input: ResearchReviewRecord,
  ): Promise<AdmissionPersistenceResult<ResearchReviewRecord>>;
  recordDissent(input: DissentReportRecord): Promise<DissentReportRecord>;
  recordCorrelation(
    input: CorrelationAssessmentRecord,
  ): Promise<CorrelationAssessmentRecord>;
  recordRejectedResidue(
    input: RejectedAuditResidueRecord,
  ): Promise<RejectedAuditResidueRecord>;
  recordReceipt(input: CellReceiptRecord): Promise<CellReceiptRecord>;
  reconstructProgram(
    programId: string,
  ): Promise<ReconstructedResearchCellState>;
}

export interface P5ResearchCellRepository extends ResearchCellRepository {
  recordIsolationCommit(
    input: IsolationCommitRecord,
  ): Promise<IsolationCommitRecord>;
  recordIsolationReveal(
    input: IsolationRevealRecord,
  ): Promise<IsolationRevealRecord>;
  recordSanitizedReviewContext(
    input: SanitizedReviewContextRecord,
  ): Promise<SanitizedReviewContextRecord>;
  recordCellAttempt(input: CellAttemptRecord): Promise<CellAttemptRecord>;
  recordBudgetReservation(
    input: BudgetReservationRecord,
  ): Promise<BudgetReservationRecord>;
  recordBudgetSettlement(
    input: BudgetSettlementRecord,
  ): Promise<BudgetSettlementRecord>;
  recordBudgetRelease(input: BudgetReleaseRecord): Promise<BudgetReleaseRecord>;
  recordProviderCharge(
    input: ProviderChargeRecord,
  ): Promise<ProviderChargeRecord>;
  recordCancellationReceipt(
    input: CancellationReceiptRecord,
  ): Promise<CancellationReceiptRecord>;
}

export class PersistenceConflictError extends Error {
  readonly code = 'persistence_conflict';
  readonly retryable = true;
  constructor(message: string) {
    super(message);
    this.name = 'PersistenceConflictError';
  }
}

export class PersistenceIntegrityError extends Error {
  readonly code = 'persistence_integrity';
  readonly retryable = false;
  constructor(message: string) {
    super(message);
    this.name = 'PersistenceIntegrityError';
  }
}

export function assertPayloadDigest(
  payload: unknown,
  expectedDigest: Digest,
  subject: string,
): void {
  const actual = canonicalDigest(payload);
  if (actual !== expectedDigest) {
    throw new PersistenceIntegrityError(
      `${subject} digest mismatch: expected ${expectedDigest}, computed ${actual}`,
    );
  }
}

export function parseResearchCellState(
  input: ReconstructedResearchCellState,
): ReconstructedResearchCellState {
  return {
    programId: input.programId,
    modelProfiles: input.modelProfiles.map((row) =>
      ModelProfileRecordSchema.parse(row),
    ),
    modelProfileVersions: input.modelProfileVersions.map((row) =>
      ModelProfileVersionRecordSchema.parse(row),
    ),
    modelLineageEdges: input.modelLineageEdges.map((row) =>
      ModelLineageEdgeRecordSchema.parse(row),
    ),
    cellPlans: input.cellPlans.map((row) => CellPlanRecordSchema.parse(row)),
    positions: input.positions.map((row) =>
      ResearchPositionRecordSchema.parse(row),
    ),
    reviewAssignments: input.reviewAssignments.map((row) =>
      ReviewAssignmentRecordSchema.parse(row),
    ),
    reviews: input.reviews.map((row) => ResearchReviewRecordSchema.parse(row)),
    dissentReports: input.dissentReports.map((row) =>
      DissentReportRecordSchema.parse(row),
    ),
    correlationAssessments: input.correlationAssessments.map((row) =>
      CorrelationAssessmentRecordSchema.parse(row),
    ),
    rejectedResidue: input.rejectedResidue.map((row) =>
      RejectedAuditResidueRecordSchema.parse(row),
    ),
    receipts: input.receipts.map((row) => CellReceiptRecordSchema.parse(row)),
    isolationCommits: (input.isolationCommits ?? []).map((row) =>
      IsolationCommitRecordSchema.parse(row),
    ),
    isolationReveals: (input.isolationReveals ?? []).map((row) =>
      IsolationRevealRecordSchema.parse(row),
    ),
    sanitizedReviewContexts: (input.sanitizedReviewContexts ?? []).map((row) =>
      SanitizedReviewContextRecordSchema.parse(row),
    ),
    cellAttempts: (input.cellAttempts ?? []).map((row) =>
      CellAttemptRecordSchema.parse(row),
    ),
    budgetReservations: (input.budgetReservations ?? []).map((row) =>
      BudgetReservationRecordSchema.parse(row),
    ),
    budgetSettlements: (input.budgetSettlements ?? []).map((row) =>
      BudgetSettlementRecordSchema.parse(row),
    ),
    budgetReleases: (input.budgetReleases ?? []).map((row) =>
      BudgetReleaseRecordSchema.parse(row),
    ),
    providerCharges: (input.providerCharges ?? []).map((row) =>
      ProviderChargeRecordSchema.parse(row),
    ),
    cancellationReceipts: (input.cancellationReceipts ?? []).map((row) =>
      CancellationReceiptRecordSchema.parse(row),
    ),
  };
}

export class InMemoryResearchCellRepository
  implements P5ResearchCellRepository
{
  readonly #cellPlans = new Map<string, CellPlanRecord>();
  readonly #positions = new Map<string, ResearchPositionRecord>();
  readonly #reviewAssignments = new Map<string, ReviewAssignmentRecord>();
  readonly #reviews = new Map<string, ResearchReviewRecord>();
  readonly #dissent = new Map<string, DissentReportRecord>();
  readonly #correlations = new Map<string, CorrelationAssessmentRecord>();
  readonly #residue = new Map<string, RejectedAuditResidueRecord>();
  readonly #receipts = new Map<string, CellReceiptRecord>();
  readonly #commits = new Map<string, IsolationCommitRecord>();
  readonly #reveals = new Map<string, IsolationRevealRecord>();
  readonly #contexts = new Map<string, SanitizedReviewContextRecord>();
  readonly #attempts = new Map<string, CellAttemptRecord>();
  readonly #reservations = new Map<string, BudgetReservationRecord>();
  readonly #settlements = new Map<string, BudgetSettlementRecord>();
  readonly #releases = new Map<string, BudgetReleaseRecord>();
  readonly #charges = new Map<string, ProviderChargeRecord>();
  readonly #cancellations = new Map<string, CancellationReceiptRecord>();

  constructor(input?: ReconstructedResearchCellState) {
    if (!input) return;
    const parsed = parseResearchCellState(input);
    for (const row of parsed.cellPlans) this.#cellPlans.set(row.id, copy(row));
    for (const row of parsed.positions) this.#positions.set(row.id, copy(row));
    for (const row of parsed.reviewAssignments)
      this.#reviewAssignments.set(row.id, copy(row));
    for (const row of parsed.reviews) this.#reviews.set(row.id, copy(row));
    for (const row of parsed.dissentReports)
      this.#dissent.set(row.id, copy(row));
    for (const row of parsed.correlationAssessments)
      this.#correlations.set(row.id, copy(row));
    for (const row of parsed.rejectedResidue)
      this.#residue.set(row.id, copy(row));
    for (const row of parsed.receipts) this.#receipts.set(row.id, copy(row));
    for (const row of parsed.isolationCommits ?? [])
      this.#commits.set(row.id, copy(row));
    for (const row of parsed.isolationReveals ?? [])
      this.#reveals.set(row.id, copy(row));
    for (const row of parsed.sanitizedReviewContexts ?? [])
      this.#contexts.set(row.id, copy(row));
    for (const row of parsed.cellAttempts ?? [])
      this.#attempts.set(row.id, copy(row));
    for (const row of parsed.budgetReservations ?? [])
      this.#reservations.set(row.id, copy(row));
    for (const row of parsed.budgetSettlements ?? [])
      this.#settlements.set(row.id, copy(row));
    for (const row of parsed.budgetReleases ?? [])
      this.#releases.set(row.id, copy(row));
    for (const row of parsed.providerCharges ?? [])
      this.#charges.set(row.id, copy(row));
    for (const row of parsed.cancellationReceipts ?? [])
      this.#cancellations.set(row.id, copy(row));
  }

  async createCellPlan(input: CellPlanRecord): Promise<CellPlanRecord> {
    await asyncBoundary();
    const record = CellPlanRecordSchema.parse(input);
    this.#insert(this.#cellPlans, record.id, record, 'cell plan');
    return copy(record);
  }

  async updateCellPlanStatus(
    input: CellPlanStatusUpdate,
  ): Promise<CellPlanRecord> {
    await asyncBoundary();
    const current = this.#cellPlans.get(input.id);
    if (!current) throw new PersistenceIntegrityError('cell plan not found');
    if (
      current.revision !== input.expectedRevision ||
      current.fencingToken !== input.expectedFencingToken
    )
      throw new PersistenceConflictError(
        'stale cell plan revision or fencing token',
      );
    const next = CellPlanRecordSchema.parse({
      ...current,
      status: input.nextStatus,
      revision: current.revision + 1,
      fencingToken: current.fencingToken + 1,
      updatedAt: current.updatedAt,
    });
    this.#cellPlans.set(next.id, copy(next));
    return copy(next);
  }

  async recordPosition(input: ResearchPositionRecord) {
    await asyncBoundary();
    const record = ResearchPositionRecordSchema.parse(input);
    this.#require(this.#cellPlans, record.cellPlanId, 'cell plan');
    return this.#idempotentInsert(this.#positions, record.id, record);
  }

  async recordReviewAssignment(input: ReviewAssignmentRecord) {
    await asyncBoundary();
    const record = ReviewAssignmentRecordSchema.parse(input);
    this.#require(this.#positions, record.targetPositionId, 'position');
    this.#insert(
      this.#reviewAssignments,
      record.id,
      record,
      'review assignment',
    );
    return copy(record);
  }

  async recordReview(input: ResearchReviewRecord) {
    await asyncBoundary();
    const record = ResearchReviewRecordSchema.parse(input);
    this.#require(
      this.#reviewAssignments,
      record.assignmentId,
      'review assignment',
    );
    return this.#idempotentInsert(this.#reviews, record.id, record);
  }

  async recordDissent(input: DissentReportRecord) {
    await asyncBoundary();
    const record = DissentReportRecordSchema.parse(input);
    this.#insert(this.#dissent, record.id, record, 'dissent');
    return copy(record);
  }

  async recordCorrelation(input: CorrelationAssessmentRecord) {
    await asyncBoundary();
    const record = CorrelationAssessmentRecordSchema.parse(input);
    this.#insert(this.#correlations, record.id, record, 'correlation');
    return copy(record);
  }

  async recordRejectedResidue(input: RejectedAuditResidueRecord) {
    await asyncBoundary();
    const record = RejectedAuditResidueRecordSchema.parse(input);
    assertPayloadDigest(
      record.payload,
      record.payloadDigest,
      'rejected residue',
    );
    this.#insert(this.#residue, record.id, record, 'rejected residue');
    return copy(record);
  }

  async recordReceipt(input: CellReceiptRecord) {
    await asyncBoundary();
    const record = CellReceiptRecordSchema.parse(input);
    this.#insert(this.#receipts, record.id, record, 'cell receipt');
    return copy(record);
  }

  async recordIsolationCommit(input: IsolationCommitRecord) {
    await asyncBoundary();
    const record = IsolationCommitRecordSchema.parse(input);
    this.#require(this.#positions, record.positionId, 'position');
    this.#uniqueBy(
      this.#commits,
      (row) => row.positionId === record.positionId,
      'position isolation commit',
    );
    this.#insert(this.#commits, record.id, record, 'isolation commit');
    return copy(record);
  }

  async recordIsolationReveal(input: IsolationRevealRecord) {
    await asyncBoundary();
    const record = IsolationRevealRecordSchema.parse(input);
    const commit = [...this.#commits.values()].find(
      (row) => row.positionId === record.positionId,
    );
    if (!commit)
      throw new PersistenceIntegrityError(
        'reveal requires durable position commit',
      );
    if (record.auditSequence <= commit.auditSequence)
      throw new PersistenceIntegrityError(
        'reveal audit sequence must follow commit',
      );
    this.#insert(this.#reveals, record.id, record, 'isolation reveal');
    return copy(record);
  }

  async recordSanitizedReviewContext(input: SanitizedReviewContextRecord) {
    await asyncBoundary();
    const record = SanitizedReviewContextRecordSchema.parse(input);
    this.#require(
      this.#reviewAssignments,
      record.assignmentId,
      'review assignment',
    );
    this.#insert(this.#contexts, record.id, record, 'sanitized review context');
    return copy(record);
  }

  async recordCellAttempt(input: CellAttemptRecord) {
    await asyncBoundary();
    const record = CellAttemptRecordSchema.parse(input);
    this.#require(this.#cellPlans, record.cellPlanId, 'cell plan');
    this.#insert(this.#attempts, record.id, record, 'cell attempt');
    return copy(record);
  }

  async recordBudgetReservation(input: BudgetReservationRecord) {
    await asyncBoundary();
    const record = BudgetReservationRecordSchema.parse(input);
    this.#require(this.#attempts, record.attemptId, 'cell attempt');
    const existing = this.#findByStableIdentity(this.#reservations, record);
    if (existing) return copy(existing);
    this.#insert(this.#reservations, record.id, record, 'budget reservation');
    return copy(record);
  }

  async recordBudgetSettlement(input: BudgetSettlementRecord) {
    await asyncBoundary();
    const record = BudgetSettlementRecordSchema.parse(input);
    const existing = this.#findByStableIdentity(this.#settlements, record);
    if (existing) return copy(existing);
    const reservation = this.#require(
      this.#reservations,
      record.reservationId,
      'budget reservation',
    );
    if (reservation.state !== 'reserved')
      throw new PersistenceConflictError('reservation is already closed');
    if (!withinBudget(record.amount, reservation.ceiling))
      throw new PersistenceIntegrityError(
        'settlement exceeds reservation ceiling',
      );
    this.#reservations.set(reservation.id, {
      ...reservation,
      state: 'settled',
      revision: reservation.revision + 1,
      updatedAt: record.settledAt,
    });
    this.#insert(this.#settlements, record.id, record, 'budget settlement');
    return copy(record);
  }

  async recordBudgetRelease(input: BudgetReleaseRecord) {
    await asyncBoundary();
    const record = BudgetReleaseRecordSchema.parse(input);
    const reservation = this.#require(
      this.#reservations,
      record.reservationId,
      'budget reservation',
    );
    if (reservation.state !== 'reserved')
      throw new PersistenceConflictError('reservation is already closed');
    const existing = this.#findByStableIdentity(this.#releases, record);
    if (existing) return copy(existing);
    this.#reservations.set(reservation.id, {
      ...reservation,
      state: 'released',
      revision: reservation.revision + 1,
      updatedAt: record.releasedAt,
    });
    this.#insert(this.#releases, record.id, record, 'budget release');
    return copy(record);
  }

  async recordProviderCharge(input: ProviderChargeRecord) {
    await asyncBoundary();
    const record = ProviderChargeRecordSchema.parse(input);
    this.#require(
      this.#reservations,
      record.reservationId,
      'budget reservation',
    );
    const existing = this.#findByStableIdentity(this.#charges, record);
    if (existing) return copy(existing);
    this.#insert(this.#charges, record.id, record, 'provider charge');
    return copy(record);
  }

  async recordCancellationReceipt(input: CancellationReceiptRecord) {
    await asyncBoundary();
    const record = CancellationReceiptRecordSchema.parse(input);
    this.#require(this.#attempts, record.attemptId, 'cell attempt');
    const existing = this.#findByStableIdentity(this.#cancellations, record);
    if (existing) return copy(existing);
    if (record.reservationId) {
      const reservation = this.#require(
        this.#reservations,
        record.reservationId,
        'budget reservation',
      );
      if (!withinBudget(record.consumed, reservation.ceiling))
        throw new PersistenceIntegrityError(
          'cancelled consumption exceeds reservation',
        );
      if (reservation.state === 'reserved') {
        this.#reservations.set(reservation.id, {
          ...reservation,
          state: 'cancelled',
          revision: reservation.revision + 1,
          updatedAt: record.cancelledAt,
        });
      }
    }
    this.#insert(
      this.#cancellations,
      record.id,
      record,
      'cancellation receipt',
    );
    return copy(record);
  }

  async reconstructProgram(
    programId: string,
  ): Promise<ReconstructedResearchCellState> {
    await asyncBoundary();
    return parseResearchCellState({
      programId,
      modelProfiles: [],
      modelProfileVersions: [],
      modelLineageEdges: [],
      cellPlans: this.#forProgram(this.#cellPlans, programId),
      positions: this.#forProgram(this.#positions, programId),
      reviewAssignments: this.#forProgram(this.#reviewAssignments, programId),
      reviews: this.#forProgram(this.#reviews, programId),
      dissentReports: this.#forProgram(this.#dissent, programId),
      correlationAssessments: [...this.#correlations.values()].map(copy),
      rejectedResidue: this.#forProgram(this.#residue, programId),
      receipts: this.#forProgram(this.#receipts, programId),
      isolationCommits: this.#forProgram(this.#commits, programId),
      isolationReveals: this.#forProgram(this.#reveals, programId),
      sanitizedReviewContexts: this.#forProgram(this.#contexts, programId),
      cellAttempts: this.#forProgram(this.#attempts, programId),
      budgetReservations: this.#forProgram(this.#reservations, programId),
      budgetSettlements: [...this.#settlements.values()]
        .filter((row) => {
          const reservation = this.#reservations.get(row.reservationId);
          return reservation?.programId === programId;
        })
        .map(copy),
      budgetReleases: [...this.#releases.values()]
        .filter((row) => {
          const reservation = this.#reservations.get(row.reservationId);
          return reservation?.programId === programId;
        })
        .map(copy),
      providerCharges: [...this.#charges.values()]
        .filter((row) => {
          const reservation = this.#reservations.get(row.reservationId);
          return reservation?.programId === programId;
        })
        .map(copy),
      cancellationReceipts: this.#forProgram(this.#cancellations, programId),
    });
  }

  #idempotentInsert<T extends { id: string }>(
    map: Map<string, T>,
    id: string,
    record: T,
  ): AdmissionPersistenceResult<T> {
    const existing = map.get(id);
    if (existing) {
      if (!sameJson(existing, record))
        throw new PersistenceConflictError(
          'duplicate id carries different payload',
        );
      return { decision: 'admitted', record: copy(existing) };
    }
    map.set(id, copy(record));
    return { decision: 'admitted', record: copy(record) };
  }

  #insert<T extends { id: string }>(
    map: Map<string, T>,
    id: string,
    record: T,
    subject: string,
  ): void {
    if (map.has(id))
      throw new PersistenceConflictError(`duplicate ${subject} id`);
    map.set(id, copy(record));
  }

  #require<T>(map: Map<string, T>, id: string, subject: string): T {
    const record = map.get(id);
    if (!record) throw new PersistenceIntegrityError(`${subject} not found`);
    return copy(record);
  }

  #uniqueBy<T>(
    map: Map<string, T>,
    predicate: (record: T) => boolean,
    subject: string,
  ): void {
    if ([...map.values()].some(predicate))
      throw new PersistenceConflictError(`duplicate ${subject}`);
  }

  #findByStableIdentity<T extends { stableIdentity: string }>(
    map: Map<string, T>,
    record: T,
  ): T | undefined {
    const existing = [...map.values()].find(
      (row) => row.stableIdentity === record.stableIdentity,
    );
    if (existing && !sameJson(existing, record))
      throw new PersistenceConflictError(
        'stable identity reused for different payload',
      );
    return existing;
  }

  #forProgram<T extends { programId: string }>(
    map: Map<string, T>,
    programId: string,
  ): T[] {
    return [...map.values()]
      .filter((row) => row.programId === programId)
      .map(copy);
  }
}

function copy<T>(value: T): T {
  return structuredClone(value);
}

function asyncBoundary(): Promise<void> {
  return Promise.resolve();
}

function withinBudget(
  value: z.infer<typeof BudgetAmountSchema>,
  ceiling: z.infer<typeof BudgetAmountSchema>,
): boolean {
  return (
    value.costUsd <= ceiling.costUsd &&
    value.tokens <= ceiling.tokens &&
    value.durationMs <= ceiling.durationMs
  );
}

function sameValues(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length && left.every((value, i) => value === right[i])
  );
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalDigest(left) === canonicalDigest(right);
}
