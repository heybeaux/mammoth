import {
  canonicalDigest,
  DomainPolicyPackSchema,
  PlanAcceptanceReceiptSchema,
  PlanRevisionRecordSchema,
  ResearchPlanProposalSchema,
  ResearchPlanSchema,
  type DomainPolicyPack,
  type PlanAcceptanceReceipt,
  type PlanFieldGroup,
  type PlanRevisionRecord,
  type ResearchDomainPackId,
  type ResearchPlan,
  type ResearchPlanProposal,
} from '@mammoth/domain';
import { GovernanceError } from './common.js';

export const P9_PLAN_ACCEPTANCE_POLICY_ID = 'p9-plan-acceptance/v1';

export interface PlanAcceptanceThresholds {
  readonly minSubquestions: number;
  readonly minSourceClasses: number;
  readonly minContradictionRequirements: number;
  readonly maxAuthorizedUsd: number;
  readonly minQuestionDerivedTerms: number;
}

const QUESTION_TOKEN = /[a-z0-9][a-z0-9-]*/gu;
const STOPWORD_TOKENS = new Set([
  'about',
  'after',
  'allow',
  'been',
  'before',
  'being',
  'between',
  'could',
  'current',
  'does',
  'from',
  'have',
  'into',
  'many',
  'more',
  'most',
  'much',
  'over',
  'should',
  'some',
  'than',
  'that',
  'their',
  'them',
  'there',
  'these',
  'they',
  'this',
  'those',
  'under',
  'until',
  'were',
  'what',
  'when',
  'where',
  'which',
  'while',
  'whose',
  'will',
  'with',
  'without',
  'would',
]);

export function materialQuestionTerms(question: string): readonly string[] {
  QUESTION_TOKEN.lastIndex = 0;
  const terms: string[] = [];
  for (const match of question.toLowerCase().matchAll(QUESTION_TOKEN)) {
    const token = match[0];
    if (token.length < 4 || STOPWORD_TOKENS.has(token)) continue;
    if (!terms.includes(token)) terms.push(token);
  }
  return terms;
}

type PlanContent = Pick<
  ResearchPlanProposal,
  | 'question'
  | 'domainPackId'
  | 'packDigest'
  | 'scope'
  | 'subquestions'
  | 'coverageRequirements'
  | 'sourceClassTargets'
  | 'searchQueries'
  | 'contradictionRequirements'
  | 'freshnessRequirements'
  | 'stopCriteria'
  | 'reportOutline'
  | 'budget'
  | 'criticalClaimPolicy'
  | 'derivations'
>;

export function planFieldGroupContent(
  content: PlanContent,
  group: PlanFieldGroup,
): string {
  switch (group) {
    case 'scope':
      return JSON.stringify({
        content: content.scope,
        derivation: content.derivations.scope,
      });
    case 'subquestions':
      return JSON.stringify({
        content: content.subquestions,
        derivation: content.derivations.subquestions,
      });
    case 'coverage':
      return JSON.stringify({
        content: content.coverageRequirements,
        derivation: content.derivations.coverage,
      });
    case 'source_classes':
      return JSON.stringify({
        content: content.sourceClassTargets,
        derivation: content.derivations.source_classes,
      });
    case 'search_queries':
      return JSON.stringify({
        content: content.searchQueries,
        derivation: content.derivations.search_queries,
      });
    case 'contradictions':
      return JSON.stringify({
        content: content.contradictionRequirements,
        derivation: content.derivations.contradictions,
      });
    case 'freshness':
      return JSON.stringify({
        content: content.freshnessRequirements,
        derivation: content.derivations.freshness,
      });
    case 'stop_criteria':
      return JSON.stringify({
        content: content.stopCriteria,
        derivation: content.derivations.stop_criteria,
      });
    case 'outline':
      return JSON.stringify({
        content: content.reportOutline,
        derivation: content.derivations.outline,
      });
    case 'budget':
      return JSON.stringify({
        content: content.budget,
        derivation: content.derivations.budget,
      });
  }
}

const PLAN_FIELD_GROUPS: readonly PlanFieldGroup[] = [
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
];

const QUESTION_DERIVED_GROUPS: readonly PlanFieldGroup[] = [
  'scope',
  'subquestions',
  'search_queries',
];

export function changedPlanFieldGroups(
  before: PlanContent,
  after: PlanContent,
): readonly PlanFieldGroup[] {
  return PLAN_FIELD_GROUPS.filter(
    (group) =>
      planFieldGroupContent(before, group) !==
      planFieldGroupContent(after, group),
  );
}

