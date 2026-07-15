import { z } from 'zod';
import { canonicalDigest } from './digest.js';

const DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const NonNegativeFiniteSchema = z.number().finite().nonnegative();
const NonNegativeIntegerSchema = z.number().int().nonnegative();
const PositiveIntegerSchema = z.number().int().positive();

export const P9_PLANNING_CONTRACT_FAMILY = 'p9.v1' as const;

export const ResearchDomainPackIdSchema = z.enum([
  'general-web/v1',
  'technical-due-diligence/v1',
  'public-policy/v1',
  'scientific-review/v1',
]);
export type ResearchDomainPackId = z.infer<typeof ResearchDomainPackIdSchema>;

export const DomainPolicyPackSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    contractFamily: z.literal(P9_PLANNING_CONTRACT_FAMILY),
    packId: ResearchDomainPackIdSchema,
    description: z.string().min(1),
    requiredSourceClasses: z.array(z.string().min(1)),
    minimumIndependentSourcesForCriticalClaims: PositiveIntegerSchema,
    evidenceHierarchy: z.array(z.string().min(1)).min(1),
    uncertaintyLanguageRequired: z.boolean(),
    rightsHandling: z.enum(['default_quotation_policy', 'strict_quotation']),
    evaluatorMethods: z.array(z.string().min(1)).min(1),
    forbiddenTemplateVocabulary: z.array(z.string().min(1)),
    packDigest: DigestSchema,
  })
  .strict()
  .superRefine((pack, context) => {
    const identity = { ...pack, packDigest: undefined };
    if (pack.packDigest !== canonicalDigest(identity)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['packDigest'],
        message: 'domain policy pack digest must bind the exact pack content',
      });
    }
  });
export type DomainPolicyPack = z.infer<typeof DomainPolicyPackSchema>;

export const ResearchExclusionSchema = z
  .object({
    exclusionId: z.string().min(1),
    statement: z.string().min(1),
  })
  .strict();
export type ResearchExclusion = z.infer<typeof ResearchExclusionSchema>;

export const ResearchScopeSchema = z
  .object({
    include: z.array(z.string().min(1)).min(1),
    exclusions: z.array(ResearchExclusionSchema),
  })
  .strict();
export type ResearchScope = z.infer<typeof ResearchScopeSchema>;

export const PlanFieldGroupSchema = z.enum([
  'scope',
  'subquestions',
  'coverage',
  'source_classes',
  'search_queries',
  'contradictions',
  'freshness',
  'stop_criteria',
  'outline',
  'budget',
]);
export type PlanFieldGroup = z.infer<typeof PlanFieldGroupSchema>;

export const PlanFieldDerivationSchema = z
  .object({
    source: z.enum(['question', 'domain_pack', 'operator']),
    questionTerms: z.array(z.string().min(1)),
  })
  .strict()
  .superRefine((derivation, context) => {
    if (
      derivation.source === 'question' &&
      derivation.questionTerms.length === 0
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['questionTerms'],
        message: 'question-derived fields must name at least one question term',
      });
    }
    if (
      derivation.source !== 'question' &&
      derivation.questionTerms.length > 0
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['questionTerms'],
        message: 'only question-derived fields may claim question terms',
      });
    }
  });
export type PlanFieldDerivation = z.infer<typeof PlanFieldDerivationSchema>;

export const PlanDerivationMapSchema = z
  .object({
    scope: PlanFieldDerivationSchema,
    subquestions: PlanFieldDerivationSchema,
    coverage: PlanFieldDerivationSchema,
    source_classes: PlanFieldDerivationSchema,
    search_queries: PlanFieldDerivationSchema,
    contradictions: PlanFieldDerivationSchema,
    freshness: PlanFieldDerivationSchema,
    stop_criteria: PlanFieldDerivationSchema,
    outline: PlanFieldDerivationSchema,
    budget: PlanFieldDerivationSchema,
  })
  .strict();
export type PlanDerivationMap = z.infer<typeof PlanDerivationMapSchema>;

export const PlannedSubquestionSchema = z
  .object({
    subquestionId: z.string().min(1),
    question: z.string().min(1),
    mandatory: z.boolean(),
  })
  .strict();
export type PlannedSubquestion = z.infer<typeof PlannedSubquestionSchema>;

export const CoverageRequirementSchema = z
  .object({
    coverageId: z.string().min(1),
    subquestionId: z.string().min(1),
    description: z.string().min(1),
    mandatory: z.boolean(),
  })
  .strict();
export type CoverageRequirement = z.infer<typeof CoverageRequirementSchema>;

export const SourceClassTargetSchema = z
  .object({
    sourceClass: z.string().min(1),
    minimumIndependentSources: PositiveIntegerSchema,
    mandatory: z.boolean(),
  })
  .strict();
export type SourceClassTarget = z.infer<typeof SourceClassTargetSchema>;

export const PlannedSearchQuerySchema = z
  .object({
    queryId: z.string().min(1),
    query: z.string().min(1),
    subquestionIds: z.array(z.string().min(1)).min(1),
  })
  .strict();
