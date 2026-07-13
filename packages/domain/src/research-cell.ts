import { z } from 'zod';
import { canonicalDigest } from './digest.js';
import {
  DigestSchema,
  EntityIdSchema,
  NonEmptyStringSchema,
  SchemaVersionSchema,
  TimestampSchema,
  UnitIntervalSchema,
  type Digest,
} from './primitives.js';

export const RESEARCH_CELL_CONTRACT_VERSION = '1.0.0';
export const MODEL_LINEAGE_POLICY_VERSION = '1.0.0';
export const RESEARCH_CELL_POLICY_VERSION = '1.0.0';

export const CriterionReferenceSchema = z
  .object({
    criterionId: EntityIdSchema,
    criterionVersion: z.number().int().positive(),
    criterionDigest: DigestSchema,
    branchId: EntityIdSchema,
    supersedesCriterionId: EntityIdSchema.optional(),
  })
  .strict();

export const ReceiptReferenceSchema = z
  .object({
    receiptId: EntityIdSchema,
    kind: z.enum([
      'model_invocation',
      'cell_completed',
      'cell_failed',
      'cell_cancelled',
      'position_admitted',
      'position_rejected',
      'review_admitted',
      'review_rejected',
      'synthesis_admitted',
      'synthesis_rejected',
    ]),
    artifactDigest: DigestSchema.optional(),
    receivedAt: TimestampSchema,
  })
  .strict();

export const ModelUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    costUsd: z.number().nonnegative().finite(),
    latencyMs: z.number().int().nonnegative(),
  })
  .strict();

export const CellOutputContractSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('positions'),
      minimumCount: z.number().int().positive(),
      schemaVersion: SchemaVersionSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('reviews'),
      targetPositionIds: z.array(EntityIdSchema).min(1),
      schemaVersion: SchemaVersionSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('dissent'),
      schemaVersion: SchemaVersionSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('synthesis'),
      allowedClaimIds: z.array(EntityIdSchema),
      schemaVersion: SchemaVersionSchema,
    })
    .strict(),
]);

export const CellTemplateSchema = z
  .object({
    id: EntityIdSchema,
    schemaVersion: z.literal(RESEARCH_CELL_CONTRACT_VERSION),
    templateVersion: z.number().int().positive(),
    kind: z.enum([
      'landscape',
      'divergence',
      'prior_art',
      'falsification',
      'experiment',
      'synthesis',
    ]),
    role: NonEmptyStringSchema,
    requiredOutput: CellOutputContractSchema,
    promptTemplateDigest: DigestSchema,
    allowedInputKinds: z
      .array(z.enum(['claim', 'evidence', 'hypothesis', 'artifact']))
      .min(1),
  })
  .strict();

export const CellInputSchema = z
  .object({
    schemaVersion: z.literal(RESEARCH_CELL_CONTRACT_VERSION),
    claimIds: z.array(EntityIdSchema),
    evidenceIds: z.array(EntityIdSchema),
    hypothesisIds: z.array(EntityIdSchema),
    artifactIds: z.array(EntityIdSchema),
  })
  .strict();

export const CellPlanSchema = z
  .object({
    id: EntityIdSchema,
    schemaVersion: z.literal(RESEARCH_CELL_CONTRACT_VERSION),
    programId: EntityIdSchema,
    workItemId: EntityIdSchema,
    templateId: EntityIdSchema,
    templateVersion: z.number().int().positive(),
    criterionRef: CriterionReferenceSchema,
    branchId: EntityIdSchema,
    input: CellInputSchema,
    inputDigest: DigestSchema,
    outputContract: CellOutputContractSchema,
    plannedAt: TimestampSchema,
  })
  .strict()
  .superRefine((plan, ctx) => {
    if (plan.branchId !== plan.criterionRef.branchId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['branchId'],
        message: 'cell branch must match criterion reference branch',
      });
    }
    if (plan.inputDigest !== cellInputDigest(plan.input)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['inputDigest'],
        message: 'cell input digest is not canonical',
      });
    }
  });

export const ModelProfileSchema = z
  .object({
    id: EntityIdSchema,
    provider: NonEmptyStringSchema,
    family: NonEmptyStringSchema,
    displayName: NonEmptyStringSchema,
    activeVersionId: EntityIdSchema.optional(),
  })
  .strict();

export const ModelLineageReferenceSchema = z
  .object({
    kind: z.enum(['known', 'unknown']),
    trainingLineageIds: z.array(EntityIdSchema),
    fineTuneLineageIds: z.array(EntityIdSchema),
    sharedDerivationIds: z.array(EntityIdSchema),
    parentVersionIds: z.array(EntityIdSchema),
    aliasOfVersionId: EntityIdSchema.optional(),
  })
  .strict()
  .superRefine((lineage, ctx) => {
    if (lineage.kind === 'unknown') {
      const fields = [
        lineage.trainingLineageIds,
        lineage.fineTuneLineageIds,
        lineage.sharedDerivationIds,
        lineage.parentVersionIds,
      ];
      if (
        fields.some((field) => field.length > 0) ||
        lineage.aliasOfVersionId
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'unknown model lineage cannot also claim concrete ancestry',
        });
      }
    }
  });

