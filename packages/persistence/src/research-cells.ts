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
  };
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
