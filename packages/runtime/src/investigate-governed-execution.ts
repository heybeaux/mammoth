import {
  AcquisitionReleaseSchema,
  canonicalDigest,
  InvestigationAcquisitionIntentSetSchema,
  P9ClaimProposalSchema,
  P9EntailmentVerdictSchema,
  P9LiveAuthorityReceiptSchema,
  type AcquisitionIntent,
  type AcquisitionRelease,
  type InvestigationAcquisitionIntentSet,
  type MediaSupportDecision,
  type P9ClaimAdmission,
  type P9ClaimProposal,
  type P9EntailmentVerdict,
  type P9LiveAuthorityReceipt,
  type P9ModelWorkRef,
  type ParserReceipt,
  type RetrievalAttempt,
  type RetrievalCoverageResidue,
  type SourceClassTarget,
} from '@mammoth/domain';
import {
  boundedEvidenceContext,
  containsP9HostileInstruction,
  detectP9SemanticDeltas,
  evaluateP9ClaimAdmission,
  deriveBoundedEvidenceSpans,
  buildEntailmentLocatorForSpan,
  type BoundedEvidenceSpan,
} from '@mammoth/evidence';
import {
  BoundedParserRegistry,
  AcquisitionFailure,
  buildTruthfulRetrievalAttempt,
  canonicalizeAcquisitionUrl,
  contentDigest,
  makeNotCheckedRobotsDecision,
  makeUnknownRightsStatus,
  retrieveSource,
  P9RetrievalResidueLedger,
  ParserPolicyError,
  selectPlannedAcquisitionCandidates,
  unservedPlannedSourceClasses,
  type DiscoveredSourceHint,
  type RejectedSourceHint,
  type SelectedRetrievalCandidate,
} from '@mammoth/retrieval';
import {
  FileP9DurableJournalStore,
  P9DurableBudgetAuthority,
} from '@mammoth/governance';
import {
  BraveRateLimitError,
  decideBraveRateLimitRetry,
  nextBraveShortWindowDelayMs,
  parseBraveRateLimitHeaders,
} from './brave-rate-limit.js';
import { P9LiveEffectExecutor } from './p9-live-executor.js';
import { deriveDecisionConstraints } from './investigate-planner.js';

const REQUIRED_EFFECT_KINDS = ['search', 'retrieval', 'parser'] as const;
const LIVE_REQUIRED_EFFECT_KINDS = [
  'search',
  'retrieval',
  'parser',
  'model',
] as const;

const PROPOSER_PROFILE_VERSION = 'offline-extractive-proposer/v1';
const PROPOSER_PROFILE_FAMILY = 'offline-extractive-proposer';
const EVALUATOR_PROFILE_VERSION = 'offline-independent-evaluator/v1';
const EVALUATOR_PROFILE_FAMILY = 'offline-independent-evaluator';
const LIVE_PROPOSER_PROFILE_VERSION = 'live-openai-compatible-proposer/v1';
const LIVE_PROPOSER_PROFILE_FAMILY = 'live-openai-compatible-proposer';
const LIVE_EVALUATOR_PROFILE_VERSION = 'live-openai-compatible-evaluator/v1';
const LIVE_EVALUATOR_PROFILE_FAMILY = 'live-openai-compatible-evaluator';
const LIVE_USER_AGENT = 'mammoth-investigate-live/1.0';
const PUBLIC_WEB_RETRIEVAL_AUTHORITY_ORIGIN = 'https://public-web.invalid';
const LOW_INFORMATION_SPAN_PATTERN =
  /(?:^(?:skip to main content|an official website|official websites use|secure \.gov websites|menu|search|privacy policy|terms of use|cookies?|javascript|equal contribution|corresponding author|received:|accepted:|published:)|\b(?:open access|creative commons|cc by|copyright|©|competing interests|license|licence|received \d{4}|revised \d{4}|accepted \d{4}|collection date|published by|permission directly from the copyright holder|distributed under the terms|equal contribution)\b)/iu;
const QUESTION_STOP_TERMS = new Set([
  'about',
  'after',
  'against',
  'also',
  'answer',
  'apply',
  'based',
  'before',
  'being',
  'best',
  'beyond',
  'build',
  'building',
  'could',
  'during',
  'evidence',
  'from',
  'help',
  'important',
  'increasingly',
  'individuals',
  'lie',
  'most',
  'operate',
  'opportunities',
  'question',
  'reduce',
  'should',
  'single',
  'systems',
  'that',
  'their',
  'there',
  'today',
  'using',
  'what',
  'where',
  'which',
  'while',
  'with',
  'within',
  'would',
]);

export class GovernedExecutionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'GovernedExecutionError';
  }
}

/** A discovery result offered by a no-effect adapter; never evidence. */
export interface GovernedDiscoveryHint {
  readonly url: string;
  readonly sourceClass: string;
  readonly title?: string;
  readonly description?: string;
}

/**
 * Injected strictly-no-effect adapters. Implementations must not perform
 * network, provider, or paid effects; the product path builds them from an
 * operator-declared offline source catalog.
 */
export interface GovernedNoEffectAdapters {
  readonly sourceClassTargets: readonly SourceClassTarget[];
  readonly search: (query: string) => readonly GovernedDiscoveryHint[];
  readonly retrieve: (
    url: string,
  ) => { readonly bytes: Uint8Array; readonly mediaType: string } | null;
}

export interface GovernedIntentReceipt {
  readonly intentId: string;
  readonly kind: AcquisitionIntent['kind'];
  readonly subject: string;
  readonly status: 'executed';
  readonly counts: Readonly<Record<string, number>>;
  readonly executedAt: string;
}

export interface GovernedExecutionSnapshot {
  readonly candidateId: string;
  readonly requestedUrl: string;
  readonly sourceClass: string;
  readonly rawContentDigest: string;
  readonly parsedTextDigest: string;
  readonly parsedText: string;
  readonly mediaSupportDecision: MediaSupportDecision;
  readonly parserReceipt: ParserReceipt;
  readonly spanCount: number;
}

export interface GovernedClaimRecord {
  readonly proposalId: string;
  readonly statement: string;
  readonly candidateId: string;
  readonly requestedUrl: string;
  readonly sourceClass: string;
  readonly decision: P9ClaimAdmission['decision'];
  readonly reasonCodes: readonly string[];
}

export interface GovernedAcquisitionExecution {
  readonly executedAt: string;
  readonly investigationId: string;
  readonly planDigest: string;
  readonly intentSetDigest: string;
  readonly releaseDigest: string;
  readonly authorityReceiptDigest: string;
  readonly intentReceipts: readonly GovernedIntentReceipt[];
  readonly discoveredHints: number;
  readonly selectedCandidates: readonly SelectedRetrievalCandidate[];
  readonly rejectedHints: readonly RejectedSourceHint[];
  readonly snapshots: readonly GovernedExecutionSnapshot[];
  readonly retrievalAttempts: readonly RetrievalAttempt[];
  readonly coverage: RetrievalCoverageResidue;
  readonly proposals: readonly P9ClaimProposal[];
  readonly verdicts: readonly P9EntailmentVerdict[];
  readonly admissions: readonly P9ClaimAdmission[];
  readonly claims: readonly GovernedClaimRecord[];
  readonly modelWork: readonly P9ModelWorkRef[];
  readonly liveReview?: GovernedLiveModelReview;
  readonly acceptanceReview?: GovernedLiveAcceptanceReview;
  readonly reviewEvidenceProposalIds?: readonly string[];
  readonly effectReceipts: readonly unknown[];
  readonly externalEffectsExecuted: boolean;
  readonly executionMode: 'offline_fixture' | 'governed_live';
}

export interface GovernedAcquisitionExecutionInput {
  readonly intentSet: unknown;
  readonly release: unknown;
  readonly effectAuthority: unknown;
  /** Caller-pinned trusted issuer; never defaulted by this module. */
  readonly trustedIssuerId: string | undefined;
  readonly adapters: GovernedNoEffectAdapters;
  /** Injected deterministic clock value for the whole execution. */
  readonly now: string;
  readonly maxClaimsPerSnapshot?: number;
}

export interface GovernedLiveModelReview {
  readonly summary: string;
  readonly portfolio?: readonly GovernedLiveReviewPortfolioItem[];
  readonly unresolvedConstraints?: readonly string[];
  readonly answerBullets?: readonly GovernedLiveReviewCitedStatement[];
  readonly mechanisms?: readonly GovernedLiveReviewCitedStatement[];
  readonly dissent?: readonly GovernedLiveReviewCitedStatement[];
  readonly boundaryConditions?: readonly GovernedLiveReviewCitedStatement[];
  readonly hypotheses?: readonly GovernedLiveReviewHypothesis[];
  readonly experimentProposals?: readonly GovernedLiveReviewExperiment[];
  readonly weaknesses: readonly string[];
  readonly suggestedSearches: readonly string[];
}

export interface GovernedLiveReviewPortfolioItem
  extends GovernedLiveReviewCitedStatement {
  readonly rank: number;
  readonly title: string;
  readonly rationale: string;
  readonly constraints: readonly string[];
  readonly nextValidation: string;
}

export interface GovernedLiveReviewCitedStatement {
  readonly statement: string;
  readonly evidenceIndexes: readonly number[];
}

export interface GovernedLiveReviewHypothesis
  extends GovernedLiveReviewCitedStatement {
  readonly falsifier: string;
}

export interface GovernedLiveReviewExperiment
  extends GovernedLiveReviewCitedStatement {
  readonly resolvesUncertainty: string;
  readonly threshold: string;
  readonly safetyBoundary: string;
}

export interface GovernedLiveAcceptanceReview {
  readonly reviewerId: string;
  readonly reviewedAt: string;
  readonly overall: 'pass' | 'fail';
  readonly criteria: readonly GovernedLiveAcceptanceCriterion[];
  readonly decisionConstraints: readonly GovernedLiveAcceptanceCriterion[];
  readonly sourceClusters: readonly {
    readonly clusterId: string;
    readonly evidenceCount: number;
  }[];
}

export interface GovernedLiveAcceptanceCriterion {
  readonly criterionId: string;
  readonly passed: boolean;
  readonly evidence: string;
}

export interface GovernedLiveAcquisitionExecutionInput {
  readonly intentSet: unknown;
  readonly release: unknown;
  readonly effectAuthority: unknown;
  readonly trustedIssuerId: string | undefined;
  readonly now: string;
  readonly budgetJournalPath: string;
  readonly searchApiKeyEnvVar: string;
  readonly modelApiKeyEnvVar: string;
  readonly modelBaseUrl: string;
  readonly modelId: string;
  readonly sourceClassTargets?: readonly SourceClassTarget[];
  readonly fetchImpl?: typeof fetch;
  readonly retrieve?: typeof retrieveSource;
  readonly maxClaimsPerSnapshot?: number;
  readonly maxCandidates?: number;
  readonly minimumSearchIntervalMs?: number;
}

function refuse(code: string, message: string): never {
  throw new GovernedExecutionError(code, message);
}