export const ModelProfileVersionSchema = z
  .object({
    id: EntityIdSchema,
    profileId: EntityIdSchema,
    schemaVersion: z.literal(RESEARCH_CELL_CONTRACT_VERSION),
    provider: NonEmptyStringSchema,
    providerModelId: NonEmptyStringSchema,
    family: NonEmptyStringSchema,
    checkpoint: NonEmptyStringSchema,
    versionLabel: NonEmptyStringSchema.optional(),
    contextWindow: z.number().int().positive(),
    modalities: z.array(NonEmptyStringSchema).min(1),
    locality: z.enum(['local', 'cloud']),
    dataPolicyId: EntityIdSchema,
    costProfileId: EntityIdSchema,
    lineage: ModelLineageReferenceSchema,
    immutableDigest: DigestSchema,
    recordedAt: TimestampSchema,
  })
  .strict()
  .superRefine((version, ctx) => {
    if (version.lineage.aliasOfVersionId === version.id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['lineage', 'aliasOfVersionId'],
        message: 'model version cannot alias itself',
      });
    }
    if (version.lineage.parentVersionIds.includes(version.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['lineage', 'parentVersionIds'],
        message: 'model version cannot parent itself',
      });
    }
    if (version.immutableDigest !== modelProfileVersionDigest(version)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['immutableDigest'],
        message: 'model profile version digest is not canonical',
      });
    }
  });

export const ProposalReferenceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('claim'), id: EntityIdSchema }).strict(),
  z.object({ kind: z.literal('evidence'), id: EntityIdSchema }).strict(),
  z.object({ kind: z.literal('hypothesis'), id: EntityIdSchema }).strict(),
  z.object({ kind: z.literal('artifact'), id: EntityIdSchema }).strict(),
]);

export const ResearchPositionSchema = z
  .object({
    id: EntityIdSchema,
    schemaVersion: z.literal(RESEARCH_CELL_CONTRACT_VERSION),
    programId: EntityIdSchema,
    cellPlanId: EntityIdSchema,
    workItemId: EntityIdSchema,
    authorAgentId: EntityIdSchema,
    role: NonEmptyStringSchema,
    criterionRef: CriterionReferenceSchema,
    modelProfileVersionId: EntityIdSchema,
    inputDigest: DigestSchema,
    outputSchemaVersion: SchemaVersionSchema,
    answer: NonEmptyStringSchema,
    claimIds: z.array(EntityIdSchema),
    evidenceIds: z.array(EntityIdSchema),
    hypothesisIds: z.array(EntityIdSchema),
    artifactIds: z.array(EntityIdSchema),
    proposalRefs: z.array(ProposalReferenceSchema),
    assumptions: z.array(NonEmptyStringSchema),
    dissent: z.array(NonEmptyStringSchema),
    proposedFalsifiers: z.array(NonEmptyStringSchema),
    usage: ModelUsageSchema,
    uncertaintyCodes: z.array(NonEmptyStringSchema),
    failureCodes: z.array(NonEmptyStringSchema),
    receiptRefs: z.array(ReceiptReferenceSchema),
    canonicalDigest: DigestSchema,
    createdAt: TimestampSchema,
  })
  .strict()
  .superRefine((position, ctx) => {
    if (position.canonicalDigest !== researchPositionDigest(position)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['canonicalDigest'],
        message: 'research position digest is not canonical',
      });
    }
  });

export const ReviewAssignmentSchema = z
  .object({
    id: EntityIdSchema,
    schemaVersion: z.literal(RESEARCH_CELL_CONTRACT_VERSION),
    programId: EntityIdSchema,
    workItemId: EntityIdSchema,
    targetPositionId: EntityIdSchema,
    reviewerAgentId: EntityIdSchema,
    reviewerModelProfileVersionId: EntityIdSchema,
    reviewerRole: NonEmptyStringSchema,
    targetAuthorAgentId: EntityIdSchema,
    targetModelProfileVersionId: EntityIdSchema,
    targetRole: NonEmptyStringSchema,
    criterionRef: CriterionReferenceSchema,
    blind: z.boolean(),
    assignedAt: TimestampSchema,
  })
  .strict();