function makePack(
  content: Omit<
    DomainPolicyPack,
    'schemaVersion' | 'contractFamily' | 'packDigest'
  >,
): DomainPolicyPack {
  const identity = {
    schemaVersion: '1.0.0' as const,
    contractFamily: 'p9.v1' as const,
    ...content,
  };
  return DomainPolicyPackSchema.parse({
    ...identity,
    packDigest: canonicalDigest(identity),
  });
}

export const P9_DOMAIN_POLICY_PACKS: Readonly<
  Record<ResearchDomainPackId, DomainPolicyPack>
> = {
  'general-web/v1': makePack({
    packId: 'general-web/v1',
    description:
      'General public-web research without a specialized evidence hierarchy.',
    requiredSourceClasses: ['primary_source', 'independent_analysis'],
    minimumIndependentSourcesForCriticalClaims: 2,
    evidenceHierarchy: [
      'primary_source',
      'independent_analysis',
      'secondary_reporting',
    ],
    uncertaintyLanguageRequired: true,
    rightsHandling: 'default_quotation_policy',
    evaluatorMethods: ['plan_relative_coverage', 'independent_entailment'],
    forbiddenTemplateVocabulary: [],
  }),
  'technical-due-diligence/v1': makePack({
    packId: 'technical-due-diligence/v1',
    description:
      'Code, documentation, vendor, and security due diligence for technical systems.',
    requiredSourceClasses: [
      'repository_code',
      'repository_docs',
      'security_advisory',
    ],
    minimumIndependentSourcesForCriticalClaims: 2,
    evidenceHierarchy: [
      'repository_code',
      'peer_reviewed_or_primary_technical',
      'hardware_vendor_docs',
      'repository_docs',
    ],
    uncertaintyLanguageRequired: true,
    rightsHandling: 'default_quotation_policy',
    evaluatorMethods: [
      'plan_relative_coverage',
      'independent_entailment',
      'claimed_vs_reproduced_check',
    ],
    forbiddenTemplateVocabulary: [
      'data center',
      'data centers',
      'short-term rental',
      'short-term-rental',
      'microplastic',
    ],
  }),
  'public-policy/v1': makePack({
    packId: 'public-policy/v1',
    description:
      'Legislation, implementation, outcome, and stakeholder analysis for public policy.',
    requiredSourceClasses: [
      'legislation',
      'official_statistics',
      'affected_stakeholder',
    ],
    minimumIndependentSourcesForCriticalClaims: 2,
    evidenceHierarchy: [
      'legislation',
      'official_statistics',
      'independent_evaluation',
      'government_implementation',
      'affected_stakeholder',
    ],
    uncertaintyLanguageRequired: true,
    rightsHandling: 'default_quotation_policy',
    evaluatorMethods: [
      'plan_relative_coverage',
      'independent_entailment',
      'stakeholder_disagreement_preservation',
    ],
    forbiddenTemplateVocabulary: [
      'data center',
      'data centers',
      'colibri',
      'microplastic',
    ],
  }),
  'scientific-review/v1': makePack({
    packId: 'scientific-review/v1',
    description:
      'Systematic scientific evidence review with explicit causal limits.',
    requiredSourceClasses: [
      'systematic_review',
      'human_primary_study',
      'critical_commentary',
    ],
    minimumIndependentSourcesForCriticalClaims: 2,
    evidenceHierarchy: [
      'systematic_review',
      'human_primary_study',
      'methods_validation',
      'mechanistic_primary_study',
      'critical_commentary',
    ],
    uncertaintyLanguageRequired: true,
    rightsHandling: 'strict_quotation',
    evaluatorMethods: [
      'plan_relative_coverage',
      'independent_entailment',
      'risk_of_bias_assessment',
    ],
    forbiddenTemplateVocabulary: [
      'data center',
      'data centers',
      'colibri',
      'short-term rental',
      'short-term-rental',
    ],
  }),
};

function stringValues(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value))
    return value.flatMap((entry) => stringValues(entry));
  if (value && typeof value === 'object')
    return Object.values(value).flatMap((entry) => stringValues(entry));
  return [];
}

