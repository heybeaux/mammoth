import {
  canonicalDigest,
  type AcquisitionRelease,
  type InvestigationAcquisitionIntentSet,
  type InvestigationPlan,
} from '@mammoth/domain';
import {
  renderSynthesisReaderLines,
  validateSynthesisExtension,
  type SynthesisExtension,
} from '@mammoth/report-compiler';
import { contentDigest } from '@mammoth/retrieval';
import {
  GovernedExecutionError,
  type GovernedAcquisitionExecution,
  type GovernedLiveReviewCitedStatement,
  type GovernedLiveReviewExperiment,
  type GovernedLiveReviewHypothesis,
  type GovernedLiveReviewPortfolioItem,
} from './investigate-governed-execution.js';

/**
 * Text that must never appear in the reader-facing report: raw digests and
 * audit-internal vocabulary. Facts excluded by this filter remain fully
 * present in the audit projection; the reader surface simply refuses to leak
 * plumbing. Mirrors the outcome-1 acceptance contract exactly.
 */
const READER_FORBIDDEN_PATTERN =
  /sha256:|claim[_:-]|proposal[_:-]|plan digest|parser receipt|budget ledger|coverage verdict/iu;
const LOW_INFORMATION_READER_FACT_PATTERN =
  /^(?:skip to main content|an official website|official websites use|secure \.gov websites|menu|search|privacy policy|terms of use|cookies?|javascript|equal contribution|corresponding author|received:|accepted:|published:)/iu;
const READER_QUESTION_STOP_TERMS = new Set([
  'about',
  'after',
  'against',
  'also',
  'answer',
  'based',
  'before',
  'being',
  'beyond',
  'biggest',
  'build',
  'building',
  'could',
  'during',
  'from',
  'important',
  'increasingly',
  'individuals',
  'lie',
  'most',
  'opportunities',
  'question',
  'should',
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
]);

function sha256Text(value: string): string {
  return contentDigest(new TextEncoder().encode(value));
}

