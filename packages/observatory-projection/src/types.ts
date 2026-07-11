import {
  ClaimAssessmentSchema,
  ClaimDependencyKindSchema,
  ClaimDependencySchema,
  ClaimEvidenceEdgeSchema,
  ClaimSchema,
  ClaimStatusSchema,
  DecisionCriterionSchema,
  DigestSchema,
  EntityIdSchema,
  EvidenceArtifactSchema,
  EvidenceKindSchema,
  EvidenceLocatorSchema,
  NonEmptyStringSchema,
  ResearchProgramSchema,
  SourceLineageSchema,
  TimestampSchema,
} from '@mammoth/domain';
import { ReportSentenceTraceSchema } from '@mammoth/report-compiler';
import { z } from 'zod';

export const AuthoritativeAuditEventSchema = z
  .object({
    id: EntityIdSchema,
    sequence: z.number().int().positive(),
    occurredAt: TimestampSchema,
    kind: NonEmptyStringSchema,
    summary: NonEmptyStringSchema,
    claimIds: z.array(EntityIdSchema),
    evidenceIds: z.array(EntityIdSchema),
    receiptId: EntityIdSchema.optional(),
    eventHash: DigestSchema,
    previousHash: z.union([DigestSchema, z.literal('GENESIS')]),
  })
  .strict();

export const DossierSnapshotSchema = z
  .object({
    manifestId: EntityIdSchema,
    artifactId: EntityIdSchema,
    traces: z.array(ReportSentenceTraceSchema),
    excludedClaims: z.array(
      z
        .object({
          claimId: EntityIdSchema,
          reason: NonEmptyStringSchema,
        })
        .strict(),
    ),
  })
  .strict();

export const ObservatoryProjectionInputV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    generatedAt: TimestampSchema,
    authoritativeRevision: z.number().int().nonnegative(),
    auditHeadHash: DigestSchema,
    complete: z.boolean(),
    omissions: z.array(NonEmptyStringSchema),
    program: ResearchProgramSchema,
    criterion: DecisionCriterionSchema,
    claims: z.array(ClaimSchema),
    assessments: z.array(ClaimAssessmentSchema),
    evidence: z.array(EvidenceArtifactSchema),
    claimEvidenceEdges: z.array(ClaimEvidenceEdgeSchema),
    claimDependencies: z.array(ClaimDependencySchema),
    sourceLineages: z.array(SourceLineageSchema),
    auditEvents: z.array(AuthoritativeAuditEventSchema),
    dossier: DossierSnapshotSchema,
  })
  .strict()
  .superRefine((input, context) => {
    if (input.complete && input.omissions.length > 0)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['omissions'],
        message: 'complete projections cannot declare omissions',
      });
    if (!input.complete && input.omissions.length === 0)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['omissions'],
        message: 'incomplete projections must name at least one omission',
      });
  });

export const ProgramProjectionSchema = z
  .object({
    id: EntityIdSchema,
    title: NonEmptyStringSchema,
    question: NonEmptyStringSchema,
    status: z.enum([
      'draft',
      'active',
      'sleeping',
      'blocked',
      'completed',
      'abandoned',
      'cancelled',
    ]),
    criterionId: EntityIdSchema,
    criterionVersion: z.number().int().positive(),
    evidencePolicyId: EntityIdSchema,
    updatedAt: TimestampSchema,
  })
  .strict();

export const ClaimNodeSchema = z
  .object({
    kind: z.literal('claim'),
    id: EntityIdSchema,
    canonicalText: NonEmptyStringSchema,
    status: ClaimStatusSchema,
    assessmentId: EntityIdSchema.optional(),
    assessmentVerdict: ClaimAssessmentSchema.shape.verdict.optional(),
    policyId: EntityIdSchema.optional(),
    policyVersion: NonEmptyStringSchema.optional(),
    reasonCodes: z.array(NonEmptyStringSchema),
  })
  .strict();

export const EvidenceNodeSchema = z
  .object({
    kind: z.literal('evidence'),
    id: EntityIdSchema,
    evidenceKind: EvidenceKindSchema,
    contentDigest: DigestSchema,
    storageUri: NonEmptyStringSchema,
    sourceLineageId: EntityIdSchema,
    retrievedAt: TimestampSchema,
  })
  .strict();

export const ObservatoryNodeSchema = z.discriminatedUnion('kind', [
  ClaimNodeSchema,
  EvidenceNodeSchema,
]);

export const ObservatoryEdgeSchema = z
  .object({
    id: EntityIdSchema,
    from: EntityIdSchema,
    to: EntityIdSchema,
    kind: z.enum(['supports', 'contradicts', 'context', 'depends_on']),
    status: z.enum(['active', 'expired', 'rejected', 'unresolved']),
    dependencyKind: ClaimDependencyKindSchema.optional(),
    locator: EvidenceLocatorSchema.optional(),
  })
  .strict();

export const TimelineEventProjectionSchema = AuthoritativeAuditEventSchema;

export const DossierProjectionSchema = z
  .object({
    manifestId: EntityIdSchema,
    artifactId: EntityIdSchema,
    sentences: z.array(ReportSentenceTraceSchema),
    excludedClaims: DossierSnapshotSchema.shape.excludedClaims,
  })
  .strict();

export const ProjectionIntegritySchema = z
  .object({
    canonicalDigest: DigestSchema,
    authoritativeRevision: z.number().int().nonnegative(),
    auditHeadHash: DigestSchema,
    complete: z.boolean(),
    omissions: z.array(NonEmptyStringSchema),
  })
  .strict();

export const ObservatoryProjectionV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    generatedAt: TimestampSchema,
    sourceRevision: NonEmptyStringSchema,
    program: ProgramProjectionSchema,
    nodes: z.array(ObservatoryNodeSchema),
    edges: z.array(ObservatoryEdgeSchema),
    timeline: z.array(TimelineEventProjectionSchema),
    dossier: DossierProjectionSchema,
    integrity: ProjectionIntegritySchema,
  })
  .strict();

export type ObservatoryProjectionInputV1 = z.infer<
  typeof ObservatoryProjectionInputV1Schema
>;
export type ObservatoryProjectionV1 = z.infer<
  typeof ObservatoryProjectionV1Schema
>;