function informativeWordCount(value: string): number {
  return value.match(/[A-Za-z][A-Za-z'-]{2,}/gu)?.length ?? 0;
}

function textTerms(value: string): readonly string[] {
  return [
    ...new Set(
      [...value.matchAll(/[\p{L}\p{N}][\p{L}\p{N}-]{2,}/gu)]
        .map((match) => match[0].toLocaleLowerCase('en-US'))
        .filter(
          (term) =>
            term.length >= 4 &&
            !QUESTION_STOP_TERMS.has(term) &&
            !/^\d+$/u.test(term),
        ),
    ),
  ];
}

function isBroadDecisionQuestion(question: string): boolean {
  return /\b(?:opportunities|strategies|approaches|options|where\s+do|where\s+should|which\s+.+\s+strategies|how\s+should)\b/iu.test(
    question,
  );
}

function normalizedContentTerms(value: string): readonly string[] {
  return textTerms(value).filter((term) => term.length >= 5);
}

function portfolioItemSignature(
  item: GovernedLiveReviewPortfolioItem,
): readonly string[] {
  return [
    ...new Set(
      normalizedContentTerms(
        [item.title, item.statement, item.rationale].join(' '),
      ),
    ),
  ].slice(0, 12);
}

function jaccardOverlap(
  left: readonly string[],
  right: readonly string[],
): number {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const union = new Set([...leftSet, ...rightSet]);
  if (union.size === 0) return 0;
  let intersection = 0;
  for (const term of leftSet) {
    if (rightSet.has(term)) intersection += 1;
  }
  return intersection / union.size;
}

function isLowInformationLiveSpan(quote: string): boolean {
  const normalized = quote.replace(/\s+/gu, ' ').trim();
  if (normalized.length < 48) return true;
  if (!/[.!?]$/u.test(normalized)) return true;
  if (informativeWordCount(normalized) < 8) return true;
  if (LOW_INFORMATION_SPAN_PATTERN.test(normalized)) return true;
  return false;
}

function liveRelevanceTerms(question: string): readonly string[] {
  return textTerms(question).slice(0, 32);
}

function textRelevanceScore(value: string, terms: readonly string[]): number {
  const normalized = value.toLocaleLowerCase('en-US');
  return terms.reduce((score, term) => {
    const variants = new Set([term]);
    if (term.endsWith('s')) variants.add(term.slice(0, -1));
    if (term.endsWith('ies')) variants.add(`${term.slice(0, -3)}y`);
    return (
      score +
      ([...variants].some((variant) => normalized.includes(variant)) ? 1 : 0)
    );
  }, 0);
}

function isLiveSpanQuestionRelevant(
  quote: string,
  terms: readonly string[],
): boolean {
  if (terms.length === 0) return true;
  return textRelevanceScore(quote, terms) >= Math.min(2, terms.length);
}

function liveHintRelevanceScore(input: {
  readonly hint: DiscoveredSourceHint;
  readonly query: string;
  readonly question: string;
}): number {
  const questionTerms = textTerms(input.question);
  const queryTerms = textTerms(input.query);
  const surface = [
    input.hint.title ?? '',
    input.hint.description ?? '',
    input.hint.url.replace(/[^\p{L}\p{N}-]+/gu, ' '),
  ].join(' ');
  return (
    textRelevanceScore(surface, questionTerms) * 2 +
    textRelevanceScore(surface, queryTerms) +
    liveSourceQualityScore(input.hint)
  );
}

function minimumHintRelevance(input: {
  readonly query: string;
  readonly question: string;
}): number {
  const questionTerms = textTerms(input.question);
  const queryTerms = textTerms(input.query);
  const questionMinimum = Math.min(6, Math.ceil(questionTerms.length / 5));
  const queryMinimum = Math.min(4, Math.ceil(queryTerms.length / 6));
  return Math.max(3, questionMinimum + queryMinimum);
}

function hasComparatorLanguage(value: string): boolean {
  return /\b(?:baseline|compar(?:e|ator|ison)|control|before[- ]?after|current|existing|alternative|threshold|target|versus|vs\.?|fail(?:ure)? rate|error rate|latency|cost|accuracy|safety|energy|outcome)\b/iu.test(
    value,
  );
}

function hasMetricLanguage(value: string): boolean {
  return /\b(?:rate|ratio|percent|percentage|accuracy|latency|throughput|cost|memory|gpu|vram|energy|runtime|hours?|minutes?|days?|error|failure|recall|precision|coverage|completion|safety|quality|score|count|threshold)\b/iu.test(
    value,
  );
}

function hasAdverseConstraintLanguage(value: string): boolean {
  return /\b(?:adverse|constraint|failure|regression|safety|privacy|security|risk|budget|cost|latency|memory|gpu|vram|offline|local|harm|fallback|blocked)\b/iu.test(
    value,
  );
}

function sourceClusterId(urlValue: string): string {
  try {
    const url = new URL(urlValue);
    const host = url.hostname.toLocaleLowerCase('en-US');
    const parts = url.pathname
      .split('/')
      .filter(Boolean)
      .map((part) => part.toLocaleLowerCase('en-US'));
    if (
      /\b(?:github|gitlab|codeberg|sourcehut)\b/u.test(host) &&
      parts.length >= 2
    ) {
      return `${host}/${parts[0] ?? ''}/${parts[1] ?? ''}`;
    }
    if (host === 'arxiv.org' && parts.length >= 2) {
      return `${host}/${parts[0] ?? ''}/${parts[1] ?? ''}`;
    }
    const hostParts = host.split('.');
    return hostParts.length >= 2 ? hostParts.slice(-2).join('.') : host;
  } catch {
    return 'invalid-url';
  }
}

function distinctSourceClustersForClaims(
  claims: readonly GovernedClaimRecord[],
): readonly string[] {
  return [
    ...new Set(claims.map((claim) => sourceClusterId(claim.requestedUrl))),
  ].filter((cluster) => cluster !== 'invalid-url');
}

function evidenceReadableConstraint(value: string, fallback: string): string {
  const trimmed = singleLine(value);
  const isSentenceLike =
    /\b(?:must|requires?|depends?|limited|under|during|without|within|only|when|where|before|after|because|if|unless|validate|evidence|budget|safety|risk|privacy|local|offline)\b/iu.test(
      trimmed,
    ) || /[.!?]$/u.test(trimmed);
  if (
    isSentenceLike &&
    informativeWordCount(trimmed) >= 3 &&
    textTerms(trimmed).length >= 1
  ) {
    return trimmed;
  }
  const fallbackText = singleLine(fallback);
  const condition = trimmed || fallbackText;
  return `Question condition requiring local validation: ${condition}.`;
}

function singleLine(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function stripFinalPunctuation(value: string): string {
  return singleLine(value).replace(/[.!?]+$/u, '');
}

function citedPortfolioItems(
  portfolio: readonly GovernedLiveReviewPortfolioItem[],
): readonly GovernedLiveReviewPortfolioItem[] {
  return portfolio.filter(
    (item) =>
      item.evidenceIndexes.length > 0 &&
      item.statement.trim().length >= 24 &&
      item.nextValidation.trim().length >= 24,
  );
}

function concreteExperimentThreshold(
  threshold: string,
  validation: string,
): string {
  const trimmed = singleLine(threshold);
  if (
    trimmed.length >= 24 &&
    hasComparatorLanguage(trimmed) &&
    !/meets? the decision criterion|portfolio rank|supported enough/iu.test(
      trimmed,
    )
  ) {
    return trimmed;
  }
  return `Pass only if the validation beats a baseline or current process on a named outcome threshold and records any adverse constraint failure for: ${stripFinalPunctuation(validation)}.`;
}

function rankLiveSpans(
  spans: readonly BoundedEvidenceSpan[],
  terms: readonly string[],
): readonly BoundedEvidenceSpan[] {
  return [...spans].sort((left, right) => {
    const relevance =
      textRelevanceScore(right.quote, terms) -
      textRelevanceScore(left.quote, terms);
    if (relevance !== 0) return relevance;
    return informativeWordCount(right.quote) - informativeWordCount(left.quote);
  });
}

function liveSourceQualityScore(hint: DiscoveredSourceHint): number {
  let score = 0;
  try {
    const url = new URL(hint.url);
    const host = url.hostname.toLocaleLowerCase('en-US');
    const path = url.pathname.toLocaleLowerCase('en-US');
    if (/\.(?:edu|gov)$/u.test(host)) score += 3;
    if (/^(?:docs?|developer|developers|research)\./u.test(host)) score += 2;
    if (/\b(?:github|gitlab|sourcehut|codeberg)\b/u.test(host)) score += 3;
    if (/\b(?:arxiv|doi|pubmed|ncbi|semanticscholar)\b/u.test(host)) {
      score += 2;
    }
    if (
      /\b(?:reddit|wikipedia|quora|medium|substack)\b/u.test(host) ||
      /\b(?:news|magazine|article|opinion|blog)\b/u.test(host)
    ) {
      score -= 4;
    }
    if (
      /\b(?:docs?|documentation|papers?|publications?|reports?|research|benchmarks?|repository|repo|manual|reference|readme|requirements)\b/u.test(
        path,
      )
    ) {
      score += 1;
    }
    if (/\b(?:login|signup|tag|category|search|privacy|terms)\b/u.test(path)) {
      score -= 2;
    }
  } catch {
    score -= 2;
  }
  const surface =
    `${hint.title ?? ''} ${hint.description ?? ''}`.toLocaleLowerCase('en-US');
  if (
    /\b(?:official (?:project|documentation)|benchmark|evaluation|repository|readme|implementation|source code|model card|field trial|guidance|technical report|paper|study|hardware requirements|memory requirements)\b/u.test(
      surface,
    )
  ) {
    score += 2;
  }
  if (
    /\b(?:blog|opinion|explained|wake-up call|what you need to know|news roundup|sponsored)\b/u.test(
      surface,
    )
  ) {
    score -= 3;
  }
  return score;
}

function isDecisionGradeLiveSource(hint: DiscoveredSourceHint): boolean {
  try {
    const host = new URL(hint.url).hostname.toLocaleLowerCase('en-US');
    if (/\b(?:reddit|wikipedia|quora|medium|substack)\b/u.test(host)) {
      return false;
    }
  } catch {
    return false;
  }
  return liveSourceQualityScore(hint) >= 2;
}

function requiresDirectDecisionEvidence(query: string): boolean {
  return /\b(?:official|documentation|primary source|technical report|benchmark|requirements|repository|readme|implementation|evaluation)\b/iu.test(
    query,
  );
}

function interleaveRelevantHintsByQuery(
  entries: readonly {
    readonly hint: DiscoveredSourceHint;
    readonly score: number;
  }[],
  queryIds: readonly string[],
): readonly DiscoveredSourceHint[] {
  const queues = new Map<string, typeof entries>();
  for (const queryId of queryIds) {
    queues.set(
      queryId,
      entries
        .filter((entry) => entry.hint.queryId === queryId)
        .sort((left, right) => right.score - left.score),
    );
  }
  const ordered: DiscoveredSourceHint[] = [];
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const queryId of queryIds) {
      const queue = queues.get(queryId) ?? [];
      const [next, ...rest] = queue;
      if (!next) continue;
      ordered.push(next.hint);
      queues.set(queryId, rest);
      progressed = true;
    }
  }
  return ordered;
}

function diversifyCandidatesBySourceCluster(
  candidates: readonly SelectedRetrievalCandidate[],
  maxCandidates: number,
): readonly SelectedRetrievalCandidate[] {
  const queues = new Map<string, SelectedRetrievalCandidate[]>();
  for (const candidate of candidates) {
    const cluster = sourceClusterId(candidate.requestedUrl);
    queues.set(cluster, [...(queues.get(cluster) ?? []), candidate]);
  }
  const ordered: SelectedRetrievalCandidate[] = [];
  let progressed = true;
  while (progressed && ordered.length < maxCandidates) {
    progressed = false;
    for (const cluster of [...queues.keys()].sort()) {
      const queue = queues.get(cluster) ?? [];
      const [next, ...rest] = queue;
      if (!next) continue;
      ordered.push(next);
      queues.set(cluster, rest);
      progressed = true;
      if (ordered.length >= maxCandidates) break;
    }
  }
  return ordered;
}

function diversifyClaimsBySourceCluster(
  claims: readonly GovernedClaimRecord[],
): readonly GovernedClaimRecord[] {
  const queues = new Map<string, GovernedClaimRecord[]>();
  for (const claim of claims) {
    const cluster = sourceClusterId(claim.requestedUrl);
    queues.set(cluster, [...(queues.get(cluster) ?? []), claim]);
  }
  const ordered: GovernedClaimRecord[] = [];
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const cluster of [...queues.keys()].sort()) {
      const queue = queues.get(cluster) ?? [];
      const [next, ...rest] = queue;
      if (!next) continue;
      ordered.push(next);
      queues.set(cluster, rest);
      progressed = true;
    }
  }
  return ordered;
}

function isRetrievalOriginAuthorized(input: {
  readonly origin: string;
  readonly authorizedOrigins: ReadonlySet<string>;
}): boolean {
  return (
    input.authorizedOrigins.has(input.origin) ||
    input.authorizedOrigins.has(PUBLIC_WEB_RETRIEVAL_AUTHORITY_ORIGIN)
  );
}

/**
 * Fail-closed authority re-verification at the execution boundary. The
 * release already evaluated the authority, but the executor never trusts a
 * release it cannot independently re-bind to the exact intent set, pinned
 * issuer, and validity window at execution time.
 */
