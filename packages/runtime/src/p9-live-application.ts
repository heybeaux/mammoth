import {
  canonicalDigest,
  ParserReceiptSchema,
  P9ClaimProposalSchema,
  P9EntailmentVerdictSchema,
  type DomainPolicyPack,
  ResearchPlanProposalSchema,
  type EffectRequestCeiling,
  type P9BudgetVector,
  type P9ClaimAdmission,
  type P9ClaimProposal,
  type P9EntailmentVerdict,
  type P9ModelWorkRef,
  type ParserReceipt,
  type ProviderPriceCatalog,
  type ResearchPlan,
  type ResearchPlanProposal,
  type RetrievalAttempt,
} from '@mammoth/domain';
import { evaluateP9ClaimAdmission } from '@mammoth/evidence';
import {
  acceptResearchPlan,
  P9BudgetAuthority,
  P9_DOMAIN_POLICY_PACKS,
  priceCatalogDigest,
  type P9ClaimEvidenceBinding,
  type P9StopCriterionFinding,
  type PlanCoverageThresholds,
} from '@mammoth/governance';
import {
  AcquisitionFailure,
  BoundedParserRegistry,
  buildTruthfulRetrievalAttempt,
  makeNotCheckedRobotsDecision,
  makeUnknownRightsStatus,
  ParserPolicyError,
  retrieveSource,
  type RetrievedSource,
} from '@mammoth/retrieval';
import { z } from 'zod';
import {
  compileP9ObservedResearchBundle,
  verifyP9ExactBundle,
  type P9GenericResearchRun,
  type P9ObservedSourceSnapshot,
} from './p9-generic-research.js';

export const P9_LIVE_EXHIBITION_QUESTION =
  'Using the current upstream repository and primary technical sources, which bounded change to JustVugg/colibri should be tested first on a 128 GB Apple-silicon machine, and what experiment would distinguish a real improvement from measurement noise?';

const USER_AGENT = 'mammoth-research/0.9';
const ROBOTS_POLICY_ID = 'p9-live-robots-not-checked/v1';
const RIGHTS_POLICY_ID = 'p9-live-rights-unknown/v1';
const COORDINATE_SPACE = 'utf16-code-units/v1';
const UNCLASSIFIED_SOURCE_CLASS = 'unclassified_non_authoritative';

export interface P9ObservedEffectReceipt {
  readonly provider: string;
  readonly operationKind: 'search' | 'model';
  readonly rawResponseDigest: string;
  readonly actual?: Partial<P9BudgetVector>;
  readonly providerModelId?: string;
  readonly startedAt: string;
  readonly finishedAt: string;
}

export interface P9LiveCandidate {
  readonly candidateId: string;
  readonly url: string;
  readonly title: string;
  readonly sourceClass: string;
  readonly sourceFamilyId: string;
}

export interface P9LiveSearchAdapter {
  readonly search: (query: string) => Promise<{
    readonly candidates: readonly P9LiveCandidate[];
    readonly receipt: P9ObservedEffectReceipt;
  }>;
}

export interface P9LiveClaimSeed {
  readonly claimId: string;
  readonly candidateId: string;
  readonly quote: string;
  readonly statement: string;
  readonly subquestionIds: readonly string[];
  readonly sectionId: string;
  readonly claimGroupId: string;
  readonly critical: boolean;
  readonly contradictionIds: readonly string[];
}

export interface P9LiveModelAdapter {
  readonly proposeClaims: (input: {
    readonly plan: ResearchPlan;
    readonly snapshots: readonly P9ObservedSourceSnapshot[];
  }) => Promise<{
    readonly claims: readonly P9LiveClaimSeed[];
    readonly receipt: P9ObservedEffectReceipt;
  }>;
  readonly evaluateClaims: (input: {
    readonly plan: ResearchPlan;
    readonly claims: readonly P9LiveClaimSeed[];
    readonly snapshots: readonly P9ObservedSourceSnapshot[];
  }) => Promise<{
    readonly verdicts: readonly {
      readonly claimId: string;
      readonly verdict: 'entailed' | 'contradicted' | 'insufficient';
      readonly semanticDeltas?: readonly string[];
      readonly reasonCodes?: readonly string[];
    }[];
    readonly receipt: P9ObservedEffectReceipt;
  }>;
  readonly proposerProfile: P9LiveModelProfile;
  readonly evaluatorProfile: P9LiveModelProfile;
}

export interface P9LiveModelProfile {
  readonly profileVersionId: string;
  readonly profileFamilyId: string;
  readonly modelId: string;
}

export interface P9LiveApplicationInput {
  readonly executionId: string;
  readonly budgetUsd: number;
  readonly search: P9LiveSearchAdapter;
  readonly model: P9LiveModelAdapter;
  readonly now?: () => Date;
  readonly retrieve?: typeof retrieveSource;
  readonly parserRegistry?: BoundedParserRegistry;
  readonly thresholds?: PlanCoverageThresholds;
  readonly maxCandidates?: number;
}

export interface P9LiveApplicationRun extends P9GenericResearchRun {
  readonly exactBundleVerified: boolean;
}