export type PlannedSearchQuery = z.infer<typeof PlannedSearchQuerySchema>;

export const ContradictionRequirementSchema = z
  .object({
    contradictionId: z.string().min(1),
    description: z.string().min(1),
  })
  .strict();
export type ContradictionRequirement = z.infer<
  typeof ContradictionRequirementSchema
>;

export const FreshnessRequirementSchema = z
  .object({
    freshnessId: z.string().min(1),
    appliesTo: z.string().min(1),
    maxAgeDays: PositiveIntegerSchema.nullable(),
    asOfDateRequired: z.boolean(),
  })
  .strict()
  .superRefine((freshness, context) => {
    if (freshness.maxAgeDays === null && !freshness.asOfDateRequired) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'freshness requirement must bound age or require an as-of date',
      });
    }
  });
export type FreshnessRequirement = z.infer<typeof FreshnessRequirementSchema>;

export const StopCriterionSchema = z
  .object({
    stopId: z.string().min(1),
    description: z.string().min(1),
  })
  .strict();
export type StopCriterion = z.infer<typeof StopCriterionSchema>;

export const ReportOutlineSchema = z
  .object({
    sections: z
      .array(
        z
          .object({
            sectionId: z.string().min(1),
            title: z.string().min(1),
          })
          .strict(),
      )
      .min(3),
  })
  .strict();
export type ReportOutline = z.infer<typeof ReportOutlineSchema>;

export const PlanBudgetAllocationSchema = z
  .object({
    currencyUsd: z.number().finite().positive(),
    searchUsd: NonNegativeFiniteSchema,
    retrievalParsingUsd: NonNegativeFiniteSchema,
    modelsUsd: NonNegativeFiniteSchema,
  })
  .strict()
  .superRefine((budget, context) => {
    const allocated =
      budget.searchUsd + budget.retrievalParsingUsd + budget.modelsUsd;
    if (allocated > budget.currencyUsd) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'budget allocation cannot exceed the total authorized amount',
      });
    }
  });
export type PlanBudgetAllocation = z.infer<typeof PlanBudgetAllocationSchema>;

export const P9CriticalClaimPolicySchema = z.enum([
  'independent_entailment_distinct_profile_family',
]);
export type P9CriticalClaimPolicy = z.infer<typeof P9CriticalClaimPolicySchema>;

export const PlanProposerWorkRefSchema = z
  .object({
    workId: z.string().min(1),
    workDigest: DigestSchema,
    rawResponseDigest: DigestSchema,
    role: z.literal('plan_proposer'),
    profileVersionId: z.string().min(1),
    profileFamilyId: z.string().min(1),
  })
  .strict();
export type PlanProposerWorkRef = z.infer<typeof PlanProposerWorkRefSchema>;

const planContentShape = {
  question: z.string().min(1),
  domainPackId: ResearchDomainPackIdSchema,
  packDigest: DigestSchema,
  scope: ResearchScopeSchema,
  subquestions: z.array(PlannedSubquestionSchema).min(1),
  coverageRequirements: z.array(CoverageRequirementSchema).min(1),
  sourceClassTargets: z.array(SourceClassTargetSchema).min(1),
  searchQueries: z.array(PlannedSearchQuerySchema).min(1),
  contradictionRequirements: z.array(ContradictionRequirementSchema),
  freshnessRequirements: z.array(FreshnessRequirementSchema).min(1),
  stopCriteria: z.array(StopCriterionSchema).min(1),
  reportOutline: ReportOutlineSchema,
  budget: PlanBudgetAllocationSchema,
  criticalClaimPolicy: P9CriticalClaimPolicySchema,
  derivations: PlanDerivationMapSchema,
};

function uniqueIds(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function addPlanContentIssues(
  content: {
    subquestions: readonly PlannedSubquestion[];
    coverageRequirements: readonly CoverageRequirement[];
    searchQueries: readonly PlannedSearchQuery[];
    sourceClassTargets: readonly SourceClassTarget[];
  },
  context: z.RefinementCtx,
): void {
  const subquestionIds = content.subquestions.map(
    (entry) => entry.subquestionId,
  );
  if (!uniqueIds(subquestionIds)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['subquestions'],
      message: 'subquestion ids must be unique',
    });
  }
  if (
    !uniqueIds(content.sourceClassTargets.map((entry) => entry.sourceClass))
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['sourceClassTargets'],
      message: 'source class targets must be unique',
    });
  }
  const knownSubquestions = new Set(subquestionIds);
  for (const coverage of content.coverageRequirements) {
    if (!knownSubquestions.has(coverage.subquestionId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['coverageRequirements'],
        message: `coverage ${coverage.coverageId} references unknown subquestion`,
      });
    }
  }
  for (const query of content.searchQueries) {
    for (const subquestionId of query.subquestionIds) {
      if (!knownSubquestions.has(subquestionId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['searchQueries'],
          message: `query ${query.queryId} references unknown subquestion`,
        });
      }
    }
  }
}

