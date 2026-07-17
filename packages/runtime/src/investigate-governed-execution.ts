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
import { P9LiveEffectExecutor } from './p9-live-executor.js';

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
const LOW_INFORMATION_SPAN_PATTERN =
  /^(?:skip to main content|an official website|official websites use|secure \.gov websites|menu|search|privacy policy|terms of use|cookies?|javascript|equal contribution|corresponding author|received:|accepted:|published:)/iu;

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
  readonly weaknesses: readonly string[];
  readonly suggestedSearches: readonly string[];
}

export interface GovernedLiveAcquisitionExecutionInput {
  readonly intentSet: unknown;
  readonly release: unknown;
  readonly effectAuthority: unknown;
  readonly trustedIssuerId: string | undefined;
  readonly now: string;
  readonly budgetJournalPath: string;
  readonly searchProvider?: 'brave' | 'tavily';
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

function isLowInformationLiveSpan(quote: string): boolean {
  const normalized = quote.replace(/\s+/gu, ' ').trim();
  if (normalized.length < 48) return true;
  if (!/[.!?]$/u.test(normalized)) return true;
  if (informativeWordCount(normalized) < 8) return true;
  if (LOW_INFORMATION_SPAN_PATTERN.test(normalized)) return true;
  return false;
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
  const maxCandidates = input.maxCandidates ?? 8;
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
  const searchOrigin =
    (input.searchProvider ?? 'brave') === 'tavily'
      ? 'https://api.tavily.com'
      : 'https://api.search.brave.com';
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
        catalogEntryId:
          (input.searchProvider ?? 'brave') === 'tavily'
            ? 'tavily-search'
            : 'brave-search',
        ceiling: ceiling({ bytes: 2_000_000, durationMs: 30_000 }),
        transport: async () => {
          const nowMs = Date.now();
          const delayMs = Math.max(0, nextSearchAt - nowMs);
          if (delayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
          }
          nextSearchAt = Date.now() + (input.minimumSearchIntervalMs ?? 1_100);
          const outcome = await liveSearch({
            query: intent.subject,
            apiKeyEnvVar: input.searchApiKeyEnvVar,
            provider: input.searchProvider ?? 'brave',
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
        counts: { observedHints: result.value.length },
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
    const unauthorizedRetrievalHints: RejectedSourceHint[] = [];
    const selectedCandidates = selection.candidates
      .filter((candidate) => {
        const origin = new URL(candidate.requestedUrl).origin;
        if (authorizedRetrievalOrigins.has(origin)) return true;
        unauthorizedRetrievalHints.push({
          hint: {
            queryId: candidate.candidateId,
            url: candidate.requestedUrl,
            sourceClass: candidate.sourceClass,
          },
          reason: 'url_not_permitted',
        });
        return false;
      })
      .slice(0, maxCandidates);

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
          ceiling: ceiling({ bytes: 3_000_000, durationMs: 45_000 }),
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
        const spans = deriveBoundedEvidenceSpans({
          body: parsed.text,
          spanIdPrefix: `live:${candidate.candidateId}`,
          isExcluded: isLowInformationLiveSpan,
        });
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
        inputTokens: 12_000,
        outputTokens: 1_200,
        bytes: 500_000,
        durationMs: 120_000,
      }),
      transport: async () => {
        const outcome = await openAiCompatibleReview({
          baseUrl: input.modelBaseUrl,
          apiKeyEnvVar: input.modelApiKeyEnvVar,
          modelId: input.modelId,
          question: intentSet.question,
          ...(input.fetchImpl === undefined
            ? {}
            : { fetchImpl: input.fetchImpl }),
          claims: claims
            .filter((claim) => claim.decision === 'admitted')
            .slice(0, 18),
        });
        return {
          value: outcome.review,
          usage: outcome.usage,
          usageSource: 'provider_reported',
        };
      },
    });
    if (modelReview.status === 'failed') throw asError(modelReview.error);
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
      rejectedHints: [...selection.rejected, ...unauthorizedRetrievalHints],
      snapshots,
      retrievalAttempts,
      coverage,
      proposals,
      verdicts,
      admissions,
      claims,
      modelWork,
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
  readonly parserClass?: string | null;
}) {
  return {
    requests: input.requests ?? 1,
    inputTokens: input.inputTokens ?? 0,
    outputTokens: input.outputTokens ?? 0,
    bytes: input.bytes ?? 0,
    durationMs: input.durationMs,
    attempts: 1,
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
        id: 'tavily-search',
        provider: 'tavily-search/v1',
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
  readonly provider: 'brave' | 'tavily';
  readonly fetchImpl?: typeof fetch;
}): Promise<{
  readonly hints: readonly GovernedDiscoveryHint[];
  readonly usage: ReturnType<typeof usageOf>;
}> {
  const apiKey = process.env[input.apiKeyEnvVar]?.trim();
  if (!apiKey) {
    throw new Error(
      `${input.provider} credential ${input.apiKeyEnvVar} is empty`,
    );
  }
  if (input.provider === 'tavily')
    return tavilySearch(input.query, apiKey, input.fetchImpl ?? fetch);
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
  url.searchParams.set('count', '5');
  const startedAt = Date.now();
  const response = await fetchImpl(url, {
    headers: {
      accept: 'application/json',
      'x-subscription-token': apiKey,
    },
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const reset = response.headers.get('x-ratelimit-reset');
    const safeReset = reset?.match(/^[0-9, ]{1,80}$/u)?.[0];
    throw new Error(
      `Brave search failed with HTTP ${String(response.status)}${
        safeReset ? `; rate limit reset ${safeReset} seconds` : ''
      }`,
    );
  }
  const raw = await response.text();
  const parsed = JSON.parse(raw) as {
    web?: { results?: { url?: string; title?: string }[] };
  };
  const hints = (parsed.web?.results ?? [])
    .filter((result): result is { url: string; title?: string } => {
      if (!result.url) return false;
      try {
        return new URL(result.url).protocol === 'https:';
      } catch {
        return false;
      }
    })
    .map((result) => ({
      url: result.url,
      sourceClass: 'public_web',
      ...(result.title === undefined ? {} : { title: result.title }),
    }));
  return {
    hints,
    usage: usageOf({
      requests: 1,
      bytes: Buffer.byteLength(raw, 'utf8'),
      durationMs: Math.max(0, Date.now() - startedAt),
    }),
  };
}

async function tavilySearch(
  query: string,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<{
  readonly hints: readonly GovernedDiscoveryHint[];
  readonly usage: ReturnType<typeof usageOf>;
}> {
  const startedAt = Date.now();
  const response = await fetchImpl('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    redirect: 'error',
    signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({
      query,
      max_results: 5,
      include_answer: false,
      include_raw_content: false,
    }),
  });
  if (!response.ok) {
    throw new Error(
      `Tavily search failed with HTTP ${String(response.status)}`,
    );
  }
  const raw = await response.text();
  const parsed = JSON.parse(raw) as {
    results?: { url?: string; title?: string }[];
  };
  const hints = (parsed.results ?? [])
    .filter((result): result is { url: string; title?: string } => {
      if (!result.url) return false;
      try {
        return new URL(result.url).protocol === 'https:';
      } catch {
        return false;
      }
    })
    .map((result) => ({
      url: result.url,
      sourceClass: 'public_web',
      ...(result.title === undefined ? {} : { title: result.title }),
    }));
  return {
    hints,
    usage: usageOf({
      requests: 1,
      bytes: Buffer.byteLength(raw, 'utf8'),
      durationMs: Math.max(0, Date.now() - startedAt),
    }),
  };
}

async function openAiCompatibleReview(input: {
  readonly baseUrl: string;
  readonly apiKeyEnvVar: string;
  readonly modelId: string;
  readonly question: string;
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
      max_tokens: 1200,
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
              weaknesses: { type: 'array', items: { type: 'string' } },
              suggestedSearches: { type: 'array', items: { type: 'string' } },
            },
            required: ['summary', 'weaknesses', 'suggestedSearches'],
          },
        },
      },
      messages: [
        {
          role: 'system',
          content:
            'You are an independent research reviewer. Use only the supplied admitted evidence snippets. Do not add facts. Return compact JSON.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            question: input.question,
            admittedEvidence: input.claims.map((claim) => ({
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
    !Array.isArray(review.weaknesses) ||
    !Array.isArray(review.suggestedSearches)
  ) {
    throw new Error('model review failed schema validation');
  }
  return {
    review,
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

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