export async function runP9LiveApplication(
  input: P9LiveApplicationInput,
): Promise<P9LiveApplicationRun> {
  if (!input.executionId.trim()) {
    throw new Error('P9 live executionId must be non-empty');
  }
  const maxCandidates = input.maxCandidates ?? 8;
  if (!Number.isInteger(maxCandidates) || maxCandidates <= 0) {
    throw new Error('P9 live maxCandidates must be a positive integer');
  }
  if (input.budgetUsd <= 0 || input.budgetUsd > 5) {
    throw new Error(
      'P9 live budget must be positive and no greater than 5 USD',
    );
  }
  if (
    input.model.proposerProfile.profileFamilyId ===
    input.model.evaluatorProfile.profileFamilyId
  ) {
    throw new Error('P9 live proposer and evaluator profile families differ');
  }
  const now = input.now ?? (() => new Date());
  const timestamp = () => now().toISOString();
  const planBundle = buildAcceptedP9LivePlan({
    budgetUsd: input.budgetUsd,
    now: timestamp(),
    proposerProfile: input.model.proposerProfile,
  });
  const authority = new P9BudgetAuthority(
    {
      accountId: `p9-live:${input.executionId}`,
      programId: input.executionId,
      catalog: buildP9LiveCatalog(),
      limit: {
        currencyUsd: input.budgetUsd,
        requests: 200,
        inputTokens: 500_000,
        outputTokens: 100_000,
        bytes: 25_000_000,
        durationMs: 3_600_000,
      },
    },
    timestamp,
  );
  const actor = `p9-live:${input.executionId}`;
  const reserveEffect = (effect: {
    readonly id: string;
    readonly catalogEntryId: string;
    readonly ceiling: EffectRequestCeiling;
  }) =>
    authority.reserve({
      reservationId: effect.id,
      workItemId: `work:${effect.id}`,
      effectId: `effect:${effect.id}`,
      idempotencyKey: `idem:${input.executionId}:${effect.id}`,
      catalogEntryId: effect.catalogEntryId,
      ceiling: effect.ceiling,
      actorId: actor,
    });
  const settleKnown = (id: string, actual: Partial<P9BudgetVector>): void => {
    authority.settle(id, {
      costState: 'known',
      actual: budgetVector(actual),
      actorId: actor,
    });
  };
  const settleObserved = (
    id: string,
    receipt: P9ObservedEffectReceipt | undefined,
  ): void => {
    if (
      receipt?.actual &&
      typeof receipt.actual.currencyUsd === 'number' &&
      Number.isFinite(receipt.actual.currencyUsd)
    ) {
      settleKnown(id, receipt.actual);
      return;
    }
    authority.settle(id, { costState: 'unknown', actorId: actor });
  };
  const settleUnknown = (id: string): void => {
    authority.settle(id, { costState: 'unknown', actorId: actor });
  };

  const candidatesById = new Map<string, P9LiveCandidate>();
  for (const query of planBundle.plan.searchQueries) {
    const reservation = reserveEffect({
      id: `search:${query.queryId}`,
      catalogEntryId: 'brave-search',
      ceiling: ceiling({ bytes: 1_000_000, durationMs: 10_000 }),
    });
    authority.markTransportStarted(reservation.id, actor);
    let results: readonly P9LiveCandidate[];
    try {
      const searchResult = await input.search.search(query.query);
      results = searchResult.candidates;
      settleObserved(reservation.id, searchResult.receipt);
    } catch (error) {
      settleUnknown(reservation.id);
      throw error;
    }
    for (const candidate of results) {
      const normalized = normalizeLiveCandidate(candidate);
      if (!candidatesById.has(normalized.candidateId)) {
        candidatesById.set(normalized.candidateId, normalized);
      }
      if (candidatesById.size >= maxCandidates) break;
    }
    if (candidatesById.size >= maxCandidates) break;
  }

  const retrieve = input.retrieve ?? retrieveSource;
  const parserRegistry = input.parserRegistry ?? new BoundedParserRegistry();
  const attempts: RetrievalAttempt[] = [];
  const parserReceipts: ParserReceipt[] = [];
  const snapshots: P9ObservedSourceSnapshot[] = [];
  for (const candidate of candidatesById.values()) {
    const retrievalReservation = reserveEffect({
      id: `retrieval:${candidate.candidateId}`,
      catalogEntryId: 'public-retrieval',
      ceiling: ceiling({ bytes: 2_000_000, durationMs: 20_000 }),
    });
    authority.markTransportStarted(retrievalReservation.id, actor);
    let retrieved: RetrievedSource;
    try {
      retrieved = await retrieve(
        { url: candidate.url, headers: { 'user-agent': USER_AGENT } },
        { now, policyId: 'p9-public-network/v1' },
      );
      settleKnown(retrievalReservation.id, {
        currencyUsd: 0.002,
        requests: 1,
        bytes: retrieved.bytes.byteLength,
      });
    } catch (error) {
      settleUnknown(retrievalReservation.id);
      const failure =
        error instanceof AcquisitionFailure
          ? error.code === 'ACQUISITION_TIMEOUT'
            ? RETRIEVAL_FAILURES.timed_out
            : RETRIEVAL_FAILURES.unavailable
          : RETRIEVAL_FAILURES.unavailable;
      attempts.push(
        buildTruthfulRetrievalAttempt({
          attemptId: `attempt:${candidate.candidateId}`,
          candidateId: candidate.candidateId,
          effectId: retrievalReservation.bound.effectId,
          requestedUrl: candidate.url,
          status:
            failure.code === 'source_timeout' ? 'timed_out' : 'unavailable',
          startedAt: retrievalReservation.createdAt,
          finishedAt: timestamp(),
          robotsDecision: makeNotCheckedRobotsDecision({
            requestedUrl: candidate.url,
            userAgent: USER_AGENT,
            policyId: ROBOTS_POLICY_ID,
            evaluatedAt: timestamp(),
          }),
          rightsStatus: makeUnknownRightsStatus({
            policyId: RIGHTS_POLICY_ID,
            observedAt: timestamp(),
          }),
          bytes: 0,
          failure,
        }),
      );
      continue;
    }

    const parserReservation = reserveEffect({
      id: `parser:${candidate.candidateId}`,
      catalogEntryId: 'bounded-parser',
      ceiling: ceiling({
        bytes: retrieved.bytes.byteLength,
        durationMs: 10_000,
        parserClass: 'text/plain',
      }),
    });
    authority.markTransportStarted(parserReservation.id, actor);
    try {
      const parsed = parserRegistry.parse(
        retrieved.bytes,
        retrieved.mediaType,
        {
          sourceUrl: retrieved.finalUrl,
          now,
          policyId: 'p9-media-support/v1',
          decisionId: `media:${candidate.candidateId}`,
          receiptId: `parser:${candidate.candidateId}`,
        },
      );
      const receipt = ParserReceiptSchema.parse(parsed.parserReceipt);
      parserReceipts.push(receipt);
      settleKnown(parserReservation.id, {
        currencyUsd: 0.001,
        requests: 1,
        bytes: retrieved.bytes.byteLength,
      });
      attempts.push(
        buildTruthfulRetrievalAttempt({
          attemptId: `attempt:${candidate.candidateId}`,
          candidateId: candidate.candidateId,
          effectId: retrievalReservation.bound.effectId,
          requestedUrl: candidate.url,
          finalUrl: retrieved.finalUrl,
          status: 'admitted',
          startedAt: retrievalReservation.createdAt,
          finishedAt: timestamp(),
          retrievedAt: retrieved.retrievedAt,
          robotsDecision: makeNotCheckedRobotsDecision({
            requestedUrl: candidate.url,
            finalUrl: retrieved.finalUrl,
            userAgent: USER_AGENT,
            policyId: ROBOTS_POLICY_ID,
            evaluatedAt: timestamp(),
          }),
          rightsStatus: makeUnknownRightsStatus({
            policyId: RIGHTS_POLICY_ID,
            observedAt: timestamp(),
          }),
          bytes: retrieved.bytes.byteLength,
        }),
      );
      snapshots.push({
        candidateId: candidate.candidateId,
        body: parsed.text,
        sourceClass: candidate.sourceClass,
        sourceFamilyId: candidate.sourceFamilyId,
      });
    } catch (error) {
      settleUnknown(parserReservation.id);
      if (error instanceof ParserPolicyError && error.receipt) {
        parserReceipts.push(ParserReceiptSchema.parse(error.receipt));
      }
      attempts.push(
        buildTruthfulRetrievalAttempt({
          attemptId: `attempt:${candidate.candidateId}`,
          candidateId: candidate.candidateId,
          effectId: retrievalReservation.bound.effectId,
          requestedUrl: candidate.url,
          finalUrl: retrieved.finalUrl,
          status: 'parser_failed',
          startedAt: retrievalReservation.createdAt,
          finishedAt: timestamp(),
          retrievedAt: retrieved.retrievedAt,
          robotsDecision: makeNotCheckedRobotsDecision({
            requestedUrl: candidate.url,
            finalUrl: retrieved.finalUrl,
            userAgent: USER_AGENT,
            policyId: ROBOTS_POLICY_ID,
            evaluatedAt: timestamp(),
          }),
          rightsStatus: makeUnknownRightsStatus({
            policyId: RIGHTS_POLICY_ID,
            observedAt: timestamp(),
          }),
          bytes: retrieved.bytes.byteLength,
          failure: RETRIEVAL_FAILURES.parser_failed,
        }),
      );
    }
  }

  const proposerReservation = reserveEffect({
    id: 'model:proposer',
    catalogEntryId: 'model-proposer-live',
    ceiling: ceiling({
      requests: 3,
      inputTokens: 120_000,
      outputTokens: 24_000,
      durationMs: 90_000,
    }),
  });
  authority.markTransportStarted(proposerReservation.id, actor);
  let seeds: readonly P9LiveClaimSeed[];
  let proposerReceipt: P9ObservedEffectReceipt;
  try {
    const proposerResult = await input.model.proposeClaims({
      plan: planBundle.plan,
      snapshots,
    });
    seeds = proposerResult.claims;
    proposerReceipt = proposerResult.receipt;
    settleObserved(proposerReservation.id, proposerReceipt);
  } catch (error) {
    settleUnknown(proposerReservation.id);
    throw error;
  }

  const evaluatorReservation = reserveEffect({
    id: 'model:evaluator',
    catalogEntryId: 'model-evaluator-live',
    ceiling: ceiling({
      requests: 3,
      inputTokens: 120_000,
      outputTokens: 24_000,
      durationMs: 90_000,
    }),
  });
  authority.markTransportStarted(evaluatorReservation.id, actor);
  let evaluatorResults: Awaited<
    ReturnType<P9LiveModelAdapter['evaluateClaims']>
  >['verdicts'];
  let evaluatorReceipt: P9ObservedEffectReceipt;
  try {
    const evaluatorResult = await input.model.evaluateClaims({
      plan: planBundle.plan,
      claims: seeds,
      snapshots,
    });
    evaluatorResults = evaluatorResult.verdicts;
    evaluatorReceipt = evaluatorResult.receipt;
    settleObserved(evaluatorReservation.id, evaluatorReceipt);
  } catch (error) {
    settleUnknown(evaluatorReservation.id);
    throw error;
  }

  if (new Set(seeds.map((seed) => seed.claimId)).size !== seeds.length) {
    throw new Error('P9 live proposer returned duplicate claim identities');
  }
  if (
    new Set(evaluatorResults.map((result) => result.claimId)).size !==
      evaluatorResults.length ||
    evaluatorResults.length !== seeds.length
  ) {
    throw new Error(
      'P9 live evaluator must return one unique verdict for every proposed claim',
    );
  }
  const evaluatorByClaimId = new Map(
    evaluatorResults.map((result) => [result.claimId, result]),
  );
  const proposals: P9ClaimProposal[] = [];
  const verdicts: P9EntailmentVerdict[] = [];
  const admissions: P9ClaimAdmission[] = [];
  const bindings: P9ClaimEvidenceBinding[] = [];
  for (const seed of seeds) {
    const snapshot = snapshots.find(
      (entry) => entry.candidateId === seed.candidateId,
    );
    const attempt = attempts.find(
      (entry) => entry.candidateId === seed.candidateId,
    );
    const evaluator = evaluatorByClaimId.get(seed.claimId);
    if (!snapshot || !attempt || !evaluator) {
      throw new Error(
        `P9 live claim ${seed.claimId} references missing source or evaluator output`,
      );
    }
    const startOffset = snapshot.body.indexOf(seed.quote);
    if (startOffset < 0) {
      throw new Error(
        `P9 live claim ${seed.claimId} quote does not match observed source bytes`,
      );
    }
    const endOffset = startOffset + seed.quote.length;
    const boundedContext = boundedSentenceContext(
      snapshot.body,
      startOffset,
      endOffset,
    );
    const locator = {
      evidenceSpanId: `span:${seed.claimId}`,
      snapshotDigest: canonicalDigest(snapshot.body),
      quoteDigest: canonicalDigest(seed.quote),
      contextDigest: canonicalDigest(boundedContext),
      coordinateSpace: COORDINATE_SPACE,
      startOffset,
      endOffset,
    };
    const proposalIdentity = {
      schemaVersion: '1.0.0' as const,
      contractFamily: 'p9.v1' as const,
      proposalId: seed.claimId,
      statement: seed.statement,
      critical: seed.critical,
      locator,
      proposerWork: modelWorkRef({
        role: 'claim_proposer',
        claimId: seed.claimId,
        profile: input.model.proposerProfile,
        rawResponseDigest: proposerReceipt.rawResponseDigest,
      }),
    };
    const proposal = P9ClaimProposalSchema.parse({
      ...proposalIdentity,
      proposalDigest: canonicalDigest(proposalIdentity),
    });
    const verdictIdentity = {
      schemaVersion: '1.0.0' as const,
      contractFamily: 'p9.v1' as const,
      verdictId: `verdict:${seed.claimId}`,
      proposalId: proposal.proposalId,
      proposalDigest: proposal.proposalDigest,
      evaluatedStatement: seed.statement,
      evaluatedQuote: seed.quote,
      boundedContext,
      locator,
      verdict: evaluator.verdict,
      semanticDeltas: [...(evaluator.semanticDeltas ?? [])],
      hostileInstructionDetected: false,
      reasonCodes: [
        ...(evaluator.reasonCodes ?? ['live_independent_evaluation']),
      ],
      evaluatorWork: modelWorkRef({
        role: 'entailment_evaluator',
        claimId: seed.claimId,
        profile: input.model.evaluatorProfile,
        rawResponseDigest: evaluatorReceipt.rawResponseDigest,
      }),
      evaluatedAt: timestamp(),
    };
    const verdict = P9EntailmentVerdictSchema.parse({
      ...verdictIdentity,
      verdictDigest: canonicalDigest(verdictIdentity),
    });
    const admission = evaluateP9ClaimAdmission({
      proposal,
      verdict,
      decidedAt: timestamp(),
    });
    const evidenceIdentity = {
      candidateId: seed.candidateId,
      attemptId: attempt.attemptId,
      attemptDigest: canonicalDigest(attempt),
      snapshotDigest: canonicalDigest(snapshot.body),
      subquestionIds: [...seed.subquestionIds],
      sourceClass: snapshot.sourceClass,
      sourceFamilyId: snapshot.sourceFamilyId,
      claimGroupId: seed.claimGroupId,
      contradictionIds: [...seed.contradictionIds],
      reportSectionId: seed.sectionId,
    };
    proposals.push(proposal);
    verdicts.push(verdict);
    admissions.push(admission);
    bindings.push({
      proposal,
      admission,
      evidence: {
        ...evidenceIdentity,
        evidenceDigest: canonicalDigest(evidenceIdentity),
      },
    });
  }

  const run = compileP9ObservedResearchBundle({
    executionId: input.executionId,
    now: timestamp(),
    ...planBundle,
    thresholds: input.thresholds ?? defaultCoverageThresholds(),
    budgetSnapshot: authority.snapshot(),
    attempts,
    parserReceipts,
    proposals,
    verdicts,
    admissions,
    bindings,
    snapshots,
    stopCriterionFindings: stopCriterionFindings(
      planBundle.plan,
      bindings,
      authority.snapshot(),
    ),
  });
  verifyP9ExactBundle(run.artifacts);
  return { ...run, exactBundleVerified: true };
}

