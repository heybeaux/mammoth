import {
  ClaimAssessmentSchema,
  ClaimDependencyKindSchema,
  ClaimDependencySchema,
  ClaimEvidenceEdgeSchema,
  ClaimSchema,
  ClaimStatusSchema,
  CellPlanSchema,
  CellTemplateSchema,
  CorrelationAssessmentSchema,
  DecisionCriterionSchema,
  DigestSchema,
  EntityIdSchema,
  EvidenceArtifactSchema,
  EvidenceKindSchema,
  EvidenceLocatorSchema,
  DissentReportSchema,
  ModelProfileVersionSchema,
  NonEmptyStringSchema,
  ResearchProgramSchema,
  ResearchPositionSchema,
  ResearchReviewSchema,
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

export const TemporalOperationEventKindSchema = z.enum([
  'workflow_started',
  'durable_step',
  'signal',
  'timer',
  'retry',
  'cancellation',
  'human_gate',
  'continue_as_new',
  'terminal',
]);

export const TemporalOperationEventSchema = z
  .object({
    source: z.literal('temporal'),
    id: EntityIdSchema,
    occurredAt: TimestampSchema,
    kind: TemporalOperationEventKindSchema,
    workflowId: NonEmptyStringSchema,
    runId: NonEmptyStringSchema,
    durableStep: NonEmptyStringSchema,
    attempt: z.number().int().positive(),
    summary: NonEmptyStringSchema,
    receiptRefs: z.array(EntityIdSchema),
    admittedAuditEventId: EntityIdSchema.optional(),
    authoritativeRevision: z.number().int().nonnegative(),
  })
  .strict();

export const TemporalOperationMetricsSchema = z
  .object({
    workflowLatencyMs: z.number().int().nonnegative(),
    activityLatencyMs: z.number().int().nonnegative(),
    retryCount: z.number().int().nonnegative(),
    duplicateEffectsPrevented: z.number().int().nonnegative(),
    failClosedStartupCount: z.number().int().nonnegative(),
  })
  .strict();

export const TemporalOperationLogSchema = z
  .object({
    occurredAt: TimestampSchema,
    level: z.enum(['info', 'warn', 'error']),
    event: NonEmptyStringSchema,
    workflowId: NonEmptyStringSchema,
    runId: NonEmptyStringSchema,
    durableStep: NonEmptyStringSchema.optional(),
    attempt: z.number().int().positive().optional(),
    message: NonEmptyStringSchema,
  })
  .strict();

export const TemporalRunLinkSchema = z
  .object({
    runId: NonEmptyStringSchema,
    continuedFromRunId: NonEmptyStringSchema.optional(),
  })
  .strict();

export const TemporalExecutionLinkSchema = z
  .object({
    workflowId: NonEmptyStringSchema,
    runId: NonEmptyStringSchema,
    runChain: z.array(TemporalRunLinkSchema).min(1),
    workflowType: NonEmptyStringSchema,
    taskQueue: NonEmptyStringSchema,
    contractVersion: NonEmptyStringSchema,
    currentDurableStep: NonEmptyStringSchema,
    attempt: z.number().int().positive(),
    events: z.array(TemporalOperationEventSchema),
    metrics: TemporalOperationMetricsSchema,
    logs: z.array(TemporalOperationLogSchema),
  })
  .strict();

export const P4RecordStatusSchema = z.enum([
  'active',
  'expired',
  'rejected',
  'unresolved',
]);

const ProjectionDigestRecordSchema = z.object({
  recordDigest: DigestSchema,
  authoritativeRevision: z.number().int().nonnegative(),
});

export const CellProjectionInputSchema = ProjectionDigestRecordSchema.extend({
  contract: CellPlanSchema,
  id: EntityIdSchema,
  programId: EntityIdSchema,
  cellPlanId: EntityIdSchema,
  cellPlanVersion: NonEmptyStringSchema,
  branchId: NonEmptyStringSchema,
  role: CellTemplateSchema.shape.kind,
  status: z.enum([
    'planned',
    'running',
    'blocked',
    'succeeded',
    'failed',
    'cancelled',
  ]),
  criterionId: EntityIdSchema,
  criterionVersion: z.number().int().positive(),
  criterionDigest: DigestSchema,
  workItemIds: z.array(EntityIdSchema),
  receiptIds: z.array(EntityIdSchema),
}).strict();

export const PositionProjectionInputSchema =
  ProjectionDigestRecordSchema.extend({
    contract: ResearchPositionSchema,
    id: EntityIdSchema,
    cellId: EntityIdSchema,
    claimIds: z.array(EntityIdSchema),
    evidenceIds: z.array(EntityIdSchema),
    modelProfileVersionId: EntityIdSchema,
    criterionId: EntityIdSchema,
    criterionVersion: z.number().int().positive(),
    criterionDigest: DigestSchema,
    status: z.enum(['proposed', 'admitted', 'rejected', 'unresolved']),
    rejectedResidueId: EntityIdSchema.optional(),
  }).strict();

export const ReviewProjectionInputSchema = ProjectionDigestRecordSchema.extend({
  contract: ResearchReviewSchema,
  id: EntityIdSchema,
  cellId: EntityIdSchema,
  positionId: EntityIdSchema,
  reviewerModelProfileVersionId: EntityIdSchema,
  assignmentId: EntityIdSchema,
  verdict: z.enum(['admit', 'reject', 'revise', 'unresolved']),
  status: z.enum(['assigned', 'completed', 'rejected', 'cancelled']),
  receiptIds: z.array(EntityIdSchema),
}).strict();

export const ModelLineageProjectionInputSchema =
  ProjectionDigestRecordSchema.extend({
    contract: ModelProfileVersionSchema,
    id: EntityIdSchema,
    provider: NonEmptyStringSchema,
    family: NonEmptyStringSchema,
    checkpoint: NonEmptyStringSchema,
    modelProfileVersion: NonEmptyStringSchema,
    parentModelLineageIds: z.array(EntityIdSchema),
    sharedDerivationIds: z.array(EntityIdSchema),
    correlationGroupId: EntityIdSchema.optional(),
    unknownLineage: z.boolean(),
  })
    .strict()
    .superRefine((record, context) => {
      if (
        record.id !== record.contract.id ||
        record.provider !== record.contract.provider ||
        record.family !== record.contract.family ||
        record.checkpoint !== record.contract.checkpoint ||
        record.unknownLineage !== (record.contract.lineage.kind === 'unknown')
      )
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['contract'],
          message:
            'model lineage projection metadata drifts from domain contract',
        });
    });