export const ResearchReviewSchema = z
  .object({
    id: EntityIdSchema,
    schemaVersion: z.literal(RESEARCH_CELL_CONTRACT_VERSION),
    assignmentId: EntityIdSchema,
    programId: EntityIdSchema,
    workItemId: EntityIdSchema,
    targetPositionId: EntityIdSchema,
    reviewerAgentId: EntityIdSchema,
    reviewerModelProfileVersionId: EntityIdSchema,
    reviewerRole: NonEmptyStringSchema,
    criterionRef: CriterionReferenceSchema,
    inputDigest: DigestSchema,
    outputSchemaVersion: SchemaVersionSchema,
    verdict: z.enum(['admit', 'reject', 'revise', 'unresolved']),
    reasonCodes: z.array(NonEmptyStringSchema).min(1),
    checkedClaimIds: z.array(EntityIdSchema),
    checkedEvidenceIds: z.array(EntityIdSchema),
    checkedHypothesisIds: z.array(EntityIdSchema),
    checkedArtifactIds: z.array(EntityIdSchema),
    usage: ModelUsageSchema,
    uncertaintyCodes: z.array(NonEmptyStringSchema),
    failureCodes: z.array(NonEmptyStringSchema),
    receiptRefs: z.array(ReceiptReferenceSchema),
    canonicalDigest: DigestSchema,
    createdAt: TimestampSchema,
  })
  .strict()
  .superRefine((review, ctx) => {
    if (review.canonicalDigest !== researchReviewDigest(review)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['canonicalDigest'],
        message: 'research review digest is not canonical',
      });
    }
  });

export const DissentReportSchema = z
  .object({
    id: EntityIdSchema,
    schemaVersion: z.literal(RESEARCH_CELL_CONTRACT_VERSION),
    programId: EntityIdSchema,
    cellPlanId: EntityIdSchema,
    criterionRef: CriterionReferenceSchema,
    positionIds: z.array(EntityIdSchema).min(1),
    claimIds: z.array(EntityIdSchema),
    evidenceIds: z.array(EntityIdSchema),
    unresolvedReasonCodes: z.array(NonEmptyStringSchema).min(1),
    canonicalDigest: DigestSchema,
    createdAt: TimestampSchema,
  })
  .strict()
  .superRefine((report, ctx) => {
    if (report.canonicalDigest !== dissentReportDigest(report)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['canonicalDigest'],
        message: 'dissent report digest is not canonical',
      });
    }
  });

export const SynthesisArtifactSchema = z
  .object({
    id: EntityIdSchema,
    schemaVersion: z.literal(RESEARCH_CELL_CONTRACT_VERSION),
    programId: EntityIdSchema,
    cellPlanId: EntityIdSchema,
    criterionRef: CriterionReferenceSchema,
    admittedClaimIds: z.array(EntityIdSchema),
    factualSentenceClaimIds: z.array(EntityIdSchema),
    positionIds: z.array(EntityIdSchema),
    dissentReportIds: z.array(EntityIdSchema),
    unresolvedClaimIds: z.array(EntityIdSchema),
    receiptRefs: z.array(ReceiptReferenceSchema),
    canonicalDigest: DigestSchema,
    createdAt: TimestampSchema,
  })
  .strict()
  .superRefine((artifact, ctx) => {
    if (artifact.canonicalDigest !== synthesisArtifactDigest(artifact)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['canonicalDigest'],
        message: 'synthesis artifact digest is not canonical',
      });
    }
  });

export const CorrelationAssessmentSchema = z
  .object({
    id: EntityIdSchema,
    schemaVersion: z.literal(RESEARCH_CELL_CONTRACT_VERSION),
    policyVersion: z.literal(MODEL_LINEAGE_POLICY_VERSION),
    subjectModelProfileVersionId: EntityIdSchema,
    candidateModelProfileVersionId: EntityIdSchema,
    independent: z.boolean(),
    correlationScore: UnitIntervalSchema,
    reasonCodes: z.array(NonEmptyStringSchema).min(1),
    assessedAt: TimestampSchema,
    canonicalDigest: DigestSchema,
  })
  .strict()
  .superRefine((assessment, ctx) => {
    if (
      assessment.canonicalDigest !== correlationAssessmentDigest(assessment)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['canonicalDigest'],
        message: 'correlation assessment digest is not canonical',
      });
    }
  });

export const CellOutcomeSchema = z
  .object({
    id: EntityIdSchema,
    schemaVersion: z.literal(RESEARCH_CELL_CONTRACT_VERSION),
    programId: EntityIdSchema,
    cellPlanId: EntityIdSchema,
    status: z.enum(['succeeded', 'failed', 'cancelled']),
    admittedPositionIds: z.array(EntityIdSchema),
    rejectedPositionRefs: z.array(EntityIdSchema),
    admittedReviewIds: z.array(EntityIdSchema),
    rejectedReviewRefs: z.array(EntityIdSchema),
    dissentReportIds: z.array(EntityIdSchema),
    synthesisArtifactId: EntityIdSchema.optional(),
    receiptRefs: z.array(ReceiptReferenceSchema),
    failureCodes: z.array(NonEmptyStringSchema),
    canonicalDigest: DigestSchema,
    completedAt: TimestampSchema,
  })
  .strict()
  .superRefine((outcome, ctx) => {
    if (outcome.canonicalDigest !== cellOutcomeDigest(outcome)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['canonicalDigest'],
        message: 'cell outcome digest is not canonical',
      });
    }
  });