function verifyExecutionAuthority(input: {
  readonly intentSet: InvestigationAcquisitionIntentSet;
  readonly release: AcquisitionRelease;
  readonly authority: P9LiveAuthorityReceipt;
  readonly trustedIssuerId: string | undefined;
  readonly now: string;
  readonly requiredEffectKinds?: readonly (typeof LIVE_REQUIRED_EFFECT_KINDS)[number][];
}): void {
  const { intentSet, release, authority } = input;
  if (release.decision !== 'authorized') {
    refuse(
      'release_not_authorized',
      `acquisition release ${release.releaseId} is ${release.decision}; governed execution refuses to run`,
    );
  }
  if (release.intentSetDigest !== intentSet.intentSetDigest) {
    refuse(
      'release_intent_set_mismatch',
      'release does not bind the presented intent set digest',
    );
  }
  if (release.planDigest !== intentSet.planDigest) {
    refuse(
      'release_plan_scope_mismatch',
      'release does not bind the intent set plan digest',
    );
  }
  if (release.investigationId !== intentSet.investigationId) {
    refuse(
      'release_investigation_mismatch',
      'release does not bind the intent set investigation',
    );
  }
  if (!input.trustedIssuerId?.trim()) {
    refuse(
      'no_trusted_authority_issuer',
      'governed execution requires an explicitly pinned trusted issuer',
    );
  }
  if (authority.issuerId !== input.trustedIssuerId) {
    refuse(
      'untrusted_authority_issuer',
      `authority issuer ${authority.issuerId} is not the pinned trusted issuer`,
    );
  }
  if (authority.receiptDigest !== release.authorityReceiptDigest) {
    refuse(
      'authority_release_binding_mismatch',
      'presented authority is not the exact authority the release bound',
    );
  }
  if (authority.planScope.planDigest !== intentSet.planDigest) {
    refuse(
      'authority_plan_scope_mismatch',
      'authority plan scope does not bind the intent set plan digest',
    );
  }
  if (
    authority.planScope.question !== intentSet.question ||
    authority.planScope.questionDigest !== canonicalDigest(intentSet.question)
  ) {
    refuse(
      'authority_question_scope_mismatch',
      'authority question scope does not bind the intent set question',
    );
  }
  const nowMs = Date.parse(input.now);
  if (nowMs < Date.parse(authority.notBeforeAt)) {
    refuse('authority_not_yet_valid', 'authority is not yet valid');
  }
  if (nowMs >= Date.parse(authority.expiresAt)) {
    refuse('authority_expired', 'authority validity window has expired');
  }
  const kinds = new Set(authority.authorizedEffectKinds);
  for (const kind of input.requiredEffectKinds ?? REQUIRED_EFFECT_KINDS) {
    if (!kinds.has(kind)) {
      refuse(
        'authority_missing_required_effect_kind',
        `authority does not authorize required effect kind ${kind}`,
      );
    }
  }
}

function workRef(input: {
  readonly kind: 'proposer' | 'evaluator';
  readonly seed: string;
  readonly payload: unknown;
}): P9ModelWorkRef {
  const proposer = input.kind === 'proposer';
  return {
    workId: `${input.kind}-work:${input.seed}`,
    workDigest: canonicalDigest({
      kind: `offline-${input.kind}-work/v1`,
      seed: input.seed,
      payload: input.payload,
    }),
    rawResponseDigest: canonicalDigest({
      kind: `offline-${input.kind}-raw/v1`,
      seed: input.seed,
      payload: input.payload,
    }),
    role: proposer ? 'claim_proposer' : 'entailment_evaluator',
    profileVersionId: proposer
      ? PROPOSER_PROFILE_VERSION
      : EVALUATOR_PROFILE_VERSION,
    profileFamilyId: proposer
      ? PROPOSER_PROFILE_FAMILY
      : EVALUATOR_PROFILE_FAMILY,
  };
}

function liveWorkRef(input: {
  readonly kind: 'proposer' | 'evaluator';
  readonly seed: string;
  readonly payload: unknown;
}): P9ModelWorkRef {
  const proposer = input.kind === 'proposer';
  return {
    workId: `live-${input.kind}-work:${input.seed}`,
    workDigest: canonicalDigest({
      kind: `live-${input.kind}-work/v1`,
      seed: input.seed,
      payload: input.payload,
    }),
    rawResponseDigest: canonicalDigest({
      kind: `live-${input.kind}-raw/v1`,
      seed: input.seed,
      payload: input.payload,
    }),
    role: proposer ? 'claim_proposer' : 'entailment_evaluator',
    profileVersionId: proposer
      ? LIVE_PROPOSER_PROFILE_VERSION
      : LIVE_EVALUATOR_PROFILE_VERSION,
    profileFamilyId: proposer
      ? LIVE_PROPOSER_PROFILE_FAMILY
      : LIVE_EVALUATOR_PROFILE_FAMILY,
  };
}

function proposeClaim(input: {
  readonly statement: string;
  readonly body: string;
  readonly span: BoundedEvidenceSpan;
  readonly snapshotDigest: string;
  readonly coordinateSpace: string;
}): P9ClaimProposal {
  const locator = buildEntailmentLocatorForSpan({
    body: input.body,
    span: input.span,
    snapshotDigest: input.snapshotDigest,
    coordinateSpace: input.coordinateSpace,
  });
  const seed = canonicalDigest({
    evidenceSpanId: input.span.evidenceSpanId,
    snapshotDigest: input.snapshotDigest,
    statement: input.statement,
  }).slice(7, 23);
  const identity = {
    schemaVersion: '1.0.0' as const,
    contractFamily: 'p9.v1' as const,
    proposalId: `claim:${seed}`,
    statement: input.statement,
    critical: false,
    locator,
    proposerWork: workRef({
      kind: 'proposer',
      seed,
      payload: { statement: input.statement, locator },
    }),
  };
  return P9ClaimProposalSchema.parse({
    ...identity,
    proposalDigest: canonicalDigest(identity),
  });
}

/**
 * Deterministic independent evaluator: it re-derives the quote and bounded
 * context from the snapshot body itself and only reports entailment when the
 * proposed statement reproduces the evidence exactly with no semantic drift.
 */
function evaluateClaim(input: {
  readonly proposal: P9ClaimProposal;
  readonly body: string;
  readonly now: string;
}): P9EntailmentVerdict {
  const { proposal } = input;
  const quote = input.body.slice(
    proposal.locator.startOffset,
    proposal.locator.endOffset,
  );
  const boundedContext = boundedEvidenceContext(
    input.body,
    proposal.locator.startOffset,
    proposal.locator.endOffset,
  );
  const semanticDeltas = detectP9SemanticDeltas(proposal.statement, quote);
  const hostileInstructionDetected =
    containsP9HostileInstruction(quote) ||
    containsP9HostileInstruction(boundedContext);
  const exact = proposal.statement === quote;
  const entailed =
    exact && semanticDeltas.length === 0 && !hostileInstructionDetected;
  const seed = canonicalDigest({
    proposalDigest: proposal.proposalDigest,
    quote,
  }).slice(7, 23);
  const identity = {
    schemaVersion: '1.0.0' as const,
    contractFamily: 'p9.v1' as const,
    verdictId: `verdict:${seed}`,
    proposalId: proposal.proposalId,
    proposalDigest: proposal.proposalDigest,
    evaluatedStatement: proposal.statement,
    evaluatedQuote: quote,
    boundedContext,
    locator: proposal.locator,
    verdict: entailed ? ('entailed' as const) : ('insufficient' as const),
    semanticDeltas,
    hostileInstructionDetected,
    reasonCodes: entailed
      ? ['statement_reproduces_admitted_quote_exactly']
      : [
          exact
            ? 'evidence_flagged_by_independent_review'
            : 'statement_not_reproduced_from_quote',
        ],
    evaluatorWork: workRef({
      kind: 'evaluator',
      seed,
      payload: { statement: proposal.statement, quote },
    }),
    evaluatedAt: input.now,
  };
  return P9EntailmentVerdictSchema.parse({
    ...identity,
    verdictDigest: canonicalDigest(identity),
  });
}

/**
 * The only sanctioned path from an AUTHORIZED acquisition release to executed
 * acquisition work, and it still performs no external effect: every
 * search/retrieval/parse step runs through injected no-effect adapters over a
 * declared offline source universe. A refused release, a digest mismatch, an
 * unpinned or untrusted issuer, or an out-of-window authority refuses before
 * any adapter is invoked. Every step leaves inspectable receipts: discovery
 * rejections, retrieval attempts, parser receipts, claim proposals,
 * independent verdicts, and admissions with typed rejection residue.
 */
