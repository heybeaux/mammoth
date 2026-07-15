import {
  canonicalDigest,
  P9ClaimAdmissionSchema,
  P9ClaimProposalSchema,
  P9EntailmentVerdictSchema,
  type P9ClaimAdmission,
  type P9ClaimProposal,
  type P9EntailmentVerdict,
  type P9SemanticDelta,
} from '@mammoth/domain';

export const P9_ENTAILMENT_POLICY_ID = 'p9-independent-entailment/v1';

const HOSTILE_INSTRUCTION =
  /\b(?:ignore|disregard|override)\b.{0,40}\b(?:instruction|prompt|policy|system|developer)\b|\b(?:system|developer)\s+(?:message|instruction)\b|\b(?:call|invoke|use)\s+(?:the\s+)?(?:tool|function)\b/iu;
const NEGATION =
  /\b(?:no|not|never|neither|without|cannot|can't|didn't|doesn't)\b/giu;
const CAUSAL =
  /\b(?:cause[ds]?|causing|because|therefore|leads? to|results? in|drives?|due to)\b/giu;
const COMPARISON =
  /\b(?:more|less|greater|lower|higher|better|worse|than|versus|compared)\b/giu;
const CERTAINTY =
  /\b(?:always|certainly|definitely|proves?|guarantees?|will)\b/giu;
const SCOPE = /\b(?:all|always|every|entire|none|never|only)\b/giu;
const RECOMMENDATION =
  /\b(?:should|must|recommend|ought|need to|necessary)\b/giu;
const NUMBER = /\b\d+(?:[.,]\d+)?%?\b/gu;
const UNIT =
  /\b(?:%|percent|percentage|ms|seconds?|minutes?|hours?|days?|weeks?|months?|years?|kb|mb|gb|tb|bytes?|watts?|kw|mw|gw|kg|km|miles?|dollars?|usd|cad)\b/giu;
const TIME =
  /\b(?:19|20)\d{2}\b|\b(?:today|currently|annually|daily|weekly|monthly|yearly|within|before|after|since|until)\b/giu;

function tokens(value: string, expression: RegExp): Set<string> {
  expression.lastIndex = 0;
  return new Set(
    [...value.matchAll(expression)].map((match) => match[0].toLowerCase()),
  );
}

function introduces(
  statement: string,
  quote: string,
  expression: RegExp,
): boolean {
  const claimTokens = tokens(statement, expression);
  if (claimTokens.size === 0) return false;
  const quoteTokens = tokens(quote, expression);
  return [...claimTokens].some((token) => !quoteTokens.has(token));
}

/** Conservative deterministic guard; the independent evaluator may add deltas. */
export function detectP9SemanticDeltas(
  statement: string,
  quote: string,
): readonly P9SemanticDelta[] {
  const deltas = new Set<P9SemanticDelta>();
  if (tokens(statement, NEGATION).size !== tokens(quote, NEGATION).size)
    deltas.add('negation');
  if (introduces(statement, quote, NUMBER)) deltas.add('quantity');
  if (introduces(statement, quote, UNIT)) deltas.add('unit');
  if (introduces(statement, quote, SCOPE)) deltas.add('scope');
  if (introduces(statement, quote, CAUSAL)) deltas.add('causality');
  if (introduces(statement, quote, COMPARISON)) deltas.add('comparison');
  if (introduces(statement, quote, CERTAINTY)) deltas.add('certainty');
  if (introduces(statement, quote, TIME)) deltas.add('timeframe');
  if (introduces(statement, quote, RECOMMENDATION))
    deltas.add('recommendation_premise');
  return [...deltas].sort();
}

function sameLocator(
  proposal: P9ClaimProposal,
  verdict: P9EntailmentVerdict,
): boolean {
  return canonicalDigest(proposal.locator) === canonicalDigest(verdict.locator);
}

export function evaluateP9ClaimAdmission(input: {
  proposal: P9ClaimProposal;
  verdict: P9EntailmentVerdict;
  decidedAt: string;
  admissionId?: string;
  policyId?: string;
}): P9ClaimAdmission {
  const proposal = P9ClaimProposalSchema.parse(input.proposal);
  const verdict = P9EntailmentVerdictSchema.parse(input.verdict);
  const reasons = new Set<string>();
  const independentProfile =
    proposal.proposerWork.profileFamilyId !==
    verdict.evaluatorWork.profileFamilyId;

  if (
    verdict.proposalId !== proposal.proposalId ||
    verdict.proposalDigest !== proposal.proposalDigest ||
    verdict.evaluatedStatement !== proposal.statement
  ) {
    reasons.add('proposal_binding_mismatch');
  }
  if (!sameLocator(proposal, verdict)) reasons.add('locator_binding_mismatch');
  if (!verdict.boundedContext.includes(verdict.evaluatedQuote))
    reasons.add('quote_outside_bounded_context');
  if (
    verdict.locator.endOffset - verdict.locator.startOffset !==
    verdict.evaluatedQuote.length
  ) {
    reasons.add('locator_length_mismatch');
  }
  if (
    proposal.proposerWork.workId === verdict.evaluatorWork.workId ||
    proposal.proposerWork.workDigest === verdict.evaluatorWork.workDigest ||
    proposal.proposerWork.rawResponseDigest ===
      verdict.evaluatorWork.rawResponseDigest
  ) {
    reasons.add('self_review_or_copied_response');
  }
  if (
    proposal.proposerWork.profileVersionId ===
    verdict.evaluatorWork.profileVersionId
  ) {
    reasons.add('same_profile_version');
  }
  if (proposal.critical && !independentProfile)
    reasons.add('critical_claim_correlated_profile');
  if (
    verdict.hostileInstructionDetected ||
    HOSTILE_INSTRUCTION.test(verdict.evaluatedQuote) ||
    HOSTILE_INSTRUCTION.test(verdict.boundedContext)
  ) {
    reasons.add('hostile_instruction_in_evidence');
  }
  for (const delta of [
    ...verdict.semanticDeltas,
    ...detectP9SemanticDeltas(
      verdict.evaluatedStatement,
      verdict.evaluatedQuote,
    ),
  ]) {
    reasons.add(`semantic_delta:${delta}`);
  }

  const hasHardFailure = [...reasons].some(
    (reason) => !reason.startsWith('semantic_delta:'),
  );
  let decision: P9ClaimAdmission['decision'];
  if (verdict.verdict === 'contradicted' && !hasHardFailure) {
    decision = 'contradicted';
    reasons.add('independent_contradiction_preserved');
  } else if (verdict.verdict !== 'entailed') {
    decision = 'rejected';
    reasons.add(`entailment_${verdict.verdict}`);
  } else if (reasons.size > 0) {
    decision = 'rejected';
  } else {
    decision = 'admitted';
    reasons.add(
      independentProfile
        ? 'independent_entailment_accepted'
        : 'noncritical_correlated_entailment_accepted',
    );
  }

  const admission = {
    schemaVersion: '1.0.0' as const,
    contractFamily: 'p9.v1' as const,
    admissionId:
      input.admissionId ??
      `admission:${proposal.proposalId}:${verdict.verdictId}`,
    proposalId: proposal.proposalId,
    proposalDigest: proposal.proposalDigest,
    verdictId: verdict.verdictId,
    verdictDigest: verdict.verdictDigest,
    decision,
    independentProfile,
    reasonCodes: [...reasons].sort(),
    policyId: input.policyId ?? P9_ENTAILMENT_POLICY_ID,
    decidedAt: input.decidedAt,
  };
  return P9ClaimAdmissionSchema.parse({
    ...admission,
    admissionDigest: canonicalDigest(admission),
  });
}

export interface P9RenderableSentence {
  readonly id: string;
  readonly kind: string;
  readonly claimIds: readonly string[];
}

export function assertEveryP9FactualSentenceAdmitted(
  sentences: readonly P9RenderableSentence[],
  admissions: readonly P9ClaimAdmission[],
): void {
  const admitted = new Set(
    admissions
      .filter((record) => record.decision === 'admitted')
      .map((record) => record.proposalId),
  );
  for (const sentence of sentences) {
    if (sentence.kind !== 'factual') continue;
    if (
      sentence.claimIds.length === 0 ||
      sentence.claimIds.some((claimId) => !admitted.has(claimId))
    ) {
      throw new Error(`P9_FACTUAL_SENTENCE_NOT_ADMITTED:${sentence.id}`);
    }
  }
}

export function rejectedP9ClaimResidue(
  admissions: readonly P9ClaimAdmission[],
): readonly P9ClaimAdmission[] {
  return admissions.filter((record) => record.decision !== 'admitted');
}