export type CriterionReference = z.infer<typeof CriterionReferenceSchema>;
export type ReceiptReference = z.infer<typeof ReceiptReferenceSchema>;
export type ModelUsage = z.infer<typeof ModelUsageSchema>;
export type CellOutputContract = z.infer<typeof CellOutputContractSchema>;
export type CellTemplate = z.infer<typeof CellTemplateSchema>;
export type CellInput = z.infer<typeof CellInputSchema>;
export type CellPlan = z.infer<typeof CellPlanSchema>;
export type ModelProfile = z.infer<typeof ModelProfileSchema>;
export type ModelLineageReference = z.infer<typeof ModelLineageReferenceSchema>;
export type ModelProfileVersion = z.infer<typeof ModelProfileVersionSchema>;
export type ProposalReference = z.infer<typeof ProposalReferenceSchema>;
export type ResearchPosition = z.infer<typeof ResearchPositionSchema>;
export type ReviewAssignment = z.infer<typeof ReviewAssignmentSchema>;
export type ResearchReview = z.infer<typeof ResearchReviewSchema>;
export type DissentReport = z.infer<typeof DissentReportSchema>;
export type SynthesisArtifact = z.infer<typeof SynthesisArtifactSchema>;
export type CorrelationAssessment = z.infer<typeof CorrelationAssessmentSchema>;
export type CellOutcome = z.infer<typeof CellOutcomeSchema>;

function digestWithoutMutableDigest(kind: string, value: object): Digest {
  const rest = { ...(value as Record<string, unknown>) };
  delete rest.canonicalDigest;
  delete rest.immutableDigest;
  return canonicalDigest({
    kind,
    schemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
    value: rest,
  });
}

export function cellInputDigest(input: CellInput): Digest {
  return canonicalDigest({
    kind: 'research-cell-input',
    schemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
    value: input,
  });
}

export function cellPlanDigest(plan: CellPlan): Digest {
  return digestWithoutMutableDigest('research-cell-plan', plan);
}

export function modelProfileVersionDigest(
  version: ModelProfileVersion,
): Digest {
  return digestWithoutMutableDigest('model-profile-version', version);
}

export function researchPositionDigest(position: ResearchPosition): Digest {
  return digestWithoutMutableDigest('research-position', position);
}

export function researchReviewDigest(review: ResearchReview): Digest {
  return digestWithoutMutableDigest('research-review', review);
}

export function dissentReportDigest(report: DissentReport): Digest {
  return digestWithoutMutableDigest('dissent-report', report);
}

export function correlationAssessmentDigest(
  assessment: CorrelationAssessment,
): Digest {
  return digestWithoutMutableDigest('correlation-assessment', assessment);
}

export function synthesisArtifactDigest(artifact: SynthesisArtifact): Digest {
  return digestWithoutMutableDigest('synthesis-artifact', artifact);
}

export function cellOutcomeDigest(outcome: CellOutcome): Digest {
  return digestWithoutMutableDigest('cell-outcome', outcome);
}

export type ModelLineageGraphResult =
  | { ok: true }
  | {
      ok: false;
      code:
        | 'dangling_model_lineage'
        | 'cyclic_model_lineage'
        | 'duplicate_model_lineage'
        | 'noncanonical_model_digest';
      message: string;
    };

export function validateModelLineageGraph(
  versions: Iterable<ModelProfileVersion>,
): ModelLineageGraphResult {
  const records = new Map<string, ModelProfileVersion>();
  for (const version of versions) {
    const parsed = ModelProfileVersionSchema.safeParse(version);
    if (!parsed.success) {
      return {
        ok: false,
        code: 'noncanonical_model_digest',
        message: parsed.error.issues.map((issue) => issue.message).join('; '),
      };
    }
    if (records.has(parsed.data.id)) {
      return {
        ok: false,
        code: 'duplicate_model_lineage',
        message: `duplicate model profile version ${parsed.data.id}`,
      };
    }
    records.set(parsed.data.id, parsed.data);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): ModelLineageGraphResult => {
    if (visiting.has(id)) {
      return {
        ok: false,
        code: 'cyclic_model_lineage',
        message: `model lineage cycle includes ${id}`,
      };
    }
    if (visited.has(id)) return { ok: true };
    const version = records.get(id);
    if (!version) {
      return {
        ok: false,
        code: 'dangling_model_lineage',
        message: `unknown model profile version ${id}`,
      };
    }
    visiting.add(id);
    const parents = [
      ...version.lineage.parentVersionIds,
      ...(version.lineage.aliasOfVersionId
        ? [version.lineage.aliasOfVersionId]
        : []),
    ];
    for (const parentId of parents) {
      const result = visit(parentId);
      if (!result.ok) return result;
    }
    visiting.delete(id);
    visited.add(id);
    return { ok: true };
  };

  for (const id of records.keys()) {
    const result = visit(id);
    if (!result.ok) return result;
  }
  return { ok: true };
}

