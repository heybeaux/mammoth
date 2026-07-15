import { createHash } from 'node:crypto';
import {
  canonicalDigest,
  DomainPolicyPackSchema,
  PlanAcceptanceReceiptSchema,
  ResearchPlanProposalSchema,
  ResearchPlanSchema,
  ParserReceiptSchema,
  P9ClaimProposalSchema,
  P9EntailmentVerdictSchema,
  P9ExecutionReceiptSchema,
  P9ReportManifestSchema,
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
  PlanCoverageThresholdsSchema,
  priceCatalogDigest,
  type P9ClaimEvidenceBinding,
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

function boundedSentenceContext(
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
  const planProposalResult = ResearchPlanProposalSchema.safeParse(
    input.planProposal,
  );
  const planResult = ResearchPlanSchema.safeParse(input.plan);
  const receiptResult = PlanAcceptanceReceiptSchema.safeParse(
    input.acceptanceReceipt,
  );
  const packResult = DomainPolicyPackSchema.safeParse(input.pack);
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
  if (
    !planProposalResult.success ||
    !planResult.success ||
    !receiptResult.success ||
    !packResult.success ||
    !thresholdsResult.success
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
  const thresholds = thresholdsResult.data;
  const proposalContent = {
    question: planProposal.question,
    domainPackId: planProposal.domainPackId,
    packDigest: planProposal.packDigest,
    scope: planProposal.scope,
    subquestions: planProposal.subquestions,
    coverageRequirements: planProposal.coverageRequirements,
    sourceClassTargets: planProposal.sourceClassTargets,
    searchQueries: planProposal.searchQueries,
    contradictionRequirements: planProposal.contradictionRequirements,
    freshnessRequirements: planProposal.freshnessRequirements,
    stopCriteria: planProposal.stopCriteria,
    reportOutline: planProposal.reportOutline,
    budget: planProposal.budget,
    criticalClaimPolicy: planProposal.criticalClaimPolicy,
    derivations: planProposal.derivations,
  };
  const acceptedContent = {
    question: plan.question,
    domainPackId: plan.domainPackId,
    packDigest: plan.packDigest,
    scope: plan.scope,
    subquestions: plan.subquestions,
    coverageRequirements: plan.coverageRequirements,
    sourceClassTargets: plan.sourceClassTargets,
    searchQueries: plan.searchQueries,
    contradictionRequirements: plan.contradictionRequirements,
    freshnessRequirements: plan.freshnessRequirements,
    stopCriteria: plan.stopCriteria,
    reportOutline: plan.reportOutline,
    budget: plan.budget,
    criticalClaimPolicy: plan.criticalClaimPolicy,
    derivations: plan.derivations,
  };
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
    canonicalDigest(proposalContent) !== canonicalDigest(acceptedContent)
  ) {
    throw new P9GenericResearchError(
      'plan_binding_mismatch',
      'execution requires the exact accepted plan, proposal, and receipt chain',
    );
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
    const boundedContext = boundedSentenceContext(
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
    if (outline.sectionId === 'references_provenance') {
      for (const binding of relevantAdmitted) {
        const attempt = attemptBySource.get(
          claimsById.get(binding.proposal.proposalId)?.candidateId ?? '',
        );
        if (!attempt) continue;
        sentences.push({
          sentenceId: `s:references:${binding.proposal.proposalId}`,
          kind: 'factual',
          text: `Claim ${binding.proposal.proposalId} is grounded in ${attempt.requestedUrl} (${binding.evidence.sourceClass}, family ${binding.evidence.sourceFamilyId}).`,
          claimIds: [binding.proposal.proposalId],
        });
      }
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
    if (!claim || !attempt) {
      throw new P9GenericResearchError(
        'citation_provenance_missing',
        `admitted claim ${binding.proposal.proposalId} lacks retrieval provenance`,
      );
    }
    return {
      claimId: claim.claimId,
      admissionId: binding.admission.admissionId,
      verdictId: binding.admission.verdictId,
      attemptId: attempt.attemptId,
      requestedUrl: attempt.requestedUrl,
      sourceClass: binding.evidence.sourceClass,
      sourceFamilyId: binding.evidence.sourceFamilyId,
      evidenceSpanId: binding.proposal.locator.evidenceSpanId,
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
    'entailment-verdicts.jsonl': toJsonLines(
      verdicts.map((verdict, index) => ({
        verdict,
        admission: admissions[index],
      })),
    ),
    'plan-coverage-assessment.json': JSON.stringify(assessment, null, 2),
    'report-manifest.json': JSON.stringify(manifest, null, 2),
    'report.md': report,
  };
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
    if (reservation.state === 'settled') {
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