function jsonArtifact(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function jsonlArtifact(entries: readonly unknown[]): string {
  return entries.length === 0
    ? ''
    : `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`;
}

function singleLine(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function informativeWordCount(value: string): number {
  return value.match(/[A-Za-z][A-Za-z'-]{2,}/gu)?.length ?? 0;
}

function readerQuestionTerms(value: string): readonly string[] {
  return [
    ...new Set(
      [...value.matchAll(/[\p{L}\p{N}][\p{L}\p{N}-]{2,}/gu)]
        .map((match) => match[0].toLocaleLowerCase('en-US'))
        .filter(
          (term) =>
            term.length >= 4 &&
            !READER_QUESTION_STOP_TERMS.has(term) &&
            !/^\d+$/u.test(term),
        ),
    ),
  ].slice(0, 20);
}

function readerRelevanceScore(value: string, terms: readonly string[]): number {
  const normalized = value.toLocaleLowerCase('en-US');
  return terms.reduce((score, term) => {
    const variants = new Set([term]);
    if (term.endsWith('s')) variants.add(term.slice(0, -1));
    if (term.endsWith('ies')) variants.add(`${term.slice(0, -3)}y`);
    if (term.endsWith('ate')) variants.add(`${term.slice(0, -3)}acy`);
    return (
      score +
      ([...variants].some((variant) => normalized.includes(variant)) ? 1 : 0)
    );
  }, 0);
}

function termAppears(value: string, term: string): boolean {
  const normalized = value.toLocaleLowerCase('en-US');
  const variants = new Set([term]);
  if (term.endsWith('s')) variants.add(term.slice(0, -1));
  if (term.endsWith('ies')) variants.add(`${term.slice(0, -3)}y`);
  if (term.endsWith('ate')) variants.add(`${term.slice(0, -3)}acy`);
  return [...variants].some((variant) => normalized.includes(variant));
}

function isReaderQualityFact(sentence: string): boolean {
  if (sentence.length < 48) return false;
  if (!/[.!?]$/u.test(sentence)) return false;
  if (informativeWordCount(sentence) < 8) return false;
  if (LOW_INFORMATION_READER_FACT_PATTERN.test(sentence)) return false;
  return true;
}

function readerVisibleReviewLines(
  values: readonly string[] | undefined,
): readonly string[] {
  return (values ?? [])
    .map(singleLine)
    .filter((value) => value.length >= 24)
    .filter((value) => !READER_FORBIDDEN_PATTERN.test(value))
    .slice(0, 3)
    .map((value) => (/[:.!?]$/u.test(value) ? value : `${value}.`));
}

function readerVisibleDeduction(value: string | undefined): string | null {
  if (!value) return null;
  const sentence = singleLine(value)
    .replace(/\s*\(\s*evidence\s*indexes?\s*:?\s*\[?[\d,\s]+\]?\s*\)/giu, '')
    .replace(/\s*\(\s*evidenceindexes?\s*:?\s*\[?[\d,\s]+\]?\s*\)/giu, '')
    .replace(/\s*evidence\s*indexes?\s*:?\s*\[?[\d,\s]+\]?/giu, '')
    .replace(/\s*evidenceindexes?\s*:?\s*\[?[\d,\s]+\]?/giu, '')
    .trim();
  if (sentence.length < 32) return null;
  if (READER_FORBIDDEN_PATTERN.test(sentence)) return null;
  return /[.!?]$/u.test(sentence) ? sentence : `${sentence}.`;
}

function citedReviewStatements<T extends GovernedLiveReviewCitedStatement>(
  values: readonly T[] | undefined,
  citationNumbersForEvidenceIndex: (index: number) => readonly number[],
  limit: number,
): readonly (T & {
  readonly sentence: string;
  readonly citations: readonly number[];
})[] {
  const cited: (T & {
    readonly sentence: string;
    readonly citations: readonly number[];
  })[] = [];
  for (const value of values ?? []) {
    const sentence = readerVisibleDeduction(value.statement);
    const citations = [
      ...new Set(
        value.evidenceIndexes.flatMap((index) =>
          citationNumbersForEvidenceIndex(index),
        ),
      ),
    ].sort((left, right) => left - right);
    if (sentence && citations.length > 0) {
      cited.push({ ...value, sentence, citations });
    }
    if (cited.length >= limit) break;
  }
  return cited;
}

function citationSuffix(citations: readonly number[]): string {
  return citations.map((number) => `[${String(number)}]`).join('');
}

export interface GovernedInvestigationBundleInput {
  readonly plan: InvestigationPlan;
  readonly intentSet: InvestigationAcquisitionIntentSet;
  readonly release: AcquisitionRelease;
  readonly execution: GovernedAcquisitionExecution;
  /** Injected deterministic clock value used for composition timestamps. */
  readonly now: string;
}

export interface GovernedInvestigationBundle {
  readonly runId: string;
  /** Relative artifact path → exact file content. */
  readonly files: Readonly<Record<string, string>>;
}

interface RenderableFact {
  readonly claimId: string;
  readonly reviewEvidenceIndex: number;
  readonly sentence: string;
  readonly citation: number;
  readonly url: string;
  readonly sourceClass: string;
}

/**
 * Deterministically derives the design-only synthesis extension from the
 * accepted plan and admitted evidence. Every hypothesis is derived from an
 * admitted claim id and every statement is taken verbatim from the
 * digest-bound plan; nothing here invents facts or branches on topics.
 */
function deriveSynthesis(
  plan: InvestigationPlan,
  facts: readonly RenderableFact[],
): SynthesisExtension {
  const derivedFromClaimIds = [
    ...new Set(facts.map((fact) => fact.claimId)),
  ].slice(0, 3);
  const seed = canonicalDigest({
    planDigest: plan.planDigest,
    derivedFromClaimIds,
  }).slice(7, 19);
  const hypothesisId = `h-${seed}`;
  const unknowns = plan.interpretation.unknowns;
  const falsificationChecks = plan.plan.falsificationChecks;
  const stopCriteria = plan.plan.stopCriteria;
  return validateSynthesisExtension(
    {
      schemaVersion: '1.0.0',
      contractFamily: 'research-synthesis-extension.v1',
      mechanisms: [],
      hypotheses: [
        {
          hypothesisId,
          label: 'hypothesis',
          statement: plan.interpretation.decisionCriterion,
          derivedFromClaimIds,
          mechanismIds: [],
          falsifiers: [...plan.interpretation.falsifiers],
        },
      ],
      experimentProposals: [
        {
          proposalId: `x-${seed}`,
          hypothesisIds: [hypothesisId],
          uncertainty:
            unknowns[0] ?? 'Remaining uncertainty identified by the plan.',
          intervention: `Design-only verification: ${
            falsificationChecks[0] ?? 'repeat the planned falsification checks'
          }`,
          evaluator:
            'An independent evaluator with no access to the drafting work.',
          threshold:
            stopCriteria[0] ??
            'The stop criteria accepted in the investigation plan.',
          budget:
            'No additional budget; design only, pending separate explicit approval.',
          safetyBoundary:
            'No external effects; any execution requires separately granted authority.',
          falsifier:
            plan.interpretation.falsifiers[0] ??
            'The accepted plan falsifiers fail to hold.',
        },
      ],
    },
    new Set(derivedFromClaimIds),
  );
}

/**
 * Composes the complete reader + audit output of a governed offline
 * execution as an immutable path→content mapping. The reader report contains
 * only human-readable prose whose factual sentences are verbatim admitted
 * evidence bound to admitted claim ids in the projection; every audit
 * artifact is digest-chained into the execution receipt. Rendering can only
 * select and cite admitted evidence — it cannot introduce facts.
 */
export function composeGovernedInvestigationBundle(
  input: GovernedInvestigationBundleInput,
): GovernedInvestigationBundle {
  const { plan, intentSet, release, execution } = input;
  if (
    plan.planDigest !== intentSet.planDigest ||
    intentSet.intentSetDigest !== release.intentSetDigest ||
    release.releaseDigest !== execution.releaseDigest ||
    intentSet.intentSetDigest !== execution.intentSetDigest
  ) {
    throw new GovernedExecutionError(
      'bundle_lineage_mismatch',
      'bundle composition requires one digest-linked plan, intent set, release, and execution',
    );
  }
  const runId = `run:${canonicalDigest({
    planDigest: plan.planDigest,
    intentSetDigest: intentSet.intentSetDigest,
  }).slice(7, 23)}`;
  const authoritativeRevision = plan.revision;

  // Reader-facing facts: verbatim admitted statements that can be shown
  // without leaking audit internals. Facts filtered here remain in the audit.
  const admitted = execution.claims.filter(
    (claim) => claim.decision === 'admitted',
  );
  const urls: string[] = [];
  const facts: RenderableFact[] = [];
  for (const [index, claim] of admitted.entries()) {
    const sentence = singleLine(claim.statement);
    if (READER_FORBIDDEN_PATTERN.test(sentence)) continue;
    if (!isReaderQualityFact(sentence)) continue;
    if (!urls.includes(claim.requestedUrl)) urls.push(claim.requestedUrl);
    facts.push({
      claimId: claim.proposalId,
      reviewEvidenceIndex: index + 1,
      sentence,
      citation: urls.indexOf(claim.requestedUrl) + 1,
      url: claim.requestedUrl,
      sourceClass: claim.sourceClass,
    });
  }
  const [direct] = facts;
  if (direct === undefined) {
    throw new GovernedExecutionError(
      'no_renderable_admitted_evidence',
      'no admitted evidence can be rendered on the reader surface; refusing to compose an uncited report',
    );
  }
  const rejected = execution.claims.filter(
    (claim) => claim.decision !== 'admitted',
  );
  if (rejected.length === 0) {
    throw new GovernedExecutionError(
      'missing_rejection_residue',
      'governed execution produced no rejected residue; refusing to publish an audit that cannot show its own filters',
    );
  }

  const synthesis = deriveSynthesis(plan, facts);
  const liveWeaknesses = readerVisibleReviewLines(
    execution.liveReview?.weaknesses,
  );
  const citationNumbersForClaim = (
    claimId: string,
  ): readonly number[] | undefined => {
    const numbers = facts
      .filter((fact) => fact.claimId === claimId)
      .map((fact) => fact.citation);
    return numbers.length > 0 ? numbers : undefined;
  };
  const citationNumbersForEvidenceIndex = (index: number): readonly number[] =>
    execution.reviewEvidenceProposalIds
      ? facts
          .filter(
            (fact) =>
              fact.claimId === execution.reviewEvidenceProposalIds?.[index - 1],
          )
          .map((fact) => fact.citation)
      : facts
          .filter((fact) => fact.reviewEvidenceIndex === index)
          .map((fact) => fact.citation);
  const rawReviewAnswerBullets = citedReviewStatements(
    execution.liveReview?.answerBullets,
    citationNumbersForEvidenceIndex,
    4,
  );
  const reviewMechanisms = citedReviewStatements(
    execution.liveReview?.mechanisms,
    citationNumbersForEvidenceIndex,
    3,
  );
  const reviewDissent = citedReviewStatements(
    execution.liveReview?.dissent,
    citationNumbersForEvidenceIndex,
    3,
  );
  const reviewBoundaries = citedReviewStatements(
    execution.liveReview?.boundaryConditions,
    citationNumbersForEvidenceIndex,
    3,
  );
  const reviewHypotheses = citedReviewStatements<GovernedLiveReviewHypothesis>(
    execution.liveReview?.hypotheses,
    citationNumbersForEvidenceIndex,
    3,
  );
  const reviewExperiments = citedReviewStatements<GovernedLiveReviewExperiment>(
    execution.liveReview?.experimentProposals,
    citationNumbersForEvidenceIndex,
    3,
  );
  const reviewPortfolio = [
    ...citedReviewStatements<GovernedLiveReviewPortfolioItem>(
      execution.liveReview?.portfolio,
      citationNumbersForEvidenceIndex,
      5,
    ),
  ].sort((left, right) => left.rank - right.rank);
  const unresolvedConstraints = readerVisibleReviewLines(
    execution.liveReview?.unresolvedConstraints,
  );

  const title = READER_FORBIDDEN_PATTERN.test(plan.question)
    ? 'Investigation findings'
    : plan.question;
  const questionTerms = readerQuestionTerms(plan.question);
  const unsupportedQuestionTerms = questionTerms
    .filter((term) => !facts.some((fact) => termAppears(fact.sentence, term)))
    .slice(0, 6);
  const reviewAnswerBullets = rawReviewAnswerBullets.filter(
    (item) =>
      !unsupportedQuestionTerms.some((term) =>
        termAppears(item.sentence, term),
      ),
  );
  const directAnswerFacts =
    rawReviewAnswerBullets.length > 0 ? [] : facts.slice(0, 3);
  const directAnswerLimitations =
    rawReviewAnswerBullets.length > 0 ? reviewBoundaries.slice(0, 2) : [];
  const citedBeforeConstraintEvidence = new Set(
    [...reviewAnswerBullets, ...directAnswerLimitations].flatMap(
      (item) => item.citations,
    ),
  );
  const directConstraintFacts =
    rawReviewAnswerBullets.length > 0
      ? facts
          .filter((fact) => !citedBeforeConstraintEvidence.has(fact.citation))
          .map((fact) => ({
            fact,
            unresolvedScore: readerRelevanceScore(
              fact.sentence,
              unsupportedQuestionTerms,
            ),
            questionScore: readerRelevanceScore(fact.sentence, questionTerms),
          }))
          .filter((entry) =>
            unsupportedQuestionTerms.length === 0
              ? entry.questionScore >= 3
              : entry.unresolvedScore > 0,
          )
          .sort(
            (left, right) =>
              right.unresolvedScore - left.unresolvedScore ||
              right.questionScore - left.questionScore,
          )
          .slice(0, 4)
          .map((entry) => entry.fact)
      : [];
  const unresolvedQuestionTerms =
    rawReviewAnswerBullets.length > 0 ? unsupportedQuestionTerms : [];
  const renderedSynthesis =
    reviewMechanisms.length > 0 ||
    reviewDissent.length > 0 ||
    reviewBoundaries.length > 0 ||
    reviewHypotheses.length > 0 ||
    reviewExperiments.length > 0
      ? [
          ...(reviewMechanisms.length === 0
            ? []
            : [
                '## Cross-domain mechanisms',
                '',
                ...reviewMechanisms.map(
                  (mechanism) =>
                    `- Deduction from admitted evidence: ${
                      mechanism.sentence
                    } ${citationSuffix(mechanism.citations)}`,
                ),
                '',
              ]),
          ...(reviewDissent.length === 0
            ? []
            : [
                '## Competing evidence and dissent',
                '',
                ...reviewDissent.map(
                  (dissent) =>
                    `- Source-bounded dissent: ${
                      dissent.sentence
                    } ${citationSuffix(dissent.citations)}`,
                ),
                '',
              ]),
          ...(reviewBoundaries.length === 0
            ? []
            : [
                '## Boundary conditions',
                '',
                ...reviewBoundaries.map(
                  (boundary) =>
                    `- Applicability limit: ${
                      boundary.sentence
                    } ${citationSuffix(boundary.citations)}`,
                ),
                '',
              ]),
          ...(reviewHypotheses.length === 0
            ? []
            : [
                '## Hypotheses',
                '',
                ...reviewHypotheses.flatMap((hypothesis) => {
                  const falsifier = readerVisibleDeduction(
                    hypothesis.falsifier,
                  );
                  return [
                    `- Hypothesis from admitted evidence: ${
                      hypothesis.sentence
                    } ${citationSuffix(hypothesis.citations)}`,
                    ...(falsifier ? [`  - Falsifier: ${falsifier}`] : []),
                  ];
                }),
                '',
              ]),
          ...(reviewExperiments.length === 0
            ? []
            : [
                '## Proposed experiments',
                '',
                ...reviewExperiments.flatMap((experiment) => {
                  const uncertainty = readerVisibleDeduction(
                    experiment.resolvesUncertainty,
                  );
                  const threshold = readerVisibleDeduction(
                    experiment.threshold,
                  );
                  const safetyBoundary = readerVisibleDeduction(
                    experiment.safetyBoundary,
                  );
                  return [
                    `- Design-only experiment from admitted evidence: ${
                      experiment.sentence
                    } ${citationSuffix(experiment.citations)}`,
                    ...(uncertainty
                      ? [`  - Resolves uncertainty: ${uncertainty}`]
                      : []),
                    ...(threshold ? [`  - Threshold: ${threshold}`] : []),
                    ...(safetyBoundary
                      ? [`  - Safety boundary: ${safetyBoundary}`]
                      : []),
                  ];
                }),
                '',
              ]),
        ]
      : renderSynthesisReaderLines(synthesis, { citationNumbersForClaim });
  const citedReaderNumbers = new Set(
    [
      ...reviewAnswerBullets,
      ...directAnswerLimitations,
      ...directConstraintFacts.map((fact) => ({
        ...fact,
        citations: [fact.citation],
        evidenceIndexes: [fact.reviewEvidenceIndex],
      })),
      ...reviewMechanisms,
      ...reviewDissent,
      ...reviewBoundaries,
      ...reviewHypotheses,
      ...reviewExperiments,
      ...reviewPortfolio,
    ].flatMap((item) => item.citations),
  );
  const supportingFacts =
    citedReaderNumbers.size > 0
      ? facts.filter((fact) => citedReaderNumbers.has(fact.citation))
      : facts;
  const reportLines = [
    `# ${singleLine(title)}`,
    '',
    '## Direct answer',
    '',
    ...reviewAnswerBullets.map(
      (item) =>
        `- Deduction from admitted evidence: ${item.sentence} ${citationSuffix(
          item.citations,
        )}`,
    ),
    ...directAnswerLimitations.map(
      (item) =>
        `- Limitation from admitted evidence: ${item.sentence} ${citationSuffix(
          item.citations,
        )}`,
    ),
    ...directConstraintFacts.map(
      (fact) =>
        `- Admitted constraint evidence not resolved by synthesis: ${
          fact.sentence
        } [${String(fact.citation)}]`,
    ),
    ...(unresolvedQuestionTerms.length === 0
      ? []
      : [
          `- Unresolved question constraint: admitted evidence did not directly resolve ${unresolvedQuestionTerms.join(
            ', ',
          )}.`,
        ]),
    ...directAnswerFacts.map(
      (fact) => `- ${fact.sentence} [${String(fact.citation)}]`,
    ),
    '',
    ...(reviewPortfolio.length === 0
      ? []
      : [
          '## Ranked decision portfolio',
          '',
          ...reviewPortfolio.flatMap((item) => {
            const rationale = readerVisibleDeduction(item.rationale);
            const nextValidation = readerVisibleDeduction(item.nextValidation);
            return [
              `### ${String(item.rank)}. ${singleLine(item.title)}`,
              '',
              `${item.sentence} ${citationSuffix(item.citations)}`,
              '',
              ...(rationale
                ? [
                    `- Why it ranks here: ${rationale} ${citationSuffix(
                      item.citations,
                    )}`,
                  ]
                : []),
              ...item.constraints.flatMap((constraint) => {
                const visible = readerVisibleDeduction(constraint);
                return visible ? [`- Constraint: ${visible}`] : [];
              }),
              ...(nextValidation
                ? [`- Next validation: ${nextValidation}`]
                : []),
              '',
            ];
          }),
        ]),
    ...(unresolvedConstraints.length === 0
      ? []
      : [
          '## Unresolved constraints',
          '',
          ...unresolvedConstraints.map((constraint) => `- ${constraint}`),
          '',
        ]),
    '## Supporting evidence',
    '',
    ...supportingFacts.map(
      (fact) =>
        `- ${fact.sentence} [${String(fact.citation)}] (${fact.sourceClass} source)`,
    ),
    '',
    '## Method and limits',
    '',
    rawReviewAnswerBullets.length > 0
      ? 'Supporting evidence sentences above are quoted verbatim from preserved sources and passed independent admission review; direct answers and synthesis sections are source-bounded deductions that cite admitted evidence.'
      : 'Every factual sentence above is quoted verbatim from a preserved source and passed an independent admission review; sentences that failed review were excluded and are preserved in the audit projection.',
    execution.externalEffectsExecuted
      ? `This investigation ran with governed live effects under scoped authority: ${String(execution.snapshots.length)} source snapshot(s) were preserved and ${String(rejected.length)} candidate statement(s) were rejected rather than repaired.`
      : `This investigation ran strictly offline against an operator-declared source universe: ${String(execution.snapshots.length)} source snapshot(s) were preserved and ${String(rejected.length)} candidate statement(s) were rejected rather than repaired.`,
    execution.externalEffectsExecuted
      ? 'Network, provider, and model effects were reserved and settled before use; the audit projection preserves live effect receipts and the durable journal copy.'
      : 'No network, provider, or paid effect was executed at any point.',
    ...(liveWeaknesses.length === 0
      ? []
      : [
          '',
          'Reviewer-noted limitations:',
          ...liveWeaknesses.map((weakness) => `- ${weakness}`),
        ]),
    '',
    ...renderedSynthesis,
  ];
  const report = `${reportLines
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trimEnd()}\n`;
  if (READER_FORBIDDEN_PATTERN.test(report)) {
    throw new GovernedExecutionError(
      'reader_surface_contaminated',
      'composed reader report would leak audit internals; refusing to publish',
    );
  }
  const references = `${urls
    .map((url, index) => `[${String(index + 1)}]: ${url}`)
    .join('\n')}\n`;

  const projection = jsonArtifact({
    schemaVersion: '1.0.0',
    contractFamily: 'outcome-1.reader-projection/v1',
    runId,
    authoritativeRevision,
    planDigest: plan.planDigest,
    question: plan.question,
    reportDigest: sha256Text(report),
    referencesDigest: sha256Text(references),
    factualSentences: facts.map((fact) => ({
      sentence: fact.sentence,
      claimIds: [fact.claimId],
      citation: fact.citation,
      url: fact.url,
    })),
    deductions: [],
    sourceBoundedDeductions: [
      ...reviewAnswerBullets,
      ...directAnswerLimitations,
      ...directConstraintFacts.map((fact) => ({
        ...fact,
        citations: [fact.citation],
        evidenceIndexes: [fact.reviewEvidenceIndex],
      })),
      ...reviewMechanisms,
      ...reviewDissent,
      ...reviewBoundaries,
      ...reviewHypotheses,
      ...reviewExperiments,
      ...reviewPortfolio,
    ].map((deduction) => ({
      sentence: deduction.sentence,
      citations: deduction.citations,
      evidenceIndexes: deduction.evidenceIndexes,
    })),
    citations: urls.map((url, index) => ({ number: index + 1, url })),
    composedAt: input.now,
  });

  const auditFiles: Record<string, string> = {
    'audit/problem-contract.json': jsonArtifact({
      runId,
      investigationId: plan.investigationId,
      question: plan.question,
      interpretation: plan.interpretation,
      sourcePreviewDigest: plan.sourcePreviewDigest,
      planDigest: plan.planDigest,
    }),
    'audit/team-plan.json': jsonArtifact({
      runId,
      investigationId: plan.investigationId,
      proposedTeam: plan.team,
      planDigest: plan.planDigest,
    }),
    'audit/research-plan.json': jsonArtifact(plan),
    'audit/retrieval-attempts.jsonl': jsonlArtifact(
      execution.retrievalAttempts,
    ),
    'audit/parser-receipts.jsonl': jsonlArtifact(
      execution.snapshots.map((snapshot) => ({
        candidateId: snapshot.candidateId,
        requestedUrl: snapshot.requestedUrl,
        sourceClass: snapshot.sourceClass,
        rawContentDigest: snapshot.rawContentDigest,
        parsedTextDigest: snapshot.parsedTextDigest,
        spanCount: snapshot.spanCount,
        mediaSupportDecision: snapshot.mediaSupportDecision,
        parserReceipt: snapshot.parserReceipt,
      })),
    ),
    'audit/claim-admissions.jsonl': jsonlArtifact(
      execution.admissions.map((admission) => ({
        claimId: admission.proposalId,
        decision: admission.decision,
        admission,
      })),
    ),
    'audit/rejected-claims.jsonl': jsonlArtifact(
      rejected.map((claim) => ({
        claimId: claim.proposalId,
        statement: claim.statement,
        requestedUrl: claim.requestedUrl,
        sourceClass: claim.sourceClass,
        decision: claim.decision,
        reasonCodes: claim.reasonCodes,
      })),
    ),
    'audit/contradictions.jsonl': jsonlArtifact(
      intentSet.coverage.contradictionChecks.map((check, index) => ({
        checkId: `contradiction-check:${String(index + 1)}`,
        check,
        contradictedVerdicts: execution.verdicts.filter(
          (verdict) => verdict.verdict === 'contradicted',
        ).length,
        evaluatedAt: execution.executedAt,
      })),
    ),
    'audit/model-work.jsonl': jsonlArtifact(execution.modelWork),
    'audit/live-review.json': jsonArtifact(execution.liveReview ?? null),
    'audit/live-effect-receipts.jsonl': jsonlArtifact(execution.effectReceipts),
    'audit/budget-journal.jsonl': execution.externalEffectsExecuted
      ? jsonlArtifact(execution.effectReceipts)
      : jsonlArtifact([
          ...execution.intentReceipts.map((receipt) => ({
            entryId: `budget:${receipt.intentId}`,
            effect: receipt.kind,
            reference: receipt.intentId,
            chargedUsd: 0,
            note: 'strictly offline no-effect adapter; no billable effect executed',
            recordedAt: receipt.executedAt,
          })),
          ...execution.retrievalAttempts.map((attempt) => ({
            entryId: `budget:${attempt.attemptId}`,
            effect: 'retrieval',
            reference: attempt.attemptId,
            chargedUsd: 0,
            note: 'strictly offline no-effect adapter; no billable effect executed',
            recordedAt: execution.executedAt,
          })),
        ]),
  };

  const manifest = jsonArtifact({
    schemaVersion: '1.0.0',
    contractFamily: 'outcome-1.audit-manifest/v1',
    runId,
    authoritativeRevision,
    planDigest: plan.planDigest,
    intentSetDigest: intentSet.intentSetDigest,
    releaseDigest: release.releaseDigest,
    authorityReceiptDigest: execution.authorityReceiptDigest,
    externalEffectsExecuted: execution.externalEffectsExecuted,
    executionMode: execution.executionMode,
    readerProjectionDigest: sha256Text(projection),
    coverage: execution.coverage,
    discovery: {
      discoveredHints: execution.discoveredHints,
      selectedCandidates: execution.selectedCandidates,
      rejectedHints: execution.rejectedHints,
    },
    intentReceipts: execution.intentReceipts,
    artifacts: [
      'reader/report.md',
      'reader/references.md',
      'reader/projection.json',
      ...Object.keys(auditFiles),
    ],
    composedAt: input.now,
  });

  const files: Record<string, string> = {
    'reader/report.md': report,
    'reader/references.md': references,
    'reader/projection.json': projection,
    'audit/manifest.json': manifest,
    ...auditFiles,
  };
  const artifactDigests = Object.fromEntries(
    Object.entries(files).map(([name, content]) => [name, sha256Text(content)]),
  );
  files['execution-receipt.json'] = jsonArtifact({
    schemaVersion: '1.0.0',
    contractFamily: 'outcome-1.execution-receipt/v1',
    runId,
    authoritativeRevision,
    planDigest: plan.planDigest,
    intentSetDigest: intentSet.intentSetDigest,
    releaseDigest: release.releaseDigest,
    authorityReceiptDigest: execution.authorityReceiptDigest,
    externalEffectsExecuted: execution.externalEffectsExecuted,
    executionMode: execution.executionMode,
    executedAt: execution.executedAt,
    artifactDigests,
  });
  return { runId, files };
}
