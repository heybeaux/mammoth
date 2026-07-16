import {
  canonicalDigest,
  ParserReceiptSchema,
  PlanAcceptanceReceiptSchema,
  P9ClaimProposalSchema,
  P9EffectReceiptSchema,
  P9EntailmentVerdictSchema,
  P9ExecutionReceiptSchema,
  ProviderPriceCatalogSchema,
  ResearchPlanProposalSchema,
  type DomainPolicyPack,
  type EffectRequestCeiling,
  type P9ClaimAdmission,
  type P9ClaimProposal,
  type P9EffectReceipt,
  type P9EntailmentVerdict,
  type P9ExecutionReceipt,
  P9LiveAuthorityReceiptSchema,
  P9ProviderProfileCatalogSchema,
  type P9LiveAuthorityReceipt,
  type P9ProviderProfileCatalog,
  type P9ProviderProfile,
  type P9ModelWorkRef,
  type P9ObservedUsage,
  type P9SemanticDelta,
  type ParserReceipt,
  type ResearchPlan,
  type ResearchPlanProposal,
  type RetrievalAttempt,
  ResearchPlanSchema,
  RetrievalAttemptSchema,
} from '@mammoth/domain';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import {
  detectP9SemanticDeltas,
  evaluateP9ClaimAdmission,
} from '@mammoth/evidence';
import {
  acceptResearchPlan,
  assertP9LiveAuthorityLineage,
  GovernanceError,
  P9DurableBudgetAuthority,
  MemoryP9DurableJournalStore,
  P9DurableJournalRecordSchema,
  P9_DOMAIN_POLICY_PACKS,
  isClaimRelevantToSubquestion,
  type P9BudgetAuthority,
  type P9BudgetReservation,
  type P9ClaimEvidenceBinding,
  type P9DurableJournalStore,
  type P9StopCriterionFinding,
  type PlanCoverageThresholds,
} from '@mammoth/governance';
import {
  AcquisitionFailure,
  BoundedParserRegistry,
  buildTruthfulRetrievalAttempt,
  canonicalizeAcquisitionUrl,
  makeNotCheckedRobotsDecision,
  makeUnknownRightsStatus,
  ParserPolicyError,
  retrieveSource,
  type ParsedArtifact,
  type RetrievedSource,
} from '@mammoth/retrieval';
import { z } from 'zod';
import {
  boundedP9SentenceContext,
  compileP9ObservedResearchBundle,
  verifyP9ExactBundle,
  type P9GenericResearchRun,
  type P9ObservedSourceSnapshot,
} from './p9-generic-research.js';
import {
  P9LiveEffectExecutor,
  priceObservedUsage,
  type P9LiveEffectObservation,
} from './p9-live-executor.js';

export const P9_LIVE_EXHIBITION_QUESTION =
  'Using the current upstream repository and primary technical sources, which bounded change to JustVugg/colibri should be tested first on a 128 GB Apple-silicon machine, and what experiment would distinguish a real improvement from measurement noise?';
export const P9_LIVE_SOURCE_CLASSIFICATION_POLICY_DIGEST = canonicalDigest(
  'p9-live-source-classification/v3',
);

const USER_AGENT = 'mammoth-research/0.9';
const ROBOTS_POLICY_ID = 'p9-live-robots-not-checked/v1';
const RIGHTS_POLICY_ID = 'p9-live-rights-unknown/v1';
const COORDINATE_SPACE = 'utf16-code-units/v1';
const CURRENT_COMMIT_DATE_POLICY_ID = 'p9-live-current-commit-date/v1';
const P9_LIVE_PARSER_CLASS = 'mammoth-deterministic-text';
const P9_LIVE_COLIBRI_COMMIT_SHA = '12d3bd51405fc95e40686ce686b5e4ebeb12aa7b';

export interface P9LiveCandidate {
  readonly candidateId: string;
  readonly url: string;
  readonly title: string;
  readonly sourceClass: string;
  readonly sourceFamilyId: string;
}

/**
 * The release exhibition has six mandatory source classes. Search remains a
 * governed discovery effect, but ranking volatility must not be able to crowd
 * an entire mandatory class out of the bounded retrieval budget. These exact
 * primary-source targets are therefore seeded before search results are
 * backfilled.
 */
const P9_LIVE_MANDATORY_SOURCE_CANDIDATES: readonly P9LiveCandidate[] = [
  {
    candidateId: 'pinned:colibri-metal-source',
    url: `https://raw.githubusercontent.com/JustVugg/colibri/${P9_LIVE_COLIBRI_COMMIT_SHA}/c/backend_metal.mm`,
    title: 'JustVugg/colibri Metal backend source',
    sourceClass: 'repository_code',
    sourceFamilyId: 'github.com',
  },
  {
    candidateId: 'pinned:colibri-repository-docs',
    url: `https://github.com/JustVugg/colibri/blob/${P9_LIVE_COLIBRI_COMMIT_SHA}/README.md`,
    title: 'JustVugg/colibri repository documentation',
    sourceClass: 'repository_docs',
    sourceFamilyId: 'github.com',
  },
  {
    candidateId: 'pinned:glm-5-model-card',
    url: 'https://huggingface.co/zai-org/GLM-5',
    title: 'Official GLM-5 model card',
    sourceClass: 'upstream_model_docs',
    sourceFamilyId: 'huggingface.co',
  },
  {
    candidateId: 'pinned:apple-m4-max-specification',
    url: 'https://www.apple.com/newsroom/2024/10/apple-introduces-m4-pro-and-m4-max/',
    title: 'Apple M4 Max unified-memory specification',
    sourceClass: 'hardware_vendor_docs',
    sourceFamilyId: 'apple.com',
  },
  {
    candidateId: 'pinned:repeated-run-evaluation-study',
    url: 'https://arxiv.org/html/2509.24086v1',
    title: 'Primary repeated-run evaluation study',
    sourceClass: 'peer_reviewed_or_primary_technical',
    sourceFamilyId: 'arxiv.org',
  },
  {
    candidateId: 'pinned:cisa-memory-safety-guidance',
    url: 'https://www.cisa.gov/resources-tools/resources/case-memory-safe-roadmaps',
    title: 'CISA memory-safe coding guidance',
    sourceClass: 'security_advisory',
    sourceFamilyId: 'cisa.gov',
  },
];

export interface P9LiveSearchOutcome {
  readonly candidates: readonly P9LiveCandidate[];
  readonly usage: P9ObservedUsage | null;
}