export function buildAcceptedP9LivePlan(input: {
  readonly budgetUsd: number;
  readonly now: string;
  readonly proposerProfile: P9LiveModelProfile;
}): {
  readonly planProposal: ResearchPlanProposal;
  readonly plan: ResearchPlan;
  readonly acceptanceReceipt: ReturnType<typeof acceptResearchPlan>['receipt'];
  readonly pack: DomainPolicyPack;
} {
  const pack = P9_DOMAIN_POLICY_PACKS['technical-due-diligence/v1'];
  const content = {
    question: P9_LIVE_EXHIBITION_QUESTION,
    domainPackId: 'technical-due-diligence/v1' as const,
    packDigest: pack.packDigest,
    scope: {
      include: [
        'current upstream JustVugg/colibri repository behavior',
        '128 GB Apple-silicon bounded first-change recommendation',
        'experiment design that separates improvement from measurement noise',
      ],
      exclusions: [
        {
          exclusionId: 'ex-solver-execution',
          statement:
            'No repository mutation, local benchmarking, package installation, or claim that Mammoth solved colibri is authorized in P9.',
        },
      ],
    },
    subquestions: [
      {
        subquestionId: 'sq-upstream',
        question:
          'Which current upstream colibri code and documentation facts constrain a bounded first change?',
        mandatory: true,
      },
      {
        subquestionId: 'sq-apple-silicon',
        question:
          'Which Apple silicon memory and performance facts matter on a 128 GB machine?',
        mandatory: true,
      },
      {
        subquestionId: 'sq-experiment',
        question:
          'What controlled experiment would distinguish a real colibri improvement from measurement noise?',
        mandatory: true,
      },
      {
        subquestionId: 'sq-risk',
        question:
          'What correctness, security, or maintenance risks could falsify the recommended bounded colibri change?',
        mandatory: true,
      },
    ],
    coverageRequirements: [
      {
        coverageId: 'cov-upstream',
        subquestionId: 'sq-upstream',
        description:
          'Repository code or documentation grounds current colibri behavior.',
        mandatory: true,
      },
      {
        coverageId: 'cov-apple',
        subquestionId: 'sq-apple-silicon',
        description:
          'Primary technical sources ground 128 GB Apple-silicon constraints.',
        mandatory: true,
      },
      {
        coverageId: 'cov-experiment',
        subquestionId: 'sq-experiment',
        description:
          'Experiment protocol includes repetition, baseline, metrics, and noise threshold.',
        mandatory: true,
      },
      {
        coverageId: 'cov-risk',
        subquestionId: 'sq-risk',
        description: 'Risks and falsifiers remain visible.',
        mandatory: true,
      },
    ],
    sourceClassTargets: [
      {
        sourceClass: 'repository_code',
        minimumIndependentSources: 1,
        mandatory: true,
      },
      {
        sourceClass: 'repository_docs',
        minimumIndependentSources: 1,
        mandatory: true,
      },
      {
        sourceClass: 'upstream_model_docs',
        minimumIndependentSources: 1,
        mandatory: true,
      },
      {
        sourceClass: 'hardware_vendor_docs',
        minimumIndependentSources: 1,
        mandatory: true,
      },
      {
        sourceClass: 'peer_reviewed_or_primary_technical',
        minimumIndependentSources: 1,
        mandatory: true,
      },
      {
        sourceClass: 'security_advisory',
        minimumIndependentSources: 1,
        mandatory: true,
      },
    ],
    searchQueries: [
      {
        queryId: 'q-colibri-repo',
        query:
          'JustVugg colibri GitHub README source code GLM MoE Apple silicon',
        subquestionIds: ['sq-upstream'],
      },
      {
        queryId: 'q-colibri-implementation',
        query:
          'JustVugg colibri mmap cache quantization expert offload source code',
        subquestionIds: ['sq-upstream', 'sq-risk'],
      },
      {
        queryId: 'q-apple-silicon',
        query:
          'Apple-silicon 128 GB machine unified memory bandwidth developer documentation',
        subquestionIds: ['sq-apple-silicon'],
      },
      {
        queryId: 'q-experiment',
        query:
          'experiment LLM inference benchmark statistical significance repeated runs measurement noise',
        subquestionIds: ['sq-experiment'],
      },
      {
        queryId: 'q-security',
        query:
          'C C++ mmap model inference security advisory bounds checking memory mapped files',
        subquestionIds: ['sq-risk'],
      },
    ],
    contradictionRequirements: [
      {
        contradictionId: 'contradiction-performance-vs-correctness',
        description:
          'Seek evidence that a performance-oriented colibri change could harm correctness or router semantics.',
      },
      {
        contradictionId: 'contradiction-noise-vs-improvement',
        description:
          'Seek evidence that apparent decode-speed gains can be measurement noise without repeated controlled runs.',
      },
    ],
    freshnessRequirements: [
      {
        freshnessId: 'fresh-repository-current',
        appliesTo: 'current upstream repository',
        maxAgeDays: 30,
        asOfDateRequired: true,
      },
      {
        freshnessId: 'fresh-technical-sources',
        appliesTo: 'primary technical sources',
        maxAgeDays: 1095,
        asOfDateRequired: false,
      },
    ],
    stopCriteria: [
      {
        stopId: 'stop-source-classes',
        description:
          'Required source classes are either covered by terminal attempts or explicitly insufficient.',
      },
      {
        stopId: 'stop-bounded-change',
        description:
          'At least one admitted critical claim supports a bounded first colibri change and one admitted claim supports its experiment.',
      },
      {
        stopId: 'stop-budget-terminal',
        description:
          'All P9 live budget reservations have terminal settlement, release, or conservative unknown-cost accounting.',
      },
    ],
    reportOutline: {
      sections: [
        { sectionId: 'executive_summary', title: 'executive summary' },
        {
          sectionId: 'upstream_colibri_facts',
          title: 'upstream colibri facts',
        },
        {
          sectionId: 'apple_silicon_constraints',
          title: 'apple silicon constraints',
        },
        { sectionId: 'first_bounded_change', title: 'first bounded change' },
        { sectionId: 'experiment_design', title: 'experiment design' },
        {
          sectionId: 'risks_and_contradictions',
          title: 'risks and contradictions',
        },
      ],
    },
    budget: {
      currencyUsd: input.budgetUsd,
      searchUsd: 0.25,
      retrievalParsingUsd: 0.5,
      modelsUsd: Math.max(0, input.budgetUsd - 0.75),
    },
    criticalClaimPolicy:
      'independent_entailment_distinct_profile_family' as const,
    derivations: {
      scope: {
        source: 'question' as const,
        questionTerms: ['upstream', 'colibri'],
      },
      subquestions: {
        source: 'question' as const,
        questionTerms: [
          'upstream',
          'colibri',
          'bounded',
          'first',
          'change',
          'machine',
          'experiment',
          'noise',
        ],
      },
      coverage: { source: 'domain_pack' as const, questionTerms: [] },
      source_classes: { source: 'domain_pack' as const, questionTerms: [] },
      search_queries: {
        source: 'question' as const,
        questionTerms: [
          'justvugg',
          'colibri',
          'apple-silicon',
          'experiment',
          'measurement',
          'noise',
        ],
      },
      contradictions: { source: 'domain_pack' as const, questionTerms: [] },
      freshness: { source: 'domain_pack' as const, questionTerms: [] },
      stop_criteria: { source: 'domain_pack' as const, questionTerms: [] },
      outline: { source: 'domain_pack' as const, questionTerms: [] },
      budget: { source: 'operator' as const, questionTerms: [] },
    },
  };
  const proposerWork = {
    workId: 'p9-live-plan-proposer',
    workDigest: canonicalDigest({
      question: P9_LIVE_EXHIBITION_QUESTION,
      model: input.proposerProfile.modelId,
    }),
    rawResponseDigest: canonicalDigest({ plan: content }),
    role: 'plan_proposer' as const,
    profileVersionId: input.proposerProfile.profileVersionId,
    profileFamilyId: input.proposerProfile.profileFamilyId,
  };
  const proposalIdentity = {
    schemaVersion: '1.0.0' as const,
    contractFamily: 'p9.v1' as const,
    proposalId: 'p9-live-colibri-plan-proposal',
    ...content,
    proposerWork,
    proposedAt: input.now,
  };
  const planProposal = ResearchPlanProposalSchema.parse({
    ...proposalIdentity,
    proposalDigest: canonicalDigest(proposalIdentity),
  });
  const accepted = acceptResearchPlan({
    proposal: planProposal,
    thresholds: {
      minSubquestions: 4,
      minSourceClasses: 6,
      minContradictionRequirements: 2,
      maxAuthorizedUsd: 5,
      minQuestionDerivedTerms: 4,
    },
    decidedAt: input.now,
    actorId: 'p9-live-operator',
    planId: 'p9-live-colibri-plan',
  });
  if (!accepted.plan) {
    throw new Error(
      `P9 live accepted plan was unexpectedly rejected: ${accepted.receipt.reasonCodes.join(', ')}`,
    );
  }
  return {
    planProposal,
    plan: accepted.plan,
    acceptanceReceipt: accepted.receipt,
    pack,
  };
}