export const CorrelationProjectionStatusSchema = z.enum([
  'independent',
  'correlated',
  'unknown_penalized',
]);

export const CorrelationProjectionInputSchema =
  ProjectionDigestRecordSchema.extend({
    contract: CorrelationAssessmentSchema,
    id: EntityIdSchema,
    modelLineageIds: z.array(EntityIdSchema).min(2),
    policyVersion: NonEmptyStringSchema,
    score: z.number().min(0).max(1),
    status: CorrelationProjectionStatusSchema,
    reasonCodes: z.array(NonEmptyStringSchema),
  })
    .strict()
    .superRefine((record, context) => {
      const contract = record.contract;
      const expectedStatus = contract.independent
        ? 'independent'
        : contract.reasonCodes.includes('unknown_lineage')
          ? 'unknown_penalized'
          : 'correlated';
      if (
        record.id !== contract.id ||
        record.policyVersion !== contract.policyVersion ||
        record.score !== contract.correlationScore ||
        record.status !== expectedStatus ||
        !sameOrderedValues(record.modelLineageIds, [
          contract.subjectModelProfileVersionId,
          contract.candidateModelProfileVersionId,
        ]) ||
        !sameOrderedValues(record.reasonCodes, contract.reasonCodes)
      )
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['contract'],
          message:
            'correlation projection metadata drifts from domain contract',
        });
    });

export const DissentProjectionStatusSchema = z.enum([
  'minority',
  'unresolved',
  'contradicted',
  'preserved',
]);

export const DissentProjectionInputSchema = ProjectionDigestRecordSchema.extend(
  {
    contract: DissentReportSchema,
    id: EntityIdSchema,
    positionIds: z.array(EntityIdSchema).min(1),
    claimIds: z.array(EntityIdSchema),
    evidenceIds: z.array(EntityIdSchema),
    status: DissentProjectionStatusSchema,
    reasonCodes: z.array(NonEmptyStringSchema),
  },
)
  .strict()
  .superRefine((record, context) => {
    const contract = record.contract;
    if (
      record.id !== contract.id ||
      !sameOrderedValues(record.positionIds, contract.positionIds) ||
      !sameOrderedValues(record.claimIds, contract.claimIds) ||
      !sameOrderedValues(record.evidenceIds, contract.evidenceIds) ||
      !sameOrderedValues(record.reasonCodes, contract.unresolvedReasonCodes)
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['contract'],
        message: 'dissent projection metadata drifts from domain contract',
      });
  });