function fieldStringValues(
  content: PlanContent,
  group: PlanFieldGroup,
): string[] {
  switch (group) {
    case 'scope':
      return stringValues(content.scope);
    case 'subquestions':
      return stringValues(content.subquestions);
    case 'coverage':
      return stringValues(content.coverageRequirements);
    case 'source_classes':
      return stringValues(content.sourceClassTargets);
    case 'search_queries':
      return stringValues(content.searchQueries);
    case 'contradictions':
      return stringValues(content.contradictionRequirements);
    case 'freshness':
      return stringValues(content.freshnessRequirements);
    case 'stop_criteria':
      return stringValues(content.stopCriteria);
    case 'outline':
      return stringValues(content.reportOutline);
    case 'budget':
      return [];
  }
}

export function validateResearchPlanProposal(
  proposal: ResearchPlanProposal,
  pack: DomainPolicyPack,
  thresholds: PlanAcceptanceThresholds,
): readonly string[] {
  const reasons = new Set<string>();
  if (proposal.domainPackId !== pack.packId) reasons.add('pack_id_mismatch');
  if (proposal.packDigest !== pack.packDigest)
    reasons.add('pack_digest_mismatch');

  if (proposal.subquestions.length < thresholds.minSubquestions)
    reasons.add('subquestions_below_minimum');
  if (proposal.sourceClassTargets.length < thresholds.minSourceClasses)
    reasons.add('source_classes_below_minimum');
  if (
    proposal.contradictionRequirements.length <
    thresholds.minContradictionRequirements
  )
    reasons.add('contradictions_below_minimum');
  if (proposal.budget.currencyUsd > thresholds.maxAuthorizedUsd)
    reasons.add('budget_exceeds_authorized');

  const targetClasses = new Set(
    proposal.sourceClassTargets.map((target) => target.sourceClass),
  );
  for (const required of pack.requiredSourceClasses) {
    if (!targetClasses.has(required))
      reasons.add(`pack_required_source_class_missing:${required}`);
  }

  const coveredSubquestions = new Set(
    proposal.coverageRequirements.map((coverage) => coverage.subquestionId),
  );
  const queriedSubquestions = new Set(
    proposal.searchQueries.flatMap((query) => query.subquestionIds),
  );
  for (const subquestion of proposal.subquestions) {
    if (!subquestion.mandatory) continue;
    if (!coveredSubquestions.has(subquestion.subquestionId))
      reasons.add(`subquestion_uncovered:${subquestion.subquestionId}`);
    if (!queriedSubquestions.has(subquestion.subquestionId))
      reasons.add(`subquestion_unqueried:${subquestion.subquestionId}`);
  }

  const questionTokens = new Set(materialQuestionTerms(proposal.question));
  const verifiedQuestionTerms = new Set<string>();
  for (const group of PLAN_FIELD_GROUPS) {
    const derivation = proposal.derivations[group];
    if (
      QUESTION_DERIVED_GROUPS.includes(group) &&
      derivation.source !== 'question'
    ) {
      reasons.add(`group_not_question_derived:${group}`);
    }
    if (group === 'budget' && derivation.source !== 'operator') {
      reasons.add('budget_not_operator_authorized');
    }
    if (derivation.source !== 'question') continue;
    const groupTokens = new Set(
      materialQuestionTerms(fieldStringValues(proposal, group).join(' ')),
    );
    for (const term of derivation.questionTerms) {
      const normalized = term.toLowerCase();
      if (!questionTokens.has(normalized)) {
        reasons.add(`derivation_term_not_in_question:${group}`);
        continue;
      }
      if (!groupTokens.has(normalized)) {
        reasons.add(`derivation_term_not_in_group_content:${group}`);
        continue;
      }
      verifiedQuestionTerms.add(normalized);
    }
  }
  if (verifiedQuestionTerms.size < thresholds.minQuestionDerivedTerms)
    reasons.add('insufficient_question_derivation');

  const corpus = PLAN_FIELD_GROUPS.map((group) =>
    planFieldGroupContent(proposal, group),
  )
    .join('\n')
    .toLowerCase();
  const question = proposal.question.toLowerCase();
  for (const term of pack.forbiddenTemplateVocabulary) {
    const normalized = term.toLowerCase();
    if (question.includes(normalized)) continue;
    if (corpus.includes(normalized))
      reasons.add(`template_vocabulary:${normalized}`);
  }

  return [...reasons].sort();
}

export interface PlanAcceptanceInput {
  readonly proposal: ResearchPlanProposal;
  readonly thresholds: PlanAcceptanceThresholds;
  readonly decidedAt: string;
  readonly actorId: string;
  readonly planId?: string;
}

