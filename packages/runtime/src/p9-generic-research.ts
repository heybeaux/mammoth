import { createHash } from 'node:crypto';
import {
  canonicalDigest,
  DomainPolicyPackSchema,
  PlanAcceptanceReceiptSchema,
  ResearchPlanProposalSchema,
  ResearchPlanSchema,
  RetrievalAttemptSchema,
  ParserReceiptSchema,
  P9ClaimAdmissionSchema,
  P9ClaimProposalSchema,
  P9EntailmentVerdictSchema,
  P9ExecutionReceiptSchema,
  P9ReportManifestSchema,
  PlanCoverageAssessmentSchema,
  type DomainPolicyPack,
  type EffectRequestCeiling,
  type P9BudgetVector,
  type P9ClaimAdmission,
  type P9ClaimProposal,
  type P9EntailmentVerdict,
  type P9ExecutionReceipt,
  type P9ModelWorkRef,
  type P9ReportManifest,
  type P9ReportSection,
  type P9ReportSentence,
  type ParserReceipt,
  type PlanAcceptanceReceipt,
  type ProviderPriceCatalog,
  type PlanCoverageAssessment,
  type ResearchPlan,
  type ResearchPlanProposal,
  type RetrievalAttempt,
  type RetrievalFailure,
} from '@mammoth/domain';
import {
  assertEveryP9FactualSentenceAdmitted,
  containsP9HostileInstruction,
  evaluateP9ClaimAdmission,
} from '@mammoth/evidence';
import {
  assessPlanCoverage,
  isClaimRelevantToPlan,
  P9BudgetAuthority,
  P9_DOMAIN_POLICY_PACKS,
  P9_PLAN_ACCEPTANCE_POLICY_ID,
  PlanCoverageThresholdsSchema,
  P9CoverageEvidenceRecordSchema,
  priceCatalogDigest,
  type P9ClaimEvidenceBinding,
  type P9BudgetAuthoritySnapshot,
  type P9StopCriterionFinding,
  type PlanCoverageThresholds,
} from '@mammoth/governance';
import {
  buildTruthfulRetrievalAttempt,
  makeNotCheckedRobotsDecision,
  makeUnknownRightsStatus,
  P9RetrievalResidueLedger,
} from '@mammoth/retrieval';
import { z } from 'zod';

export const P9_GENERIC_RESEARCH_POLICY_ID = 'p9-generic-plan-execution/v1';
const ROBOTS_POLICY_ID = 'p9-offline-fixture-robots/v1';
const RIGHTS_POLICY_ID = 'p9-offline-fixture-rights/v1';
const DATE_POLICY_ID = 'p9-date-extraction/v1';
const USER_AGENT = 'mammoth-research/0.9';
const PARSER_ID = 'p9-fixture-text-parser';
const PARSER_VERSION = '1.0.0';
const COORDINATE_SPACE = 'utf16-code-units/v1';

export class P9GenericResearchError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'P9GenericResearchError';
  }
}

const CorpusDateSchema = z
  .object({
    extractionMethod: z.enum([
      'http_header',
      'html_metadata',
      'json_ld',
      'document_text',
      'operator_supplied',
    ]),
    exactLocator: z.string().min(1),
    sourceValue: z.string().min(1),
    normalizedValue: z.string().datetime(),
  })
  .strict();

const CorpusSourceOutcomeSchema = z.enum([
  'admitted',
  'timed_out',
  'denied',
  'rate_limited',
  'parser_failed',
]);

const CorpusSourceSchema = z
  .object({
    candidateId: z.string().min(1),
    sourceClass: z.string().min(1),
    sourceFamilyId: z.string().min(1),
    url: z.string().url(),
    mediaType: z.string().min(1),
    outcome: CorpusSourceOutcomeSchema,
    publishedAt: CorpusDateSchema.nullable(),
    body: z.string().min(1).nullable(),
  })
  .strict()
  .superRefine((source, context) => {
    if ((source.outcome === 'admitted') !== (source.body !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'admitted corpus sources require a body and failures forbid one',
      });
    }
    if (source.outcome !== 'admitted' && source.publishedAt !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'failed corpus sources cannot declare publication metadata',
      });
    }
  });

const CorpusClaimSchema = z
  .object({
    claimId: z.string().min(1),
    candidateId: z.string().min(1),
    subquestionIds: z.array(z.string().min(1)).min(1),
    claimGroupId: z.string().min(1),
    critical: z.boolean(),
    sectionId: z.string().min(1),
    quote: z.string().min(1),
    statement: z.string().min(1),
    evaluatorVerdict: z.enum(['entailed', 'contradicted', 'insufficient']),
    contradictionIds: z.array(z.string().min(1)),
    rejectionSeed: z
      .enum(['copied_evaluator_response', 'same_profile_version'])
      .nullable(),
  })
  .strict();

const CorpusStopBaseSchema = z
  .object({
    stopId: z.string().min(1),
    basis: z.enum([
      'subquestions_accounted',
      'critical_corroboration',
      'section_admitted_claims',
      'budget_terminal',
    ]),
    sectionId: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((base, context) => {
    if (base.basis === 'section_admitted_claims' && !base.sectionId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'section_admitted_claims basis requires a section identity',
      });
    }
  });

export const P9OfflineCorpusSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    contractFamily: z.literal('p9.v1'),
    corpusId: z.string().min(1),
    planFixture: z.string().min(1),
    corpusPolicy: z.string().min(1),
    sources: z.array(CorpusSourceSchema).min(1),
    claims: z.array(CorpusClaimSchema).min(1),
    stopCriterionBases: z.array(CorpusStopBaseSchema),
    unknownCostCandidateId: z.string().min(1).nullable(),
  })
  .strict()
  .superRefine((corpus, context) => {
    const sourcesById = new Map(
      corpus.sources.map((source) => [source.candidateId, source]),
    );
    if (sourcesById.size !== corpus.sources.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sources'],
        message: 'corpus candidate identities must be unique',
      });
    }
    const claimIds = new Set(corpus.claims.map((claim) => claim.claimId));
    if (claimIds.size !== corpus.claims.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['claims'],
        message: 'corpus claim identities must be unique',
      });
    }
    for (const claim of corpus.claims) {
      const source = sourcesById.get(claim.candidateId);
      if (!source || source.outcome !== 'admitted' || source.body === null) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['claims'],
          message: `claim ${claim.claimId} must quote an admitted corpus source`,
        });
        continue;
      }
      if (!source.body.includes(claim.quote)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['claims'],
          message: `claim ${claim.claimId} quote is not verbatim in its source body`,
        });
      }
    }
    if (
      corpus.unknownCostCandidateId !== null &&
      !sourcesById.has(corpus.unknownCostCandidateId)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['unknownCostCandidateId'],
        message: 'unknown-cost candidate must reference a corpus source',
      });
    }
  });
export type P9OfflineCorpus = z.infer<typeof P9OfflineCorpusSchema>;

export interface P9GenericResearchInput {
  readonly planProposal: ResearchPlanProposal;
  readonly plan: ResearchPlan;
  readonly acceptanceReceipt: PlanAcceptanceReceipt;
  readonly pack: DomainPolicyPack;
  readonly corpus: unknown;
  readonly thresholds: PlanCoverageThresholds;
  readonly executionId: string;
  readonly now: string;
}

export interface P9GenericResearchRun {
  readonly corpusId: string;
  readonly attempts: readonly RetrievalAttempt[];
  readonly parserReceipts: readonly ParserReceipt[];
  readonly proposals: readonly P9ClaimProposal[];
  readonly verdicts: readonly P9EntailmentVerdict[];
  readonly admissions: readonly P9ClaimAdmission[];
  readonly bindings: readonly P9ClaimEvidenceBinding[];
  readonly assessment: PlanCoverageAssessment;
  readonly manifest: P9ReportManifest;
  readonly report: string;
  readonly receipt: P9ExecutionReceipt;
  readonly artifacts: Readonly<Record<string, string>>;
}

export interface P9ObservedSourceSnapshot {
  readonly candidateId: string;
  readonly body: string;
  readonly sourceClass: string;
  readonly sourceFamilyId: string;
}

export interface P9ObservedResearchInput {
  readonly executionId: string;
  readonly now: string;
  readonly planProposal: ResearchPlanProposal;
  readonly plan: ResearchPlan;
  readonly acceptanceReceipt: PlanAcceptanceReceipt;
  readonly pack: DomainPolicyPack;
  readonly thresholds: PlanCoverageThresholds;
  readonly budgetSnapshot: P9BudgetAuthoritySnapshot;
  readonly attempts: readonly RetrievalAttempt[];
  readonly parserReceipts: readonly ParserReceipt[];
  readonly proposals: readonly P9ClaimProposal[];
  readonly verdicts: readonly P9EntailmentVerdict[];
  readonly admissions: readonly P9ClaimAdmission[];
  readonly bindings: readonly P9ClaimEvidenceBinding[];
  readonly snapshots: readonly P9ObservedSourceSnapshot[];
  readonly stopCriterionFindings: readonly P9StopCriterionFinding[];
  readonly narrativeSections?: Readonly<
    Record<
      string,
      { readonly lead: string; readonly claimIds: readonly string[] }
    >
  >;
}