export const ResearchPlanProposalSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    contractFamily: z.literal(P9_PLANNING_CONTRACT_FAMILY),
    proposalId: z.string().min(1),
    ...planContentShape,
    proposerWork: PlanProposerWorkRefSchema,
    proposedAt: z.string().datetime(),
    proposalDigest: DigestSchema,
  })
  .strict()
  .superRefine((proposal, context) => {
    addPlanContentIssues(proposal, context);
    const identity = { ...proposal, proposalDigest: undefined };
    if (proposal.proposalDigest !== canonicalDigest(identity)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['proposalDigest'],
        message: 'proposal digest must bind the exact proposed plan content',
      });
    }
  });
export type ResearchPlanProposal = z.infer<typeof ResearchPlanProposalSchema>;

export const ResearchPlanSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    contractFamily: z.literal(P9_PLANNING_CONTRACT_FAMILY),
    planId: z.string().min(1),
    revision: PositiveIntegerSchema,
    previousPlanDigest: DigestSchema.nullable(),
    proposalId: z.string().min(1),
    proposalDigest: DigestSchema,
    ...planContentShape,
    acceptancePolicyId: z.string().min(1),
    acceptedAt: z.string().datetime(),
    acceptedBy: z.string().min(1),
    planDigest: DigestSchema,
  })
  .strict()
  .superRefine((plan, context) => {
    addPlanContentIssues(plan, context);
    if (plan.revision === 1 && plan.previousPlanDigest !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['previousPlanDigest'],
        message: 'first plan revision cannot reference a previous plan',
      });
    }
    if (plan.revision > 1 && plan.previousPlanDigest === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['previousPlanDigest'],
        message: 'later plan revisions must link the previous plan digest',
      });
    }
    const identity = { ...plan, planDigest: undefined };
    if (plan.planDigest !== canonicalDigest(identity)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['planDigest'],
        message: 'plan digest must bind the exact accepted immutable plan',
      });
    }
  });
export type ResearchPlan = z.infer<typeof ResearchPlanSchema>;

export const PlanAcceptanceReceiptSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    contractFamily: z.literal(P9_PLANNING_CONTRACT_FAMILY),
    receiptId: z.string().min(1),
    proposalId: z.string().min(1),
    proposalDigest: DigestSchema,
    packId: ResearchDomainPackIdSchema,
    packDigest: DigestSchema,
    decision: z.enum(['accepted', 'rejected']),
    planId: z.string().min(1).nullable(),
    planDigest: DigestSchema.nullable(),
    reasonCodes: z.array(z.string().min(1)).min(1),
    policyThresholds: z
      .object({
        minSubquestions: PositiveIntegerSchema,
        minSourceClasses: PositiveIntegerSchema,
        minContradictionRequirements: NonNegativeIntegerSchema,
        maxAuthorizedUsd: z.number().finite().positive(),
        minQuestionDerivedTerms: PositiveIntegerSchema,
      })
      .strict(),
    acceptancePolicyId: z.string().min(1),
    decidedAt: z.string().datetime(),
    actorId: z.string().min(1),
    receiptDigest: DigestSchema,
  })
  .strict()
  .superRefine((receipt, context) => {
    const accepted = receipt.decision === 'accepted';
    if (accepted && (receipt.planId === null || receipt.planDigest === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'accepted plan receipt must bind the accepted plan identity',
      });
    }
    if (!accepted && (receipt.planId !== null || receipt.planDigest !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'rejected plan receipt cannot claim an accepted plan',
      });
    }
    const identity = { ...receipt, receiptDigest: undefined };
    if (receipt.receiptDigest !== canonicalDigest(identity)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['receiptDigest'],
        message: 'receipt digest must bind the complete acceptance decision',
      });
    }
  });
export type PlanAcceptanceReceipt = z.infer<typeof PlanAcceptanceReceiptSchema>;

export const PlanRevisionRecordSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    contractFamily: z.literal(P9_PLANNING_CONTRACT_FAMILY),
    revisionId: z.string().min(1),
    previousPlanId: z.string().min(1),
    previousPlanDigest: DigestSchema,
    newPlanId: z.string().min(1),
    newPlanDigest: DigestSchema,
    changedFieldGroups: z.array(PlanFieldGroupSchema).min(1),
    invalidatesDownstreamWork: z.literal(true),
    revisedAt: z.string().datetime(),
    actorId: z.string().min(1),
    revisionDigest: DigestSchema,
  })
  .strict()
  .superRefine((record, context) => {
    if (record.previousPlanDigest === record.newPlanDigest) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['newPlanDigest'],
        message: 'plan revision must change the plan identity',
      });
    }
    const identity = { ...record, revisionDigest: undefined };
    if (record.revisionDigest !== canonicalDigest(identity)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['revisionDigest'],
        message: 'revision digest must bind the complete revision record',
      });
    }
  });
export type PlanRevisionRecord = z.infer<typeof PlanRevisionRecordSchema>;
