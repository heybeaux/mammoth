import {
  CellPlanSchema,
  CorrelationAssessmentSchema,
  DigestSchema,
  DissentReportSchema,
  ModelProfileSchema,
  ModelProfileVersionSchema,
  ResearchPositionSchema,
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

const OperationalMetadataSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

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
      record.locality !== contract.locality ||
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
      record.templateVersion !== String(contract.templateVersion)
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
    proposalRefs: z.array(z.string().min(1)),
    usage: z.unknown(),
    uncertaintyCode: z.string().min(1).nullable(),
    failureCode: z.string().min(1).nullable(),
    body: z.unknown(),
    recordedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((record, context) => {
    if (
      record.id !== record.contract.id ||
      record.positionDigest !== record.contract.canonicalDigest ||
      record.criterionId !== record.contract.criterionRef.criterionId ||
      record.criterionDigest !== record.contract.criterionRef.criterionDigest
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['contract'],
        message: 'position record metadata drifts from domain contract',
      });
  });
export const ResearchReviewRecordSchema = z
  .object({
    contract: ResearchReviewSchema,
    id: z.string().min(1),
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
    usage: z.unknown(),
    uncertaintyCode: z.string().min(1).nullable(),
    failureCode: z.string().min(1).nullable(),
    reasons: z.array(z.string().min(1)),
    body: z.unknown(),
    recordedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((record, context) => {
    if (
      record.id !== record.contract.id ||
      record.positionId !== record.contract.targetPositionId ||
      record.reviewDigest !== record.contract.canonicalDigest ||
      record.modelProfileVersionId !==
        record.contract.reviewerModelProfileVersionId ||
      record.criterionId !== record.contract.criterionRef.criterionId ||
      record.criterionDigest !== record.contract.criterionRef.criterionDigest ||
      record.verdict !== record.contract.verdict
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
      record.criterionDigest !== record.contract.criterionRef.criterionDigest
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
      record.assessmentDigest !== record.contract.canonicalDigest
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
    payloadDigest: DigestSchema,
    payload: z.unknown(),
    recordedAt: z.string().datetime(),
  })
  .strict();

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
export type CellPlanRecord = z.infer<typeof CellPlanRecordSchema>;
export type ResearchPositionRecord = z.infer<
  typeof ResearchPositionRecordSchema
>;
export type ResearchReviewRecord = z.infer<typeof ResearchReviewRecordSchema>;
export type DissentReportRecord = z.infer<typeof DissentReportRecordSchema>;
export type CorrelationAssessmentRecord = z.infer<
  typeof CorrelationAssessmentRecordSchema
>;
export type RejectedAuditResidueRecord = z.infer<
  typeof RejectedAuditResidueRecordSchema
>;
export type CellReceiptRecord = z.infer<typeof CellReceiptRecordSchema>;

export interface ModelProfileWrite {
  readonly id: string;
  readonly provider: string;
  readonly canonicalName: string;
  readonly familyId: string;
  readonly contract: z.infer<typeof ModelProfileSchema>;
  readonly active: boolean;
  readonly aliases: readonly string[];
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
  readonly cellPlans: readonly CellPlanRecord[];
  readonly positions: readonly ResearchPositionRecord[];
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
}

export interface ResearchCellRepository {
  createCellPlan(input: CellPlanRecord): Promise<CellPlanRecord>;
  updateCellPlanStatus(input: CellPlanStatusUpdate): Promise<CellPlanRecord>;
  recordPosition(
    input: ResearchPositionRecord,
  ): Promise<ResearchPositionRecord>;
  recordReview(input: ResearchReviewRecord): Promise<ResearchReviewRecord>;
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
    cellPlans: input.cellPlans.map((row) => CellPlanRecordSchema.parse(row)),
    positions: input.positions.map((row) =>
      ResearchPositionRecordSchema.parse(row),
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