export interface P9LiveSearchAdapter {
  readonly destinationOrigin: string;
  readonly search: (query: string) => Promise<P9LiveSearchOutcome>;
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

export interface P9LiveModelOutcome<T> {
  readonly value: T;
  readonly usage: P9ObservedUsage | null;
}

export interface P9LiveEvaluatorFinding {
  readonly claimId: string;
  readonly verdict: 'entailed' | 'contradicted' | 'insufficient';
  readonly semanticDeltas?: readonly P9SemanticDelta[] | undefined;
  readonly reasonCodes?: readonly string[] | undefined;
}

export interface P9LiveNarrativeSection {
  readonly sectionId: string;
  readonly lead: string;
  readonly claimIds: readonly string[];
}

export interface P9LiveModelAdapter {
  readonly proposeClaims: (input: {
    readonly plan: ResearchPlan;
    readonly snapshots: readonly P9ObservedSourceSnapshot[];
  }) => Promise<P9LiveModelOutcome<readonly P9LiveClaimSeed[]>>;
  readonly evaluateClaims: (input: {
    readonly plan: ResearchPlan;
    readonly claims: readonly P9LiveClaimSeed[];
    readonly snapshots: readonly P9ObservedSourceSnapshot[];
  }) => Promise<P9LiveModelOutcome<readonly P9LiveEvaluatorFinding[]>>;
  readonly synthesizeReport: (input: {
    readonly plan: ResearchPlan;
    readonly claims: readonly P9LiveClaimSeed[];
    readonly admittedClaimIds: readonly string[];
  }) => Promise<P9LiveModelOutcome<readonly P9LiveNarrativeSection[]>>;
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
  readonly authorizationReceipt: unknown;
  readonly catalog: unknown;
  readonly providerProfileCatalog: unknown;
  readonly expectedAuthorityDigest: string;
  readonly trustedIssuerId: string;
  readonly sourceClassificationPolicyDigest?: string;
  readonly journal: P9DurableJournalStore;
  readonly search: P9LiveSearchAdapter;
  readonly model: P9LiveModelAdapter;
  readonly now?: () => Date;
  readonly retrieve?: typeof retrieveSource;
  readonly parserRegistry?: BoundedParserRegistry;
  readonly thresholds?: PlanCoverageThresholds;
  readonly maxCandidates?: number;
  readonly includeMandatorySourceTargets?: boolean;
}

export interface P9LiveApplicationRun extends P9GenericResearchRun {
  readonly exactBundleVerified: boolean;
  readonly authorizationReceipt: P9LiveAuthorityReceipt;
  readonly providerProfileCatalog: P9ProviderProfileCatalog;
  readonly effectReceipts: readonly P9EffectReceipt[];
  readonly recoveredReservations: readonly P9BudgetReservation[];
}

export interface P9LiveBundleVerification {
  readonly manifest: ReturnType<typeof verifyP9ExactBundle>['manifest'];
  readonly verifiedCitationCount: number;
  readonly effectReceiptCount: number;
  readonly journalRecordCount: number;
  readonly spent: ReturnType<P9DurableBudgetAuthority['snapshot']>['spent'];
  readonly coverageVerdict: P9ExecutionReceipt['coverageVerdict'];
}

export function assertP9LiveBundleReleaseable(
  verification: P9LiveBundleVerification,
): void {
  if (
    verification.coverageVerdict !== 'covered' ||
    verification.verifiedCitationCount === 0
  ) {
    throw new Error(
      'P9 live bundle is not releaseable: covered evidence and at least one verified citation are required',
    );
  }
}

export function verifyP9LiveBundle(
  artifacts: Readonly<Record<string, string>>,
  trust: {
    readonly expectedAuthorityDigest: string;
    readonly trustedIssuerId: string;
  },
): P9LiveBundleVerification {
  const exact = verifyP9ExactBundle(artifacts);
  const authorityReceipt = P9LiveAuthorityReceiptSchema.parse(
    parseRequiredJson(artifacts, 'live-authority-receipt.json'),
  );
  const catalog = ProviderPriceCatalogSchema.parse(
    parseRequiredJson(artifacts, 'live-price-catalog.json'),
  );
  const profileCatalog = P9ProviderProfileCatalogSchema.parse(
    parseRequiredJson(artifacts, 'live-provider-profile-catalog.json'),
  );
  const plan = ResearchPlanSchema.parse(
    parseRequiredJson(artifacts, 'research-plan.json'),
  );
  const acceptanceReceipt = PlanAcceptanceReceiptSchema.parse(
    parseRequiredJson(artifacts, 'plan-acceptance-receipt.json'),
  );
  const executionReceipt = P9ExecutionReceiptSchema.parse(
    parseRequiredJson(artifacts, 'execution-receipt.json'),
  );
  if (
    Date.parse(executionReceipt.startedAt) <
      Date.parse(authorityReceipt.notBeforeAt) ||
    Date.parse(executionReceipt.finishedAt) >=
      Date.parse(authorityReceipt.expiresAt)
  ) {
    throw new Error(
      'P9 live bundle execution falls outside its authority window',
    );
  }
  const lineage = assertP9LiveAuthorityLineage({
    receipt: authorityReceipt,
    profileCatalog,
    priceCatalog: catalog,
    plan,
    acceptanceReceipt,
    expectedAuthorityDigest: trust.expectedAuthorityDigest,
    trustedIssuerId: trust.trustedIssuerId,
    executionId: authorityReceipt.executionId,
    question: P9_LIVE_EXHIBITION_QUESTION,
    sourceClassificationPolicyDigest:
      P9_LIVE_SOURCE_CLASSIFICATION_POLICY_DIGEST,
    now: executionReceipt.startedAt,
  });
  if (
    lineage.proposerProfile.destinationOrigin !==
      lineage.evaluatorProfile.destinationOrigin ||
    lineage.proposerProfile.credentialEnvVar !==
      lineage.evaluatorProfile.credentialEnvVar ||
    lineage.proposerProfile.billingAccountId !==
      lineage.evaluatorProfile.billingAccountId ||
    lineage.proposerProfile.provider !== lineage.evaluatorProfile.provider
  ) {
    throw new Error(
      'P9 live bundle model profiles do not match the shared model transport',
    );
  }
  const authorizedRetrievalOrigins = new Set(
    authorityReceipt.authorizedRetrievalOrigins.map(
      (value) => new URL(value).origin,
    ),
  );
  for (const attempt of parseRequiredJsonLines(
    artifacts,
    'retrieval-attempts.jsonl',
  ).map((value) => RetrievalAttemptSchema.parse(value))) {
    for (const value of [attempt.requestedUrl, attempt.finalUrl].filter(
      (candidate): candidate is string => Boolean(candidate),
    )) {
      if (!authorizedRetrievalOrigins.has(new URL(value).origin)) {
        throw new Error(
          `P9 live bundle retrieval origin is unauthorized: ${new URL(value).origin}`,
        );
      }
    }
  }
  const journalLines = requiredArtifact(artifacts, 'live-budget-journal.jsonl')
    .trimEnd()
    .split('\n')
    .filter(Boolean);
  const journalRecords = journalLines.map((line) =>
    P9DurableJournalRecordSchema.parse(JSON.parse(line)),
  );
  const replayStore = new MemoryP9DurableJournalStore(
    authorityReceipt.consumptionStoreId,
  );
  for (const line of journalLines) replayStore.appendDurable(line);
  const replay = P9DurableBudgetAuthority.open(
    {
      accountId: `p9-live:${authorityReceipt.executionId}`,
      programId: authorityReceipt.executionId,
      catalog,
      limit: authorityReceipt.budgetLimit,
      authorizationReceipt: authorityReceipt,
      store: replayStore,
      actorId: 'p9-live-bundle-verifier',
    },
    () => authorityReceipt.authorizedAt,
  );
  const snapshot = replay.snapshot();
  const effectReceipts = parseRequiredJsonLines(
    artifacts,
    'live-effect-receipts.jsonl',
  ).map((value) => P9EffectReceiptSchema.parse(value));
  const receiptByEffectId = new Map(
    effectReceipts.map((receipt) => [receipt.effectId, receipt]),
  );
  if (receiptByEffectId.size !== effectReceipts.length) {
    throw new Error('P9 live bundle contains duplicate effect receipts');
  }
  for (const reservation of snapshot.reservations) {
    if (reservation.state === 'released') continue;
    const receipt = receiptByEffectId.get(reservation.bound.effectId);
    const entry = catalog.entries.find(
      (candidate) => candidate.id === reservation.bound.catalogEntryId,
    );
    const expectedReceiptCostState =
      reservation.settlementCostState === 'known'
        ? 'observed'
        : reservation.settlementCostState;
    const expectedUsageSource =
      receipt?.costState === 'observed'
        ? reservation.bound.effectKind === 'model'
          ? 'provider_reported'
          : 'measured_transport'
        : 'absent';
    const observedCharge =
      receipt?.observedUsage && entry
        ? priceObservedUsage(entry, receipt.observedUsage)
        : null;
    const terminalRecord = journalRecords.findLast(
      (record) =>
        (record.entry.kind === 'settle' || record.entry.kind === 'cancel') &&
        record.entry.reservationId === reservation.id,
    );
    const transportRecord = journalRecords.find(
      (record) =>
        record.entry.kind === 'transport_started' &&
        record.entry.reservationId === reservation.id,
    );
    const settledAt = receipt ? Date.parse(receipt.settledAt) : Number.NaN;
    const mismatches = [
      !receipt && 'missing receipt',
      !entry && 'missing catalog entry',
      receipt?.catalogDigest !== catalog.catalogDigest && 'catalog digest',
      receipt?.receiptId !== `effect-receipt:${reservation.id}` && 'receipt id',
      receipt?.catalogEntryId !== reservation.bound.catalogEntryId &&
        'catalog entry',
      receipt?.provider !== reservation.bound.provider && 'provider',
      receipt?.effectKind !== reservation.bound.effectKind && 'effect kind',
      receipt?.idempotencyKey !== reservation.bound.idempotencyKey &&
        'idempotency key',
      receipt?.costState !== expectedReceiptCostState && 'cost state',
      receipt?.usageSource !== expectedUsageSource && 'usage source',
      (!transportRecord ||
        !terminalRecord ||
        settledAt < Date.parse(transportRecord.at) ||
        settledAt > Date.parse(terminalRecord.at)) &&
        'settled timestamp',
      receipt?.costState === 'observed' &&
        (!observedCharge ||
          canonicalDigest(observedCharge) !==
            canonicalDigest(reservation.charged)) &&
        'observed usage pricing',
      receipt &&
        canonicalDigest(receipt.charged) !==
          canonicalDigest(reservation.charged) &&
        'charged amount',
    ].filter((value): value is string => typeof value === 'string');
    if (mismatches.length > 0) {
      throw new Error(
        `P9 live bundle effect receipt does not match journaled reservation ${reservation.id}: ${mismatches.join(', ')}`,
      );
    }
    receiptByEffectId.delete(reservation.bound.effectId);
  }
  if (receiptByEffectId.size > 0) {
    throw new Error('P9 live bundle contains effects absent from the journal');
  }
  const recovered = parseRequiredJsonLines(
    artifacts,
    'live-recovered-reservations.jsonl',
  );
  for (const value of recovered) {
    const id =
      typeof value === 'object' && value !== null && 'id' in value
        ? String(value.id)
        : '';
    const reservation = snapshot.reservations.find((entry) => entry.id === id);
    if (
      !reservation ||
      canonicalDigest(value) !== canonicalDigest(reservation)
    ) {
      throw new Error(
        `P9 live bundle recovered reservation ${id || '<missing>'} does not match the journal`,
      );
    }
  }
  return {
    manifest: exact.manifest,
    verifiedCitationCount: exact.verifiedCitationCount,
    effectReceiptCount: effectReceipts.length,
    journalRecordCount: journalLines.length,
    spent: snapshot.spent,
    coverageVerdict: executionReceipt.coverageVerdict,
  };
}

export function resealP9LiveArtifacts(
  input: Readonly<Record<string, string>>,
): Record<string, string> {
  const artifacts = { ...input };
  const previous = P9ExecutionReceiptSchema.parse(
    JSON.parse(requiredArtifact(artifacts, 'execution-receipt.json')),
  );
  delete artifacts['execution-receipt.json'];
  const artifactDigests = Object.fromEntries(
    Object.entries(artifacts).map(([name, content]) => [
      name,
      `sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}`,
    ]),
  );
  const receiptIdentity = {
    schemaVersion: previous.schemaVersion,
    contractFamily: previous.contractFamily,
    executionId: previous.executionId,
    planId: previous.planId,
    planDigest: previous.planDigest,
    question: previous.question,
    budget: previous.budget,
    counts: previous.counts,
    typedResidue: previous.typedResidue,
    coverageVerdict: previous.coverageVerdict,
    coverageAssessmentDigest: previous.coverageAssessmentDigest,
    artifactDigests,
    startedAt: previous.startedAt,
    finishedAt: previous.finishedAt,
  };
  const receipt = P9ExecutionReceiptSchema.parse({
    ...receiptIdentity,
    receiptDigest: canonicalDigest(receiptIdentity),
  });
  artifacts['execution-receipt.json'] = JSON.stringify(receipt, null, 2);
  return artifacts;
}

function requiredArtifact(
  artifacts: Readonly<Record<string, string>>,
  name: string,
): string {
  const value = artifacts[name];
  if (value === undefined) {
    throw new Error(`P9 live bundle is missing ${name}`);
  }
  return value;
}

function parseRequiredJson(
  artifacts: Readonly<Record<string, string>>,
  name: string,
): unknown {
  return JSON.parse(requiredArtifact(artifacts, name));
}

function parseRequiredJsonLines(
  artifacts: Readonly<Record<string, string>>,
  name: string,
): unknown[] {
  const content = requiredArtifact(artifacts, name).trimEnd();
  return content
    ? content.split('\n').map((line) => JSON.parse(line) as unknown)
    : [];
}

/**
 * Executes the frozen P9 live exhibition question with real injected effect
 * adapters. Every outbound search, retrieval, parser, and model effect is
 * mechanically preceded by a durable journaled reservation bound to an
 * immutable scoped human authorization receipt and an immutable digest-bound
 * price catalog; settlement uses observed usage or conservatively charges the
 * reserved ceiling. Restarting against the same journal cannot repeat an
 * already-settled effect or spend the same remainder twice.
 */
export async function runP9LiveApplication(
  input: P9LiveApplicationInput,
): Promise<P9LiveApplicationRun> {
  input.journal.acquireExclusive();
  try {
    return await runP9LiveApplicationExclusive(input);
  } finally {
    input.journal.releaseExclusive();
  }
}

async function runP9LiveApplicationExclusive(
  input: P9LiveApplicationInput,
): Promise<P9LiveApplicationRun> {
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
  const catalog = ProviderPriceCatalogSchema.parse(input.catalog);
  const providerProfileCatalog = P9ProviderProfileCatalogSchema.parse(
    input.providerProfileCatalog,
  );
  const authorityReceiptResult = P9LiveAuthorityReceiptSchema.safeParse(
    input.authorizationReceipt,
  );
  if (!authorityReceiptResult.success) {
    throw new GovernanceError(
      'authorization_receipt_invalid',
      'scoped human authorization receipt is missing, malformed, or digest-broken',
    );
  }
  const authorityReceipt = authorityReceiptResult.data;
  if (input.budgetUsd !== authorityReceipt.budgetLimit.currencyUsd) {
    throw new GovernanceError(
      'authorization_budget_exceeded',
      'P9 live requested budget must match the scoped authority budget',
    );
  }
  const now = input.now ?? (() => new Date());
  const timestamp = () => now().toISOString();
  const actor = `p9-live:${input.executionId}`;
  const planBundle = buildAcceptedP9LivePlan({
    budgetUsd: input.budgetUsd,
    now: authorityReceipt.authorizedAt,
    proposerProfile: input.model.proposerProfile,
  });
  const lineage = (() => {
    try {
      return assertP9LiveAuthorityLineage({
        receipt: authorityReceipt,
        profileCatalog: providerProfileCatalog,
        priceCatalog: catalog,
        plan: planBundle.plan,
        acceptanceReceipt: planBundle.acceptanceReceipt,
        expectedAuthorityDigest: input.expectedAuthorityDigest,
        trustedIssuerId: input.trustedIssuerId,
        executionId: input.executionId,
        question: P9_LIVE_EXHIBITION_QUESTION,
        sourceClassificationPolicyDigest:
          input.sourceClassificationPolicyDigest ??
          P9_LIVE_SOURCE_CLASSIFICATION_POLICY_DIGEST,
        now: timestamp(),
      });
    } catch (error) {
      throw error instanceof GovernanceError
        ? error
        : new Error(`P9 live authority lineage invalid: ${String(error)}`);
    }
  })();
  assertModelProfileIdentity(
    input.model.proposerProfile,
    lineage.proposerProfile,
    'proposer',
  );
  assertModelProfileIdentity(
    input.model.evaluatorProfile,
    lineage.evaluatorProfile,
    'evaluator',
  );
  const searchProfile = requiredLiveRoleProfile(lineage.profiles, 'search');
  const retrievalProfile = requiredLiveRoleProfile(
    lineage.profiles,
    'retrieval',
  );
  const parserProfile = requiredLiveRoleProfile(lineage.profiles, 'parser');
  assertCatalogEntryAuthorized(searchProfile, 'brave-search');
  if (
    new URL(searchProfile.destinationOrigin).origin !==
    input.search.destinationOrigin
  ) {
    throw new GovernanceError(
      'search_transport_destination_mismatch',
      'authorized search profile does not match the concrete search transport destination',
    );
  }
  assertCatalogEntryAuthorized(retrievalProfile, 'public-retrieval');
  assertCatalogEntryAuthorized(parserProfile, 'bounded-parser');
  assertCatalogEntryAuthorized(lineage.proposerProfile, 'model-proposer-live');
  assertCatalogEntryAuthorized(
    lineage.evaluatorProfile,
    'model-evaluator-live',
  );
  const authority = P9DurableBudgetAuthority.open(
    {
      accountId: `p9-live:${input.executionId}`,
      programId: input.executionId,
      catalog,
      limit: authorityReceipt.budgetLimit,
      authorizationReceipt: authorityReceipt,
      store: input.journal,
      actorId: actor,
    },
    timestamp,
  );
  const executor = new P9LiveEffectExecutor(
    authority,
    catalog,
    input.executionId,
    actor,
    timestamp,
  );
  const recoveredReservations = authority.recoverInterrupted(actor);
  executor.recordRecovered(recoveredReservations);
  const measure = <T>(
    run: () => Promise<{
      value: T;
      usage: Omit<P9ObservedUsage, 'durationMs'>;
    }>,
  ): (() => Promise<P9LiveEffectObservation<T>>) => {
    return async () => {
      const startedAt = now().getTime();
      const outcome = await run();
      return {
        value: outcome.value,
        usage: {
          ...outcome.usage,
          durationMs: Math.max(0, now().getTime() - startedAt),
        },
        usageSource: 'measured_transport',
      };
    };
  };

  const candidatesByUrl = new Map<string, P9LiveCandidate>();
  const candidatesPerQuery: P9LiveCandidate[][] = [];
  const authorizedRetrievalOrigins = new Set(
    authorityReceipt.authorizedRetrievalOrigins.map(
      (value) => new URL(value).origin,
    ),
  );
  const candidateLimit = Math.min(
    input.maxCandidates ?? retrievalProfile.requestCeiling.requests,
    retrievalProfile.requestCeiling.requests,
  );
  if (input.includeMandatorySourceTargets === true) {
    for (const candidate of P9_LIVE_MANDATORY_SOURCE_CANDIDATES) {
      if (candidatesByUrl.size >= candidateLimit) break;
      if (!authorizedRetrievalOrigins.has(new URL(candidate.url).origin)) {
        throw new GovernanceError(
          'mandatory_source_origin_unauthorized',
          `mandatory P9 source origin is not authorized: ${new URL(candidate.url).origin}`,
        );
      }
      candidatesByUrl.set(
        canonicalP9CandidateSelectionUrl(candidate.url),
        candidate,
      );
    }
  }
  for (const query of planBundle.plan.searchQueries.slice(
    0,
    searchProfile.requestCeiling.requests,
  )) {
    const result = await executor.execute<readonly P9LiveCandidate[]>({
      id: `search:${query.queryId}`,
      catalogEntryId: 'brave-search',
      ceiling: ceiling({ bytes: 2_000_000, durationMs: 30_000 }),
      transport: async () => {
        const startedAt = now().getTime();
        const outcome = await input.search.search(query.query);
        return {
          value: outcome.candidates,
          usage: outcome.usage
            ? {
                ...outcome.usage,
                durationMs: Math.max(0, now().getTime() - startedAt),
              }
            : null,
          usageSource: 'measured_transport',
        };
      },
    });
    if (result.status === 'failed') {
      throw result.error instanceof Error
        ? result.error
        : new Error(String(result.error));
    }
    const authorizedCandidates = result.value.filter((candidate) =>
      authorizedRetrievalOrigins.has(new URL(candidate.url).origin),
    );
    if (
      query.queryId === 'q-colibri-repo' &&
      authorizedRetrievalOrigins.has('https://api.github.com')
    ) {
      authorizedCandidates.unshift({
        candidateId: 'github-api:justvugg-colibri:main',
        url: `https://api.github.com/repos/JustVugg/colibri/commits/${P9_LIVE_COLIBRI_COMMIT_SHA}`,
        title: 'JustVugg/colibri current main commit',
        sourceClass: 'repository_metadata',
        sourceFamilyId: 'github.com',
      });
    }
    candidatesPerQuery.push(authorizedCandidates);
  }
  // Preserve plan diversity: take one result from every governed query before
  // backfilling additional ranks. A global first-results cap lets the repository
  // queries crowd out Apple, experiment, and security evidence.
  const maximumQueryDepth = Math.max(
    0,
    ...candidatesPerQuery.map((candidates) => candidates.length),
  );
  for (
    let rank = 0;
    rank < maximumQueryDepth && candidatesByUrl.size < candidateLimit;
    rank += 1
  ) {
    for (const candidates of candidatesPerQuery) {
      const candidate = candidates[rank];
      if (!candidate) continue;
      const canonicalUrl = canonicalP9CandidateSelectionUrl(candidate.url);
      if (candidatesByUrl.has(canonicalUrl)) continue;
      candidatesByUrl.set(canonicalUrl, candidate);
      if (candidatesByUrl.size >= candidateLimit) break;
    }
  }

  const retrieve = input.retrieve ?? retrieveSource;
  const parserRegistry = input.parserRegistry ?? new BoundedParserRegistry();
  const attempts: RetrievalAttempt[] = [];
  const parserReceipts: ParserReceipt[] = [];
  const snapshots: P9ObservedSourceSnapshot[] = [];
  for (const candidate of candidatesByUrl.values()) {
    const retrievalResult = await executor.execute<RetrievedSource>({
      id: `retrieval:${candidate.candidateId}`,
      catalogEntryId: 'public-retrieval',
      ceiling: ceiling({ bytes: 2_000_000, durationMs: 60_000 }),
      transport: measure(async () => {
        const retrieved = await retrieve(
          { url: candidate.url, headers: { 'user-agent': USER_AGENT } },
          { now, policyId: 'p9-public-network/v1' },
        );
        return {
          value: retrieved,
          usage: usageOf({ requests: 1, bytes: retrieved.bytes.byteLength }),
        };
      }),
    });
    if (retrievalResult.status === 'failed') {
      const error = retrievalResult.error;
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
          effectId: retrievalResult.reservation.bound.effectId,
          requestedUrl: candidate.url,
          status:
            failure.code === 'source_timeout' ? 'timed_out' : 'unavailable',
          startedAt: retrievalResult.reservation.createdAt,
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
    const retrieved = retrievalResult.value;

    const parserResult = await executor.execute<ParsedArtifact>({
      id: `parser:${candidate.candidateId}`,
      catalogEntryId: 'bounded-parser',
      ceiling: ceiling({
        bytes: retrieved.bytes.byteLength,
        durationMs: 30_000,
        parserClass: P9_LIVE_PARSER_CLASS,
      }),
      transport: measure(() => {
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
        return Promise.resolve({
          value: parsed,
          usage: usageOf({ requests: 1, bytes: retrieved.bytes.byteLength }),
        });
      }),
    });
    if (parserResult.status === 'ok') {
      const receipt = ParserReceiptSchema.parse(
        parserResult.value.parserReceipt,
      );
      parserReceipts.push(receipt);
      const dateEvidence = observeCurrentRepositoryCommitDate({
        candidate,
        parsedText: parserResult.value.text,
        retrievedAt: retrieved.retrievedAt,
        observedAt: timestamp(),
        ...(input.includeMandatorySourceTargets === true
          ? { expectedCommitSha: P9_LIVE_COLIBRI_COMMIT_SHA }
          : {}),
      });
      attempts.push(
        buildTruthfulRetrievalAttempt({
          attemptId: `attempt:${candidate.candidateId}`,
          candidateId: candidate.candidateId,
          effectId: retrievalResult.reservation.bound.effectId,
          requestedUrl: candidate.url,
          finalUrl: retrieved.finalUrl,
          status: 'admitted',
          startedAt: retrievalResult.reservation.createdAt,
          finishedAt: timestamp(),
          retrievedAt: retrieved.retrievedAt,
          ...(dateEvidence ?? {}),
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
      if (!dateEvidence) {
        snapshots.push({
          candidateId: candidate.candidateId,
          body: parserResult.value.text,
          sourceClass: candidate.sourceClass,
          sourceFamilyId: candidate.sourceFamilyId,
        });
      }
    } else {
      const error = parserResult.error;
      if (error instanceof ParserPolicyError && error.receipt) {
        parserReceipts.push(ParserReceiptSchema.parse(error.receipt));
      }
      attempts.push(
        buildTruthfulRetrievalAttempt({
          attemptId: `attempt:${candidate.candidateId}`,
          candidateId: candidate.candidateId,
          effectId: retrievalResult.reservation.bound.effectId,
          requestedUrl: candidate.url,
          finalUrl: retrieved.finalUrl,
          status: 'parser_failed',
          startedAt: retrievalResult.reservation.createdAt,
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

  const proposerResult = await executor.execute<readonly P9LiveClaimSeed[]>({
    id: 'model:proposer',
    catalogEntryId: 'model-proposer-live',
    ceiling: ceiling({
      inputTokens: 80_000,
      outputTokens: 12_000,
      bytes: 2_000_000,
      durationMs: 120_000,
    }),
    transport: modelTransport(now, () =>
      input.model.proposeClaims({ plan: planBundle.plan, snapshots }),
    ),
  });
  if (proposerResult.status === 'failed') {
    throw proposerResult.error instanceof Error
      ? proposerResult.error
      : new Error(String(proposerResult.error));
  }
  for (const seed of proposerResult.value) {
    if (
      seed.statement !== seed.quote ||
      detectP9SemanticDeltas(seed.statement, seed.quote).length > 0
    ) {
      throw new Error(
        `P9 live extractive claim normalization failed for ${seed.claimId}`,
      );
    }
  }
  const seeds = proposerResult.value.map((seed) => {
    const declaredSnapshot = snapshots.find(
      (entry) => entry.candidateId === seed.candidateId,
    );
    const matchingSnapshots = snapshots.filter((entry) =>
      entry.body.includes(seed.quote),
    );
    const snapshot = declaredSnapshot?.body.includes(seed.quote)
      ? declaredSnapshot
      : matchingSnapshots.length === 1
        ? matchingSnapshots[0]
        : undefined;
    if (!snapshot) {
      throw new Error(
        `P9 live proposer claim does not bind to an observed snapshot: ${seed.claimId}`,
      );
    }
    return {
      ...seed,
      candidateId: snapshot.candidateId,
      statement: seed.quote,
    };
  });

  const expectedClaimIds = new Set(seeds.map((seed) => seed.claimId));
  if (expectedClaimIds.size !== seeds.length) {
    throw new Error('P9 live proposer returned duplicate claimIds');
  }
  const mandatorySourceClasses = new Set(
    planBundle.plan.sourceClassTargets
      .filter((target) => target.mandatory)
      .map((target) => target.sourceClass),
  );
  const presentMandatorySourceClasses = new Set(
    snapshots
      .filter((snapshot) => mandatorySourceClasses.has(snapshot.sourceClass))
      .map((snapshot) => snapshot.sourceClass),
  );
  const coveredSourceClasses = new Set(
    seeds.flatMap((seed) =>
      snapshots
        .filter((snapshot) => snapshot.candidateId === seed.candidateId)
        .map((snapshot) => snapshot.sourceClass),
    ),
  );
  const missingSourceClass = [...presentMandatorySourceClasses].find(
    (sourceClass) => !coveredSourceClasses.has(sourceClass),
  );
  if (missingSourceClass) {
    throw new Error(
      `P9 live proposer omitted mandatory source class: ${missingSourceClass}`,
    );
  }
  for (const seed of seeds) {
    const snapshot = snapshots.find(
      (entry) => entry.candidateId === seed.candidateId,
    );
    const attempt = attempts.find(
      (entry) => entry.candidateId === seed.candidateId,
    );
    if (!snapshot || !attempt) {
      throw new Error(
        `P9 live proposer claim does not bind to an observed snapshot: ${seed.claimId}`,
      );
    }
  }

  const evaluatorResult = await executor.execute<
    readonly P9LiveEvaluatorFinding[]
  >({
    id: 'model:evaluator',
    catalogEntryId: 'model-evaluator-live',
    ceiling: ceiling({
      inputTokens: 60_000,
      outputTokens: 8_000,
      bytes: 2_000_000,
      durationMs: 120_000,
    }),
    transport: modelTransport(now, () =>
      input.model.evaluateClaims({
        plan: planBundle.plan,
        claims: seeds,
        snapshots,
      }),
    ),
  });
  if (evaluatorResult.status === 'failed') {
    throw evaluatorResult.error instanceof Error
      ? evaluatorResult.error
      : new Error(String(evaluatorResult.error));
  }
  const evaluatorResults = evaluatorResult.value;

  const evaluatedClaimIds = new Set(
    evaluatorResults.map((result) => result.claimId),
  );
  if (
    evaluatorResults.length !== seeds.length ||
    evaluatedClaimIds.size !== evaluatorResults.length ||
    [...expectedClaimIds].some((claimId) => !evaluatedClaimIds.has(claimId)) ||
    [...evaluatedClaimIds].some((claimId) => !expectedClaimIds.has(claimId))
  ) {
    throw new Error(
      'P9 live evaluator findings must match proposed claimIds exactly',
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
    if (!snapshot || !attempt || !evaluator) continue;
    const startOffset = snapshot.body.indexOf(seed.quote);
    if (startOffset < 0) continue;
    const endOffset = startOffset + seed.quote.length;
    const boundedContext = boundedP9SentenceContext(
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
        raw: {
          policyId: 'p9-live-extractive-claim/v1',
          providerClaims: proposerResult.value,
          normalizedClaims: seeds,
        },
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
        raw: evaluatorResults,
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

  const admittedClaimIds = admissions
    .filter((admission) => admission.decision === 'admitted')
    .map((admission) => admission.proposalId);
  const narrativeResult = await executor.execute<
    readonly P9LiveNarrativeSection[]
  >({
    id: 'model:synthesizer',
    catalogEntryId: 'model-proposer-live',
    ceiling: ceiling({
      inputTokens: 40_000,
      outputTokens: 12_000,
      bytes: 500_000,
      durationMs: 120_000,
    }),
    transport: modelTransport(now, () =>
      input.model.synthesizeReport({
        plan: planBundle.plan,
        claims: seeds,
        admittedClaimIds,
      }),
    ),
  });
  if (narrativeResult.status === 'failed') {
    throw narrativeResult.error instanceof Error
      ? narrativeResult.error
      : new Error(String(narrativeResult.error));
  }
  const expectedSectionIds = [
    ...planBundle.plan.reportOutline.sections.map(
      (section) => section.sectionId,
    ),
    'references_provenance',
  ];
  const returnedSectionIds = narrativeResult.value.map(
    (section) => section.sectionId,
  );
  const narratedClaimIds = narrativeResult.value.flatMap(
    (section) => section.claimIds,
  );
  if (
    new Set(returnedSectionIds).size !== expectedSectionIds.length ||
    expectedSectionIds.some(
      (sectionId) => !returnedSectionIds.includes(sectionId),
    ) ||
    returnedSectionIds.some(
      (sectionId) => !expectedSectionIds.includes(sectionId),
    ) ||
    new Set(narratedClaimIds).size !== narratedClaimIds.length ||
    admittedClaimIds.some((claimId) => !narratedClaimIds.includes(claimId)) ||
    narratedClaimIds.some((claimId) => !admittedClaimIds.includes(claimId))
  ) {
    throw new Error(
      'P9 live synthesizer must return every section and place every admitted claim exactly once',
    );
  }
  const narrativeSections = Object.fromEntries(
    narrativeResult.value.map((section) => [
      section.sectionId,
      { lead: section.lead, claimIds: section.claimIds },
    ]),
  );

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
    narrativeSections,
  });
  verifyP9ExactBundle(run.artifacts);
  return {
    ...run,
    exactBundleVerified: true,
    authorizationReceipt: authority.authorizationReceipt,
    providerProfileCatalog,
    effectReceipts: executor.effectReceipts,
    recoveredReservations,
  };
}

function assertModelProfileIdentity(
  runtime: P9LiveModelProfile,
  authorized: P9ProviderProfile,
  role: 'proposer' | 'evaluator',
): void {
  if (
    runtime.profileVersionId !== authorized.profileId ||
    runtime.profileFamilyId !== authorized.profileFamilyId ||
    runtime.modelId !== authorized.modelId
  ) {
    throw new GovernanceError(
      `live_${role}_profile_identity_mismatch`,
      `runtime ${role} model identity does not match the authorized immutable provider profile`,
    );
  }
}

function requiredLiveRoleProfile(
  profiles: readonly P9ProviderProfile[],
  role: 'search' | 'retrieval' | 'parser',
): P9ProviderProfile {
  const matches = profiles.filter((profile) => profile.role === role);
  if (matches.length !== 1 || !matches[0]) {
    throw new GovernanceError(
      `live_${role}_profile_ambiguous`,
      `live execution requires exactly one authorized ${role} profile`,
    );
  }
  return matches[0];
}

function assertCatalogEntryAuthorized(
  profile: P9ProviderProfile,
  catalogEntryId: string,
): void {
  if (!profile.catalogEntryIds.includes(catalogEntryId)) {
    throw new GovernanceError(
      'live_effect_catalog_entry_unauthorized',
      `provider profile ${profile.profileId} does not authorize ${catalogEntryId}`,
    );
  }
}

function usageOf(
  input: Partial<Omit<P9ObservedUsage, 'durationMs'>>,
): Omit<P9ObservedUsage, 'durationMs'> {
  return {
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    bytes: 0,
    ...input,
  };
}

function modelTransport<T>(
  now: () => Date,
  run: () => Promise<P9LiveModelOutcome<T>>,
): () => Promise<P9LiveEffectObservation<T>> {
  return async () => {
    const startedAt = now().getTime();
    const outcome = await run();
    return {
      value: outcome.value,
      usage: outcome.usage
        ? {
            ...outcome.usage,
            durationMs: Math.max(
              outcome.usage.durationMs,
              Math.max(0, now().getTime() - startedAt),
            ),
          }
        : null,
      usageSource: 'provider_reported',
    };
  };
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
          'Which current upstream Apple-GPU Metal backend, zero-copy unified memory, GLM-5 model, cache, or documentation facts constrain a bounded first change?',
        mandatory: true,
      },
      {
        subquestionId: 'sq-apple-silicon',
        question:
          'Which Apple silicon memory bandwidth and performance facts matter on a 128 GB machine?',
        mandatory: true,
      },
      {
        subquestionId: 'sq-experiment',
        question:
          'What repeated-run measurement experiment would distinguish capability differences from random chance and noise?',
        mandatory: true,
      },
      {
        subquestionId: 'sq-risk',
        question:
          'Which memory safety guidance applies to security risks in a bounded colibri code change?',
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
          'site:github.com/JustVugg/colibri README source code GLM MoE cache',
        subquestionIds: ['sq-upstream', 'sq-risk'],
      },
      {
        queryId: 'q-upstream-model',
        query: 'site:huggingface.co/zai-org/GLM-5 official GLM-5 model card',
        subquestionIds: ['sq-upstream'],
      },
      {
        queryId: 'q-apple-silicon',
        query:
          'site:apple.com Apple-silicon 128GB unified memory bandwidth technical specifications',
        subquestionIds: ['sq-apple-silicon'],
      },
      {
        queryId: 'q-experiment',
        query:
          'site:arxiv.org LLM inference benchmark experiment repeated runs measurement noise statistical significance',
        subquestionIds: ['sq-experiment'],
      },
      {
        queryId: 'q-security',
        query: 'site:cisa.gov C C++ memory safety secure coding guidance',
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
  const upstreamQuestion = plan.subquestions.find(
    (subquestion) => subquestion.subquestionId === 'sq-upstream',
  );
  const experimentQuestion = plan.subquestions.find(
    (subquestion) => subquestion.subquestionId === 'sq-experiment',
  );
  const boundedChangeClaims = upstreamQuestion
    ? admitted.filter(
        (binding) =>
          binding.proposal.critical &&
          isClaimRelevantToSubquestion(
            binding,
            upstreamQuestion.subquestionId,
            upstreamQuestion.question,
          ),
      )
    : [];
  const experimentClaims = experimentQuestion
    ? admitted.filter((binding) =>
        isClaimRelevantToSubquestion(
          binding,
          experimentQuestion.subquestionId,
          experimentQuestion.question,
        ),
      )
    : [];
  const hasBoundedChangeAndExperiment = boundedChangeClaims.some(
    (boundedChange) =>
      experimentClaims.some(
        (experiment) =>
          experiment.proposal.proposalId !== boundedChange.proposal.proposalId,
      ),
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
        met: hasBoundedChangeAndExperiment,
        reason: hasBoundedChangeAndExperiment
          ? 'an admitted critical upstream claim supports the bounded-change decision and a distinct admitted claim supports its controlled experiment'
          : 'the bounded-change stop requires both an admitted critical upstream claim and a distinct admitted experiment-relevant claim',
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

function modelWorkRef(input: {
  readonly role: P9ModelWorkRef['role'];
  readonly claimId: string;
  readonly profile: P9LiveModelProfile;
  readonly raw: unknown;
}): P9ModelWorkRef {
  return {
    workId: `work:${input.role}:${input.claimId}`,
    workDigest: canonicalDigest({
      role: input.role,
      claimId: input.claimId,
      modelId: input.profile.modelId,
    }),
    rawResponseDigest: canonicalDigest(input.raw),
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

export interface BraveP9LiveSearchAdapterInput {
  readonly apiKeyEnvironmentVariable: string;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => Date;
  readonly monotonicNow?: () => number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly minimumIntervalMs?: number;
}

export class BraveP9LiveSearchAdapter implements P9LiveSearchAdapter {
  readonly destinationOrigin = 'https://api.search.brave.com';
  #nextRequestAtMs = 0;
  #admissionTail: Promise<void> = Promise.resolve();

  constructor(private readonly input: BraveP9LiveSearchAdapterInput) {
    if (!input.apiKeyEnvironmentVariable.trim()) {
      throw new Error(
        'Brave adapter requires an API key environment variable name',
      );
    }
  }

  async search(query: string): Promise<P9LiveSearchOutcome> {
    const environment = this.input.environment ?? process.env;
    const apiKey = environment[this.input.apiKeyEnvironmentVariable];
    if (!apiKey?.trim()) {
      throw new Error(
        `Brave search credential environment variable ${this.input.apiKeyEnvironmentVariable} is empty`,
      );
    }
    const now = this.input.now ?? (() => new Date());
    const monotonicNow = this.input.monotonicNow ?? (() => performance.now());
    const sleep =
      this.input.sleep ??
      ((milliseconds: number) =>
        new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
    const minimumIntervalMs = this.input.minimumIntervalMs ?? 2_000;
    if (!Number.isFinite(minimumIntervalMs) || minimumIntervalMs < 0) {
      throw new Error(
        'Brave adapter minimum request interval must be a finite non-negative number',
      );
    }
    const admission = this.#admissionTail.then(async () => {
      const waitMs = Math.max(0, this.#nextRequestAtMs - monotonicNow());
      if (waitMs > 0) await sleep(waitMs);
      this.#nextRequestAtMs = monotonicNow() + minimumIntervalMs;
    });
    this.#admissionTail = admission.catch(() => undefined);
    await admission;
    const fetchImpl = this.input.fetchImpl ?? fetch;
    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', query);
    url.searchParams.set('count', '5');
    const startedAt = now().getTime();
    const response = await fetchImpl(url, {
      headers: {
        accept: 'application/json',
        'x-subscription-token': apiKey,
      },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    const remaining = response.headers
      .get('x-ratelimit-remaining')
      ?.split(',')
      .map((value) => Number(value.trim()));
    const resets = response.headers
      .get('x-ratelimit-reset')
      ?.split(',')
      .map((value) => Number(value.trim()));
    if (remaining?.[0] === 0 && Number.isFinite(resets?.[0])) {
      this.#nextRequestAtMs = Math.max(
        this.#nextRequestAtMs,
        monotonicNow() + (resets?.[0] ?? 0) * 1_000 + 250,
      );
    }
    if (!response.ok) {
      const reset = response.headers.get('x-ratelimit-reset');
      const safeReset = reset?.match(/^[0-9, ]{1,80}$/u)?.[0];
      throw new Error(
        `Brave search failed with HTTP ${String(response.status)}${safeReset ? `; rate limit reset ${safeReset} seconds` : ''}`,
      );
    }
    const rawBody = await response.text();
    const parsed = BraveSearchResponseSchema.parse(JSON.parse(rawBody));
    const candidates = parsed.web.results.map((result, index) => {
      const sourceClass = inferSourceClass(result.url);
      return {
        candidateId: `brave:${canonicalDigest(result.url).slice(7, 19)}:${String(index)}`,
        url: result.url,
        title: result.title,
        sourceClass,
        sourceFamilyId: new URL(result.url).hostname.replace(/^www\./u, ''),
      };
    });
    return {
      candidates,
      usage: {
        requests: 1,
        inputTokens: 0,
        outputTokens: 0,
        bytes: Buffer.byteLength(rawBody, 'utf8'),
        durationMs: Math.max(0, now().getTime() - startedAt),
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

const CurrentGitHubCommitSchema = z
  .object({
    sha: z.string().regex(/^[0-9a-f]{40}$/u),
    commit: z.object({
      committer: z.object({ date: z.string().datetime() }),
    }),
  })
  .passthrough();

export function canonicalP9CandidateSelectionUrl(input: string): string {
  const url = canonicalizeAcquisitionUrl(input);
  const trackingParameters = new Set([
    'fbclid',
    'gclid',
    'mc_cid',
    'mc_eid',
    'ref',
  ]);
  for (const key of [...url.searchParams.keys()]) {
    if (
      key.toLowerCase().startsWith('utm_') ||
      trackingParameters.has(key.toLowerCase())
    ) {
      url.searchParams.delete(key);
    }
  }
  if (url.pathname.length > 1) {
    url.pathname = url.pathname.replace(/\/+$/u, '');
  }
  return url.href;
}

function observeCurrentRepositoryCommitDate(input: {
  readonly candidate: P9LiveCandidate;
  readonly parsedText: string;
  readonly retrievedAt: string;
  readonly observedAt: string;
  readonly expectedCommitSha?: string;
}) {
  if (
    canonicalP9CandidateSelectionUrl(input.candidate.url) !==
    `https://api.github.com/repos/JustVugg/colibri/commits/${P9_LIVE_COLIBRI_COMMIT_SHA}`
  ) {
    return null;
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(input.parsedText);
  } catch {
    return null;
  }
  const parsed = CurrentGitHubCommitSchema.safeParse(decoded);
  if (!parsed.success) return null;
  if (
    input.expectedCommitSha !== undefined &&
    parsed.data.sha !== input.expectedCommitSha
  ) {
    throw new Error(
      `current Colibri commit ${parsed.data.sha} does not match pinned source commit ${input.expectedCommitSha}`,
    );
  }
  const normalizedValue = new Date(
    parsed.data.commit.committer.date,
  ).toISOString();
  if (Date.parse(normalizedValue) > Date.parse(input.retrievedAt)) return null;
  const observation = {
    schemaVersion: '1.0.0' as const,
    contractFamily: 'p9.v1' as const,
    observationId: `published-at:${input.candidate.candidateId}`,
    field: 'published_at' as const,
    extractionMethod: 'document_text' as const,
    exactLocator: `json-pointer:/commit/committer/date;sha:${parsed.data.sha};body:${canonicalDigest(input.parsedText)}`,
    sourceValue: parsed.data.commit.committer.date,
    normalizedValue,
    confidence: 1,
    observedAt: input.observedAt,
  };
  return {
    dateObservation: observation,
    dateVerdict: {
      schemaVersion: '1.0.0' as const,
      contractFamily: 'p9.v1' as const,
      observationId: observation.observationId,
      observationDigest: canonicalDigest(observation),
      verdict: 'accepted' as const,
      policyId: CURRENT_COMMIT_DATE_POLICY_ID,
      reason:
        'the authorized GitHub current-ref response bound an immutable commit SHA and exact committer timestamp',
      decidedAt: input.observedAt,
    },
  };
}

function inferSourceClass(url: string): string {
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.toLowerCase();
  if (host === 'github.com' && path.includes('/justvugg/colibri')) {
    return path.includes('/blob/') || path.includes('/tree/')
      ? 'repository_code'
      : 'repository_docs';
  }
  if (host.includes('apple.com')) return 'hardware_vendor_docs';
  if (
    host === 'huggingface.co' &&
    (path === '/zai-org/glm-5' || path === '/zai-org/glm-4.7-flash')
  ) {
    return 'upstream_model_docs';
  }
  if (host === 'huggingface.co') return 'unclassified_public_source';
  if (
    host.includes('arxiv.org') ||
    host.includes('acm.org') ||
    host.includes('ieee.org')
  ) {
    return 'peer_reviewed_or_primary_technical';
  }
  if (host.includes('github.com')) return 'repository_docs';
  if (
    host.includes('cve') ||
    host.includes('nvd.nist.gov') ||
    host === 'cisa.gov' ||
    host.endsWith('.cisa.gov')
  )
    return 'security_advisory';
  return 'peer_reviewed_or_primary_technical';
}