export type CorrelationReason =
  | 'same_model_profile_version'
  | 'alias_model_version'
  | 'same_family_checkpoint'
  | 'shared_training_lineage'
  | 'shared_finetune_lineage'
  | 'shared_derivation'
  | 'ancestral_derivation'
  | 'unknown_lineage'
  | 'invalid_lineage_graph'
  | 'different_known_family';

export interface CorrelationPolicyInput {
  subject: ModelProfileVersion;
  candidate: ModelProfileVersion;
  registry: ReadonlyMap<string, ModelProfileVersion>;
  /** @deprecated Frozen v1 always treats unknown lineage as non-independent. */
  requireKnownLineageForIndependence?: boolean;
}

export interface CorrelationPolicyResult {
  independent: boolean;
  correlationScore: number;
  reasonCodes: CorrelationReason[];
}

export function assessModelCorrelation(
  input: CorrelationPolicyInput,
): CorrelationPolicyResult {
  const reasons = new Set<CorrelationReason>();
  const { subject, candidate } = input;

  const subjectRecord = input.registry.get(subject.id);
  const candidateRecord = input.registry.get(candidate.id);
  const graph = validateModelLineageGraph(input.registry.values());
  if (
    !graph.ok ||
    !ModelProfileVersionSchema.safeParse(subject).success ||
    !ModelProfileVersionSchema.safeParse(candidate).success ||
    subjectRecord?.immutableDigest !== subject.immutableDigest ||
    candidateRecord?.immutableDigest !== candidate.immutableDigest
  ) {
    return {
      independent: false,
      correlationScore: 1,
      reasonCodes: ['invalid_lineage_graph'],
    };
  }

  if (subject.id === candidate.id) reasons.add('same_model_profile_version');
  if (
    subject.lineage.aliasOfVersionId === candidate.id ||
    candidate.lineage.aliasOfVersionId === subject.id ||
    (subject.lineage.aliasOfVersionId &&
      subject.lineage.aliasOfVersionId === candidate.lineage.aliasOfVersionId)
  ) {
    reasons.add('alias_model_version');
  }
  if (
    subject.family === candidate.family &&
    subject.checkpoint === candidate.checkpoint
  ) {
    reasons.add('same_family_checkpoint');
  }
  if (
    intersects(
      subject.lineage.trainingLineageIds,
      candidate.lineage.trainingLineageIds,
    )
  ) {
    reasons.add('shared_training_lineage');
  }
  if (
    intersects(
      subject.lineage.fineTuneLineageIds,
      candidate.lineage.fineTuneLineageIds,
    )
  ) {
    reasons.add('shared_finetune_lineage');
  }
  if (
    intersects(
      subject.lineage.sharedDerivationIds,
      candidate.lineage.sharedDerivationIds,
    )
  ) {
    reasons.add('shared_derivation');
  }
  if (
    hasModelAncestry(subject.id, candidate.id, input.registry) ||
    hasModelAncestry(candidate.id, subject.id, input.registry)
  ) {
    reasons.add('ancestral_derivation');
  }
  if (
    subject.lineage.kind === 'unknown' ||
    candidate.lineage.kind === 'unknown'
  ) {
    reasons.add('unknown_lineage');
  }

  if (reasons.size === 0) reasons.add('different_known_family');

  const independent =
    ![
      'same_model_profile_version',
      'alias_model_version',
      'same_family_checkpoint',
      'shared_training_lineage',
      'shared_finetune_lineage',
      'shared_derivation',
      'ancestral_derivation',
    ].some((reason) => reasons.has(reason as CorrelationReason)) &&
    !reasons.has('unknown_lineage');

  return {
    independent,
    correlationScore: reasons.has('same_model_profile_version')
      ? 1
      : reasons.has('alias_model_version') ||
          reasons.has('same_family_checkpoint') ||
          reasons.has('ancestral_derivation')
        ? 0.9
        : reasons.has('shared_derivation') ||
            reasons.has('shared_training_lineage') ||
            reasons.has('shared_finetune_lineage')
          ? 0.75
          : reasons.has('unknown_lineage')
            ? 0.6
            : 0,
    reasonCodes: [...reasons].sort(),
  };
}