export function executeGovernedAcquisition(
  input: GovernedAcquisitionExecutionInput,
): GovernedAcquisitionExecution {
  const intentSet = InvestigationAcquisitionIntentSetSchema.parse(
    input.intentSet,
  );
  const release = AcquisitionReleaseSchema.parse(input.release);
  const authorityParsed = P9LiveAuthorityReceiptSchema.safeParse(
    input.effectAuthority,
  );
  if (!authorityParsed.success) {
    refuse(
      'invalid_effect_authority_receipt',
      'governed execution requires a schema-valid scoped authority receipt',
    );
  }
  const authority = authorityParsed.data;
  verifyExecutionAuthority({
    intentSet,
    release,
    authority,
    trustedIssuerId: input.trustedIssuerId,
    now: input.now,
  });

  const sourceClassTargets = input.adapters.sourceClassTargets;
  if (sourceClassTargets.length === 0) {
    refuse(
      'no_planned_source_classes',
      'governed execution requires an explicitly pinned source-class policy',
    );
  }
  const maxClaimsPerSnapshot = input.maxClaimsPerSnapshot ?? 3;
  if (!Number.isInteger(maxClaimsPerSnapshot) || maxClaimsPerSnapshot < 1) {
    refuse(
      'invalid_claim_bound',
      'claims per snapshot must be a positive integer',
    );
  }

  const discoveryIntents = intentSet.intents.filter(
    (intent) => intent.kind === 'discovery.search',
  );
  const preserveIntents = intentSet.intents.filter(
    (intent) => intent.kind === 'acquisition.preserve',
  );
  const intentReceipts: GovernedIntentReceipt[] = [];

  // Phase 1 — discovery through the no-effect search adapter, then
  // plan-bound candidate selection with typed rejection residue.
  const hints: DiscoveredSourceHint[] = [];
  for (const intent of discoveryIntents) {
    const observed = input.adapters.search(intent.subject);
    for (const hint of observed) {
      hints.push({
        queryId: intent.intentId,
        url: hint.url,
        sourceClass: hint.sourceClass,
        ...(hint.title === undefined ? {} : { title: hint.title }),
      });
    }
    intentReceipts.push({
      intentId: intent.intentId,
      kind: intent.kind,
      subject: intent.subject,
      status: 'executed',
      counts: { observedHints: observed.length },
      executedAt: input.now,
    });
  }
  const selection = selectPlannedAcquisitionCandidates({
    scope: {
      searchQueries: discoveryIntents.map((intent) => ({
        queryId: intent.intentId,
        query: intent.subject,
        subquestionIds: [intent.derivedFrom],
      })),
      sourceClassTargets,
    },
    hints,
    selectedAt: input.now,
  });

  // Attribute each selected candidate to the discovery intent whose accepted
  // hint produced it (the first planned hint with the same canonical URL).
  const candidateQuery = new Map<string, string>();
  for (const candidate of selection.candidates) {
    const source = hints.find((hint) => {
      try {
        return (
          canonicalizeAcquisitionUrl(hint.url).href === candidate.requestedUrl
        );
      } catch {
        return false;
      }
    });
    if (source) candidateQuery.set(candidate.candidateId, source.queryId);
  }

  // Phase 2 — preserve intents: retrieval, immutable snapshots,
  // deterministic parsing, span derivation, and independent admission.
  const registry = new BoundedParserRegistry();
  const clock = () => new Date(input.now);
  const ledger = new P9RetrievalResidueLedger();
  const retrievalAttempts: RetrievalAttempt[] = [];
  const snapshots: GovernedExecutionSnapshot[] = [];
  const proposals: P9ClaimProposal[] = [];
  const verdicts: P9EntailmentVerdict[] = [];
  const admissions: P9ClaimAdmission[] = [];
  const claims: GovernedClaimRecord[] = [];
  const modelWork: P9ModelWorkRef[] = [];
  const spanUniverse: {
    readonly body: string;
    readonly span: BoundedEvidenceSpan;
    readonly snapshotDigest: string;
    readonly coordinateSpace: string;
    readonly candidateId: string;
    readonly requestedUrl: string;
    readonly sourceClass: string;
  }[] = [];

  const recordAttempt = (
    candidate: SelectedRetrievalCandidate,
    status: RetrievalAttempt['status'],
    bytes: number,
    failure?: { code: string; message: string },
  ): void => {
    retrievalAttempts.push(
      ledger.recordTerminal(
        buildTruthfulRetrievalAttempt({
          attemptId: `attempt:${candidate.candidateId}`,
          candidateId: candidate.candidateId,
          effectId: `effect:retrieval:${candidate.candidateId}`,
          requestedUrl: candidate.requestedUrl,
          status,
          startedAt: input.now,
          finishedAt: input.now,
          ...(status === 'admitted' ? { retrievedAt: input.now } : {}),
          robotsDecision: makeNotCheckedRobotsDecision({
            requestedUrl: candidate.requestedUrl,
            userAgent: 'mammoth-offline-governed-execution/1.0',
            policyId: 'offline-governed-robots/v1',
            evaluatedAt: input.now,
          }),
          rightsStatus: makeUnknownRightsStatus({
            policyId: 'offline-governed-rights/v1',
            observedAt: input.now,
          }),
          bytes,
          ...(failure
            ? {
                failure: {
                  ...failure,
                  retryable: false,
                  policyEffect: 'fail_closed' as const,
                },
              }
            : {}),
        }),
      ),
    );
  };

  const adjudicate = (
    proposal: P9ClaimProposal,
    body: string,
    origin: {
      readonly candidateId: string;
      readonly requestedUrl: string;
      readonly sourceClass: string;
    },
  ): void => {
    const verdict = evaluateClaim({ proposal, body, now: input.now });
    const admission = evaluateP9ClaimAdmission({
      proposal,
      verdict,
      decidedAt: input.now,
    });
    proposals.push(proposal);
    verdicts.push(verdict);
    admissions.push(admission);
    modelWork.push(proposal.proposerWork, verdict.evaluatorWork);
    claims.push({
      proposalId: proposal.proposalId,
      statement: proposal.statement,
      candidateId: origin.candidateId,
      requestedUrl: origin.requestedUrl,
      sourceClass: origin.sourceClass,
      decision: admission.decision,
      reasonCodes: admission.reasonCodes,
    });
  };

  for (const intent of preserveIntents) {
    const discoveryId = intent.dependsOn[0];
    const candidates = selection.candidates.filter(
      (candidate) => candidateQuery.get(candidate.candidateId) === discoveryId,
    );
    let preserved = 0;
    let intentClaims = 0;
    for (const candidate of candidates) {
      ledger.select(candidate);
      const retrieved = input.adapters.retrieve(candidate.requestedUrl);
      if (!retrieved) {
        recordAttempt(candidate, 'unavailable', 0, {
          code: 'offline_source_unavailable',
          message: 'declared offline source returned no bytes',
        });
        continue;
      }
      let parsed;
      try {
        parsed = registry.parse(retrieved.bytes, retrieved.mediaType, {
          sourceUrl: candidate.requestedUrl,
          now: clock,
          decisionId: `media:${candidate.candidateId}`,
          receiptId: `parser:${candidate.candidateId}`,
        });
      } catch (error) {
        if (error instanceof ParserPolicyError) {
          recordAttempt(
            candidate,
            'parser_failed',
            retrieved.bytes.byteLength,
            {
              code: error.code,
              message: 'deterministic parser refused the retrieved bytes',
            },
          );
          continue;
        }
        throw error;
      }
      const mediaSupportDecision = parsed.mediaSupportDecision;
      const parserReceipt = parsed.parserReceipt;
      if (!mediaSupportDecision || !parserReceipt) {
        refuse(
          'parser_receipt_missing',
          'governed execution requires a parser that emits its full receipt lineage',
        );
      }
      const parsedTextDigest = contentDigest(
        new TextEncoder().encode(parsed.text),
      );
      const spans = deriveBoundedEvidenceSpans({
        body: parsed.text,
        spanIdPrefix: candidate.candidateId,
      });
      recordAttempt(candidate, 'admitted', retrieved.bytes.byteLength);
      snapshots.push({
        candidateId: candidate.candidateId,
        requestedUrl: candidate.requestedUrl,
        sourceClass: candidate.sourceClass,
        rawContentDigest: contentDigest(retrieved.bytes),
        parsedTextDigest,
        parsedText: parsed.text,
        mediaSupportDecision,
        parserReceipt,
        spanCount: spans.length,
      });
      preserved += 1;
      const coordinateSpace =
        parserReceipt.locatorCoordinateSpace ?? 'utf16-code-units/v1';
      for (const span of spans) {
        spanUniverse.push({
          body: parsed.text,
          span,
          snapshotDigest: parsedTextDigest,
          coordinateSpace,
          candidateId: candidate.candidateId,
          requestedUrl: candidate.requestedUrl,
          sourceClass: candidate.sourceClass,
        });
      }
      for (const span of spans
        .filter((candidateSpan) => !candidateSpan.hostileInstructionDetected)
        .slice(0, maxClaimsPerSnapshot)) {
        adjudicate(
          proposeClaim({
            statement: span.quote,
            body: parsed.text,
            span,
            snapshotDigest: parsedTextDigest,
            coordinateSpace,
          }),
          parsed.text,
          candidate,
        );
        intentClaims += 1;
      }
    }
    intentReceipts.push({
      intentId: intent.intentId,
      kind: intent.kind,
      subject: intent.subject,
      status: 'executed',
      counts: {
        selectedCandidates: candidates.length,
        preservedSnapshots: preserved,
        proposedClaims: intentClaims,
      },
      executedAt: input.now,
    });
  }

  // Phase 3 — falsification probes derived verbatim from the accepted plan.
  // Each probe statement is deliberately adjudicated against real evidence by
  // the independent evaluator; probes that the evidence does not entail
  // become typed rejection residue instead of silently disappearing.
  for (const [
    index,
    check,
  ] of intentSet.coverage.falsificationChecks.entries()) {
    if (spanUniverse.length === 0) break;
    const target = spanUniverse[index % spanUniverse.length];
    if (!target || target.span.quote === check) continue;
    adjudicate(
      proposeClaim({
        statement: check,
        body: target.body,
        span: target.span,
        snapshotDigest: target.snapshotDigest,
        coordinateSpace: target.coordinateSpace,
      }),
      target.body,
      target,
    );
  }

  const coverage = ledger.assertComplete({
    missingSourceClasses: unservedPlannedSourceClasses(
      { searchQueries: [], sourceClassTargets },
      selection,
    ),
    assessedAt: input.now,
  });

  if (!admissions.some((admission) => admission.decision === 'admitted')) {
    refuse(
      'no_admissible_evidence',
      'governed execution admitted no evidence; a cited report cannot be composed',
    );
  }

  return {
    executedAt: input.now,
    investigationId: intentSet.investigationId,
    planDigest: intentSet.planDigest,
    intentSetDigest: intentSet.intentSetDigest,
    releaseDigest: release.releaseDigest,
    authorityReceiptDigest: authority.receiptDigest,
    intentReceipts,
    discoveredHints: hints.length,
    selectedCandidates: selection.candidates,
    rejectedHints: selection.rejected,
    snapshots,
    retrievalAttempts,
    coverage,
    proposals,
    verdicts,
    admissions,
    claims,
    modelWork,
    effectReceipts: [],
    externalEffectsExecuted: false,
    executionMode: 'offline_fixture',
  };
}