function defaultCoverageThresholds(): PlanCoverageThresholds {
  return {
    minAdmittedClaims: 4,
    minCriticalClaims: 1,
    minIndependentFamiliesPerCriticalClaim: 1,
    minMandatorySourceClassCoverageRatio: 0.5,
  };
}

function stopCriterionFindings(
  plan: ResearchPlan,
  bindings: readonly P9ClaimEvidenceBinding[],
  snapshot: ReturnType<P9BudgetAuthority['snapshot']>,
): readonly P9StopCriterionFinding[] {
  const admitted = bindings.filter(
    (binding) => binding.admission.decision === 'admitted',
  );
  const subquestions = new Set(
    admitted.flatMap((binding) => binding.evidence.subquestionIds),
  );
  const hasCritical = admitted.some((binding) => binding.proposal.critical);
  const sourceClasses = new Set(
    admitted.map((binding) => binding.evidence.sourceClass),
  );
  const hasExperiment = admitted.some((binding) =>
    binding.evidence.subquestionIds.includes('sq-experiment'),
  );
  const openReservations = snapshot.reservations.filter(
    (reservation) => reservation.state === 'reserved',
  );
  return plan.stopCriteria.map((criterion) => {
    if (criterion.stopId === 'stop-budget-terminal') {
      return {
        stopId: criterion.stopId,
        met: openReservations.length === 0,
        reason:
          openReservations.length === 0
            ? 'all live effect reservations reached terminal accounting'
            : `open reservations: ${openReservations.map((entry) => entry.id).join(', ')}`,
      };
    }
    if (criterion.stopId === 'stop-bounded-change') {
      return {
        stopId: criterion.stopId,
        met: hasCritical && hasExperiment,
        reason:
          hasCritical && hasExperiment
            ? 'admitted claims support both the bounded-change decision and experiment design'
            : 'bounded-change stop requires an admitted critical claim and an admitted experiment claim',
      };
    }
    if (criterion.stopId === 'stop-source-classes') {
      const missing = plan.sourceClassTargets
        .filter((target) => target.mandatory)
        .map((target) => target.sourceClass)
        .filter((sourceClass) => !sourceClasses.has(sourceClass));
      return {
        stopId: criterion.stopId,
        met: missing.length === 0,
        reason:
          missing.length === 0
            ? 'all mandatory source classes have admitted coverage'
            : `missing mandatory source classes: ${missing.join(', ')}`,
      };
    }
    return {
      stopId: criterion.stopId,
      met: plan.subquestions.every((subquestion) =>
        subquestions.has(subquestion.subquestionId),
      ),
      reason: 'live admitted claims were checked against plan subquestions',
    };
  });
}