export type AdmissionReason =
  | 'schema_invalid'
  | 'missing_claim_ref'
  | 'missing_evidence_ref'
  | 'missing_hypothesis_ref'
  | 'missing_artifact_ref'
  | 'missing_receipt_ref'
  | 'receipt_ref_drift'
  | 'cell_plan_drift'
  | 'work_item_drift'
  | 'input_digest_drift'
  | 'output_schema_drift'
  | 'criterion_drift'
  | 'unapproved_criterion_branch'
  | 'unknown_model_lineage'
  | 'self_review'
  | 'correlated_review'
  | 'correlation_policy_drift'
  | 'noncanonical_digest'
  | 'synthesis_non_admitted_claim'
  | 'synthesis_unknown_position'
  | 'admitted_on_branch'
  | 'admitted';

export type PolicyDecision<T> =
  | {
      ok: true;
      value: T;
      reasonCodes: ['admitted'] | ['admitted_on_branch'];
    }
  | { ok: false; rejected: unknown; reasonCodes: AdmissionReason[] };

export interface ReferenceUniverse {
  programId: string;
  cellPlanId: string;
  workItemId: string;
  inputDigest: string;
  outputSchemaVersion: string;
  criterionRef: CriterionReference;
  allowedCriterionBranches?: readonly CriterionReference[];
  claimIds: ReadonlySet<string>;
  evidenceIds: ReadonlySet<string>;
  hypothesisIds: ReadonlySet<string>;
  artifactIds: ReadonlySet<string>;
  receiptRefs: ReadonlyMap<string, ReceiptReference>;
  modelVersions: ReadonlyMap<string, ModelProfileVersion>;
}

export function admitResearchPosition(
  raw: unknown,
  universe: ReferenceUniverse,
): PolicyDecision<ResearchPosition> {
  const parsed = ResearchPositionSchema.safeParse(raw);
  if (!parsed.success) {
    const reasonCodes: AdmissionReason[] = parsed.error.issues.some((issue) =>
      issue.message.includes('digest'),
    )
      ? ['schema_invalid', 'noncanonical_digest']
      : ['schema_invalid'];
    return { ok: false, rejected: raw, reasonCodes };
  }
  const position = parsed.data;
  const reasons = commonProposalReasons(position, universe);
  const typedIds = {
    claim: new Set(position.claimIds),
    evidence: new Set(position.evidenceIds),
    hypothesis: new Set(position.hypothesisIds),
    artifact: new Set(position.artifactIds),
  };
  for (const proposal of position.proposalRefs) {
    const known =
      proposal.kind === 'claim'
        ? universe.claimIds.has(proposal.id)
        : proposal.kind === 'evidence'
          ? universe.evidenceIds.has(proposal.id)
          : proposal.kind === 'hypothesis'
            ? universe.hypothesisIds.has(proposal.id)
            : universe.artifactIds.has(proposal.id);
    if (!known) {
      reasons.push(
        proposal.kind === 'claim'
          ? 'missing_claim_ref'
          : proposal.kind === 'evidence'
            ? 'missing_evidence_ref'
            : proposal.kind === 'hypothesis'
              ? 'missing_hypothesis_ref'
              : 'missing_artifact_ref',
      );
    }
    if (!typedIds[proposal.kind].has(proposal.id)) {
      reasons.push('schema_invalid');
    }
  }
  if (!universe.modelVersions.has(position.modelProfileVersionId)) {
    reasons.push('unknown_model_lineage');
  }
  return reasons.length === 0
    ? {
        ok: true,
        value: position,
        reasonCodes: admissionSuccessReasons(position, universe),
      }
    : { ok: false, rejected: position, reasonCodes: uniqueReasons(reasons) };
}