function sameOrderedValues(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

export const RejectedResidueProjectionInputSchema =
  ProjectionDigestRecordSchema.extend({
    id: EntityIdSchema,
    sourceId: EntityIdSchema,
    sourceKind: z.enum(['position', 'review', 'cell', 'correlation']),
    reasonCodes: z.array(NonEmptyStringSchema).min(1),
    retainedArtifactDigest: DigestSchema,
  }).strict();

export const ReceiptProjectionInputSchema = ProjectionDigestRecordSchema.extend(
  {
    id: EntityIdSchema,
    workItemId: EntityIdSchema,
    status: z.enum(['succeeded', 'failed', 'cancelled', 'partial']),
    artifactDigest: DigestSchema,
  },
).strict();

export const P5IsolationProjectionInputSchema =
  ProjectionDigestRecordSchema.extend({
    id: EntityIdSchema,
    workflowId: NonEmptyStringSchema,
    isolationProtocolVersion: z.literal('1.0.0'),
    sanitizedContextContractVersion: z.literal('1.0.0'),
    assignmentPolicyVersion: z.literal('1.0.0'),
    positionId: EntityIdSchema,
    reviewId: EntityIdSchema,
    assignmentId: EntityIdSchema,
    sanitizedContextDigest: DigestSchema,
    committedPositionDigest: DigestSchema,
    revealedPositionDigest: DigestSchema.optional(),
    commitSequence: z.array(
      z.enum([
        'budget_reserved',
        'position_dispatched',
        'position_committed',
        'position_revealed',
        'review_assigned',
        'review_committed',
        'budget_settled',
      ]),
    ),
    authorAttribution: z
      .object({
        authorAgentId: EntityIdSchema,
        authorModelProfileVersionId: EntityIdSchema,
      })
      .strict(),
    reviewerVisibleFields: z.array(NonEmptyStringSchema),
    prohibitedReviewerFieldDigests: z.array(DigestSchema),
    correlationId: EntityIdSchema.optional(),
    dissentId: EntityIdSchema.optional(),
    residueIds: z.array(EntityIdSchema),
    reservation: z
      .object({
        reservationId: EntityIdSchema,
        amountUsd: z.number().nonnegative(),
        receiptId: EntityIdSchema,
      })
      .strict(),
    settlement: z
      .object({
        settlementId: EntityIdSchema,
        consumedUsd: z.number().nonnegative(),
        releasedUsd: z.number().nonnegative(),
        receiptId: EntityIdSchema,
      })
      .strict()
      .optional(),
    partialResultReceiptIds: z.array(EntityIdSchema),
    cancellationReceiptId: EntityIdSchema.optional(),
    retryReceiptIds: z.array(EntityIdSchema),
    effectReceiptIds: z.array(EntityIdSchema),
    temporalCarryDigest: DigestSchema.optional(),
  }).strict();

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
    temporalExecution: TemporalExecutionLinkSchema.optional(),
    cells: z.array(CellProjectionInputSchema).default([]),
    positions: z.array(PositionProjectionInputSchema).default([]),
    reviews: z.array(ReviewProjectionInputSchema).default([]),
    modelLineages: z.array(ModelLineageProjectionInputSchema).default([]),
    correlations: z.array(CorrelationProjectionInputSchema).default([]),
    dissentReports: z.array(DissentProjectionInputSchema).default([]),
    rejectedResidue: z.array(RejectedResidueProjectionInputSchema).default([]),
    receipts: z.array(ReceiptProjectionInputSchema).default([]),
    isolationRuns: z.array(P5IsolationProjectionInputSchema).default([]),
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

export const CellNodeSchema = z
  .object({
    kind: z.literal('research_cell'),
    id: EntityIdSchema,
    cellPlanId: EntityIdSchema,
    cellPlanVersion: NonEmptyStringSchema,
    branchId: NonEmptyStringSchema,
    role: CellProjectionInputSchema.shape.role,
    status: CellProjectionInputSchema.shape.status,
    criterionId: EntityIdSchema,
    criterionVersion: z.number().int().positive(),
    criterionDigest: DigestSchema,
  })
  .strict();

export const PositionNodeSchema = z
  .object({
    kind: z.literal('position'),
    id: EntityIdSchema,
    status: PositionProjectionInputSchema.shape.status,
    criterionId: EntityIdSchema,
    criterionVersion: z.number().int().positive(),
    criterionDigest: DigestSchema,
    modelProfileId: EntityIdSchema,
    claimIds: z.array(EntityIdSchema),
    evidenceIds: z.array(EntityIdSchema),
  })
  .strict();

export const ReviewNodeSchema = z
  .object({
    kind: z.literal('review'),
    id: EntityIdSchema,
    assignmentId: EntityIdSchema,
    verdict: ReviewProjectionInputSchema.shape.verdict,
    status: ReviewProjectionInputSchema.shape.status,
    reviewerModelProfileId: EntityIdSchema,
  })
  .strict();

export const ModelLineageNodeSchema = z
  .object({
    kind: z.literal('model_lineage'),
    id: EntityIdSchema,
    provider: NonEmptyStringSchema,
    family: NonEmptyStringSchema,
    checkpoint: NonEmptyStringSchema,
    modelProfileVersion: NonEmptyStringSchema,
    unknownLineage: z.boolean(),
    correlationGroupId: EntityIdSchema.optional(),
  })
  .strict();

export const CorrelationNodeSchema = z
  .object({
    kind: z.literal('correlation'),
    id: EntityIdSchema,
    policyVersion: NonEmptyStringSchema,
    score: z.number().min(0).max(1),
    status: CorrelationProjectionStatusSchema,
    reasonCodes: z.array(NonEmptyStringSchema),
    modelLineageIds: z.array(EntityIdSchema).min(2),
    contractDigest: DigestSchema,
  })
  .strict();

export const DissentNodeSchema = z
  .object({
    kind: z.literal('dissent'),
    id: EntityIdSchema,
    status: DissentProjectionStatusSchema,
    reasonCodes: z.array(NonEmptyStringSchema),
    positionIds: z.array(EntityIdSchema).min(1),
    claimIds: z.array(EntityIdSchema),
    evidenceIds: z.array(EntityIdSchema),
    criterionId: EntityIdSchema,
    criterionVersion: z.number().int().positive(),
    criterionDigest: DigestSchema,
    contractDigest: DigestSchema,
  })
  .strict();

export const RejectedResidueNodeSchema = z
  .object({
    kind: z.literal('rejected_residue'),
    id: EntityIdSchema,
    sourceKind: RejectedResidueProjectionInputSchema.shape.sourceKind,
    reasonCodes: z.array(NonEmptyStringSchema),
    retainedArtifactDigest: DigestSchema,
  })
  .strict();

export const ReceiptNodeSchema = z
  .object({
    kind: z.literal('receipt'),
    id: EntityIdSchema,
    workItemId: EntityIdSchema,
    status: ReceiptProjectionInputSchema.shape.status,
    artifactDigest: DigestSchema,
  })
  .strict();

export const P5IsolationNodeSchema = z
  .object({
    kind: z.literal('p5_isolation'),
    id: EntityIdSchema,
    workflowId: NonEmptyStringSchema,
    isolationProtocolVersion: z.literal('1.0.0'),
    sanitizedContextContractVersion: z.literal('1.0.0'),
    assignmentPolicyVersion: z.literal('1.0.0'),
    positionId: EntityIdSchema,
    reviewId: EntityIdSchema,
    assignmentId: EntityIdSchema,
    sanitizedContextDigest: DigestSchema,
    committedPositionDigest: DigestSchema,
    sequenceState: z.enum([
      'committed',
      'revealed',
      'reviewed',
      'settled',
      'partial',
    ]),
    authorAgentId: EntityIdSchema,
    authorModelProfileVersionId: EntityIdSchema,
    reservationId: EntityIdSchema,
    reservedUsd: z.number().nonnegative(),
    consumedUsd: z.number().nonnegative(),
    releasedUsd: z.number().nonnegative(),
    cancellationReceiptId: EntityIdSchema.optional(),
  })
  .strict();

export const ObservatoryNodeSchema = z.discriminatedUnion('kind', [
  ClaimNodeSchema,
  EvidenceNodeSchema,
  CellNodeSchema,
  PositionNodeSchema,
  ReviewNodeSchema,
  ModelLineageNodeSchema,
  CorrelationNodeSchema,
  DissentNodeSchema,
  RejectedResidueNodeSchema,
  ReceiptNodeSchema,
  P5IsolationNodeSchema,
]);

export const ObservatoryEdgeSchema = z
  .object({
    id: EntityIdSchema,
    from: EntityIdSchema,
    to: EntityIdSchema,
    kind: z.enum([
      'supports',
      'contradicts',
      'context',
      'depends_on',
      'has_position',
      'proposed_by',
      'reviews',
      'reviewed_by',
      'derived_from',
      'shares_lineage',
      'correlates_with',
      'dissents_from',
      'rejected_for',
      'emitted_receipt',
      'references_claim',
      'references_evidence',
    ]),
    status: z.enum(['active', 'expired', 'rejected', 'unresolved']),
    dependencyKind: ClaimDependencyKindSchema.optional(),
    locator: EvidenceLocatorSchema.optional(),
  })
  .strict();

export const TimelineEventProjectionSchema = z.union([
  AuthoritativeAuditEventSchema,
  TemporalOperationEventSchema,
]);

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
    temporalExecution: TemporalExecutionLinkSchema.optional(),
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