function assertReadableNarrative(
  sections: readonly P9ReportSection[],
  required: boolean,
  boundedChangeEvidenceAvailable: boolean,
): void {
  if (!required) return;
  const byId = new Map(sections.map((section) => [section.sectionId, section]));
  for (const section of sections) {
    const lead = section.sentences.find(
      (sentence) => sentence.kind === 'interpretive',
    );
    if (!lead)
      throw new P9GenericResearchError(
        'report_narrative_missing',
        `${section.sectionId} lacks narrative synthesis`,
      );
    if (
      lead.text.length < 24 ||
      lead.text.length > 600 ||
      /Interpretive synthesis for|\{\{|\}\}|\[\[|\]\]|<\|/u.test(lead.text)
    ) {
      throw new P9GenericResearchError(
        'report_narrative_unreadable',
        `${section.sectionId} contains placeholder, raw, or unbounded narrative`,
      );
    }
    for (const factual of section.sentences.filter(
      (sentence) => sentence.kind === 'factual',
    )) {
      if (
        factual.text.length > 600 ||
        /chat_template_jinja|<\|(?:system|user|assistant|tool)|\\n\{%-|"availableInferenceProviders"/u.test(
          factual.text,
        )
      ) {
        throw new P9GenericResearchError(
          'report_evidence_unreadable',
          `${factual.sentenceId} contains an oversized or raw-serialization evidence span`,
        );
      }
    }
  }
  const leadText = (sectionId: string): string =>
    byId
      .get(sectionId)
      ?.sentences.find((sentence) => sentence.kind === 'interpretive')?.text ??
    '';
  const executive = leadText('executive_summary');
  const change = leadText('first_bounded_change');
  const experiment = leadText('experiment_design');
  const criticalSectionClaimIds = (sectionId: string): readonly string[] =>
    byId
      .get(sectionId)
      ?.sentences.filter((sentence) => sentence.kind === 'factual')
      .flatMap((sentence) => sentence.claimIds) ?? [];
  if (
    executive.length < 80 ||
    change.length < 80 ||
    experiment.length < 80 ||
    (boundedChangeEvidenceAvailable &&
      criticalSectionClaimIds('first_bounded_change').length === 0) ||
    !/(test|change|implement|optimi[sz])/iu.test(change) ||
    !/(current state|currently|today).*(proposed|change|instead|rather than|from)/iu.test(
      change,
    ) ||
    !/(add|introduce|replace|remove|modify|implement)/iu.test(change) ||
    !/(flag|harness|benchmark|test|function|kernel|configuration|mode|check)/iu.test(
      change,
    ) ||
    /(?:verification|optimization) path/iu.test(change) ||
    !/(warm[- ]?up)/iu.test(experiment) ||
    !/(repeat|repetition|paired run)/iu.test(experiment) ||
    !/(confidence|statistical|bootstrap|t-test|wilcoxon)/iu.test(experiment) ||
    !/(minimum|threshold|at least|greater than|exceed)/iu.test(experiment) ||
    !/(pass|accept).*(fail|reject)/iu.test(experiment) ||
    !/\d/u.test(experiment)
  ) {
    throw new P9GenericResearchError(
      'report_synthesis_incomplete',
      'report must answer the question, name a bounded change, and describe a noise-resistant experiment',
    );
  }
}

export interface P9AcceptedPlanChain {
  readonly planProposal: ResearchPlanProposal;
  readonly plan: ResearchPlan;
  readonly acceptanceReceipt: PlanAcceptanceReceipt;
  readonly pack: DomainPolicyPack;
}

const P9SerializedEvidenceSourceSchema = z
  .object({
    candidateId: z.string().min(1),
    attemptId: z.string().min(1),
    requestedUrl: z.string().url(),
    sourceClass: z.string().min(1),
    sourceFamilyId: z.string().min(1),
    snapshotDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  })
  .strict();

const P9SerializedEntailmentRecordSchema = z
  .object({
    verdict: P9EntailmentVerdictSchema,
    admission: P9ClaimAdmissionSchema,
  })
  .strict();

const P9SerializedClaimEvidenceSchema = z
  .object({
    proposalId: z.string().min(1),
    evidence: P9CoverageEvidenceRecordSchema,
  })
  .strict();

function p9PlanContentProjection(value: ResearchPlanProposal | ResearchPlan) {
  return {
    question: value.question,
    domainPackId: value.domainPackId,
    packDigest: value.packDigest,
    scope: value.scope,
    subquestions: value.subquestions,
    coverageRequirements: value.coverageRequirements,
    sourceClassTargets: value.sourceClassTargets,
    searchQueries: value.searchQueries,
    contradictionRequirements: value.contradictionRequirements,
    freshnessRequirements: value.freshnessRequirements,
    stopCriteria: value.stopCriteria,
    reportOutline: value.reportOutline,
    budget: value.budget,
    criticalClaimPolicy: value.criticalClaimPolicy,
    derivations: value.derivations,
  };
}

/**
 * Validates the exact immutable proposal -> accepted plan -> receipt -> policy
 * pack chain before an application is allowed to consider external effects.
 */
export function assertP9AcceptedPlanChain(input: {
  readonly planProposal: unknown;
  readonly plan: unknown;
  readonly acceptanceReceipt: unknown;
  readonly pack: unknown;
}): P9AcceptedPlanChain {
  const planProposalResult = ResearchPlanProposalSchema.safeParse(
    input.planProposal,
  );
  const planResult = ResearchPlanSchema.safeParse(input.plan);
  const receiptResult = PlanAcceptanceReceiptSchema.safeParse(
    input.acceptanceReceipt,
  );
  const packResult = DomainPolicyPackSchema.safeParse(input.pack);
  if (
    !planProposalResult.success ||
    !planResult.success ||
    !receiptResult.success ||
    !packResult.success
  ) {
    throw new P9GenericResearchError(
      'plan_binding_mismatch',
      'execution requires a schema-valid accepted plan contract',
    );
  }
  const planProposal = planProposalResult.data;
  const plan = planResult.data;
  const acceptanceReceipt = receiptResult.data;
  const pack = packResult.data;
  if (
    acceptanceReceipt.decision !== 'accepted' ||
    acceptanceReceipt.proposalId !== planProposal.proposalId ||
    acceptanceReceipt.proposalDigest !== planProposal.proposalDigest ||
    acceptanceReceipt.planId !== plan.planId ||
    acceptanceReceipt.planDigest !== plan.planDigest ||
    acceptanceReceipt.packId !== pack.packId ||
    acceptanceReceipt.packDigest !== pack.packDigest ||
    acceptanceReceipt.packId !== planProposal.domainPackId ||
    acceptanceReceipt.packDigest !== planProposal.packDigest ||
    acceptanceReceipt.packId !== plan.domainPackId ||
    acceptanceReceipt.packDigest !== plan.packDigest ||
    plan.proposalId !== planProposal.proposalId ||
    plan.proposalDigest !== planProposal.proposalDigest ||
    plan.domainPackId !== pack.packId ||
    plan.packDigest !== pack.packDigest ||
    plan.acceptancePolicyId !== P9_PLAN_ACCEPTANCE_POLICY_ID ||
    acceptanceReceipt.acceptancePolicyId !== P9_PLAN_ACCEPTANCE_POLICY_ID ||
    plan.acceptedAt !== acceptanceReceipt.decidedAt ||
    plan.acceptedBy !== acceptanceReceipt.actorId ||
    canonicalDigest(p9PlanContentProjection(planProposal)) !==
      canonicalDigest(p9PlanContentProjection(plan))
  ) {
    throw new P9GenericResearchError(
      'plan_binding_mismatch',
      'execution requires the exact accepted plan, proposal, receipt, actor, time, policy, and pack chain',
    );
  }
  return { planProposal, plan, acceptanceReceipt, pack };
}

export interface P9ExactBundleVerification {
  readonly manifest: P9ReportManifest;
  readonly receipt: P9ExecutionReceipt;
  readonly verifiedCitationCount: number;
}

const RETRIEVAL_FAILURES: Readonly<Record<string, RetrievalFailure>> = {
  timed_out: {
    code: 'transport_timeout',
    message: 'source transport exceeded its bounded deadline',
    retryable: true,
    policyEffect: 'retry_bounded',
  },
  denied: {
    code: 'robots_denied',
    message: 'robots policy denied acquisition for this origin',
    retryable: false,
    policyEffect: 'fail_closed',
  },
  rate_limited: {
    code: 'provider_rate_limited',
    message: 'provider rate limited the acquisition request',
    retryable: true,
    policyEffect: 'retry_bounded',
  },
  parser_failed: {
    code: 'parser_output_invalid',
    message: 'bounded parser could not produce valid output',
    retryable: false,
    policyEffect: 'fail_closed',
  },
};

function sha256Text(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

export function boundedP9SentenceContext(
  body: string,
  startOffset: number,
  endOffset: number,
): string {
  const priorBoundary = Math.max(
    body.lastIndexOf('.', Math.max(0, startOffset - 1)),
    body.lastIndexOf('!', Math.max(0, startOffset - 1)),
    body.lastIndexOf('?', Math.max(0, startOffset - 1)),
    body.lastIndexOf('\n', Math.max(0, startOffset - 1)),
  );
  const lastSelected = body[endOffset - 1];
  const endsAtBoundary =
    lastSelected === '.' ||
    lastSelected === '!' ||
    lastSelected === '?' ||
    lastSelected === '\n';
  const following = endsAtBoundary
    ? endOffset
    : [
        body.indexOf('.', endOffset),
        body.indexOf('!', endOffset),
        body.indexOf('?', endOffset),
        body.indexOf('\n', endOffset),
      ].filter((index) => index >= 0);
  const contextEnd =
    typeof following === 'number'
      ? following
      : following.length === 0
        ? body.length
        : Math.min(...following) + 1;
  return body.slice(priorBoundary + 1, contextEnd).trim();
}

function round12(value: number): number {
  return Math.round(value * 1e12) / 1e12;
}

function ceiling(input: Partial<EffectRequestCeiling>): EffectRequestCeiling {
  return {
    requests: 1,
    inputTokens: 0,
    outputTokens: 0,
    bytes: 0,
    durationMs: 1,
    attempts: 1,
    parserClass: null,
    ...input,
  };
}

function actual(input: Partial<P9BudgetVector>): P9BudgetVector {
  return {
    currencyUsd: 0,
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    bytes: 0,
    durationMs: 0,
    ...input,
  };
}

function buildCatalog(): ProviderPriceCatalog {
  const entries = [
    {
      id: 'search-fixture',
      provider: 'fixture-search',
      effectKind: 'search' as const,
      parserClass: null,
      flatCostUsd: 0,
      costPerRequestUsd: 0.02,
      costPerInputTokenUsd: 0,
      costPerOutputTokenUsd: 0,
      costPerByteUsd: 0,
    },
    {
      id: 'retrieval-fixture',
      provider: 'fixture-transport',
      effectKind: 'retrieval' as const,
      parserClass: null,
      flatCostUsd: 0,
      costPerRequestUsd: 0.01,
      costPerInputTokenUsd: 0,
      costPerOutputTokenUsd: 0,
      costPerByteUsd: 1e-9,
    },
    {
      id: 'parser-text-fixture',
      provider: 'fixture-parser',
      effectKind: 'parser' as const,
      parserClass: 'text/plain',
      flatCostUsd: 0,
      costPerRequestUsd: 0.005,
      costPerInputTokenUsd: 0,
      costPerOutputTokenUsd: 0,
      costPerByteUsd: 0,
    },
    {
      id: 'model-proposer-fixture',
      provider: 'fixture-model-alpha',
      effectKind: 'model' as const,
      parserClass: null,
      flatCostUsd: 0,
      costPerRequestUsd: 0,
      costPerInputTokenUsd: 1e-6,
      costPerOutputTokenUsd: 4e-6,
      costPerByteUsd: 0,
    },
    {
      id: 'model-evaluator-fixture',
      provider: 'fixture-model-beta',
      effectKind: 'model' as const,
      parserClass: null,
      flatCostUsd: 0,
      costPerRequestUsd: 0,
      costPerInputTokenUsd: 1e-6,
      costPerOutputTokenUsd: 4e-6,
      costPerByteUsd: 0,
    },
  ];
  const identity = {
    schemaVersion: '1.0.0' as const,
    contractFamily: 'p9.v1' as const,
    catalogId: 'p9-offline-fixture-catalog',
    version: '1.0.0',
    entries,
  };
  return { ...identity, catalogDigest: priceCatalogDigest(identity) };
}

function proposerWork(claimId: string): P9ModelWorkRef {
  return {
    workId: `work:proposer:${claimId}`,
    workDigest: canonicalDigest({ proposerWork: claimId }),
    rawResponseDigest: canonicalDigest({ proposerRaw: claimId }),
    role: 'claim_proposer',
    profileVersionId: 'proposer-profile-v1',
    profileFamilyId: 'proposer-family-alpha',
  };
}

function evaluatorWork(
  claimId: string,
  seed: 'copied_evaluator_response' | 'same_profile_version' | null,
): P9ModelWorkRef {
  return {
    workId: `work:evaluator:${claimId}`,
    workDigest: canonicalDigest({ evaluatorWork: claimId }),
    rawResponseDigest:
      seed === 'copied_evaluator_response'
        ? canonicalDigest({ proposerRaw: claimId })
        : canonicalDigest({ evaluatorRaw: claimId }),
    role: 'entailment_evaluator',
    profileVersionId:
      seed === 'same_profile_version'
        ? 'proposer-profile-v1'
        : 'evaluator-profile-v2',
    profileFamilyId: 'evaluator-family-beta',
  };
}

/**
 * Composes an accepted research plan with an explicitly labelled offline source
 * corpus: pre-transport budget reservations, truthful acquisition residue,
 * bounded parsing, independent entailment admission, plan-relative coverage,
 * and a report manifest whose factual sentences all carry admitted claim IDs.
 * The corpus proposes; deterministic code validates, admits, and accounts.
 */
export function runP9PlanDrivenResearch(
  input: P9GenericResearchInput,
): P9GenericResearchRun {
  const corpus = P9OfflineCorpusSchema.parse(input.corpus);
  const thresholdsResult = PlanCoverageThresholdsSchema.safeParse(
    input.thresholds,
  );
  const { executionId, now } = input;
  if (
    !z.string().min(1).safeParse(executionId).success ||
    !z.string().datetime().safeParse(now).success
  ) {
    throw new P9GenericResearchError(
      'execution_input_invalid',
      'execution identity and clock must be valid before budgeted work',
    );
  }
  if (!thresholdsResult.success) {
    throw new P9GenericResearchError(
      'plan_binding_mismatch',
      'execution requires a schema-valid accepted plan contract',
    );
  }
  const { planProposal, plan, acceptanceReceipt, pack } =
    assertP9AcceptedPlanChain(input);
  const thresholds = thresholdsResult.data;
  const reportSectionIds = new Set(
    plan.reportOutline.sections.map((section) => section.sectionId),
  );
  for (const claim of corpus.claims) {
    if (!reportSectionIds.has(claim.sectionId)) {
      throw new P9GenericResearchError(
        'corpus_report_section_invalid',
        `claim ${claim.claimId} targets report section ${claim.sectionId} outside the accepted plan outline`,
      );
    }
  }

  const authority = new P9BudgetAuthority(
    {
      accountId: `account:${executionId}`,
      programId: executionId,
      catalog: buildCatalog(),
      limit: {
        currencyUsd: plan.budget.currencyUsd,
        requests: 10_000,
        inputTokens: 10_000_000,
        outputTokens: 2_000_000,
        bytes: 1_000_000_000,
        durationMs: 100_000_000,
      },
    },
    () => now,
  );
  const actor = `runtime:${executionId}`;
  const spendEffect = (spec: {
    id: string;
    catalogEntryId: string;
    ceiling: EffectRequestCeiling;
    settlement: { kind: 'known'; actual: P9BudgetVector } | { kind: 'unknown' };
  }): string => {
    const reservation = authority.reserve({
      reservationId: spec.id,
      workItemId: `workitem:${spec.id}`,
      effectId: `effect:${spec.id}`,
      idempotencyKey: `idem:${executionId}:${spec.id}`,
      catalogEntryId: spec.catalogEntryId,
      ceiling: spec.ceiling,
      actorId: actor,
    });
    authority.markTransportStarted(reservation.id, actor);
    if (spec.settlement.kind === 'known') {
      authority.settle(reservation.id, {
        costState: 'known',
        actual: spec.settlement.actual,
        actorId: actor,
      });
    } else {
      authority.settle(reservation.id, {
        costState: 'unknown',
        actorId: actor,
      });
    }
    return reservation.bound.effectId;
  };

  for (const query of plan.searchQueries) {
    spendEffect({
      id: `search:${query.queryId}`,
      catalogEntryId: 'search-fixture',
      ceiling: ceiling({ durationMs: 5_000 }),
      settlement: {
        kind: 'known',
        actual: actual({ currencyUsd: 0.02, requests: 1, durationMs: 40 }),
      },
    });
  }

  const ledger = new P9RetrievalResidueLedger();
  const attempts: RetrievalAttempt[] = [];
  const attemptBySource = new Map<string, RetrievalAttempt>();
  for (const source of corpus.sources) {
    ledger.select({
      candidateId: source.candidateId,
      sourceClass: source.sourceClass,
      requestedUrl: source.url,
      selectedAt: now,
    });
    const bytes =
      source.body !== null
        ? Buffer.byteLength(source.body, 'utf8')
        : source.outcome === 'parser_failed'
          ? 2_048
          : 0;
    const settleUnknown = corpus.unknownCostCandidateId === source.candidateId;
    const effectId = spendEffect({
      id: `retrieval:${source.candidateId}`,
      catalogEntryId: 'retrieval-fixture',
      ceiling: ceiling({ bytes: 262_144, durationMs: 30_000 }),
      settlement: settleUnknown
        ? { kind: 'unknown' }
        : {
            kind: 'known',
            actual: actual({
              currencyUsd: round12(0.01 + bytes * 1e-9),
              requests: 1,
              bytes,
              durationMs: 120,
            }),
          },
    });
    const observation = source.publishedAt
      ? {
          schemaVersion: '1.0.0' as const,
          contractFamily: 'p9.v1' as const,
          observationId: `obs:${source.candidateId}`,
          field: 'published_at' as const,
          extractionMethod: source.publishedAt.extractionMethod,
          exactLocator: source.publishedAt.exactLocator,
          sourceValue: source.publishedAt.sourceValue,
          normalizedValue: source.publishedAt.normalizedValue,
          confidence: 0.9,
          observedAt: now,
        }
      : undefined;
    const attempt = buildTruthfulRetrievalAttempt({
      attemptId: `attempt:${source.candidateId}`,
      candidateId: source.candidateId,
      effectId,
      requestedUrl: source.url,
      status: source.outcome,
      startedAt: now,
      finishedAt: now,
      ...(source.outcome === 'admitted' ? { finalUrl: source.url } : {}),
      ...(source.outcome === 'admitted' || source.outcome === 'parser_failed'
        ? { retrievedAt: now }
        : {}),
      ...(observation
        ? {
            dateObservation: observation,
            dateVerdict: {
              schemaVersion: '1.0.0' as const,
              contractFamily: 'p9.v1' as const,
              observationId: observation.observationId,
              observationDigest: canonicalDigest(observation),
              verdict: 'accepted' as const,
              policyId: DATE_POLICY_ID,
              reason:
                'exact locator produced a well-formed observed publication timestamp',
              decidedAt: now,
            },
          }
        : {}),
      robotsDecision:
        source.outcome === 'denied'
          ? {
              schemaVersion: '1.0.0' as const,
              contractFamily: 'p9.v1' as const,
              status: 'denied' as const,
              policyId: ROBOTS_POLICY_ID,
              userAgent: USER_AGENT,
              requestedUrl: source.url,
              finalUrl: source.url,
              evaluatedAt: now,
              decisionPath: ['fetched_robots_txt', 'matched_disallow_rule'],
              robotsReceiptDigest: canonicalDigest({
                robots: 'disallow',
                url: source.url,
              }),
            }
          : makeNotCheckedRobotsDecision({
              requestedUrl: source.url,
              userAgent: USER_AGENT,
              policyId: ROBOTS_POLICY_ID,
              evaluatedAt: now,
            }),
      rightsStatus: makeUnknownRightsStatus({
        policyId: RIGHTS_POLICY_ID,
        observedAt: now,
      }),
      bytes,
      ...(source.outcome === 'admitted'
        ? {}
        : { failure: RETRIEVAL_FAILURES[source.outcome] }),
    });
    ledger.recordTerminal(attempt);
    attempts.push(attempt);
    attemptBySource.set(source.candidateId, attempt);
  }
  ledger.assertComplete({ missingSourceClasses: [], assessedAt: now });

  const parserLimits = {
    maximumInputBytes: 262_144,
    maximumOutputCharacters: 200_000,
    timeoutMs: 10_000,
    maximumMemoryBytes: 268_435_456,
    maximumProcesses: 1,
  };
  const parserReceipts: ParserReceipt[] = [];
  for (const source of corpus.sources) {
    if (source.outcome !== 'admitted' && source.outcome !== 'parser_failed') {
      continue;
    }
    spendEffect({
      id: `parse:${source.candidateId}`,
      catalogEntryId: 'parser-text-fixture',
      ceiling: ceiling({
        bytes: 262_144,
        durationMs: 10_000,
        parserClass: 'text/plain',
      }),
      settlement: {
        kind: 'known',
        actual: actual({ currencyUsd: 0.005, requests: 1, durationMs: 15 }),
      },
    });
    const parsed = source.outcome === 'admitted' && source.body !== null;
    parserReceipts.push(
      ParserReceiptSchema.parse({
        schemaVersion: '1.0.0',
        contractFamily: 'p9.v1',
        receiptId: `parser:${source.candidateId}`,
        decisionId: `media:${source.candidateId}`,
        inputDigest: parsed
          ? sha256Text(source.body ?? '')
          : canonicalDigest({ unparseable: source.candidateId }),
        parserId: PARSER_ID,
        parserVersion: PARSER_VERSION,
        parserDigest: canonicalDigest(`${PARSER_ID}@${PARSER_VERSION}`),
        mediaType: source.mediaType,
        limits: parserLimits,
        status: parsed ? 'parsed' : 'failed',
        outputDigest: parsed ? canonicalDigest(source.body) : null,
        outputCharacters: parsed ? (source.body ?? '').length : 0,
        locatorCoordinateSpace: parsed ? COORDINATE_SPACE : null,
        failureCode: parsed ? null : 'parser_output_invalid',
        startedAt: now,
        finishedAt: now,
      }),
    );
  }

  const claimTokens = corpus.claims.length;
  for (const role of ['proposer', 'evaluator'] as const) {
    spendEffect({
      id: `model:${role}`,
      catalogEntryId: `model-${role}-fixture`,
      ceiling: ceiling({
        inputTokens: 200_000,
        outputTokens: 50_000,
        durationMs: 120_000,
      }),
      settlement: {
        kind: 'known',
        actual: actual({
          currencyUsd: round12(
            claimTokens * 800 * 1e-6 + claimTokens * 120 * 4e-6,
          ),
          requests: 1,
          inputTokens: claimTokens * 800,
          outputTokens: claimTokens * 120,
          durationMs: 900,
        }),
      },
    });
  }

  const sourcesById = new Map(
    corpus.sources.map((source) => [source.candidateId, source]),
  );
  const proposals: P9ClaimProposal[] = [];
  const verdicts: P9EntailmentVerdict[] = [];
  const admissions: P9ClaimAdmission[] = [];
  const bindings: P9ClaimEvidenceBinding[] = [];
  for (const claim of corpus.claims) {
    const source = sourcesById.get(claim.candidateId);
    if (source?.body === null || source?.body === undefined) {
      throw new P9GenericResearchError(
        'claim_source_unavailable',
        `claim ${claim.claimId} references a source without admitted content`,
      );
    }
    const startOffset = source.body.indexOf(claim.quote);
    const endOffset = startOffset + claim.quote.length;
    const boundedContext = boundedP9SentenceContext(
      source.body,
      startOffset,
      endOffset,
    );
    const locator = {
      evidenceSpanId: `span:${claim.claimId}`,
      snapshotDigest: canonicalDigest(source.body),
      quoteDigest: canonicalDigest(claim.quote),
      contextDigest: canonicalDigest(boundedContext),
      coordinateSpace: COORDINATE_SPACE,
      startOffset,
      endOffset,
    };
    const proposalIdentity = {
      schemaVersion: '1.0.0' as const,
      contractFamily: 'p9.v1' as const,
      proposalId: claim.claimId,
      statement: claim.statement,
      critical: claim.critical,
      locator,
      proposerWork: proposerWork(claim.claimId),
    };
    const proposal = P9ClaimProposalSchema.parse({
      ...proposalIdentity,
      proposalDigest: canonicalDigest(proposalIdentity),
    });
    const verdictIdentity = {
      schemaVersion: '1.0.0' as const,
      contractFamily: 'p9.v1' as const,
      verdictId: `verdict:${claim.claimId}`,
      proposalId: proposal.proposalId,
      proposalDigest: proposal.proposalDigest,
      evaluatedStatement: claim.statement,
      evaluatedQuote: claim.quote,
      boundedContext,
      locator,
      verdict: claim.evaluatorVerdict,
      semanticDeltas: [],
      hostileInstructionDetected: containsP9HostileInstruction(
        `${claim.statement}\n${claim.quote}\n${boundedContext}`,
      ),
      reasonCodes: containsP9HostileInstruction(
        `${claim.statement}\n${claim.quote}\n${boundedContext}`,
      )
        ? ['hostile_instruction_detected']
        : ['fixture_deterministic_evaluation'],
      evaluatorWork: evaluatorWork(claim.claimId, claim.rejectionSeed),
      evaluatedAt: now,
    };
    const verdict = P9EntailmentVerdictSchema.parse({
      ...verdictIdentity,
      verdictDigest: canonicalDigest(verdictIdentity),
    });
    const admission = evaluateP9ClaimAdmission({
      proposal,
      verdict,
      decidedAt: now,
    });
    proposals.push(proposal);
    verdicts.push(verdict);
    admissions.push(admission);
    const attempt = attemptBySource.get(claim.candidateId);
    if (!attempt) {
      throw new P9GenericResearchError(
        'coverage_evidence_missing',
        `claim ${claim.claimId} lacks a terminal retrieval attempt`,
      );
    }
    bindings.push({
      proposal,
      admission,
      evidence: (() => {
        const identity = {
          candidateId: claim.candidateId,
          attemptId: attempt.attemptId,
          attemptDigest: canonicalDigest(attempt),
          snapshotDigest: canonicalDigest(source.body),
          subquestionIds: claim.subquestionIds,
          sourceClass: source.sourceClass,
          sourceFamilyId: source.sourceFamilyId,
          claimGroupId: claim.claimGroupId,
          contradictionIds: claim.contradictionIds,
          reportSectionId: claim.sectionId,
        };
        return { ...identity, evidenceDigest: canonicalDigest(identity) };
      })(),
    });
  }

  const admitted = bindings.filter(
    (binding) => binding.admission.decision === 'admitted',
  );
  const contradicted = bindings.filter(
    (binding) => binding.admission.decision === 'contradicted',
  );
  const rejected = bindings.filter(
    (binding) => binding.admission.decision === 'rejected',
  );
  const claimsById = new Map(
    corpus.claims.map((claim) => [claim.claimId, claim]),
  );
  const relevantAdmitted = admitted.filter((binding) =>
    isClaimRelevantToPlan(binding, plan),
  );
  const sections: P9ReportSection[] = [];
  const outlineSections = [
    ...plan.reportOutline.sections,
    { sectionId: 'references_provenance', title: 'references and provenance' },
  ];
  for (const outline of outlineSections) {
    const sentences: P9ReportSentence[] = [
      {
        sentenceId: `s:${outline.sectionId}:lead`,
        kind: 'interpretive',
        text: `Interpretive synthesis for ${outline.title}, grounded only in admitted claims below.`,
        claimIds: [],
      },
    ];
    for (const binding of relevantAdmitted) {
      if (binding.evidence.reportSectionId !== outline.sectionId) continue;
      sentences.push({
        sentenceId: `s:${outline.sectionId}:${binding.proposal.proposalId}`,
        kind: 'factual',
        text: binding.proposal.statement,
        claimIds: [binding.proposal.proposalId],
      });
    }
    sections.push({
      sectionId: outline.sectionId,
      title: outline.title,
      sentences,
    });
  }
  assertEveryP9FactualSentenceAdmitted(
    sections.flatMap((section) =>
      section.sentences.map((sentence) => ({
        id: sentence.sentenceId,
        kind: sentence.kind,
        claimIds: sentence.claimIds,
      })),
    ),
    admissions,
  );

  const admittedSubquestions = new Set(
    relevantAdmitted.flatMap((binding) => binding.evidence.subquestionIds),
  );
  const criticalGroups = new Map<string, Set<string>>();
  for (const binding of relevantAdmitted) {
    const group =
      criticalGroups.get(binding.evidence.claimGroupId) ?? new Set<string>();
    group.add(binding.evidence.sourceFamilyId);
    criticalGroups.set(binding.evidence.claimGroupId, group);
  }
  const criticalGroupIds = new Set(
    relevantAdmitted
      .filter((binding) => binding.proposal.critical)
      .map((binding) => binding.evidence.claimGroupId),
  );
  const snapshot = authority.snapshot();
  const stopCriterionFindings: P9StopCriterionFinding[] =
    corpus.stopCriterionBases.map((base) => {
      switch (base.basis) {
        case 'subquestions_accounted': {
          const missing = plan.subquestions
            .map((entry) => entry.subquestionId)
            .filter((id) => !admittedSubquestions.has(id));
          return {
            stopId: base.stopId,
            met: missing.length === 0,
            reason:
              missing.length === 0
                ? `all ${String(plan.subquestions.length)} plan subquestions have admitted claims`
                : `subquestions without admitted claims: ${missing.join(', ')}`,
          };
        }
        case 'critical_corroboration': {
          if (criticalGroupIds.size === 0) {
            return {
              stopId: base.stopId,
              met: false,
              reason:
                'no critical claims were admitted, so corroboration is unproven',
            };
          }
          const uncorroborated = [...criticalGroupIds].filter(
            (groupId) =>
              (criticalGroups.get(groupId)?.size ?? 0) <
              thresholds.minIndependentFamiliesPerCriticalClaim,
          );
          return {
            stopId: base.stopId,
            met: uncorroborated.length === 0,
            reason:
              uncorroborated.length === 0
                ? 'every critical claim group has independent source families'
                : `critical groups without corroboration: ${uncorroborated.join(', ')}`,
          };
        }
        case 'section_admitted_claims': {
          const sectionId = base.sectionId ?? '';
          const count = relevantAdmitted.filter(
            (binding) => binding.evidence.reportSectionId === sectionId,
          ).length;
          return {
            stopId: base.stopId,
            met: count > 0,
            reason:
              count > 0
                ? `${String(count)} admitted claim(s) ground section ${sectionId}`
                : `no admitted claims ground section ${sectionId}`,
          };
        }
        case 'budget_terminal': {
          const open = snapshot.reservations.filter(
            (reservation) => reservation.state === 'reserved',
          );
          return {
            stopId: base.stopId,
            met: open.length === 0,
            reason:
              open.length === 0
                ? 'every budget reservation reached an honest terminal settlement'
                : `open reservations remain: ${open.map((r) => r.id).join(', ')}`,
          };
        }
      }
    });

  const assessment = assessPlanCoverage({
    plan,
    pack,
    claims: bindings,
    attempts,
    reportSectionTexts: sections.map((section) => ({
      sectionId: section.sectionId,
      text: section.sentences.map((sentence) => sentence.text).join(' '),
    })),
    stopCriterionFindings,
    thresholds,
    assessedAt: now,
    assessmentId: `coverage:${executionId}`,
  });

  const citations = relevantAdmitted.map((binding) => {
    const claim = claimsById.get(binding.proposal.proposalId);
    const attempt = attemptBySource.get(claim?.candidateId ?? '');
    const verdict = verdicts.find(
      (record) => record.verdictId === binding.admission.verdictId,
    );
    if (!claim || !attempt) {
      throw new P9GenericResearchError(
        'citation_provenance_missing',
        `admitted claim ${binding.proposal.proposalId} lacks retrieval provenance`,
      );
    }
    if (!verdict || verdict.verdict !== 'entailed') {
      throw new P9GenericResearchError(
        'citation_entailment_missing',
        `admitted claim ${binding.proposal.proposalId} lacks entailment provenance`,
      );
    }
    return {
      claimId: claim.claimId,
      admissionId: binding.admission.admissionId,
      admissionPolicyId: binding.admission.policyId,
      admissionDecision: 'admitted' as const,
      admissionDigest: binding.admission.admissionDigest,
      verdictId: binding.admission.verdictId,
      verdictDigest: binding.admission.verdictDigest,
      entailmentVerdictId: verdict.verdictId,
      entailmentVerdict: 'entailed' as const,
      entailmentVerdictDigest: verdict.verdictDigest,
      attemptId: attempt.attemptId,
      requestedUrl: attempt.requestedUrl,
      sourceClass: binding.evidence.sourceClass,
      sourceFamilyId: binding.evidence.sourceFamilyId,
      evidenceSpanId: binding.proposal.locator.evidenceSpanId,
      locator: binding.proposal.locator,
      snapshotDigest: binding.proposal.locator.snapshotDigest,
      quoteDigest: canonicalDigest(claim.quote),
      coordinateSpace: binding.proposal.locator.coordinateSpace,
      startOffset: binding.proposal.locator.startOffset,
      endOffset: binding.proposal.locator.endOffset,
    };
  });
  const contradictions = contradicted.map((binding) => {
    const claim = claimsById.get(binding.proposal.proposalId);
    if (!claim) {
      throw new P9GenericResearchError(
        'contradiction_provenance_missing',
        `contradicted proposal ${binding.proposal.proposalId} lacks typed metadata`,
      );
    }
    return {
      proposalId: binding.proposal.proposalId,
      admissionId: binding.admission.admissionId,
      verdictId: binding.admission.verdictId,
      attemptId: binding.evidence.attemptId,
      contradictionIds: [...binding.evidence.contradictionIds],
      statement: binding.proposal.statement,
      evidenceSpanId: binding.proposal.locator.evidenceSpanId,
      snapshotDigest: binding.proposal.locator.snapshotDigest,
      quoteDigest: binding.proposal.locator.quoteDigest,
      coordinateSpace: binding.proposal.locator.coordinateSpace,
      startOffset: binding.proposal.locator.startOffset,
      endOffset: binding.proposal.locator.endOffset,
    };
  });
  const manifestIdentity = {
    schemaVersion: '1.0.0' as const,
    contractFamily: 'p9.v1' as const,
    manifestId: `manifest:${executionId}`,
    planId: plan.planId,
    planDigest: plan.planDigest,
    question: plan.question,
    coverageAssessmentDigest: assessment.assessmentDigest,
    sections,
    citations,
    contradictions,
    compiledAt: now,
  };
  const manifest = P9ReportManifestSchema.parse({
    ...manifestIdentity,
    manifestDigest: canonicalDigest(manifestIdentity),
  });
  const report = renderP9Report(manifest, assessment);

  const budgetSummary = summarizeBudget(snapshot, plan.budget.currencyUsd);
  const typedResidue = {
    retrieval_failures: attempts
      .filter((attempt) => attempt.status !== 'admitted')
      .map((attempt) => attempt.attemptId)
      .sort(),
    parser_failures: parserReceipts
      .filter((receipt) => receipt.status !== 'parsed')
      .map((receipt) => receipt.receiptId)
      .sort(),
    rejected_claims: rejected
      .map((binding) => binding.proposal.proposalId)
      .sort(),
    unknown_costs: [...budgetSummary.unknownCostReservationIds],
    redactions: [],
    coverage_gaps: [...assessment.gaps],
  };
  const counts = {
    selectedCandidates: corpus.sources.length,
    terminalAttempts: attempts.length,
    admittedSources: attempts.filter((attempt) => attempt.status === 'admitted')
      .length,
    retrievalFailures: typedResidue.retrieval_failures.length,
    parserReceipts: parserReceipts.length,
    parserFailures: typedResidue.parser_failures.length,
    claimProposals: proposals.length,
    admittedClaims: admitted.length,
    rejectedClaims: rejected.length,
    contradictedClaims: contradicted.length,
    criticalClaims: admitted.filter((binding) => binding.proposal.critical)
      .length,
    factualSentences: sections
      .flatMap((section) => section.sentences)
      .filter((sentence) => sentence.kind === 'factual').length,
  };

  const evidenceSources = corpus.sources
    .filter(
      (source): source is typeof source & { body: string } =>
        source.outcome === 'admitted' && source.body !== null,
    )
    .map((source) => {
      const attempt = attemptBySource.get(source.candidateId);
      if (!attempt || attempt.status !== 'admitted') {
        throw new P9GenericResearchError(
          'exact_bundle_source_missing',
          `admitted source ${source.candidateId} lacks an admitted attempt`,
        );
      }
      return {
        candidateId: source.candidateId,
        attemptId: attempt.attemptId,
        requestedUrl: attempt.requestedUrl,
        sourceClass: source.sourceClass,
        sourceFamilyId: source.sourceFamilyId,
        snapshotDigest: canonicalDigest(source.body),
      };
    });

  const artifacts: Record<string, string> = {
    'research-plan-proposal.json': JSON.stringify(planProposal, null, 2),
    'research-plan.json': JSON.stringify(plan, null, 2),
    'plan-acceptance-receipt.json': JSON.stringify(acceptanceReceipt, null, 2),
    'retrieval-attempts.jsonl': toJsonLines(attempts),
    'budget-ledger.json': JSON.stringify(
      { snapshot, summary: budgetSummary },
      null,
      2,
    ),
    'parser-receipts.jsonl': toJsonLines(parserReceipts),
    'claim-proposals.jsonl': toJsonLines(proposals),
    'claim-evidence.jsonl': toJsonLines(
      bindings.map((binding) => ({
        proposalId: binding.proposal.proposalId,
        evidence: binding.evidence,
      })),
    ),
    'entailment-verdicts.jsonl': toJsonLines(
      verdicts.map((verdict, index) => ({
        verdict,
        admission: admissions[index],
      })),
    ),
    'evidence-sources.jsonl': toJsonLines(evidenceSources),
    'plan-coverage-assessment.json': JSON.stringify(assessment, null, 2),
    'report-manifest.json': JSON.stringify(manifest, null, 2),
    'report.md': report,
  };
  for (const source of corpus.sources) {
    if (source.outcome !== 'admitted' || source.body === null) continue;
    const snapshotDigest = canonicalDigest(source.body);
    artifacts[
      `source-snapshots/${snapshotDigest.slice('sha256:'.length)}.txt`
    ] = source.body;
  }
  const artifactDigests = Object.fromEntries(
    Object.entries(artifacts).map(([name, content]) => [
      name,
      sha256Text(content),
    ]),
  );
  const receiptIdentity = {
    schemaVersion: '1.0.0' as const,
    contractFamily: 'p9.v1' as const,
    executionId,
    planId: plan.planId,
    planDigest: plan.planDigest,
    question: plan.question,
    budget: budgetSummary,
    counts,
    typedResidue,
    coverageVerdict: assessment.verdict,
    coverageAssessmentDigest: assessment.assessmentDigest,
    artifactDigests,
    startedAt: now,
    finishedAt: now,
  };
  const receipt = P9ExecutionReceiptSchema.parse({
    ...receiptIdentity,
    receiptDigest: canonicalDigest(receiptIdentity),
  });
  artifacts['execution-receipt.json'] = JSON.stringify(receipt, null, 2);

  return {
    corpusId: corpus.corpusId,
    attempts,
    parserReceipts,
    proposals,
    verdicts,
    admissions,
    bindings,
    assessment,
    manifest,
    report,
    receipt,
    artifacts,
  };
}

/**
 * Pure P9 bundle compiler for live or adapter-observed execution. Unlike the
 * offline wrapper above, this function does not fabricate effect prices, source
 * attempts, parser receipts, or model-work identities from a corpus. Callers must
 * supply the already observed terminal attempts, budget snapshot, model
 * proposals, independent verdicts, admissions, coverage bindings, and immutable
 * source bytes.
 */
export function compileP9ObservedResearchBundle(
  input: P9ObservedResearchInput,
): P9GenericResearchRun {
  const planProposal = ResearchPlanProposalSchema.parse(input.planProposal);
  const plan = ResearchPlanSchema.parse(input.plan);
  const acceptanceReceipt = PlanAcceptanceReceiptSchema.parse(
    input.acceptanceReceipt,
  );
  const pack = DomainPolicyPackSchema.parse(input.pack);
  const thresholds = PlanCoverageThresholdsSchema.parse(input.thresholds);
  const { executionId, now } = input;
  if (
    !z.string().min(1).safeParse(executionId).success ||
    !z.string().datetime().safeParse(now).success
  ) {
    throw new P9GenericResearchError(
      'execution_input_invalid',
      'execution identity and clock must be valid before compiling observed work',
    );
  }
  assertAcceptedPlanChain(planProposal, plan, acceptanceReceipt, pack);

  const attempts = input.attempts.map((attempt) =>
    RetrievalAttemptSchema.parse(attempt),
  );
  const parserReceipts = input.parserReceipts.map((receipt) =>
    ParserReceiptSchema.parse(receipt),
  );
  const proposals = input.proposals.map((proposal) =>
    P9ClaimProposalSchema.parse(proposal),
  );
  const verdicts = input.verdicts.map((verdict) =>
    P9EntailmentVerdictSchema.parse(verdict),
  );
  const admissions = input.admissions.map((admission) =>
    P9ClaimAdmissionSchema.parse(admission),
  );
  const bindings = input.bindings.map((binding) => ({
    proposal: P9ClaimProposalSchema.parse(binding.proposal),
    admission: P9ClaimAdmissionSchema.parse(binding.admission),
    evidence: P9CoverageEvidenceRecordSchema.parse(binding.evidence),
  }));
  const snapshots = input.snapshots.map((snapshot) => ({
    ...snapshot,
    snapshotDigest: canonicalDigest(snapshot.body),
  }));
  const snapshotByCandidateId = new Map(
    snapshots.map((snapshot) => [snapshot.candidateId, snapshot]),
  );
  const attemptById = new Map(
    attempts.map((attempt) => [attempt.attemptId, attempt]),
  );
  const verdictById = new Map(
    verdicts.map((verdict) => [verdict.verdictId, verdict]),
  );
  const proposalById = new Map(
    proposals.map((proposal) => [proposal.proposalId, proposal]),
  );
  const admissionByProposalId = new Map(
    admissions.map((admission) => [admission.proposalId, admission]),
  );
  if (
    new Set(attempts.map((attempt) => attempt.attemptId)).size !==
      attempts.length ||
    new Set(proposals.map((proposal) => proposal.proposalId)).size !==
      proposals.length ||
    new Set(verdicts.map((verdict) => verdict.verdictId)).size !==
      verdicts.length ||
    new Set(admissions.map((admission) => admission.admissionId)).size !==
      admissions.length
  ) {
    throw new P9GenericResearchError(
      'observed_identity_duplicate',
      'observed attempts, proposals, verdicts, and admissions require unique identities',
    );
  }
  for (const binding of bindings) {
    const observedProposal = proposalById.get(binding.proposal.proposalId);
    const matchingAdmission = admissionByProposalId.get(
      binding.proposal.proposalId,
    );
    if (
      !observedProposal ||
      observedProposal.proposalDigest !== binding.proposal.proposalDigest ||
      !matchingAdmission ||
      matchingAdmission.admissionDigest !== binding.admission.admissionDigest
    ) {
      throw new P9GenericResearchError(
        'observed_admission_mismatch',
        `binding for ${binding.proposal.proposalId} must use an observed admission`,
      );
    }
    const attempt = attemptById.get(binding.evidence.attemptId);
    const snapshot = snapshotByCandidateId.get(binding.evidence.candidateId);
    if (
      !attempt ||
      !snapshot ||
      attempt.candidateId !== binding.evidence.candidateId ||
      binding.evidence.attemptDigest !== canonicalDigest(attempt) ||
      binding.evidence.snapshotDigest !== snapshot.snapshotDigest ||
      binding.evidence.sourceClass !== snapshot.sourceClass ||
      binding.evidence.sourceFamilyId !== snapshot.sourceFamilyId
    ) {
      throw new P9GenericResearchError(
        'observed_evidence_mismatch',
        `binding for ${binding.proposal.proposalId} does not replay against observed attempt and snapshot metadata`,
      );
    }
    const quote = snapshot.body.slice(
      binding.proposal.locator.startOffset,
      binding.proposal.locator.endOffset,
    );
    const verdict = verdictById.get(binding.admission.verdictId);
    if (
      !verdict ||
      verdict.proposalId !== binding.proposal.proposalId ||
      verdict.proposalDigest !== binding.proposal.proposalDigest ||
      quote !== verdict.evaluatedQuote ||
      canonicalDigest(quote) !== binding.proposal.locator.quoteDigest ||
      canonicalDigest(snapshot.body) !==
        binding.proposal.locator.snapshotDigest ||
      boundedP9SentenceContext(
        snapshot.body,
        binding.proposal.locator.startOffset,
        binding.proposal.locator.endOffset,
      ) !== verdict.boundedContext
    ) {
      throw new P9GenericResearchError(
        'observed_entailment_mismatch',
        `binding for ${binding.proposal.proposalId} does not replay against observed entailment inputs`,
      );
    }
    const recomputedAdmission = evaluateP9ClaimAdmission({
      proposal: observedProposal,
      verdict,
      decidedAt: matchingAdmission.decidedAt,
    });
    if (
      canonicalDigest(recomputedAdmission) !==
        canonicalDigest(matchingAdmission) ||
      canonicalDigest(matchingAdmission) !== canonicalDigest(binding.admission)
    ) {
      throw new P9GenericResearchError(
        'observed_admission_mismatch',
        `binding for ${binding.proposal.proposalId} does not replay through the admission policy`,
      );
    }
  }

  const acceptedSectionIds = new Set(
    plan.reportOutline.sections.map((section) => section.sectionId),
  );
  for (const binding of bindings) {
    if (!acceptedSectionIds.has(binding.evidence.reportSectionId)) {
      throw new P9GenericResearchError(
        'observed_report_section_invalid',
        `binding for ${binding.proposal.proposalId} targets a section outside the accepted plan`,
      );
    }
  }

  const admitted = bindings.filter(
    (binding) => binding.admission.decision === 'admitted',
  );
  const contradicted = bindings.filter(
    (binding) => binding.admission.decision === 'contradicted',
  );
  const rejected = bindings.filter(
    (binding) => binding.admission.decision === 'rejected',
  );
  const relevantAdmitted = admitted.filter((binding) =>
    isClaimRelevantToPlan(binding, plan),
  );

  const outlineSections = [
    ...plan.reportOutline.sections,
    { sectionId: 'references_provenance', title: 'references and provenance' },
  ];
  const sections: P9ReportSection[] = [];
  for (const outline of outlineSections) {
    const narrative = input.narrativeSections?.[outline.sectionId];
    if (!narrative) {
      throw new P9GenericResearchError(
        'report_narrative_missing',
        `observed live bundle lacks narrative synthesis for ${outline.sectionId}`,
      );
    }
    const sentences: P9ReportSentence[] = [
      {
        sentenceId: `s:${outline.sectionId}:lead`,
        kind: 'interpretive',
        text: narrative.lead,
        claimIds: [],
      },
    ];
    const relevantByClaimId = new Map(
      relevantAdmitted.map((entry) => [entry.proposal.proposalId, entry]),
    );
    for (const claimId of narrative.claimIds) {
      const binding = relevantByClaimId.get(claimId);
      if (!binding) continue;
      if (binding.evidence.reportSectionId !== outline.sectionId) continue;
      sentences.push({
        sentenceId: `s:${outline.sectionId}:${binding.proposal.proposalId}`,
        kind: 'factual',
        text: binding.proposal.statement,
        claimIds: [binding.proposal.proposalId],
      });
    }
    sections.push({
      sectionId: outline.sectionId,
      title: outline.title,
      sentences,
    });
  }
  assertEveryP9FactualSentenceAdmitted(
    sections.flatMap((section) =>
      section.sentences.map((sentence) => ({
        id: sentence.sentenceId,
        kind: sentence.kind,
        claimIds: sentence.claimIds,
      })),
    ),
    admissions,
  );

  const assessment = assessPlanCoverage({
    plan,
    pack,
    claims: bindings,
    attempts,
    reportSectionTexts: sections.map((section) => ({
      sectionId: section.sectionId,
      text: section.sentences.map((sentence) => sentence.text).join(' '),
    })),
    stopCriterionFindings: [...input.stopCriterionFindings],
    thresholds,
    assessedAt: now,
    assessmentId: `coverage:${executionId}`,
  });
  assertReadableNarrative(sections, true, assessment.verdict === 'covered');

  const citations = relevantAdmitted.map((binding) => {
    const attempt = attemptById.get(binding.evidence.attemptId);
    const verdict = verdictById.get(binding.admission.verdictId);
    if (!attempt || !verdict || verdict.verdict !== 'entailed') {
      throw new P9GenericResearchError(
        'citation_entailment_missing',
        `admitted claim ${binding.proposal.proposalId} lacks observed entailment provenance`,
      );
    }
    return {
      claimId: binding.proposal.proposalId,
      admissionId: binding.admission.admissionId,
      admissionPolicyId: binding.admission.policyId,
      admissionDecision: 'admitted' as const,
      admissionDigest: binding.admission.admissionDigest,
      verdictId: binding.admission.verdictId,
      verdictDigest: binding.admission.verdictDigest,
      entailmentVerdictId: verdict.verdictId,
      entailmentVerdict: 'entailed' as const,
      entailmentVerdictDigest: verdict.verdictDigest,
      attemptId: attempt.attemptId,
      requestedUrl: attempt.requestedUrl,
      sourceClass: binding.evidence.sourceClass,
      sourceFamilyId: binding.evidence.sourceFamilyId,
      evidenceSpanId: binding.proposal.locator.evidenceSpanId,
      locator: binding.proposal.locator,
      snapshotDigest: binding.proposal.locator.snapshotDigest,
      quoteDigest: binding.proposal.locator.quoteDigest,
      coordinateSpace: binding.proposal.locator.coordinateSpace,
      startOffset: binding.proposal.locator.startOffset,
      endOffset: binding.proposal.locator.endOffset,
    };
  });
  const contradictions = contradicted.map((binding) => ({
    proposalId: binding.proposal.proposalId,
    admissionId: binding.admission.admissionId,
    verdictId: binding.admission.verdictId,
    attemptId: binding.evidence.attemptId,
    contradictionIds: [...binding.evidence.contradictionIds],
    statement: binding.proposal.statement,
    evidenceSpanId: binding.proposal.locator.evidenceSpanId,
    snapshotDigest: binding.proposal.locator.snapshotDigest,
    quoteDigest: binding.proposal.locator.quoteDigest,
    coordinateSpace: binding.proposal.locator.coordinateSpace,
    startOffset: binding.proposal.locator.startOffset,
    endOffset: binding.proposal.locator.endOffset,
  }));
  const manifestIdentity = {
    schemaVersion: '1.0.0' as const,
    contractFamily: 'p9.v1' as const,
    manifestId: `manifest:${executionId}`,
    planId: plan.planId,
    planDigest: plan.planDigest,
    question: plan.question,
    coverageAssessmentDigest: assessment.assessmentDigest,
    sections,
    citations,
    contradictions,
    compiledAt: now,
  };
  const manifest = P9ReportManifestSchema.parse({
    ...manifestIdentity,
    manifestDigest: canonicalDigest(manifestIdentity),
  });
  const report = renderP9Report(manifest, assessment);
  let validatedBudgetSnapshot: P9BudgetAuthoritySnapshot;
  try {
    validatedBudgetSnapshot = P9BudgetAuthority.restore(
      input.budgetSnapshot,
    ).snapshot();
  } catch (error) {
    throw new P9GenericResearchError(
      'observed_budget_invalid',
      `observed budget snapshot is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (
    validatedBudgetSnapshot.programId !== executionId ||
    validatedBudgetSnapshot.limit.currencyUsd !== plan.budget.currencyUsd
  ) {
    throw new P9GenericResearchError(
      'observed_budget_mismatch',
      'observed budget snapshot must match the execution and accepted plan budget',
    );
  }
  const budgetSummary = summarizeBudget(
    validatedBudgetSnapshot,
    plan.budget.currencyUsd,
  );
  if (
    validatedBudgetSnapshot.reservations.some(
      (reservation) => reservation.state === 'breached',
    ) ||
    !budgetSummary.withinAuthorization
  ) {
    throw new P9GenericResearchError(
      'observed_budget_breached',
      'observed execution exceeded its accepted budget authority',
    );
  }
  const typedResidue = {
    retrieval_failures: attempts
      .filter((attempt) => attempt.status !== 'admitted')
      .map((attempt) => attempt.attemptId)
      .sort(),
    parser_failures: parserReceipts
      .filter((receipt) => receipt.status !== 'parsed')
      .map((receipt) => receipt.receiptId)
      .sort(),
    rejected_claims: rejected
      .map((binding) => binding.proposal.proposalId)
      .sort(),
    unknown_costs: [...budgetSummary.unknownCostReservationIds],
    redactions: [],
    coverage_gaps: [...assessment.gaps],
  };
  const counts = {
    selectedCandidates: attempts.length,
    terminalAttempts: attempts.length,
    admittedSources: attempts.filter((attempt) => attempt.status === 'admitted')
      .length,
    retrievalFailures: typedResidue.retrieval_failures.length,
    parserReceipts: parserReceipts.length,
    parserFailures: typedResidue.parser_failures.length,
    claimProposals: proposals.length,
    admittedClaims: admitted.length,
    rejectedClaims: rejected.length,
    contradictedClaims: contradicted.length,
    criticalClaims: admitted.filter((binding) => binding.proposal.critical)
      .length,
    factualSentences: sections
      .flatMap((section) => section.sentences)
      .filter((sentence) => sentence.kind === 'factual').length,
  };
  const evidenceSources = snapshots.map((snapshot) => {
    const admittedAttempt = attempts.find(
      (attempt) =>
        attempt.candidateId === snapshot.candidateId &&
        attempt.status === 'admitted',
    );
    if (!admittedAttempt) {
      throw new P9GenericResearchError(
        'exact_bundle_source_missing',
        `admitted source ${snapshot.candidateId} lacks an admitted attempt`,
      );
    }
    return {
      candidateId: snapshot.candidateId,
      attemptId: admittedAttempt.attemptId,
      requestedUrl: admittedAttempt.requestedUrl,
      sourceClass: snapshot.sourceClass,
      sourceFamilyId: snapshot.sourceFamilyId,
      snapshotDigest: snapshot.snapshotDigest,
    };
  });
  const artifacts: Record<string, string> = {
    'research-plan-proposal.json': JSON.stringify(planProposal, null, 2),
    'research-plan.json': JSON.stringify(plan, null, 2),
    'plan-acceptance-receipt.json': JSON.stringify(acceptanceReceipt, null, 2),
    'retrieval-attempts.jsonl': toJsonLines(attempts),
    'budget-ledger.json': JSON.stringify(
      { snapshot: validatedBudgetSnapshot, summary: budgetSummary },
      null,
      2,
    ),
    'parser-receipts.jsonl': toJsonLines(parserReceipts),
    'claim-proposals.jsonl': toJsonLines(proposals),
    'claim-evidence.jsonl': toJsonLines(
      bindings.map((binding) => ({
        proposalId: binding.proposal.proposalId,
        evidence: binding.evidence,
      })),
    ),
    'entailment-verdicts.jsonl': toJsonLines(
      verdicts.map((verdict) => ({
        verdict,
        admission: admissionByProposalId.get(verdict.proposalId),
      })),
    ),
    'evidence-sources.jsonl': toJsonLines(evidenceSources),
    'plan-coverage-assessment.json': JSON.stringify(assessment, null, 2),
    'report-manifest.json': JSON.stringify(manifest, null, 2),
    'report.md': report,
  };
  for (const snapshot of snapshots) {
    artifacts[
      `source-snapshots/${snapshot.snapshotDigest.slice('sha256:'.length)}.txt`
    ] = snapshot.body;
  }
  const artifactDigests = Object.fromEntries(
    Object.entries(artifacts).map(([name, content]) => [
      name,
      sha256Text(content),
    ]),
  );
  const receiptIdentity = {
    schemaVersion: '1.0.0' as const,
    contractFamily: 'p9.v1' as const,
    executionId,
    planId: plan.planId,
    planDigest: plan.planDigest,
    question: plan.question,
    budget: budgetSummary,
    counts,
    typedResidue,
    coverageVerdict: assessment.verdict,
    coverageAssessmentDigest: assessment.assessmentDigest,
    artifactDigests,
    startedAt: now,
    finishedAt: now,
  };
  const receipt = P9ExecutionReceiptSchema.parse({
    ...receiptIdentity,
    receiptDigest: canonicalDigest(receiptIdentity),
  });
  artifacts['execution-receipt.json'] = JSON.stringify(receipt, null, 2);

  return {
    corpusId: `observed:${executionId}`,
    attempts,
    parserReceipts,
    proposals,
    verdicts,
    admissions,
    bindings,
    assessment,
    manifest,
    report,
    receipt,
    artifacts,
  };
}

function assertAcceptedPlanChain(
  planProposal: ResearchPlanProposal,
  plan: ResearchPlan,
  acceptanceReceipt: PlanAcceptanceReceipt,
  pack: DomainPolicyPack,
): void {
  if (
    acceptanceReceipt.decision !== 'accepted' ||
    acceptanceReceipt.proposalId !== planProposal.proposalId ||
    acceptanceReceipt.proposalDigest !== planProposal.proposalDigest ||
    acceptanceReceipt.planId !== plan.planId ||
    acceptanceReceipt.planDigest !== plan.planDigest ||
    acceptanceReceipt.packId !== pack.packId ||
    acceptanceReceipt.packDigest !== pack.packDigest ||
    plan.proposalId !== planProposal.proposalId ||
    plan.proposalDigest !== planProposal.proposalDigest ||
    plan.domainPackId !== pack.packId ||
    plan.packDigest !== pack.packDigest ||
    plan.acceptancePolicyId !== acceptanceReceipt.acceptancePolicyId ||
    plan.acceptedAt !== acceptanceReceipt.decidedAt ||
    plan.acceptedBy !== acceptanceReceipt.actorId ||
    canonicalDigest(p9PlanContentProjection(planProposal)) !==
      canonicalDigest(p9PlanContentProjection(plan))
  ) {
    throw new P9GenericResearchError(
      'plan_binding_mismatch',
      'execution requires the exact accepted plan, proposal, and receipt chain',
    );
  }
}

/**
 * Replays the serialized P9 bundle without trusting the in-memory producer.
 * Every factual citation must resolve through proposal, admission, independent
 * entailment verdict, retrieval attempt, source metadata, and immutable bytes.
 */
export function verifyP9ExactBundle(
  artifacts: Readonly<Record<string, string>>,
): P9ExactBundleVerification {
  const required = (name: string): string => {
    const content = artifacts[name];
    if (content === undefined) {
      throw new P9GenericResearchError(
        'exact_bundle_artifact_missing',
        `exact bundle is missing ${name}`,
      );
    }
    return content;
  };
  const parseJson = <T>(name: string, schema: z.ZodType<T>): T => {
    try {
      return schema.parse(JSON.parse(required(name)));
    } catch (error) {
      throw new P9GenericResearchError(
        'exact_bundle_artifact_invalid',
        `${name} is invalid: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
  const parseLines = <T>(name: string, schema: z.ZodType<T>): T[] => {
    const lines = required(name)
      .split('\n')
      .filter((line) => line.length > 0);
    try {
      return lines.map((line) => schema.parse(JSON.parse(line)));
    } catch (error) {
      throw new P9GenericResearchError(
        'exact_bundle_artifact_invalid',
        `${name} is invalid: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
  const uniqueMap = <T>(
    records: readonly T[],
    keyOf: (record: T) => string,
    label: string,
  ): Map<string, T> => {
    const result = new Map<string, T>();
    for (const record of records) {
      const key = keyOf(record);
      if (result.has(key)) {
        throw new P9GenericResearchError(
          'exact_bundle_identity_duplicate',
          `${label} identity ${key} is duplicated`,
        );
      }
      result.set(key, record);
    }
    return result;
  };
  const assert = (condition: boolean, message: string): void => {
    if (!condition) {
      throw new P9GenericResearchError('exact_bundle_chain_invalid', message);
    }
  };

  const receipt = parseJson('execution-receipt.json', P9ExecutionReceiptSchema);
  for (const [name, digest] of Object.entries(receipt.artifactDigests)) {
    assert(
      sha256Text(required(name)) === digest,
      `${name} bytes do not match the execution receipt`,
    );
  }
  for (const name of Object.keys(artifacts)) {
    if (name === 'execution-receipt.json') continue;
    assert(
      receipt.artifactDigests[name] !== undefined,
      `${name} is not covered by the execution receipt`,
    );
  }

  const manifest = parseJson('report-manifest.json', P9ReportManifestSchema);
  const assessment = parseJson(
    'plan-coverage-assessment.json',
    PlanCoverageAssessmentSchema,
  );
  const planProposal = parseJson(
    'research-plan-proposal.json',
    ResearchPlanProposalSchema,
  );
  const plan = parseJson('research-plan.json', ResearchPlanSchema);
  const acceptanceReceipt = parseJson(
    'plan-acceptance-receipt.json',
    PlanAcceptanceReceiptSchema,
  );
  try {
    assertP9AcceptedPlanChain({
      planProposal,
      plan,
      acceptanceReceipt,
      pack: P9_DOMAIN_POLICY_PACKS[plan.domainPackId],
    });
  } catch (error) {
    throw new P9GenericResearchError(
      'exact_bundle_chain_invalid',
      `accepted plan chain is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  assert(
    plan.proposalId === planProposal.proposalId &&
      plan.proposalDigest === planProposal.proposalDigest &&
      acceptanceReceipt.decision === 'accepted' &&
      acceptanceReceipt.proposalId === planProposal.proposalId &&
      acceptanceReceipt.proposalDigest === planProposal.proposalDigest &&
      acceptanceReceipt.planId === plan.planId &&
      acceptanceReceipt.planDigest === plan.planDigest &&
      acceptanceReceipt.packId === planProposal.domainPackId &&
      acceptanceReceipt.packId === plan.domainPackId &&
      acceptanceReceipt.packDigest === planProposal.packDigest &&
      acceptanceReceipt.packDigest === plan.packDigest &&
      plan.acceptancePolicyId === acceptanceReceipt.acceptancePolicyId &&
      plan.acceptedAt === acceptanceReceipt.decidedAt &&
      plan.acceptedBy === acceptanceReceipt.actorId &&
      canonicalDigest(p9PlanContentProjection(planProposal)) ===
        canonicalDigest(p9PlanContentProjection(plan)) &&
      receipt.planId === plan.planId &&
      receipt.planDigest === plan.planDigest &&
      receipt.question === plan.question &&
      manifest.planId === plan.planId &&
      manifest.planDigest === plan.planDigest &&
      manifest.question === plan.question &&
      receipt.planDigest === manifest.planDigest &&
      receipt.coverageAssessmentDigest === manifest.coverageAssessmentDigest &&
      assessment.planId === plan.planId &&
      assessment.planDigest === plan.planDigest &&
      assessment.assessmentDigest === manifest.coverageAssessmentDigest,
    'proposal, accepted plan, receipt, manifest, and coverage assessment do not share one plan chain',
  );
  let budgetSnapshot: P9BudgetAuthoritySnapshot;
  let serializedBudgetSummary: unknown;
  try {
    const ledger = z
      .object({ snapshot: z.unknown(), summary: z.unknown() })
      .strict()
      .parse(JSON.parse(required('budget-ledger.json')));
    budgetSnapshot = P9BudgetAuthority.restore(ledger.snapshot).snapshot();
    serializedBudgetSummary = ledger.summary;
  } catch (error) {
    throw new P9GenericResearchError(
      'exact_bundle_chain_invalid',
      `budget ledger is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const replayedBudgetSummary = summarizeBudget(
    budgetSnapshot,
    plan.budget.currencyUsd,
  );
  assert(
    budgetSnapshot.programId === receipt.executionId &&
      budgetSnapshot.limit.currencyUsd === plan.budget.currencyUsd &&
      budgetSnapshot.reservations.every(
        (reservation) =>
          reservation.state !== 'reserved' && reservation.state !== 'breached',
      ) &&
      canonicalDigest(serializedBudgetSummary) ===
        canonicalDigest(replayedBudgetSummary) &&
      canonicalDigest(receipt.budget) ===
        canonicalDigest(replayedBudgetSummary) &&
      replayedBudgetSummary.withinAuthorization,
    'budget ledger does not replay against the execution, accepted plan, terminal reservations, and receipt',
  );
  assert(
    required('report.md') === renderP9Report(manifest, assessment),
    'rendered report bytes do not match the verified manifest',
  );

  const proposals = uniqueMap(
    parseLines('claim-proposals.jsonl', P9ClaimProposalSchema),
    (record) => record.proposalId,
    'proposal',
  );
  const claimEvidence = uniqueMap(
    parseLines('claim-evidence.jsonl', P9SerializedClaimEvidenceSchema),
    (record) => record.proposalId,
    'claim evidence',
  );
  const entailmentRecords = parseLines(
    'entailment-verdicts.jsonl',
    P9SerializedEntailmentRecordSchema,
  );
  const verdicts = uniqueMap(
    entailmentRecords.map((record) => record.verdict),
    (record) => record.verdictId,
    'verdict',
  );
  const admissions = uniqueMap(
    entailmentRecords.map((record) => record.admission),
    (record) => record.admissionId,
    'admission',
  );
  const attempts = uniqueMap(
    parseLines('retrieval-attempts.jsonl', RetrievalAttemptSchema),
    (record) => record.attemptId,
    'retrieval attempt',
  );
  const evidenceSources = uniqueMap(
    parseLines('evidence-sources.jsonl', P9SerializedEvidenceSourceSchema),
    (record) => record.attemptId,
    'evidence source',
  );
  for (const record of entailmentRecords) {
    const proposal = proposals.get(record.admission.proposalId);
    assert(
      Boolean(proposal),
      `admission ${record.admission.admissionId} lacks its proposal`,
    );
    if (!proposal) continue;
    const replayedAdmission = evaluateP9ClaimAdmission({
      proposal,
      verdict: record.verdict,
      decidedAt: record.admission.decidedAt,
      admissionId: record.admission.admissionId,
    });
    assert(
      canonicalDigest(replayedAdmission) ===
        canonicalDigest(record.admission) &&
        replayedAdmission.admissionDigest === record.admission.admissionDigest,
      `admission ${record.admission.admissionId} does not match deterministic policy replay`,
    );
  }
  const admittedRecords = [...admissions.values()].filter(
    (record) => record.decision === 'admitted',
  );
  const contradictedRecords = [...admissions.values()].filter(
    (record) => record.decision === 'contradicted',
  );
  const rejectedRecords = [...admissions.values()].filter(
    (record) => record.decision === 'rejected',
  );
  const factualSentences = manifest.sections.flatMap((section) =>
    section.sentences.filter((sentence) => sentence.kind === 'factual'),
  );
  const acceptedReportSectionIds = new Set(
    plan.reportOutline.sections.map((section) => section.sectionId),
  );
  for (const [proposalId, record] of claimEvidence) {
    const attempt = attempts.get(record.evidence.attemptId);
    const source = evidenceSources.get(record.evidence.attemptId);
    assert(
      Boolean(proposals.get(proposalId)),
      `claim evidence ${proposalId} lacks its proposal`,
    );
    assert(
      Boolean(attempt),
      `claim evidence ${proposalId} lacks its retrieval attempt`,
    );
    assert(
      Boolean(source),
      `claim evidence ${proposalId} lacks its source metadata`,
    );
    assert(
      acceptedReportSectionIds.has(record.evidence.reportSectionId),
      `claim evidence ${proposalId} targets a section outside the accepted plan`,
    );
    if (!attempt || !source) continue;
    assert(
      record.evidence.candidateId === attempt.candidateId &&
        record.evidence.attemptDigest === canonicalDigest(attempt) &&
        source.candidateId === attempt.candidateId &&
        record.evidence.snapshotDigest === source.snapshotDigest &&
        record.evidence.sourceClass === source.sourceClass &&
        record.evidence.sourceFamilyId === source.sourceFamilyId,
      `claim evidence ${proposalId} does not match its acquired source`,
    );
  }
  const relevantAdmittedRecords = admittedRecords.filter((admission) => {
    const proposal = proposals.get(admission.proposalId);
    const evidence = claimEvidence.get(admission.proposalId)?.evidence;
    assert(
      Boolean(proposal),
      `admission ${admission.admissionId} lacks its proposal`,
    );
    assert(
      Boolean(evidence),
      `admission ${admission.admissionId} lacks claim evidence`,
    );
    return proposal && evidence
      ? isClaimRelevantToPlan({ proposal, admission, evidence }, plan)
      : false;
  });
  const relevantClaimIds = new Set(
    relevantAdmittedRecords.map((record) => record.proposalId),
  );
  const citedClaimIds = new Set(
    manifest.citations.map((citation) => citation.claimId),
  );
  assert(
    receipt.counts.admittedClaims === admittedRecords.length &&
      receipt.counts.contradictedClaims === contradictedRecords.length &&
      receipt.counts.rejectedClaims === rejectedRecords.length &&
      receipt.counts.claimProposals === proposals.size &&
      receipt.counts.factualSentences === factualSentences.length &&
      receipt.counts.terminalAttempts === attempts.size &&
      manifest.citations.length === relevantAdmittedRecords.length &&
      manifest.contradictions.length === contradictedRecords.length &&
      citedClaimIds.size === relevantClaimIds.size &&
      [...citedClaimIds].every((claimId) => relevantClaimIds.has(claimId)),
    'receipt counts or rendered citation set do not match serialized decisions',
  );

  const factualByClaim = new Map<string, P9ReportSentence[]>();
  for (const section of manifest.sections) {
    for (const sentence of section.sentences.filter(
      (entry) => entry.kind === 'factual',
    )) {
      assert(
        sentence.claimIds.length === 1,
        `factual sentence ${sentence.sentenceId} must bind exactly one proposal`,
      );
      const claimId = sentence.claimIds[0];
      if (!claimId) continue;
      assert(
        claimEvidence.get(claimId)?.evidence.reportSectionId ===
          section.sectionId,
        `factual sentence ${sentence.sentenceId} is rendered outside its accepted evidence section`,
      );
      factualByClaim.set(claimId, [
        ...(factualByClaim.get(claimId) ?? []),
        sentence,
      ]);
    }
  }
  try {
    assertReadableNarrative(
      manifest.sections,
      plan.planId.startsWith('p9-live-'),
      receipt.coverageVerdict === 'covered',
    );
  } catch (error) {
    throw new P9GenericResearchError(
      'exact_bundle_chain_invalid',
      error instanceof Error ? error.message : String(error),
    );
  }

  for (const citation of manifest.citations) {
    const proposal = proposals.get(citation.claimId);
    const admission = admissions.get(citation.admissionId);
    const verdict = verdicts.get(citation.verdictId);
    const attempt = attempts.get(citation.attemptId);
    const source = evidenceSources.get(citation.attemptId);
    const evidence = claimEvidence.get(citation.claimId)?.evidence;
    assert(
      Boolean(proposal),
      `citation ${citation.claimId} lacks its proposal`,
    );
    assert(
      Boolean(admission),
      `citation ${citation.claimId} lacks its admission`,
    );
    assert(Boolean(verdict), `citation ${citation.claimId} lacks its verdict`);
    assert(Boolean(attempt), `citation ${citation.claimId} lacks its attempt`);
    assert(
      Boolean(source),
      `citation ${citation.claimId} lacks source metadata`,
    );
    assert(
      Boolean(evidence),
      `citation ${citation.claimId} lacks claim evidence`,
    );
    if (!proposal || !admission || !verdict || !attempt || !source || !evidence)
      continue;

    assert(
      admission.decision === 'admitted' && admission.independentProfile,
      `citation ${citation.claimId} was not independently admitted`,
    );
    assert(
      admission.proposalId === proposal.proposalId &&
        admission.proposalDigest === proposal.proposalDigest &&
        admission.verdictId === verdict.verdictId &&
        admission.verdictDigest === verdict.verdictDigest &&
        admission.policyId === citation.admissionPolicyId &&
        admission.admissionDigest === citation.admissionDigest,
      `citation ${citation.claimId} does not match its admission record`,
    );
    assert(
      verdict.verdict === 'entailed' &&
        verdict.proposalId === proposal.proposalId &&
        verdict.proposalDigest === proposal.proposalDigest &&
        verdict.verdictId === citation.entailmentVerdictId &&
        verdict.verdictDigest === citation.entailmentVerdictDigest &&
        canonicalDigest(verdict.locator) ===
          canonicalDigest(citation.locator) &&
        canonicalDigest(proposal.locator) === canonicalDigest(citation.locator),
      `citation ${citation.claimId} does not match its entailment chain`,
    );
    assert(
      attempt.status === 'admitted' &&
        source.candidateId === attempt.candidateId &&
        attempt.requestedUrl === citation.requestedUrl &&
        source.requestedUrl === citation.requestedUrl &&
        source.sourceClass === citation.sourceClass &&
        source.sourceFamilyId === citation.sourceFamilyId &&
        source.snapshotDigest === citation.snapshotDigest &&
        evidence.attemptId === citation.attemptId &&
        evidence.candidateId === attempt.candidateId &&
        evidence.snapshotDigest === citation.snapshotDigest &&
        evidence.sourceClass === citation.sourceClass &&
        evidence.sourceFamilyId === citation.sourceFamilyId &&
        evidence.snapshotDigest === proposal.locator.snapshotDigest,
      `citation ${citation.claimId} does not match its acquired source`,
    );
    const claimSentences = factualByClaim.get(citation.claimId) ?? [];
    assert(
      claimSentences.length === 1 &&
        claimSentences[0]?.text === proposal.statement,
      `citation ${citation.claimId} does not bind exactly one admitted proposal sentence`,
    );

    const snapshotName = `source-snapshots/${citation.snapshotDigest.slice('sha256:'.length)}.txt`;
    const snapshot = required(snapshotName);
    assert(
      canonicalDigest(snapshot) === citation.snapshotDigest,
      `citation ${citation.claimId} snapshot bytes do not match its digest`,
    );
    const quote = snapshot.slice(
      citation.locator.startOffset,
      citation.locator.endOffset,
    );
    assert(
      quote === verdict.evaluatedQuote &&
        canonicalDigest(quote) === citation.quoteDigest,
      `citation ${citation.claimId} locator does not select the evaluated quote`,
    );
    assert(
      boundedP9SentenceContext(
        snapshot,
        citation.locator.startOffset,
        citation.locator.endOffset,
      ) === verdict.boundedContext,
      `citation ${citation.claimId} bounded context does not match source bytes`,
    );
  }

  const contradictedProposalIds = new Set(
    contradictedRecords.map((record) => record.proposalId),
  );
  const renderedContradictionIds = new Set(
    manifest.contradictions.map((record) => record.proposalId),
  );
  assert(
    renderedContradictionIds.size === contradictedProposalIds.size &&
      [...renderedContradictionIds].every((proposalId) =>
        contradictedProposalIds.has(proposalId),
      ),
    'rendered contradiction set does not match serialized contradicted decisions',
  );
  for (const contradiction of manifest.contradictions) {
    const proposal = proposals.get(contradiction.proposalId);
    const admission = admissions.get(contradiction.admissionId);
    const verdict = verdicts.get(contradiction.verdictId);
    const evidence = claimEvidence.get(contradiction.proposalId)?.evidence;
    const attempt = attempts.get(contradiction.attemptId);
    const source = evidenceSources.get(contradiction.attemptId);
    assert(
      Boolean(proposal),
      `contradiction ${contradiction.proposalId} lacks its proposal`,
    );
    assert(
      Boolean(admission),
      `contradiction ${contradiction.proposalId} lacks its admission`,
    );
    assert(
      Boolean(verdict),
      `contradiction ${contradiction.proposalId} lacks its verdict`,
    );
    assert(
      Boolean(evidence),
      `contradiction ${contradiction.proposalId} lacks claim evidence`,
    );
    assert(
      Boolean(attempt),
      `contradiction ${contradiction.proposalId} lacks its retrieval attempt`,
    );
    assert(
      Boolean(source),
      `contradiction ${contradiction.proposalId} lacks source metadata`,
    );
    if (!proposal || !admission || !verdict || !evidence || !attempt || !source)
      continue;
    assert(
      admission.decision === 'contradicted' &&
        admission.proposalId === proposal.proposalId &&
        admission.proposalDigest === proposal.proposalDigest &&
        admission.verdictId === verdict.verdictId &&
        admission.verdictDigest === verdict.verdictDigest &&
        verdict.verdict === 'contradicted' &&
        verdict.proposalId === proposal.proposalId &&
        verdict.proposalDigest === proposal.proposalDigest,
      `contradiction ${contradiction.proposalId} does not match its decision chain`,
    );
    assert(
      contradiction.statement === proposal.statement &&
        contradiction.evidenceSpanId === proposal.locator.evidenceSpanId &&
        contradiction.snapshotDigest === proposal.locator.snapshotDigest &&
        contradiction.quoteDigest === proposal.locator.quoteDigest &&
        contradiction.coordinateSpace === proposal.locator.coordinateSpace &&
        contradiction.startOffset === proposal.locator.startOffset &&
        contradiction.endOffset === proposal.locator.endOffset &&
        canonicalDigest(verdict.locator) ===
          canonicalDigest(proposal.locator) &&
        canonicalDigest(contradiction.contradictionIds) ===
          canonicalDigest(evidence.contradictionIds),
      `contradiction ${contradiction.proposalId} does not match its exact evidence locator`,
    );
    assert(
      evidence.attemptId === contradiction.attemptId &&
        evidence.candidateId === attempt.candidateId &&
        evidence.attemptDigest === canonicalDigest(attempt) &&
        attempt.status === 'admitted' &&
        source.candidateId === attempt.candidateId &&
        evidence.snapshotDigest === source.snapshotDigest &&
        evidence.sourceClass === source.sourceClass &&
        evidence.sourceFamilyId === source.sourceFamilyId,
      `contradiction ${contradiction.proposalId} does not match its acquired source`,
    );
    const snapshotName = `source-snapshots/${contradiction.snapshotDigest.slice('sha256:'.length)}.txt`;
    const snapshot = required(snapshotName);
    const quote = snapshot.slice(
      contradiction.startOffset,
      contradiction.endOffset,
    );
    assert(
      canonicalDigest(snapshot) === contradiction.snapshotDigest &&
        quote === verdict.evaluatedQuote &&
        canonicalDigest(quote) === contradiction.quoteDigest &&
        boundedP9SentenceContext(
          snapshot,
          contradiction.startOffset,
          contradiction.endOffset,
        ) === verdict.boundedContext,
      `contradiction ${contradiction.proposalId} does not replay against source bytes`,
    );
  }

  return {
    manifest,
    receipt,
    verifiedCitationCount: manifest.citations.length,
  };
}

function toJsonLines(records: readonly unknown[]): string {
  return `${records.map((record) => JSON.stringify(record)).join('\n')}\n`;
}

function summarizeBudget(
  snapshot: ReturnType<P9BudgetAuthority['snapshot']>,
  authorizedUsd: number,
): {
  authorizedUsd: number;
  reservedOpenUsd: number;
  spentKnownUsd: number;
  spentConservativeUnknownUsd: number;
  unknownCostReservationIds: string[];
  unknownCostSerializedAsZero: false;
  withinAuthorization: boolean;
} {
  let spentKnownUsd = 0;
  let spentConservativeUnknownUsd = 0;
  const unknownCostReservationIds: string[] = [];
  for (const reservation of snapshot.reservations) {
    if (reservation.state === 'settled' || reservation.state === 'breached') {
      spentKnownUsd = round12(spentKnownUsd + reservation.charged.currencyUsd);
    } else if (reservation.state === 'ambiguous') {
      spentConservativeUnknownUsd = round12(
        spentConservativeUnknownUsd + reservation.charged.currencyUsd,
      );
      unknownCostReservationIds.push(reservation.id);
    }
  }
  unknownCostReservationIds.sort();
  const reservedOpenUsd = snapshot.reserved.currencyUsd;
  return {
    authorizedUsd,
    reservedOpenUsd,
    spentKnownUsd,
    spentConservativeUnknownUsd,
    unknownCostReservationIds,
    unknownCostSerializedAsZero: false,
    withinAuthorization:
      reservedOpenUsd + spentKnownUsd + spentConservativeUnknownUsd <=
      authorizedUsd,
  };
}

function renderP9Report(
  manifest: P9ReportManifest,
  assessment: PlanCoverageAssessment,
): string {
  const lines: string[] = [
    `# ${manifest.question}`,
    '',
    `Plan ${manifest.planId} (digest ${manifest.planDigest})`,
    `Plan-relative coverage verdict: ${assessment.verdict}`,
    '',
  ];
  for (const section of manifest.sections) {
    lines.push(`## ${section.title}`, '');
    for (const sentence of section.sentences) {
      lines.push(
        sentence.kind === 'factual'
          ? `- ${sentence.text} [${sentence.claimIds.join(', ')}]`
          : `- ${sentence.text}`,
      );
    }
    lines.push('');
  }
  if (manifest.contradictions.length > 0) {
    lines.push('## Preserved contradictions', '');
    for (const contradiction of manifest.contradictions) {
      lines.push(
        `- Proposal ${contradiction.proposalId} was contradicted under ${contradiction.contradictionIds.join(', ')} (verdict ${contradiction.verdictId}; locator ${contradiction.evidenceSpanId}; snapshot ${contradiction.snapshotDigest}).`,
      );
    }
    lines.push('');
  }
  lines.push(
    `Coverage gaps: ${assessment.gaps.length === 0 ? 'none' : assessment.gaps.join('; ')}`,
    '',
  );
  return lines.join('\n');
}
