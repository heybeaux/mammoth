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
  buildTruthfulRetrievalAttempt,
  canonicalizeAcquisitionUrl,
  contentDigest,
  makeNotCheckedRobotsDecision,
  makeUnknownRightsStatus,
  P9RetrievalResidueLedger,
  ParserPolicyError,
  selectPlannedAcquisitionCandidates,
  unservedPlannedSourceClasses,
  type DiscoveredSourceHint,
  type RejectedSourceHint,
  type SelectedRetrievalCandidate,
} from '@mammoth/retrieval';

const REQUIRED_EFFECT_KINDS = ['search', 'retrieval', 'parser'] as const;

const PROPOSER_PROFILE_VERSION = 'offline-extractive-proposer/v1';
const PROPOSER_PROFILE_FAMILY = 'offline-extractive-proposer';
const EVALUATOR_PROFILE_VERSION = 'offline-independent-evaluator/v1';
const EVALUATOR_PROFILE_FAMILY = 'offline-independent-evaluator';

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

function refuse(code: string, message: string): never {
  throw new GovernedExecutionError(code, message);
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
  for (const kind of REQUIRED_EFFECT_KINDS) {
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
  };
}
