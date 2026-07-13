import { DigestSchema, canonicalDigest, type Digest } from '@mammoth/domain';
import { z } from 'zod';

export type { Digest } from '@mammoth/domain';

export type ModelLocality = 'local' | 'cloud' | 'unknown';
export type ModelLineageStatus = 'known' | 'partial' | 'unknown';
export type CellPlanStatus =
  | 'planned'
  | 'leased'
  | 'completed'
  | 'failed'
  | 'cancelled';

export const ModelProfileSchema = z
  .object({
    id: z.string().min(1),
    provider: z.string().min(1),
    canonicalName: z.string().min(1),
    familyId: z.string().min(1),
    active: z.boolean(),
    aliases: z.array(z.string().min(1)),
    revision: z.number().int().nonnegative(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const ModelProfileVersionSchema = z
  .object({
    id: z.string().min(1),
    profileId: z.string().min(1),
    profileRevision: z.number().int().positive(),
    provider: z.string().min(1),
    modelName: z.string().min(1),
    checkpoint: z.string().min(1),
    familyId: z.string().min(1),
    lineageStatus: z.enum(['known', 'partial', 'unknown']),
    trainingLineageIds: z.array(z.string().min(1)),
    fineTuneLineageIds: z.array(z.string().min(1)),
    sharedDerivationIds: z.array(z.string().min(1)),
    locality: z.enum(['local', 'cloud', 'unknown']),
    modalities: z.array(z.string().min(1)),
    contextWindow: z.number().int().nonnegative(),
    dataPolicyId: z.string().min(1),
    costProfileId: z.string().min(1),
    declaredAt: z.string().datetime(),
    metadata: z.unknown(),
  })
  .strict();

export const CellPlanSchema = z
  .object({
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
    revision: z.number().int().nonnegative(),
    fencingToken: z.number().int().nonnegative(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const ResearchPositionSchema = z
  .object({
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
  .strict();

export const ResearchReviewSchema = ResearchPositionSchema.omit({
  positionDigest: true,
  proposalRefs: true,
  body: true,
})
  .extend({
    id: z.string().min(1),
    positionId: z.string().min(1),
    reviewerRole: z.string().min(1),
    reviewDigest: DigestSchema,
    verdict: z.enum(['admit', 'reject', 'abstain']),
    reasons: z.array(z.string().min(1)),
    body: z.unknown(),
  })
  .strict();

export const DissentReportSchema = z
  .object({
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
  .strict();

export const CorrelationAssessmentSchema = z
  .object({
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
  .strict();

export const RejectedAuditResidueSchema = z
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

export const CellReceiptSchema = z
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

export type ModelProfile = z.infer<typeof ModelProfileSchema>;
export type ModelProfileVersion = z.infer<typeof ModelProfileVersionSchema>;
export type CellPlan = z.infer<typeof CellPlanSchema>;
export type ResearchPosition = z.infer<typeof ResearchPositionSchema>;
export type ResearchReview = z.infer<typeof ResearchReviewSchema>;
export type DissentReport = z.infer<typeof DissentReportSchema>;
export type CorrelationAssessment = z.infer<typeof CorrelationAssessmentSchema>;
export type RejectedAuditResidue = z.infer<typeof RejectedAuditResidueSchema>;
export type CellReceipt = z.infer<typeof CellReceiptSchema>;

export interface ModelProfileWrite {
  readonly id: string;
  readonly provider: string;
  readonly canonicalName: string;
  readonly familyId: string;
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
  readonly modelProfiles: readonly ModelProfile[];
  readonly modelProfileVersions: readonly ModelProfileVersion[];
  readonly cellPlans: readonly CellPlan[];
  readonly positions: readonly ResearchPosition[];
  readonly reviews: readonly ResearchReview[];
  readonly dissentReports: readonly DissentReport[];
  readonly correlationAssessments: readonly CorrelationAssessment[];
  readonly rejectedResidue: readonly RejectedAuditResidue[];
  readonly receipts: readonly CellReceipt[];
}

export interface ModelLineageRepository {
  upsertModelProfile(input: ModelProfileWrite): Promise<ModelProfile>;
  appendModelProfileVersion(
    input: ModelProfileVersion,
  ): Promise<ModelProfileVersion>;
  readModelProfile(id: string): Promise<ModelProfile | undefined>;
  readModelProfileVersion(id: string): Promise<ModelProfileVersion | undefined>;
  listModelProfileVersions(
    profileId: string,
  ): Promise<readonly ModelProfileVersion[]>;
}

export interface ResearchCellRepository {
  createCellPlan(input: CellPlan): Promise<CellPlan>;
  updateCellPlanStatus(input: CellPlanStatusUpdate): Promise<CellPlan>;
  recordPosition(input: ResearchPosition): Promise<ResearchPosition>;
  recordReview(input: ResearchReview): Promise<ResearchReview>;
  recordDissent(input: DissentReport): Promise<DissentReport>;
  recordCorrelation(
    input: CorrelationAssessment,
  ): Promise<CorrelationAssessment>;
  recordRejectedResidue(
    input: RejectedAuditResidue,
  ): Promise<RejectedAuditResidue>;
  recordReceipt(input: CellReceipt): Promise<CellReceipt>;
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
      ModelProfileSchema.parse(row),
    ),
    modelProfileVersions: input.modelProfileVersions.map((row) =>
      ModelProfileVersionSchema.parse(row),
    ),
    cellPlans: input.cellPlans.map((row) => CellPlanSchema.parse(row)),
    positions: input.positions.map((row) => ResearchPositionSchema.parse(row)),
    reviews: input.reviews.map((row) => ResearchReviewSchema.parse(row)),
    dissentReports: input.dissentReports.map((row) =>
      DissentReportSchema.parse(row),
    ),
    correlationAssessments: input.correlationAssessments.map((row) =>
      CorrelationAssessmentSchema.parse(row),
    ),
    rejectedResidue: input.rejectedResidue.map((row) =>
      RejectedAuditResidueSchema.parse(row),
    ),
    receipts: input.receipts.map((row) => CellReceiptSchema.parse(row)),
  };
}