function buildP9LiveCatalog(): ProviderPriceCatalog {
  const entries = [
    {
      id: 'brave-search',
      provider: 'brave-search',
      effectKind: 'search' as const,
      parserClass: null,
      flatCostUsd: 0.01,
      costPerRequestUsd: 0,
      costPerInputTokenUsd: 0,
      costPerOutputTokenUsd: 0,
      costPerByteUsd: 0,
    },
    {
      id: 'public-retrieval',
      provider: 'p9-pinned-retrieval',
      effectKind: 'retrieval' as const,
      parserClass: null,
      flatCostUsd: 0.002,
      costPerRequestUsd: 0,
      costPerInputTokenUsd: 0,
      costPerOutputTokenUsd: 0,
      costPerByteUsd: 1e-9,
    },
    {
      id: 'bounded-parser',
      provider: 'p9-bounded-parser',
      effectKind: 'parser' as const,
      parserClass: 'text/plain',
      flatCostUsd: 0.001,
      costPerRequestUsd: 0,
      costPerInputTokenUsd: 0,
      costPerOutputTokenUsd: 0,
      costPerByteUsd: 0,
    },
    {
      id: 'model-proposer-live',
      provider: 'openai-compatible-proposer',
      effectKind: 'model' as const,
      parserClass: null,
      flatCostUsd: 0.45,
      costPerRequestUsd: 0,
      costPerInputTokenUsd: 0,
      costPerOutputTokenUsd: 0,
      costPerByteUsd: 0,
    },
    {
      id: 'model-evaluator-live',
      provider: 'openai-compatible-evaluator',
      effectKind: 'model' as const,
      parserClass: null,
      flatCostUsd: 0.45,
      costPerRequestUsd: 0,
      costPerInputTokenUsd: 0,
      costPerOutputTokenUsd: 0,
      costPerByteUsd: 0,
    },
  ];
  const identity = {
    schemaVersion: '1.0.0' as const,
    contractFamily: 'p9.v1' as const,
    catalogId: 'p9-live-conservative-catalog',
    version: '1.0.0',
    entries,
  };
  return { ...identity, catalogDigest: priceCatalogDigest(identity) };
}