export async function executeGovernedLiveAcquisition(
  input: GovernedLiveAcquisitionExecutionInput,
): Promise<GovernedAcquisitionExecution> {
  const intentSet = InvestigationAcquisitionIntentSetSchema.parse(
    input.intentSet,
  );
  const release = AcquisitionReleaseSchema.parse(input.release);
  const authorityParsed = P9LiveAuthorityReceiptSchema.safeParse(
    input.effectAuthority,
  );
  if (!authorityParsed.success) {
    refuse(
      'invalid_effect_authority_receipt',
      'governed live execution requires a schema-valid scoped authority receipt',
    );
  }
  const authority = authorityParsed.data;
  verifyExecutionAuthority({
    intentSet,
    release,
    authority,
    trustedIssuerId: input.trustedIssuerId,
    now: input.now,
    requiredEffectKinds: LIVE_REQUIRED_EFFECT_KINDS,
  });

  const sourceClassTargets =
    input.sourceClassTargets ??
    ([
      {
        sourceClass: 'public_web',
        minimumIndependentSources: 2,
        mandatory: true,
      },
      {
        sourceClass: 'counterevidence',
        minimumIndependentSources: 1,
        mandatory: false,
      },
    ] as const);
  const maxClaimsPerSnapshot = input.maxClaimsPerSnapshot ?? 3;
  if (!Number.isInteger(maxClaimsPerSnapshot) || maxClaimsPerSnapshot < 1) {
    refuse(
      'invalid_claim_bound',
      'claims per snapshot must be a positive integer',
    );
  }
  const maxCandidates = input.maxCandidates ?? 16;
  if (!Number.isInteger(maxCandidates) || maxCandidates < 1) {
    refuse('invalid_candidate_bound', 'live candidate bound must be positive');
  }
  const authorizedDestinationOrigins = new Set(
    authority.authorizedDestinationOrigins.map(
      (value) => new URL(value).origin,
    ),
  );
  const authorizedRetrievalOrigins = new Set(
    authority.authorizedRetrievalOrigins.map((value) => new URL(value).origin),
  );
  const searchOrigin = 'https://api.search.brave.com';
  if (!authorizedDestinationOrigins.has(searchOrigin)) {
    refuse(
      'search_destination_origin_unauthorized',
      `live authority does not authorize search destination ${searchOrigin}`,
    );
  }
  const modelOrigin = new URL(input.modelBaseUrl).origin;
  if (!authorizedDestinationOrigins.has(modelOrigin)) {
    refuse(
      'model_destination_origin_unauthorized',
      `live authority does not authorize model destination ${modelOrigin}`,
    );
  }

  const journal = new FileP9DurableJournalStore(input.budgetJournalPath);
  journal.acquireExclusive();
  try {
    const budgetAuthority = P9DurableBudgetAuthority.open({
      accountId: `investigate-live:${authority.executionId}`,
      programId: authority.executionId,
      catalog: buildInvestigateLivePriceCatalog(),
      limit: authority.budgetLimit,
      authorizationReceipt: authority,
      store: journal,
      actorId: 'mammoth-investigate-live',
    });
    const executor = new P9LiveEffectExecutor(
      budgetAuthority,
      buildInvestigateLivePriceCatalog(),
      authority.executionId,
      'mammoth-investigate-live',
      () => input.now,
    );

    const discoveryIntents = intentSet.intents.filter(
      (intent) => intent.kind === 'discovery.search',
    );
    const preserveIntents = intentSet.intents.filter(
      (intent) => intent.kind === 'acquisition.preserve',
    );
    const intentReceipts: GovernedIntentReceipt[] = [];
    const hints: DiscoveredSourceHint[] = [];
    let nextSearchAt = 0;
    for (const intent of discoveryIntents) {
      const result = await executor.execute<readonly GovernedDiscoveryHint[]>({
        id: `live-search:${intent.intentId}`,
        catalogEntryId: 'brave-search',
        ceiling: ceiling({
          bytes: 2_000_000,
          durationMs: 30_000,
          attempts: 3,
        }),
        transport: async () => {
          const nowMs = Date.now();
          const delayMs = Math.max(0, nextSearchAt - nowMs);
          if (delayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
          }
          nextSearchAt = Date.now() + (input.minimumSearchIntervalMs ?? 2_000);
          const outcome = await liveSearch({
            query: intent.subject,
            apiKeyEnvVar: input.searchApiKeyEnvVar,
            ...(input.fetchImpl === undefined
              ? {}
              : { fetchImpl: input.fetchImpl }),
          });
          return {
            value: outcome.hints,
            usage: outcome.usage,
            usageSource: 'measured_transport',
          };
        },
      });
      if (result.status === 'failed') throw asError(result.error);
      for (const hint of result.value) {
        const querySubject = intent.subject.toLocaleLowerCase('en-US');
        const sourceClass =
          /\b(?:limitations?|counterexamples?|failure|failures|risks?|contradictions?|replication)\b/u.test(
            querySubject,
          )
            ? 'counterevidence'
            : hint.sourceClass;
        hints.push({
          queryId: intent.intentId,
          url: hint.url,
          sourceClass,
          ...(hint.title === undefined ? {} : { title: hint.title }),
          ...(hint.description === undefined
            ? {}
            : { description: hint.description }),
        });
      }
      intentReceipts.push({
        intentId: intent.intentId,
        kind: intent.kind,
        subject: intent.subject,
        status: 'executed',
        counts: { observedHints: result.value.length },
        executedAt: input.now,
      });
    }

    const plannedQueryById = new Map(
      discoveryIntents.map((intent) => [intent.intentId, intent.subject]),
    );
    const lowRelevanceHints: RejectedSourceHint[] = [];
    const relevantHintEntries = hints
      .map((hint) => {
        const query = plannedQueryById.get(hint.queryId) ?? '';
        return {
          hint,
          score: liveHintRelevanceScore({
            hint,
            query,
            question: authority.planScope.question,
          }),
          minimum: minimumHintRelevance({
            query,
            question: authority.planScope.question,
          }),
        };
      })
      .filter((entry) => {
        const query = plannedQueryById.get(entry.hint.queryId) ?? '';
        const directEnough =
          !requiresDirectDecisionEvidence(query) ||
          isDecisionGradeLiveSource(entry.hint);
        if (entry.score >= entry.minimum && directEnough) return true;
        lowRelevanceHints.push({
          hint: entry.hint,
          reason: 'low_relevance_hint',
        });
        return false;
      })
      .sort((left, right) => right.score - left.score);
    const relevantHints = interleaveRelevantHintsByQuery(
      relevantHintEntries,
      discoveryIntents.map((intent) => intent.intentId),
    );

    const selection = selectPlannedAcquisitionCandidates({
      scope: {
        searchQueries: discoveryIntents.map((intent) => ({
          queryId: intent.intentId,
          query: intent.subject,
          subquestionIds: [intent.derivedFrom],
        })),
        sourceClassTargets,
      },
      hints: relevantHints,
      selectedAt: input.now,
    });
    const unauthorizedRetrievalHints: RejectedSourceHint[] = [];
    const authorizedSelectedCandidates = selection.candidates.filter(
      (candidate) => {
        const origin = new URL(candidate.requestedUrl).origin;
        if (
          isRetrievalOriginAuthorized({
            origin,
            authorizedOrigins: authorizedRetrievalOrigins,
          })
        )
          return true;
        unauthorizedRetrievalHints.push({
          hint: {
            queryId: candidate.candidateId,
            url: candidate.requestedUrl,
            sourceClass: candidate.sourceClass,
          },
          reason: 'url_not_permitted',
        });
        return false;
      },
    );
    const selectedCandidates = diversifyCandidatesBySourceCluster(
      authorizedSelectedCandidates,
      maxCandidates,
    );

    const candidateQuery = new Map<string, string>();
    for (const candidate of selectedCandidates) {
      const source = hints.find((hint) => {
        try {
          return (
            canonicalizeAcquisitionUrl(hint.url).href === candidate.requestedUrl
          );
        } catch {
          return false;
        }
      });
      if (source) candidateQuery.set(candidate.candidateId, source.queryId);
    }

    const registry = new BoundedParserRegistry();
    const ledger = new P9RetrievalResidueLedger();
    const retrievalAttempts: RetrievalAttempt[] = [];
    const snapshots: GovernedExecutionSnapshot[] = [];
    const proposals: P9ClaimProposal[] = [];
    const verdicts: P9EntailmentVerdict[] = [];
    const admissions: P9ClaimAdmission[] = [];
    const claims: GovernedClaimRecord[] = [];
    const modelWork: P9ModelWorkRef[] = [];
    const spanUniverse: {
      readonly body: string;
      readonly span: BoundedEvidenceSpan;
      readonly snapshotDigest: string;
      readonly coordinateSpace: string;
      readonly candidateId: string;
      readonly requestedUrl: string;
      readonly sourceClass: string;
    }[] = [];
    const relevanceTerms = liveRelevanceTerms(authority.planScope.question);

    const recordAttempt = (
      candidate: SelectedRetrievalCandidate,
      status: RetrievalAttempt['status'],
      bytes: number,
      effectId: string,
      finalUrl?: string,
      failure?: { code: string; message: string; retryable?: boolean },
    ): void => {
      retrievalAttempts.push(
        ledger.recordTerminal(
          buildTruthfulRetrievalAttempt({
            attemptId: `attempt:${candidate.candidateId}`,
            candidateId: candidate.candidateId,
            effectId,
            requestedUrl: candidate.requestedUrl,
            ...(finalUrl === undefined ? {} : { finalUrl }),
            status,
            startedAt: input.now,
            finishedAt: input.now,
            ...(status === 'admitted' ? { retrievedAt: input.now } : {}),
            robotsDecision: makeNotCheckedRobotsDecision({
              requestedUrl: candidate.requestedUrl,
              ...(finalUrl === undefined ? {} : { finalUrl }),
              userAgent: LIVE_USER_AGENT,
              policyId: 'investigate-live-robots-not-checked/v1',
              evaluatedAt: input.now,
            }),
            rightsStatus: makeUnknownRightsStatus({
              policyId: 'investigate-live-rights-unknown/v1',
              observedAt: input.now,
            }),
            bytes,
            ...(failure
              ? {
                  failure: {
                    code: failure.code,
                    message: failure.message,
                    retryable: failure.retryable ?? false,
                    policyEffect: 'fail_closed' as const,
                  },
                }
              : {}),
          }),
        ),
      );
    };

    const adjudicate = (
      proposal: P9ClaimProposal,
      body: string,
      origin: {
        readonly candidateId: string;
        readonly requestedUrl: string;
        readonly sourceClass: string;
      },
    ): void => {
      const verdict = evaluateClaim({ proposal, body, now: input.now });
      const admission = evaluateP9ClaimAdmission({
        proposal,
        verdict,
        decidedAt: input.now,
      });
      proposals.push(proposal);
      verdicts.push(verdict);
      admissions.push(admission);
      modelWork.push(proposal.proposerWork, verdict.evaluatorWork);
      claims.push({
        proposalId: proposal.proposalId,
        statement: proposal.statement,
        candidateId: origin.candidateId,
        requestedUrl: origin.requestedUrl,
        sourceClass: origin.sourceClass,
        decision: admission.decision,
        reasonCodes: admission.reasonCodes,
      });
    };

    for (const intent of preserveIntents) {
      const discoveryId = intent.dependsOn[0];
      const candidates = selectedCandidates.filter(
        (candidate) =>
          candidateQuery.get(candidate.candidateId) === discoveryId,
      );
      let preserved = 0;
      let intentClaims = 0;
      for (const candidate of candidates) {
        ledger.select(candidate);
        const retrievalResult = await executor.execute({
          id: `live-retrieval:${candidate.candidateId}`,
          catalogEntryId: 'public-retrieval',
          ceiling: ceiling({ bytes: 4_000_000, durationMs: 45_000 }),
          transport: async () => {
            const retrieved = await (input.retrieve ?? retrieveSource)(
              {
                url: candidate.requestedUrl,
                headers: { 'user-agent': LIVE_USER_AGENT },
              },
              {
                now: () => new Date(input.now),
                policyId: 'investigate-live-network/v1',
              },
            );
            return {
              value: retrieved,
              usage: usageOf({
                requests: 1,
                bytes: retrieved.bytes.byteLength,
              }),
              usageSource: 'measured_transport' as const,
            };
          },
        });
        if (retrievalResult.status === 'failed') {
          const error = retrievalResult.error;
          recordAttempt(
            candidate,
            error instanceof AcquisitionFailure &&
              error.code === 'ACQUISITION_TIMEOUT'
              ? 'timed_out'
              : 'unavailable',
            0,
            retrievalResult.reservation.bound.effectId,
            undefined,
            {
              code:
                error instanceof AcquisitionFailure
                  ? error.code
                  : 'live_retrieval_failed',
              message:
                error instanceof Error
                  ? error.message
                  : 'live retrieval failed',
              retryable: true,
            },
          );
          continue;
        }
        const retrieved = retrievalResult.value;
        const parserResult = await executor.execute({
          id: `live-parser:${candidate.candidateId}`,
          catalogEntryId: 'bounded-parser',
          ceiling: ceiling({
            bytes: retrieved.bytes.byteLength,
            durationMs: 30_000,
            parserClass: 'mammoth-bounded-parser/v1',
          }),
          transport: () => {
            const parsed = registry.parse(
              retrieved.bytes,
              retrieved.mediaType,
              {
                sourceUrl: retrieved.finalUrl,
                now: () => new Date(input.now),
                decisionId: `media:${candidate.candidateId}`,
                receiptId: `parser:${candidate.candidateId}`,
              },
            );
            return Promise.resolve({
              value: parsed,
              usage: usageOf({
                requests: 1,
                bytes: retrieved.bytes.byteLength,
              }),
              usageSource: 'measured_transport' as const,
            });
          },
        });
        if (parserResult.status === 'failed') {
          recordAttempt(
            candidate,
            'parser_failed',
            retrieved.bytes.byteLength,
            parserResult.reservation.bound.effectId,
            retrieved.finalUrl,
            {
              code:
                parserResult.error instanceof ParserPolicyError
                  ? parserResult.error.code
                  : 'live_parser_failed',
              message:
                parserResult.error instanceof Error
                  ? parserResult.error.message
                  : 'live parser failed',
            },
          );
          continue;
        }
        const parsed = parserResult.value;
        if (!parsed.mediaSupportDecision || !parsed.parserReceipt) {
          refuse(
            'parser_receipt_missing',
            'governed live execution requires a parser that emits full receipt lineage',
          );
        }
        const rawContentDigest = contentDigest(retrieved.bytes);
        const parsedBytes = new TextEncoder().encode(parsed.text);
        const parsedTextDigest = contentDigest(parsedBytes);
        const candidateSearchTerms = textTerms(
          plannedQueryById.get(
            candidateQuery.get(candidate.candidateId) ?? '',
          ) ?? '',
        );
        const spans = rankLiveSpans(
          deriveBoundedEvidenceSpans({
            body: parsed.text,
            spanIdPrefix: `live:${candidate.candidateId}`,
            bounds: { maximumWindowCharacters: 160_000 },
            isExcluded: isLowInformationLiveSpan,
          }).filter((span) =>
            isLiveSpanQuestionRelevant(span.quote, [
              ...new Set([...relevanceTerms, ...candidateSearchTerms]),
            ]),
          ),
          [...new Set([...relevanceTerms, ...candidateSearchTerms])],
        );
        recordAttempt(
          candidate,
          'admitted',
          retrieved.bytes.byteLength,
          retrievalResult.reservation.bound.effectId,
          retrieved.finalUrl,
        );
        snapshots.push({
          candidateId: candidate.candidateId,
          requestedUrl: candidate.requestedUrl,
          sourceClass: candidate.sourceClass,
          rawContentDigest,
          parsedTextDigest,
          parsedText: parsed.text,
          mediaSupportDecision: parsed.mediaSupportDecision,
          parserReceipt: parsed.parserReceipt,
          spanCount: spans.length,
        });
        preserved += 1;
        for (const span of spans.slice(0, maxClaimsPerSnapshot)) {
          spanUniverse.push({
            body: parsed.text,
            span,
            snapshotDigest: parsedTextDigest,
            coordinateSpace: 'parsed_text',
            candidateId: candidate.candidateId,
            requestedUrl: candidate.requestedUrl,
            sourceClass: candidate.sourceClass,
          });
          const proposal = proposeClaim({
            statement: span.quote,
            body: parsed.text,
            span,
            snapshotDigest: parsedTextDigest,
            coordinateSpace: 'parsed_text',
          });
          adjudicate(proposal, parsed.text, {
            candidateId: candidate.candidateId,
            requestedUrl: candidate.requestedUrl,
            sourceClass: candidate.sourceClass,
          });
          intentClaims += 1;
        }
      }
      intentReceipts.push({
        intentId: intent.intentId,
        kind: intent.kind,
        subject: intent.subject,
        status: 'executed',
        counts: {
          selectedCandidates: candidates.length,
          preserved,
          proposedClaims: intentClaims,
        },
        executedAt: input.now,
      });
    }

    // Preserve explicit rejection residue: one deterministic poisoned claim
    // proves the independent admission layer is active on the live path.
    const [firstSpan] = spanUniverse;
    if (firstSpan) {
      const bad = proposeClaim({
        statement: `${firstSpan.span.quote} unsupported extrapolation`,
        body: firstSpan.body,
        span: firstSpan.span,
        snapshotDigest: firstSpan.snapshotDigest,
        coordinateSpace: firstSpan.coordinateSpace,
      });
      adjudicate(bad, firstSpan.body, firstSpan);
    }

    const modelReview = await executor.execute<GovernedLiveModelReview>({
      id: 'live-model:independent-review',
      catalogEntryId: 'openai-compatible-model',
      ceiling: ceiling({
        inputTokens: 20_000,
        outputTokens: 2_000,
        bytes: 500_000,
        durationMs: 120_000,
      }),
      transport: async () => {
        const rawReviewClaims = claims.filter(
          (claim) =>
            claim.decision === 'admitted' &&
            hints.some((hint) => {
              try {
                return (
                  canonicalizeAcquisitionUrl(hint.url).href ===
                    claim.requestedUrl && isDecisionGradeLiveSource(hint)
                );
              } catch {
                return false;
              }
            }),
        );
        if (isBroadDecisionQuestion(intentSet.question)) {
          const clusters = distinctSourceClustersForClaims(rawReviewClaims);
          if (clusters.length < 3) {
            refuse(
              'insufficient_source_cluster_diversity',
              'broad live synthesis requires admitted decision-grade evidence from at least three independent source clusters',
            );
          }
        }
        const reviewClaims = diversifyClaimsBySourceCluster(rawReviewClaims)
          .filter(
            (claim, index, all) =>
              all
                .slice(0, index)
                .filter(
                  (prior) =>
                    sourceClusterId(prior.requestedUrl) ===
                    sourceClusterId(claim.requestedUrl),
                ).length < 4,
          )
          .slice(0, 32);
        if (reviewClaims.length === 0) {
          refuse(
            'no_decision_grade_evidence',
            'live synthesis requires admitted direct, primary, official, repository, or measured evidence',
          );
        }
        const outcome = await openAiCompatibleReview({
          baseUrl: input.modelBaseUrl,
          apiKeyEnvVar: input.modelApiKeyEnvVar,
          modelId: input.modelId,
          question: intentSet.question,
          ...(input.fetchImpl === undefined
            ? {}
            : { fetchImpl: input.fetchImpl }),
          decisionConstraints: deriveDecisionConstraints(
            intentSet.question,
          ).slice(0, 4),
          broadDecisionQuestion: isBroadDecisionQuestion(intentSet.question),
          claims: reviewClaims,
        });
        return {
          value: outcome.review,
          usage: outcome.usage,
          usageSource: 'provider_reported',
        };
      },
    });
    if (modelReview.status === 'failed') throw asError(modelReview.error);
    const reviewEvidenceClaims = claims.filter(
      (claim) =>
        claim.decision === 'admitted' &&
        hints.some((hint) => {
          try {
            return (
              canonicalizeAcquisitionUrl(hint.url).href ===
                claim.requestedUrl && isDecisionGradeLiveSource(hint)
            );
          } catch {
            return false;
          }
        }),
    );
    assertDecisionGradeReview({
      review: modelReview.value,
      admittedEvidenceCount: reviewEvidenceClaims.length,
      decisionConstraints: deriveDecisionConstraints(intentSet.question).slice(
        0,
        4,
      ),
      question: intentSet.question,
      reviewClaims: reviewEvidenceClaims,
    });
    const acceptanceReview = buildLiveAcceptanceReview({
      review: modelReview.value,
      reviewClaims: reviewEvidenceClaims,
      decisionConstraints: deriveDecisionConstraints(intentSet.question).slice(
        0,
        4,
      ),
      question: intentSet.question,
      now: input.now,
    });
    if (acceptanceReview.overall !== 'pass') {
      const failed = [
        ...acceptanceReview.criteria,
        ...acceptanceReview.decisionConstraints,
      ]
        .filter((item) => !item.passed)
        .map((item) => item.criterionId)
        .join(', ');
      refuse(
        'independent_acceptance_review_failed',
        `live acceptance review failed one or more explicit pass/fail criteria: ${failed}`,
      );
    }
    const reviewSeed = canonicalDigest(modelReview.value).slice(7, 23);
    modelWork.push(
      liveWorkRef({
        kind: 'evaluator',
        seed: reviewSeed,
        payload: modelReview.value,
      }),
    );

    const coverage = ledger.assertComplete({
      missingSourceClasses: unservedPlannedSourceClasses(
        { searchQueries: [], sourceClassTargets },
        { candidates: selectedCandidates, rejected: selection.rejected },
      ),
      assessedAt: input.now,
    });
    return {
      executedAt: input.now,
      investigationId: intentSet.investigationId,
      planDigest: intentSet.planDigest,
      intentSetDigest: intentSet.intentSetDigest,
      releaseDigest: release.releaseDigest,
      authorityReceiptDigest: authority.receiptDigest,
      intentReceipts,
      discoveredHints: hints.length,
      selectedCandidates,
      rejectedHints: [
        ...lowRelevanceHints,
        ...selection.rejected,
        ...unauthorizedRetrievalHints,
      ],
      snapshots,
      retrievalAttempts,
      coverage,
      proposals,
      verdicts,
      admissions,
      claims,
      modelWork,
      liveReview: modelReview.value,
      acceptanceReview,
      reviewEvidenceProposalIds: diversifyClaimsBySourceCluster(
        reviewEvidenceClaims,
      )
        .filter(
          (claim, index, all) =>
            all
              .slice(0, index)
              .filter(
                (prior) =>
                  sourceClusterId(prior.requestedUrl) ===
                  sourceClusterId(claim.requestedUrl),
              ).length < 4,
        )
        .slice(0, 32)
        .map((claim) => claim.proposalId),
      effectReceipts: executor.effectReceipts,
      externalEffectsExecuted: true,
      executionMode: 'governed_live',
    };
  } finally {
    journal.releaseExclusive();
  }
}