export function admitResearchReview(input: {
  raw: unknown;
  assignment: ReviewAssignment;
  universe: ReferenceUniverse;
}): PolicyDecision<ResearchReview> {
  const parsed = ResearchReviewSchema.safeParse(input.raw);
  if (!parsed.success) {
    const reasonCodes: AdmissionReason[] = parsed.error.issues.some((issue) =>
      issue.message.includes('digest'),
    )
      ? ['schema_invalid', 'noncanonical_digest']
      : ['schema_invalid'];
    return { ok: false, rejected: input.raw, reasonCodes };
  }
  const review = parsed.data;
  const reasons = commonRefsReasons(
    review,
    input.universe,
    review.checkedClaimIds,
    review.checkedEvidenceIds,
    review.checkedHypothesisIds,
    review.checkedArtifactIds,
  );
  const assignment = ReviewAssignmentSchema.parse(input.assignment);
  if (
    assignment.reviewerAgentId === assignment.targetAuthorAgentId ||
    assignment.reviewerModelProfileVersionId ===
      assignment.targetModelProfileVersionId ||
    (assignment.reviewerRole === assignment.targetRole &&
      (assignment.reviewerAgentId === assignment.targetAuthorAgentId ||
        assignment.reviewerModelProfileVersionId ===
          assignment.targetModelProfileVersionId))
  ) {
    reasons.push('self_review');
  }
  if (
    review.assignmentId !== assignment.id ||
    review.programId !== assignment.programId ||
    review.workItemId !== assignment.workItemId ||
    review.reviewerAgentId !== assignment.reviewerAgentId ||
    review.reviewerModelProfileVersionId !==
      assignment.reviewerModelProfileVersionId ||
    review.reviewerRole !== assignment.reviewerRole ||
    review.targetPositionId !== assignment.targetPositionId ||
    !criterionRefsEqual(review.criterionRef, assignment.criterionRef)
  ) {
    reasons.push('schema_invalid');
  }
  const reviewer = input.universe.modelVersions.get(
    assignment.reviewerModelProfileVersionId,
  );
  const target = input.universe.modelVersions.get(
    assignment.targetModelProfileVersionId,
  );
  if (!reviewer || !target) {
    reasons.push('unknown_model_lineage');
  } else {
    const correlation = assessModelCorrelation({
      subject: reviewer,
      candidate: target,
      registry: input.universe.modelVersions,
      requireKnownLineageForIndependence: true,
    });
    if (!correlation.independent) reasons.push('correlated_review');
  }
  return reasons.length === 0
    ? {
        ok: true,
        value: review,
        reasonCodes: admissionSuccessReasons(review, input.universe),
      }
    : { ok: false, rejected: review, reasonCodes: uniqueReasons(reasons) };
}

export function admitCorrelationAssessment(input: {
  raw: unknown;
  modelVersions: ReadonlyMap<string, ModelProfileVersion>;
}): PolicyDecision<CorrelationAssessment> {
  const parsed = CorrelationAssessmentSchema.safeParse(input.raw);
  if (!parsed.success) {
    const reasonCodes: AdmissionReason[] = parsed.error.issues.some((issue) =>
      issue.message.includes('digest'),
    )
      ? ['schema_invalid', 'noncanonical_digest']
      : ['schema_invalid'];
    return { ok: false, rejected: input.raw, reasonCodes };
  }
  const assessment = parsed.data;
  const subject = input.modelVersions.get(
    assessment.subjectModelProfileVersionId,
  );
  const candidate = input.modelVersions.get(
    assessment.candidateModelProfileVersionId,
  );
  if (!subject || !candidate) {
    return {
      ok: false,
      rejected: assessment,
      reasonCodes: ['unknown_model_lineage'],
    };
  }
  const recomputed = assessModelCorrelation({
    subject,
    candidate,
    registry: input.modelVersions,
  });
  if (
    assessment.independent !== recomputed.independent ||
    assessment.correlationScore !== recomputed.correlationScore ||
    !sameStringSet(assessment.reasonCodes, recomputed.reasonCodes)
  ) {
    return {
      ok: false,
      rejected: assessment,
      reasonCodes: ['correlation_policy_drift'],
    };
  }
  return { ok: true, value: assessment, reasonCodes: ['admitted'] };
}

export function admitSynthesis(input: {
  raw: unknown;
  universe: ReferenceUniverse;
  admittedClaimIds: ReadonlySet<string>;
  admittedPositionIds: ReadonlySet<string>;
}): PolicyDecision<SynthesisArtifact> {
  const parsed = SynthesisArtifactSchema.safeParse(input.raw);
  if (!parsed.success) {
    const reasonCodes: AdmissionReason[] = parsed.error.issues.some((issue) =>
      issue.message.includes('digest'),
    )
      ? ['schema_invalid', 'noncanonical_digest']
      : ['schema_invalid'];
    return { ok: false, rejected: input.raw, reasonCodes };
  }
  const artifact = parsed.data;
  const reasons = commonRefsReasons(
    artifact,
    input.universe,
    artifact.admittedClaimIds,
    [],
    [],
    [],
  );
  if (artifact.cellPlanId !== input.universe.cellPlanId) {
    reasons.push('cell_plan_drift');
  }
  for (const claimId of [
    ...artifact.admittedClaimIds,
    ...artifact.factualSentenceClaimIds,
  ]) {
    if (!input.admittedClaimIds.has(claimId)) {
      reasons.push('synthesis_non_admitted_claim');
    }
  }
  for (const positionId of artifact.positionIds) {
    if (!input.admittedPositionIds.has(positionId)) {
      reasons.push('synthesis_unknown_position');
    }
  }
  return reasons.length === 0
    ? {
        ok: true,
        value: artifact,
        reasonCodes: admissionSuccessReasons(artifact, input.universe),
      }
    : { ok: false, rejected: artifact, reasonCodes: uniqueReasons(reasons) };
}

export interface ProposalAudit<T> {
  admitted: T[];
  rejected: { proposal: unknown; reasonCodes: AdmissionReason[] }[];
}