function modelWorkRef(input: {
  readonly role: P9ModelWorkRef['role'];
  readonly claimId: string;
  readonly profile: P9LiveModelProfile;
  readonly rawResponseDigest: string;
}): P9ModelWorkRef {
  return {
    workId: `work:${input.role}:${input.claimId}`,
    workDigest: canonicalDigest({
      role: input.role,
      claimId: input.claimId,
      modelId: input.profile.modelId,
    }),
    rawResponseDigest: input.rawResponseDigest,
    role: input.role,
    profileVersionId: input.profile.profileVersionId,
    profileFamilyId: input.profile.profileFamilyId,
  };
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

function budgetVector(input: Partial<P9BudgetVector>): P9BudgetVector {
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
  const following = [
    body.indexOf('.', endOffset),
    body.indexOf('!', endOffset),
    body.indexOf('?', endOffset),
    body.indexOf('\n', endOffset),
  ].filter((index) => index >= 0);
  const contextEnd = endsAtBoundary
    ? endOffset
    : following.length === 0
      ? body.length
      : Math.min(...following) + 1;
  return body.slice(priorBoundary + 1, contextEnd).trim();
}

function normalizeLiveCandidate(candidate: P9LiveCandidate): P9LiveCandidate {
  const classified = classifySource(candidate.url);
  return {
    ...candidate,
    sourceClass: classified.sourceClass,
    sourceFamilyId: classified.sourceFamilyId,
  };
}

function classifySource(url: string): {
  readonly sourceClass: string;
  readonly sourceFamilyId: string;
} {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      sourceClass: UNCLASSIFIED_SOURCE_CLASS,
      sourceFamilyId: 'invalid-url',
    };
  }
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.toLowerCase();
  if (hostMatches(host, 'github.com') && path.startsWith('/justvugg/colibri')) {
    const sourceClass =
      path.includes('readme') || path.includes('/docs/')
        ? 'repository_docs'
        : 'repository_code';
    return { sourceClass, sourceFamilyId: 'github.com/JustVugg/colibri' };
  }
  if (hostMatches(host, 'apple.com')) {
    return {
      sourceClass: 'hardware_vendor_docs',
      sourceFamilyId: 'apple.com',
    };
  }
  if (hostMatches(host, 'huggingface.co')) {
    return {
      sourceClass: 'upstream_model_docs',
      sourceFamilyId: 'huggingface.co',
    };
  }
  if (
    hostMatches(host, 'arxiv.org') ||
    hostMatches(host, 'doi.org') ||
    hostMatches(host, 'acm.org') ||
    hostMatches(host, 'ieee.org')
  ) {
    return {
      sourceClass: 'peer_reviewed_or_primary_technical',
      sourceFamilyId: host,
    };
  }
  if (
    hostMatches(host, 'nvd.nist.gov') ||
    hostMatches(host, 'cve.org') ||
    (hostMatches(host, 'github.com') && path.includes('/security/advisories'))
  ) {
    return {
      sourceClass: 'security_advisory',
      sourceFamilyId: host,
    };
  }
  return {
    sourceClass: UNCLASSIFIED_SOURCE_CLASS,
    sourceFamilyId: host,
  };
}

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