function usageOf(input: {
  readonly requests?: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly bytes?: number;
  readonly durationMs?: number;
}) {
  return {
    requests: input.requests ?? 0,
    inputTokens: input.inputTokens ?? 0,
    outputTokens: input.outputTokens ?? 0,
    bytes: input.bytes ?? 0,
    durationMs: input.durationMs ?? 0,
  };
}

function ceiling(input: {
  readonly requests?: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly bytes?: number;
  readonly durationMs: number;
  readonly attempts?: number;
  readonly parserClass?: string | null;
}) {
  return {
    requests: input.requests ?? 1,
    inputTokens: input.inputTokens ?? 0,
    outputTokens: input.outputTokens ?? 0,
    bytes: input.bytes ?? 0,
    durationMs: input.durationMs,
    attempts: input.attempts ?? 1,
    parserClass: input.parserClass ?? null,
  };
}

export function buildInvestigateLivePriceCatalog() {
  const identity = {
    schemaVersion: '1.0.0' as const,
    contractFamily: 'p9.v1' as const,
    catalogId: 'investigate-live-price-catalog/v1',
    version: '1.0.0',
    entries: [
      {
        id: 'brave-search',
        provider: 'brave-search/v1',
        effectKind: 'search' as const,
        parserClass: null,
        flatCostUsd: 0,
        costPerRequestUsd: 0.01,
        costPerInputTokenUsd: 0,
        costPerOutputTokenUsd: 0,
        costPerByteUsd: 0,
      },
      {
        id: 'public-retrieval',
        provider: 'mammoth-public-network/v1',
        effectKind: 'retrieval' as const,
        parserClass: null,
        flatCostUsd: 0,
        costPerRequestUsd: 0,
        costPerInputTokenUsd: 0,
        costPerOutputTokenUsd: 0,
        costPerByteUsd: 0,
      },
      {
        id: 'bounded-parser',
        provider: 'mammoth-local-parser/v1',
        effectKind: 'parser' as const,
        parserClass: 'mammoth-bounded-parser/v1',
        flatCostUsd: 0,
        costPerRequestUsd: 0,
        costPerInputTokenUsd: 0,
        costPerOutputTokenUsd: 0,
        costPerByteUsd: 0,
      },
      {
        id: 'openai-compatible-model',
        provider: 'openai-compatible/v1',
        effectKind: 'model' as const,
        parserClass: null,
        flatCostUsd: 0,
        costPerRequestUsd: 0,
        costPerInputTokenUsd: 0.00000001,
        costPerOutputTokenUsd: 0.00000003,
        costPerByteUsd: 0,
      },
    ],
  };
  return { ...identity, catalogDigest: canonicalDigest(identity) };
}

async function liveSearch(input: {
  readonly query: string;
  readonly apiKeyEnvVar: string;
  readonly fetchImpl?: typeof fetch;
}): Promise<{
  readonly hints: readonly GovernedDiscoveryHint[];
  readonly usage: ReturnType<typeof usageOf>;
}> {
  const apiKey = process.env[input.apiKeyEnvVar]?.trim();
  if (!apiKey) {
    throw new Error(`brave credential ${input.apiKeyEnvVar} is empty`);
  }
  return braveSearch(input.query, apiKey, input.fetchImpl ?? fetch);
}