export interface PlanAcceptanceResult {
  readonly receipt: PlanAcceptanceReceipt;
  readonly plan: ResearchPlan | null;
}

function planContent(proposal: ResearchPlanProposal): PlanContent {
  return {
    question: proposal.question,
    domainPackId: proposal.domainPackId,
    packDigest: proposal.packDigest,
    scope: proposal.scope,
    subquestions: proposal.subquestions,
    coverageRequirements: proposal.coverageRequirements,
    sourceClassTargets: proposal.sourceClassTargets,
    searchQueries: proposal.searchQueries,
    contradictionRequirements: proposal.contradictionRequirements,
    freshnessRequirements: proposal.freshnessRequirements,
    stopCriteria: proposal.stopCriteria,
    reportOutline: proposal.reportOutline,
    budget: proposal.budget,
    criticalClaimPolicy: proposal.criticalClaimPolicy,
    derivations: proposal.derivations,
  };
}

function makeReceipt(input: {
  proposal: ResearchPlanProposal;
  pack: DomainPolicyPack;
  thresholds: PlanAcceptanceThresholds;
  decision: 'accepted' | 'rejected';
  planId: string | null;
  planDigest: string | null;
  reasonCodes: readonly string[];
  decidedAt: string;
  actorId: string;
}): PlanAcceptanceReceipt {
  const receipt = {
    schemaVersion: '1.0.0' as const,
    contractFamily: 'p9.v1' as const,
    receiptId: `plan-receipt:${input.proposal.proposalId}:${input.decidedAt}`,
    proposalId: input.proposal.proposalId,
    proposalDigest: input.proposal.proposalDigest,
    packId: input.pack.packId,
    packDigest: input.pack.packDigest,
    decision: input.decision,
    planId: input.planId,
    planDigest: input.planDigest,
    reasonCodes: [...input.reasonCodes],
    policyThresholds: {
      minSubquestions: input.thresholds.minSubquestions,
      minSourceClasses: input.thresholds.minSourceClasses,
      minContradictionRequirements:
        input.thresholds.minContradictionRequirements,
      maxAuthorizedUsd: input.thresholds.maxAuthorizedUsd,
      minQuestionDerivedTerms: input.thresholds.minQuestionDerivedTerms,
    },
    acceptancePolicyId: P9_PLAN_ACCEPTANCE_POLICY_ID,
    decidedAt: input.decidedAt,
    actorId: input.actorId,
  };
  return PlanAcceptanceReceiptSchema.parse({
    ...receipt,
    receiptDigest: canonicalDigest(receipt),
  });
}

function acceptResearchPlanInternal(
  input: PlanAcceptanceInput & { readonly previousPlan?: ResearchPlan },
): PlanAcceptanceResult {
  const proposal = ResearchPlanProposalSchema.parse(input.proposal);
  const pack = P9_DOMAIN_POLICY_PACKS[proposal.domainPackId];
  const reasons = validateResearchPlanProposal(
    proposal,
    pack,
    input.thresholds,
  );
  if (reasons.length > 0) {
    return {
      receipt: makeReceipt({
        proposal,
        pack,
        thresholds: input.thresholds,
        decision: 'rejected',
        planId: null,
        planDigest: null,
        reasonCodes: reasons,
        decidedAt: input.decidedAt,
        actorId: input.actorId,
      }),
      plan: null,
    };
  }

  const plan = {
    schemaVersion: '1.0.0' as const,
    contractFamily: 'p9.v1' as const,
    planId: input.planId ?? `plan:${proposal.proposalId}`,
    revision: input.previousPlan ? input.previousPlan.revision + 1 : 1,
    previousPlanDigest: input.previousPlan?.planDigest ?? null,
    proposalId: proposal.proposalId,
    proposalDigest: proposal.proposalDigest,
    ...planContent(proposal),
    acceptancePolicyId: P9_PLAN_ACCEPTANCE_POLICY_ID,
    acceptedAt: input.decidedAt,
    acceptedBy: input.actorId,
  };
  const accepted = ResearchPlanSchema.parse({
    ...plan,
    planDigest: canonicalDigest(plan),
  });
  return {
    receipt: makeReceipt({
      proposal,
      pack,
      thresholds: input.thresholds,
      decision: 'accepted',
      planId: accepted.planId,
      planDigest: accepted.planDigest,
      reasonCodes: ['plan_policy_satisfied'],
      decidedAt: input.decidedAt,
      actorId: input.actorId,
    }),
    plan: accepted,
  };
}