export function evaluatePositionProposals(
  proposals: readonly unknown[],
  universe: ReferenceUniverse,
): ProposalAudit<ResearchPosition> {
  const admitted: ResearchPosition[] = [];
  const rejected: { proposal: unknown; reasonCodes: AdmissionReason[] }[] = [];
  for (const proposal of proposals) {
    const result = admitResearchPosition(proposal, universe);
    if (result.ok) admitted.push(result.value);
    else
      rejected.push({
        proposal: result.rejected,
        reasonCodes: result.reasonCodes,
      });
  }
  return { admitted, rejected };
}

function commonProposalReasons(
  position: ResearchPosition,
  universe: ReferenceUniverse,
): AdmissionReason[] {
  const reasons = commonRefsReasons(
    position,
    universe,
    position.claimIds,
    position.evidenceIds,
    position.hypothesisIds,
    position.artifactIds,
  );
  if (position.cellPlanId !== universe.cellPlanId)
    reasons.push('cell_plan_drift');
  if (position.workItemId !== universe.workItemId)
    reasons.push('work_item_drift');
  if (position.inputDigest !== universe.inputDigest)
    reasons.push('input_digest_drift');
  if (position.outputSchemaVersion !== universe.outputSchemaVersion)
    reasons.push('output_schema_drift');
  return reasons;
}

function commonRefsReasons(
  value: {
    programId: string;
    criterionRef: CriterionReference;
    inputDigest?: string;
  },
  universe: ReferenceUniverse,
  claimIds: readonly string[],
  evidenceIds: readonly string[],
  hypothesisIds: readonly string[],
  artifactIds: readonly string[],
): AdmissionReason[] {
  const reasons: AdmissionReason[] = [];
  if (value.programId !== universe.programId) reasons.push('schema_invalid');
  if (!criterionRefsEqual(value.criterionRef, universe.criterionRef)) {
    const allowedBranch = (universe.allowedCriterionBranches ?? []).some(
      (branch) => criterionRefsEqual(value.criterionRef, branch),
    );
    if (!allowedBranch) reasons.push('criterion_drift');
  }
  for (const claimId of claimIds) {
    if (!universe.claimIds.has(claimId)) reasons.push('missing_claim_ref');
  }
  for (const evidenceId of evidenceIds) {
    if (!universe.evidenceIds.has(evidenceId))
      reasons.push('missing_evidence_ref');
  }
  for (const hypothesisId of hypothesisIds) {
    if (!universe.hypothesisIds.has(hypothesisId))
      reasons.push('missing_hypothesis_ref');
  }
  for (const artifactId of artifactIds) {
    if (!universe.artifactIds.has(artifactId))
      reasons.push('missing_artifact_ref');
  }
  if ('receiptRefs' in value && Array.isArray(value.receiptRefs)) {
    for (const receipt of value.receiptRefs as readonly ReceiptReference[]) {
      const known = universe.receiptRefs.get(receipt.receiptId);
      if (!known) reasons.push('missing_receipt_ref');
      else if (canonicalDigest(known) !== canonicalDigest(receipt))
        reasons.push('receipt_ref_drift');
    }
  }
  return reasons;
}

function admissionSuccessReasons(
  value: { criterionRef: CriterionReference },
  universe: ReferenceUniverse,
): ['admitted'] | ['admitted_on_branch'] {
  return criterionRefsEqual(value.criterionRef, universe.criterionRef)
    ? ['admitted']
    : ['admitted_on_branch'];
}

function criterionRefsEqual(
  left: CriterionReference,
  right: CriterionReference,
): boolean {
  return (
    left.criterionId === right.criterionId &&
    left.criterionVersion === right.criterionVersion &&
    left.criterionDigest === right.criterionDigest &&
    left.branchId === right.branchId
  );
}

function intersects(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const rightSet = new Set(right);
  return left.some((entry) => rightSet.has(entry));
}

function sameStringSet(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

function hasModelAncestry(
  subjectId: string,
  maybeAncestorId: string,
  registry: ReadonlyMap<string, ModelProfileVersion>,
): boolean {
  const visit = (id: string, seen: Set<string>): boolean => {
    if (seen.has(id)) return false;
    seen.add(id);
    const record = registry.get(id);
    if (!record) return false;
    const parents = [
      ...record.lineage.parentVersionIds,
      ...(record.lineage.aliasOfVersionId
        ? [record.lineage.aliasOfVersionId]
        : []),
    ];
    if (parents.includes(maybeAncestorId)) return true;
    return parents.some((parentId) => visit(parentId, seen));
  };
  return visit(subjectId, new Set());
}

function uniqueReasons(reasons: readonly AdmissionReason[]): AdmissionReason[] {
  return [...new Set(reasons)].sort();
}