async function braveSearch(
  query: string,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<{
  readonly hints: readonly GovernedDiscoveryHint[];
  readonly usage: ReturnType<typeof usageOf>;
}> {
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', '10');
  const startedAt = Date.now();
  let attempts = 0;
  let observedBytes = 0;
  let response: Response | null = null;
  let raw = '';
  for (;;) {
    attempts += 1;
    response = await fetchImpl(url, {
      headers: {
        accept: 'application/json',
        'x-subscription-token': apiKey,
      },
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    raw = await response.text();
    observedBytes += Buffer.byteLength(raw, 'utf8');
    if (response.status !== 429) break;
    const decision = decideBraveRateLimitRetry({
      status: response.status,
      headers: response.headers,
      maxShortResetSeconds: 5,
      retryPaddingMs: 250,
      jitterMs: 0,
    });
    if (decision.kind !== 'retry_short_window' || attempts > 2) {
      throw braveSearchRateLimitError(
        response.status,
        response.headers,
        decision,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, decision.waitMs));
  }
  if (!response.ok) {
    throw braveSearchHttpError(response.status, response.headers);
  }
  const parsed = JSON.parse(raw) as {
    web?: {
      results?: { url?: string; title?: string; description?: string }[];
    };
  };
  const hints = (parsed.web?.results ?? [])
    .filter(
      (
        result,
      ): result is {
        url: string;
        title?: string;
        description?: string;
      } => {
        if (!result.url) return false;
        try {
          const url = new URL(result.url);
          return (
            url.protocol === 'https:' &&
            (!url.pathname.endsWith('.pdf') || url.hostname === 'arxiv.org')
          );
        } catch {
          return false;
        }
      },
    )
    .map((result) => {
      const url = new URL(result.url);
      const arxivPdf =
        url.hostname === 'arxiv.org'
          ? /^\/pdf\/([^/]+?)(?:\.pdf)?$/u.exec(url.pathname)
          : null;
      return {
        url: arxivPdf
          ? `https://arxiv.org/html/${arxivPdf[1] ?? ''}`
          : result.url,
        sourceClass: 'public_web',
        ...(result.title === undefined ? {} : { title: result.title }),
        ...(result.description === undefined
          ? {}
          : { description: result.description }),
      };
    });
  return {
    hints,
    usage: usageOf({
      requests: attempts,
      bytes: observedBytes,
      durationMs: Math.max(0, Date.now() - startedAt),
    }),
  };
}

function braveSearchRateLimitError(
  status: number,
  headers: Headers,
  decision: ReturnType<typeof decideBraveRateLimitRetry>,
): Error {
  if (decision.kind === 'not_rate_limit') {
    return braveSearchHttpError(status, headers);
  }
  const reset = headers.get('x-ratelimit-reset');
  const safeReset = reset?.match(/^[0-9, ]{1,80}$/u)?.[0];
  return new BraveRateLimitError(
    `Brave search failed with HTTP ${String(status)}${
      safeReset ? `; rate limit reset ${safeReset} seconds` : ''
    }; rate limit ${decision.kind}`,
    decision,
  );
}

function braveSearchHttpError(status: number, headers: Headers): Error {
  const reset = headers.get('x-ratelimit-reset');
  const safeReset = reset?.match(/^[0-9, ]{1,80}$/u)?.[0];
  const state = parseBraveRateLimitHeaders(headers);
  const shortDelayMs = nextBraveShortWindowDelayMs({
    headers,
    fallbackIntervalMs: 2_000,
    retryPaddingMs: 250,
  });
  const monthlyExhausted =
    state.monthlyWindow?.remaining === 0 ? '; monthly quota exhausted' : '';
  return new Error(
    `Brave search failed with HTTP ${String(status)}${
      safeReset ? `; rate limit reset ${safeReset} seconds` : ''
    }; next short-window delay ${String(shortDelayMs)}ms${monthlyExhausted}`,
  );
}

async function openAiCompatibleReview(input: {
  readonly baseUrl: string;
  readonly apiKeyEnvVar: string;
  readonly modelId: string;
  readonly question: string;
  readonly decisionConstraints: readonly string[];
  readonly broadDecisionQuestion: boolean;
  readonly fetchImpl?: typeof fetch;
  readonly claims: readonly GovernedClaimRecord[];
}): Promise<{
  readonly review: GovernedLiveModelReview;
  readonly usage: ReturnType<typeof usageOf> | null;
}> {
  const apiKey = process.env[input.apiKeyEnvVar]?.trim();
  if (!apiKey) {
    throw new Error(`model credential ${input.apiKeyEnvVar} is empty`);
  }
  const base = new URL(input.baseUrl);
  if (base.protocol !== 'https:') {
    throw new Error('model base URL must be https');
  }
  const completionsUrl = new URL(
    `${base.pathname.replace(/\/+$/u, '')}/chat/completions`,
    base,
  );
  const startedAt = Date.now();
  const response = await (input.fetchImpl ?? fetch)(completionsUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    redirect: 'error',
    signal: AbortSignal.timeout(120_000),
    body: JSON.stringify({
      model: input.modelId,
      temperature: 0,
      max_tokens: 2000,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'mammoth_investigate_live_review',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              summary: { type: 'string' },
              portfolio: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    rank: { type: 'integer', minimum: 1 },
                    title: { type: 'string' },
                    statement: { type: 'string' },
                    rationale: { type: 'string' },
                    constraints: {
                      type: 'array',
                      items: { type: 'string' },
                    },
                    nextValidation: { type: 'string' },
                    evidenceIndexes: {
                      type: 'array',
                      items: { type: 'integer', minimum: 1 },
                    },
                  },
                  required: [
                    'rank',
                    'title',
                    'statement',
                    'rationale',
                    'constraints',
                    'nextValidation',
                    'evidenceIndexes',
                  ],
                },
              },
              unresolvedConstraints: {
                type: 'array',
                items: { type: 'string' },
              },
              answerBullets: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    statement: { type: 'string' },
                    evidenceIndexes: {
                      type: 'array',
                      items: { type: 'integer', minimum: 1 },
                    },
                  },
                  required: ['statement', 'evidenceIndexes'],
                },
              },
              mechanisms: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    statement: { type: 'string' },
                    evidenceIndexes: {
                      type: 'array',
                      items: { type: 'integer', minimum: 1 },
                    },
                  },
                  required: ['statement', 'evidenceIndexes'],
                },
              },
              dissent: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    statement: { type: 'string' },
                    evidenceIndexes: {
                      type: 'array',
                      items: { type: 'integer', minimum: 1 },
                    },
                  },
                  required: ['statement', 'evidenceIndexes'],
                },
              },
              boundaryConditions: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    statement: { type: 'string' },
                    evidenceIndexes: {
                      type: 'array',
                      items: { type: 'integer', minimum: 1 },
                    },
                  },
                  required: ['statement', 'evidenceIndexes'],
                },
              },
              hypotheses: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    statement: { type: 'string' },
                    falsifier: { type: 'string' },
                    evidenceIndexes: {
                      type: 'array',
                      items: { type: 'integer', minimum: 1 },
                    },
                  },
                  required: ['statement', 'falsifier', 'evidenceIndexes'],
                },
              },
              experimentProposals: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    statement: { type: 'string' },
                    resolvesUncertainty: { type: 'string' },
                    threshold: { type: 'string' },
                    safetyBoundary: { type: 'string' },
                    evidenceIndexes: {
                      type: 'array',
                      items: { type: 'integer', minimum: 1 },
                    },
                  },
                  required: [
                    'statement',
                    'resolvesUncertainty',
                    'threshold',
                    'safetyBoundary',
                    'evidenceIndexes',
                  ],
                },
              },
              weaknesses: { type: 'array', items: { type: 'string' } },
              suggestedSearches: { type: 'array', items: { type: 'string' } },
            },
            required: [
              'summary',
              'portfolio',
              'unresolvedConstraints',
              'answerBullets',
              'mechanisms',
              'dissent',
              'boundaryConditions',
              'hypotheses',
              'experimentProposals',
              'weaknesses',
              'suggestedSearches',
            ],
          },
        },
      },
      messages: [
        {
          role: 'system',
          content:
            'You are an independent decision-research reviewer. Use only the supplied admitted evidence snippets. Do not add facts. Return compact JSON. Build a ranked portfolio of concrete decisions or opportunities, ordered by evidence strength and practical feasibility. Every portfolio item must name a specific build, intervention, opportunity class, or decision; explain why it ranks there; state evidence-backed constraints; propose the cheapest decisive next validation; and cite one or more supplied evidenceIndex values. Do not create a portfolio item when the evidence supports only a broad theme. For broad opportunity, strategy, approach, option, or how-should questions, return at least three distinct portfolio items when the evidence supports them; otherwise put the missing breadth in unresolvedConstraints. Distinct items must differ in user workflow, architecture, or decision lever, not merely be substeps of the same project. Avoid multiple items that are only variants of the same named project or intervention. Address every supplied decisionConstraint explicitly: either use its wording in an evidence-backed portfolio item or repeat it in unresolvedConstraints when the evidence does not resolve it. Every answer bullet, mechanism, dissent item, boundary condition, hypothesis, and experiment must cite supplied evidenceIndex values. Address the user question in the same form it was asked, including any locality, privacy, hardware, budget, risk, safety, or deployment constraints that are supported by evidence. Do not infer hardware feasibility, cost, privacy, locality, safety, or performance unless the snippets support it; when evidence is missing, say so in unresolvedConstraints. Mechanisms should identify transferable causal mechanisms and where transfer breaks. Dissent should name a real evidence gap, counterexample, tradeoff, or boundary; do not emit generic "more validation needed" dissent. Experiments must name a concrete task, baseline/comparator, metric, decision threshold, and safety boundary when evidence permits. Prefer direct project documentation, implementation details, measured benchmarks, resource constraints, deployment evidence, and primary-source limitations over commentary.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            question: input.question,
            decisionConstraints: input.decisionConstraints,
            broadDecisionQuestion: input.broadDecisionQuestion,
            keyQuestionTerms: liveRelevanceTerms(input.question),
            admittedEvidence: input.claims.map((claim, index) => ({
              evidenceIndex: index + 1,
              statement: claim.statement,
              sourceClass: claim.sourceClass,
              url: claim.requestedUrl,
            })),
          }),
        },
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(`model review failed with HTTP ${String(response.status)}`);
  }
  const raw = await response.text();
  const parsed = JSON.parse(raw) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
  };
  const content = parsed.choices?.[0]?.message?.content;
  if (!content) throw new Error('model review returned no content');
  const review = JSON.parse(content) as GovernedLiveModelReview;
  if (
    !review.summary ||
    !Array.isArray(review.portfolio) ||
    !Array.isArray(review.unresolvedConstraints) ||
    !Array.isArray(review.answerBullets) ||
    !Array.isArray(review.mechanisms) ||
    !Array.isArray(review.dissent) ||
    !Array.isArray(review.boundaryConditions) ||
    !Array.isArray(review.hypotheses) ||
    !Array.isArray(review.experimentProposals) ||
    !Array.isArray(review.weaknesses) ||
    !Array.isArray(review.suggestedSearches)
  ) {
    throw new Error('model review failed schema validation');
  }
  return {
    review: completeLiveReview(review),
    usage: parsed.usage
      ? usageOf({
          requests: 1,
          inputTokens: parsed.usage.prompt_tokens ?? 0,
          outputTokens: parsed.usage.completion_tokens ?? 0,
          bytes: Buffer.byteLength(raw, 'utf8'),
          durationMs: Math.max(0, Date.now() - startedAt),
        })
      : null,
  };
}

function completeLiveReview(
  review: GovernedLiveModelReview,
): GovernedLiveModelReview {
  const unresolvedConstraints = (review.unresolvedConstraints ?? [])
    .map(singleLine)
    .filter(
      (constraint) =>
        constraint.length > 0 &&
        !/^(?:none|n\/a|not applicable|no unresolved constraints?)\.?$/iu.test(
          constraint,
        ),
    );
  const portfolio = (review.portfolio ?? []).map((item) => ({
    ...item,
    constraints:
      item.constraints.length > 0
        ? item.constraints.map((constraint) =>
            evidenceReadableConstraint(constraint, item.nextValidation),
          )
        : [
            evidenceReadableConstraint(
              '',
              item.nextValidation || item.statement || item.title,
            ),
          ],
  }));
  const citedPortfolio = citedPortfolioItems(portfolio);
  const dissent =
    (review.dissent ?? []).filter(
      (item) =>
        item.statement.trim().length >= 24 && item.evidenceIndexes.length > 0,
    ).length > 0
      ? (review.dissent ?? []).filter(
          (item) =>
            item.statement.trim().length >= 24 &&
            item.evidenceIndexes.length > 0,
        )
      : citedPortfolio
          .filter(
            (item) =>
              item.constraints.length > 0 && item.evidenceIndexes.length > 0,
          )
          .slice(0, 3)
          .map((item) => ({
            statement: `The cited evidence supports ${item.title.trim()} only where this condition is satisfied: ${item.constraints[0]?.trim() ?? item.nextValidation.trim()}`,
            evidenceIndexes: item.evidenceIndexes,
          }));
  const boundaryConditions =
    (review.boundaryConditions ?? []).filter(
      (item) =>
        item.statement.trim().length >= 24 && item.evidenceIndexes.length > 0,
    ).length > 0
      ? (review.boundaryConditions ?? []).filter(
          (item) =>
            item.statement.trim().length >= 24 &&
            item.evidenceIndexes.length > 0,
        )
      : citedPortfolio
          .filter(
            (item) =>
              item.constraints.length > 0 && item.evidenceIndexes.length > 0,
          )
          .slice(0, 3)
          .map((item) => ({
            statement: `Before choosing ${item.title.trim()}, validate whether the cited evidence actually satisfies this condition: ${item.constraints[0]?.trim() ?? item.nextValidation.trim()}`,
            evidenceIndexes: item.evidenceIndexes,
          }));
  const hypotheses =
    (review.hypotheses ?? []).filter(
      (item) =>
        item.statement.trim().length >= 24 &&
        item.falsifier.trim().length >= 24 &&
        item.evidenceIndexes.length > 0,
    ).length > 0
      ? (review.hypotheses ?? []).filter(
          (item) =>
            item.statement.trim().length >= 24 &&
            item.falsifier.trim().length >= 24 &&
            item.evidenceIndexes.length > 0,
        )
      : citedPortfolio
          .filter(
            (item) =>
              item.statement.trim().length >= 24 &&
              item.nextValidation.trim().length >= 24 &&
              item.evidenceIndexes.length > 0,
          )
          .slice(0, 3)
          .map((item) => ({
            statement: `If ${stripFinalPunctuation(item.statement)}, then ${stripFinalPunctuation(item.nextValidation)}`,
            falsifier: `The validation fails to observe the expected effect, shows no advantage over the baseline, or exposes a material constraint failure.`,
            evidenceIndexes: item.evidenceIndexes,
          }));
  const experimentProposals =
    (review.experimentProposals ?? []).filter(
      (item) =>
        item.statement.trim().length >= 24 &&
        item.resolvesUncertainty.trim().length >= 24 &&
        item.threshold.trim().length >= 24 &&
        item.safetyBoundary.trim().length >= 24 &&
        item.evidenceIndexes.length > 0,
    ).length > 0
      ? (review.experimentProposals ?? [])
          .filter(
            (item) =>
              item.statement.trim().length >= 24 &&
              item.resolvesUncertainty.trim().length >= 24 &&
              item.threshold.trim().length >= 24 &&
              item.safetyBoundary.trim().length >= 24 &&
              item.evidenceIndexes.length > 0,
          )
          .map((item) => ({
            ...item,
            threshold: concreteExperimentThreshold(
              item.threshold,
              item.statement,
            ),
          }))
      : citedPortfolio
          .filter(
            (item) =>
              item.nextValidation.trim().length >= 24 &&
              item.evidenceIndexes.length > 0,
          )
          .slice(0, 3)
          .map((item) => ({
            statement: item.nextValidation,
            resolvesUncertainty: `Whether ${item.title.trim()} produces the intended outcome under the cited constraints.`,
            threshold: concreteExperimentThreshold('', item.nextValidation),
            safetyBoundary:
              'Design-only proposal: do not touch private data, production systems, paid providers, deployments, or real-world operations without separate scoped authority.',
            evidenceIndexes: item.evidenceIndexes,
          }));
  const weaknessSeeds = [
    ...review.weaknesses,
    ...unresolvedConstraints.map(
      (constraint) =>
        `Unresolved decision constraint remains: ${constraint.trim()}`,
    ),
    ...citedPortfolio.slice(0, 3).map((item) => {
      const constraint = item.constraints[0]?.trim();
      return `Portfolio item still requires validation before operational reliance: ${item.nextValidation.trim()}${
        constraint ? ` Constraint: ${constraint}` : ''
      }`;
    }),
  ];
  const weaknesses = [
    ...new Set(
      weaknessSeeds
        .map(singleLine)
        .filter((weakness) => informativeWordCount(weakness) >= 6),
    ),
  ];
  return {
    ...review,
    portfolio,
    unresolvedConstraints,
    dissent,
    boundaryConditions,
    hypotheses,
    experimentProposals,
    weaknesses,
  };
}