export function acceptResearchPlan(
  input: PlanAcceptanceInput,
): PlanAcceptanceResult {
  return acceptResearchPlanInternal(input);
}

export interface ResearchPlanPreview {
  readonly proposalId: string;
  readonly proposalDigest: string;
  readonly question: string;
  readonly domainPackId: ResearchDomainPackId;
  readonly subquestions: readonly string[];
  readonly sourceClasses: readonly string[];
  readonly contradictions: readonly string[];
  readonly outlineSections: readonly string[];
  readonly budget: ResearchPlanProposal['budget'];
  readonly previewDigest: string;
}

export function previewResearchPlan(
  input: ResearchPlanProposal,
): ResearchPlanPreview {
  const proposal = ResearchPlanProposalSchema.parse(input);
  const preview = {
    proposalId: proposal.proposalId,
    proposalDigest: proposal.proposalDigest,
    question: proposal.question,
    domainPackId: proposal.domainPackId,
    subquestions: proposal.subquestions.map((entry) => entry.question),
    sourceClasses: proposal.sourceClassTargets.map(
      (entry) => entry.sourceClass,
    ),
    contradictions: proposal.contradictionRequirements.map(
      (entry) => entry.contradictionId,
    ),
    outlineSections: proposal.reportOutline.sections.map(
      (entry) => entry.sectionId,
    ),
    budget: proposal.budget,
  };
  return { ...preview, previewDigest: canonicalDigest(preview) };
}

export interface PlanRevisionInput {
  readonly currentPlan: ResearchPlan;
  readonly proposal: ResearchPlanProposal;
  readonly thresholds: PlanAcceptanceThresholds;
  readonly decidedAt: string;
  readonly actorId: string;
}

export interface PlanRevisionResult extends PlanAcceptanceResult {
  readonly revisionRecord: PlanRevisionRecord | null;
}

export function reviseResearchPlan(
  input: PlanRevisionInput,
): PlanRevisionResult {
  const currentPlan = ResearchPlanSchema.parse(input.currentPlan);
  const proposal = ResearchPlanProposalSchema.parse(input.proposal);
  if (
    proposal.domainPackId !== currentPlan.domainPackId ||
    proposal.packDigest !== currentPlan.packDigest
  )
    throw new GovernanceError(
      'plan_revision_authority_changed',
      'domain pack changes require a new accepted plan',
    );
  const changedFieldGroups = changedPlanFieldGroups(
    currentPlan,
    planContent(proposal),
  );
  if (proposal.question !== currentPlan.question)
    throw new GovernanceError(
      'plan_revision_question_changed',
      'a new question requires a new plan, not a revision',
    );
  if (changedFieldGroups.length === 0) {
    const pack = P9_DOMAIN_POLICY_PACKS[proposal.domainPackId];
    return {
      receipt: makeReceipt({
        proposal,
        pack,
        thresholds: input.thresholds,
        decision: 'rejected',
        planId: null,
        planDigest: null,
        reasonCodes: ['revision_without_material_change'],
        decidedAt: input.decidedAt,
        actorId: input.actorId,
      }),
      plan: null,
      revisionRecord: null,
    };
  }
  const result = acceptResearchPlanInternal({
    proposal,
    thresholds: input.thresholds,
    decidedAt: input.decidedAt,
    actorId: input.actorId,
    planId: currentPlan.planId,
    previousPlan: currentPlan,
  });
  if (result.plan === null) return { ...result, revisionRecord: null };
  const record = {
    schemaVersion: '1.0.0' as const,
    contractFamily: 'p9.v1' as const,
    revisionId: `plan-revision:${result.plan.planId}:${String(result.plan.revision)}`,
    previousPlanId: currentPlan.planId,
    previousPlanDigest: currentPlan.planDigest,
    newPlanId: result.plan.planId,
    newPlanDigest: result.plan.planDigest,
    changedFieldGroups: [...changedFieldGroups],
    invalidatesDownstreamWork: true as const,
    revisedAt: input.decidedAt,
    actorId: input.actorId,
  };
  return {
    ...result,
    revisionRecord: PlanRevisionRecordSchema.parse({
      ...record,
      revisionDigest: canonicalDigest(record),
    }),
  };
}