const RETRIEVAL_FAILURES = {
  unavailable: {
    code: 'source_unavailable',
    message: 'source acquisition failed before admissible bytes were parsed',
    retryable: true,
    policyEffect: 'none',
  },
  timed_out: {
    code: 'source_timeout',
    message: 'source acquisition timed out',
    retryable: true,
    policyEffect: 'retry_bounded',
  },
  parser_failed: {
    code: 'parser_output_invalid',
    message: 'bounded parser could not produce valid output',
    retryable: false,
    policyEffect: 'fail_closed',
  },
} as const;

export class BraveP9LiveSearchAdapter implements P9LiveSearchAdapter {
  constructor(private readonly apiKey: string) {}

  async search(query: string): Promise<{
    readonly candidates: readonly P9LiveCandidate[];
    readonly receipt: P9ObservedEffectReceipt;
  }> {
    const startedAt = new Date().toISOString();
    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', query);
    url.searchParams.set('count', '5');
    const response = await fetch(url, {
      headers: {
        accept: 'application/json',
        'x-subscription-token': this.apiKey,
      },
    });
    if (!response.ok) {
      throw new Error(
        `Brave search failed with HTTP ${String(response.status)}`,
      );
    }
    const body = await response.text();
    const parsed = BraveSearchResponseSchema.parse(JSON.parse(body));
    const candidates = parsed.web.results.map((result, index) => {
      const classified = classifySource(result.url);
      return {
        candidateId: `brave:${canonicalDigest(result.url).slice(7, 19)}:${String(index)}`,
        url: result.url,
        title: result.title,
        sourceClass: classified.sourceClass,
        sourceFamilyId: classified.sourceFamilyId,
      };
    });
    return {
      candidates,
      receipt: {
        provider: 'brave-search',
        operationKind: 'search',
        rawResponseDigest: canonicalDigest(body),
        actual: {
          currencyUsd: 0.01,
          requests: 1,
          bytes: new TextEncoder().encode(body).byteLength,
        },
        startedAt,
        finishedAt: new Date().toISOString(),
      },
    };
  }
}

const BraveSearchResponseSchema = z
  .object({
    web: z
      .object({
        results: z
          .array(
            z
              .object({
                title: z.string(),
                url: z.string().url(),
              })
              .passthrough(),
          )
          .default([]),
      })
      .default({ results: [] }),
  })
  .passthrough();