function assertDecisionGradeReview(input: {
  readonly review: GovernedLiveModelReview;
  readonly admittedEvidenceCount: number;
  readonly decisionConstraints: readonly string[];
  readonly question: string;
  readonly reviewClaims: readonly GovernedClaimRecord[];
}): void {
  const portfolio = input.review.portfolio ?? [];
  if (portfolio.length === 0) {
    refuse(
      'decision_portfolio_missing',
      'live synthesis produced no evidence-bound decision portfolio',
    );
  }
  const ranks = new Set<number>();
  for (const item of portfolio) {
    if (
      !Number.isInteger(item.rank) ||
      item.rank < 1 ||
      ranks.has(item.rank) ||
      item.title.trim().length < 4 ||
      item.statement.trim().length < 24 ||
      item.rationale.trim().length < 24 ||
      item.nextValidation.trim().length < 24 ||
      item.constraints.length === 0 ||
      item.evidenceIndexes.length === 0 ||
      item.evidenceIndexes.some(
        (index) =>
          !Number.isInteger(index) ||
          index < 1 ||
          index > input.admittedEvidenceCount,
      )
    ) {
      refuse(
        'decision_portfolio_invalid',
        'live synthesis produced an invalid or unbound decision portfolio item',
      );
    }
    if (
      item.constraints.some(
        (constraint) =>
          informativeWordCount(constraint) < 2 ||
          textTerms(constraint).length < 1,
      )
    ) {
      refuse(
        'decision_portfolio_weak_constraints',
        'live synthesis portfolio constraints must be substantive and evidence-readable',
      );
    }
    ranks.add(item.rank);
  }
  const ordered = [...portfolio].sort((left, right) => left.rank - right.rank);
  if (ordered.some((item, index) => item.rank !== index + 1)) {
    refuse(
      'decision_portfolio_rank_gap',
      'live synthesis portfolio ranks must be contiguous and deterministic',
    );
  }
  if (isBroadDecisionQuestion(input.question)) {
    const clusters = distinctSourceClustersForClaims(input.reviewClaims);
    if (clusters.length < 3) {
      refuse(
        'insufficient_source_cluster_diversity',
        'broad decision questions require admitted decision-grade evidence from at least three independent source clusters',
      );
    }
    if (portfolio.length < 3) {
      refuse(
        'decision_portfolio_too_narrow',
        'broad decision questions require at least three distinct evidence-bound portfolio items or must fail closed',
      );
    }
    const signatures = portfolio.map(portfolioItemSignature);
    for (let left = 0; left < signatures.length; left += 1) {
      for (let right = left + 1; right < signatures.length; right += 1) {
        const leftSignature = signatures[left] ?? [];
        const rightSignature = signatures[right] ?? [];
        if (
          leftSignature.length > 0 &&
          rightSignature.length > 0 &&
          jaccardOverlap(leftSignature, rightSignature) > 0.72
        ) {
          refuse(
            'decision_portfolio_not_distinct',
            'broad decision questions require distinct portfolio items rather than repeated variants of the same option',
          );
        }
      }
    }
  }
  const coverageText = [
    ...portfolio.flatMap((item) => [
      item.title,
      item.statement,
      item.rationale,
      ...item.constraints,
    ]),
    ...(input.review.unresolvedConstraints ?? []),
  ].join(' ');
  const uncovered = input.decisionConstraints.filter((constraint) => {
    const terms = textTerms(constraint);
    if (terms.length === 0) return false;
    return (
      textRelevanceScore(coverageText, terms) < Math.ceil(terms.length / 2)
    );
  });
  if (uncovered.length > 0) {
    refuse(
      'decision_constraints_unresolved',
      `live synthesis omitted generated decision constraints: ${uncovered.join('; ')}`,
    );
  }
  const unresolvedText = (input.review.unresolvedConstraints ?? []).join(' ');
  const unresolvedDecisionConstraints = input.decisionConstraints.filter(
    (constraint) => {
      const terms = textTerms(constraint);
      if (terms.length === 0) return false;
      const portfolioResolved =
        textRelevanceScore(
          portfolio
            .flatMap((item) => [
              item.title,
              item.statement,
              item.rationale,
              ...item.constraints,
              item.nextValidation,
            ])
            .join(' '),
          terms,
        ) >= Math.ceil(terms.length / 2);
      return (
        !portfolioResolved &&
        textRelevanceScore(unresolvedText, terms) >= Math.ceil(terms.length / 2)
      );
    },
  );
  if (unresolvedDecisionConstraints.length > 0) {
    refuse(
      'decision_constraints_explicitly_unresolved',
      `live synthesis left generated decision constraints unresolved: ${unresolvedDecisionConstraints.join('; ')}`,
    );
  }
  if ((input.review.experimentProposals ?? []).length === 0) {
    refuse(
      'missing_bounded_experiments',
      'live synthesis requires at least one cited bounded experiment proposal',
    );
  }
  if (
    (input.review.dissent ?? []).length === 0 ||
    input.review.weaknesses.some(
      (weakness) => informativeWordCount(weakness) < 6,
    ) ||
    input.review.weaknesses.length === 0
  ) {
    refuse(
      'missing_live_limitations',
      'live synthesis requires visible dissent and substantive weaknesses',
    );
  }
  const citedSections = [
    {
      code: 'missing_boundary_conditions',
      label: 'boundary condition',
      values: input.review.boundaryConditions ?? [],
    },
    {
      code: 'missing_hypotheses',
      label: 'falsifiable hypothesis',
      values: input.review.hypotheses ?? [],
    },
  ] as const;
  for (const section of citedSections) {
    if (
      section.values.length === 0 ||
      section.values.some(
        (item) =>
          item.statement.trim().length < 24 ||
          item.evidenceIndexes.length === 0 ||
          item.evidenceIndexes.some(
            (index) =>
              !Number.isInteger(index) ||
              index < 1 ||
              index > input.admittedEvidenceCount,
          ),
      )
    ) {
      refuse(
        section.code,
        `live synthesis requires at least one cited ${section.label}`,
      );
    }
  }
  for (const experiment of input.review.experimentProposals ?? []) {
    const threshold = experiment.threshold.trim();
    const experimentText = [
      experiment.statement,
      experiment.resolvesUncertainty,
      experiment.threshold,
      experiment.safetyBoundary,
    ].join(' ');
    if (
      experiment.statement.trim().length < 24 ||
      experiment.resolvesUncertainty.trim().length < 24 ||
      threshold.length < 24 ||
      /meets? the decision criterion|portfolio rank|supported enough/iu.test(
        threshold,
      ) ||
      !hasComparatorLanguage(threshold) ||
      !hasMetricLanguage(experimentText) ||
      !hasAdverseConstraintLanguage(experimentText) ||
      experiment.safetyBoundary.trim().length < 24 ||
      experiment.evidenceIndexes.length === 0 ||
      experiment.evidenceIndexes.some(
        (index) =>
          !Number.isInteger(index) ||
          index < 1 ||
          index > input.admittedEvidenceCount,
      )
    ) {
      refuse(
        'invalid_bounded_experiment',
        'live synthesis requires concrete cited experiments with metrics, comparators, thresholds, and adverse-constraint checks',
      );
    }
  }
}

function criterion(
  criterionId: string,
  passed: boolean,
  evidence: string,
): GovernedLiveAcceptanceCriterion {
  return { criterionId, passed, evidence };
}

function buildLiveAcceptanceReview(input: {
  readonly review: GovernedLiveModelReview;
  readonly reviewClaims: readonly GovernedClaimRecord[];
  readonly decisionConstraints: readonly string[];
  readonly question: string;
  readonly now: string;
}): GovernedLiveAcceptanceReview {
  const clusters = distinctSourceClustersForClaims(input.reviewClaims);
  const portfolio = input.review.portfolio ?? [];
  const portfolioText = portfolio
    .flatMap((item) => [
      item.title,
      item.statement,
      item.rationale,
      item.nextValidation,
      ...item.constraints,
    ])
    .join(' ');
  const decisionConstraintCriteria = input.decisionConstraints.map(
    (constraint, index) => {
      const terms = textTerms(constraint);
      const portfolioResolved =
        textRelevanceScore(portfolioText, terms) >= Math.ceil(terms.length / 2);
      const resolved = terms.length === 0 || portfolioResolved;
      return criterion(
        `decision-constraint-${String(index + 1)}`,
        resolved,
        constraint,
      );
    },
  );
  const experiments = input.review.experimentProposals ?? [];
  const criteria = [
    criterion(
      'source-cluster-diversity',
      !isBroadDecisionQuestion(input.question) || clusters.length >= 3,
      `${String(clusters.length)} independent source cluster(s): ${clusters.join(', ')}`,
    ),
    criterion(
      'portfolio-breadth',
      !isBroadDecisionQuestion(input.question) || portfolio.length >= 3,
      `${String(portfolio.length)} ranked portfolio item(s)`,
    ),
    criterion(
      'dissent-and-boundaries',
      (input.review.dissent ?? []).length > 0 &&
        (input.review.boundaryConditions ?? []).length > 0,
      `${String((input.review.dissent ?? []).length)} dissent item(s), ${String((input.review.boundaryConditions ?? []).length)} boundary item(s)`,
    ),
    criterion(
      'bounded-experiments',
      experiments.length > 0 &&
        experiments.every((experiment) => {
          const text = [
            experiment.statement,
            experiment.resolvesUncertainty,
            experiment.threshold,
            experiment.safetyBoundary,
          ].join(' ');
          return (
            hasComparatorLanguage(experiment.threshold) &&
            hasMetricLanguage(text) &&
            hasAdverseConstraintLanguage(text)
          );
        }),
      `${String(experiments.length)} experiment proposal(s) with comparator, metric, threshold, and adverse-constraint language`,
    ),
  ];
  const allCriteria = [...criteria, ...decisionConstraintCriteria];
  return {
    reviewerId: 'mammoth-live-independent-acceptance-review/v1',
    reviewedAt: input.now,
    overall: allCriteria.every((item) => item.passed) ? 'pass' : 'fail',
    criteria,
    decisionConstraints: decisionConstraintCriteria,
    sourceClusters: clusters.map((cluster) => ({
      clusterId: cluster,
      evidenceCount: input.reviewClaims.filter(
        (claim) => sourceClusterId(claim.requestedUrl) === cluster,
      ).length,
    })),
  };
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
