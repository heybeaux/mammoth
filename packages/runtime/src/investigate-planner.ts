import {
  canonicalDigest,
  InvestigationPreviewSchema,
  type InvestigationPreview,
  type ProposedResearchRole,
} from '@mammoth/domain';

const STOP_WORDS = new Set([
  'about',
  'after',
  'against',
  'and',
  'are',
  'can',
  'did',
  'for',
  'had',
  'has',
  'how',
  'its',
  'may',
  'might',
  'should',
  'than',
  'the',
  'will',
  'why',
  'argues',
  'being',
  'between',
  'biggest',
  'build',
  'building',
  'could',
  'does',
  'establish',
  'finding',
  'from',
  'have',
  'important',
  'increasingly',
  'individuals',
  'into',
  'lie',
  'matter',
  'most',
  'novel',
  'opportunities',
  'other',
  'own',
  'researchers',
  'systems',
  'based',
  'their',
  'there',
  'these',
  'that',
  'today',
  'using',
  'ways',
  'what',
  'where',
  'whether',
  'which',
  'with',
  'would',
  'during',
  'while',
]);

const OPTIONAL_ROLES: readonly Omit<ProposedResearchRole, 'mission'>[] = [
  {
    roleId: 'mechanism-mapper',
    title: 'Mechanism mapper',
    independence:
      'Develops causal mechanisms before reviewing solution candidates.',
  },
  {
    roleId: 'quantitative-analyst',
    title: 'Quantitative analyst',
    independence:
      'Checks magnitudes, denominators, uncertainty, and measurement quality independently.',
  },
  {
    roleId: 'transfer-scout',
    title: 'Adjacent-field transfer scout',
    independence:
      'Searches by underlying constraints without treating analogy as evidence.',
  },
  {
    roleId: 'prior-art-challenger',
    title: 'Prior-art challenger',
    independence:
      'Looks for existing work and counterexamples before candidate ranking.',
  },
  {
    roleId: 'implementation-analyst',
    title: 'Implementation analyst',
    independence:
      'Assesses feasibility and boundary conditions separately from desirability.',
  },
  {
    roleId: 'experiment-designer',
    title: 'Experiment designer',
    independence: 'Designs tests but receives no authority to execute them.',
  },
];

function normalizedQuestion(question: string): string {
  return question.trim().replace(/\s+/gu, ' ');
}

function focusTerms(question: string): readonly string[] {
  const observed = [...question.matchAll(/[\p{L}\p{N}][\p{L}\p{N}-]{2,}/gu)]
    .map((match, index) => ({
      term: match[0].toLocaleLowerCase('en-US'),
      acronym: /^[A-Z0-9]{2,}$/u.test(match[0]),
      index,
    }))
    .filter(({ term }) => term.length > 0 && !STOP_WORDS.has(term));
  const frequency = new Map<string, number>();
  for (const { term } of observed) {
    frequency.set(term, (frequency.get(term) ?? 0) + 1);
  }
  const firstSeen = new Map<string, (typeof observed)[number]>();
  for (const candidate of observed) {
    if (!firstSeen.has(candidate.term))
      firstSeen.set(candidate.term, candidate);
  }
  const ranked = [...firstSeen.values()].sort((left, right) => {
    const score = (candidate: typeof left) =>
      (frequency.get(candidate.term) ?? 0) * 20 +
      Math.min(candidate.term.length, 14) +
      (candidate.acronym ? 10 : 0) +
      (candidate.term.includes('-') ? 8 : 0) +
      candidate.index / Math.max(observed.length, 1);
    return score(right) - score(left) || left.index - right.index;
  });
  if (ranked.length >= 2) return ranked.slice(0, 16).map(({ term }) => term);
  return observed.slice(0, 16).map(({ term }) => term);
}

function orderedFocusTerms(question: string): readonly string[] {
  const terms: string[] = [];
  const seen = new Set<string>();
  for (const match of question.matchAll(/[\p{L}\p{N}][\p{L}\p{N}-]{2,}/gu)) {
    const term = match[0].toLocaleLowerCase('en-US');
    if (STOP_WORDS.has(term) || seen.has(term)) continue;
    seen.add(term);
    terms.push(term);
  }
  return terms;
}

function stripAttributionFraming(value: string): string {
  return value.replace(
    /(^|[.!?]\s*)[^.!?]{0,120}?\b(?:argues?|claims?|says?|suggests?)\s+that\b/giu,
    '$1',
  );
}

export function deriveDecisionConstraints(question: string): readonly string[] {
  const decisionText = stripAttributionFraming(question);
  const ordered = orderedFocusTerms(decisionText);
  const segmentPhrases: string[] = [];
  const supportingPhrases: string[] = [];
  const seen = new Set<string>();
  const add = (target: string[], phrase: string) => {
    if (phrase.length < 7 || phrase.length > 80 || seen.has(phrase)) return;
    seen.add(phrase);
    target.push(phrase);
  };
  const readableSegment = (segment: string): string => {
    const normalized = segment
      .replace(/[“”"']/gu, '')
      .replace(/[^\p{L}\p{N}./+-]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim()
      .replace(
        /^(?:how|what|which|where|when|why|should|could|would|can|do|does|did|the|a|an|with)\s+/iu,
        '',
      )
      .replace(/\b(?:argues?|claims?|says?|suggests?)\s+that\b/giu, ' ')
      .replace(/\b(?:are|is|was|were)\s+important\s+beyond\b/giu, ' beyond ')
      .replace(
        /^(?:biggest\s+)?(?:opportunities|strategies|approaches|options)\s+(?:lie\s+)?(?:today\s+)?(?:for\s+)?/iu,
        '',
      )
      .trim();
    const words = normalized.split(/\s+/u).filter(Boolean);
    if (words.length < 2) return '';
    return words.slice(0, 9).join(' ');
  };
  for (const segment of decisionText.split(
    /\b(?:after|before|during|for|on|under|using|when|where|while|with|without|based\s+on)\b|[.;:?!]/giu,
  )) {
    const terms = orderedFocusTerms(segment);
    if (terms.length < 2) continue;
    add(
      segmentPhrases,
      readableSegment(segment) || terms.slice(0, 6).join(' '),
    );
    if (terms.length > 5) add(supportingPhrases, terms.slice(-4).join(' '));
    for (let index = 0; index < terms.length - 1; index += 1) {
      add(supportingPhrases, terms.slice(index, index + 3).join(' '));
    }
  }
  for (let index = 0; index < ordered.length; index += 1) {
    for (const width of [4, 3, 2]) {
      const phrase = ordered.slice(index, index + width).join(' ');
      add(supportingPhrases, phrase);
    }
  }
  return [...segmentPhrases, ...supportingPhrases].slice(0, 8);
}

function stableIndex(seed: string, offset: number, size: number): number {
  const digest = canonicalDigest({ seed, offset }).slice(7);
  return Number.parseInt(digest.slice(0, 8), 16) % size;
}

function searchStem(question: string): string {
  return question;
}

function compactQuery(value: string, maxTerms = 18): string {
  const terms: string[] = [];
  const seen = new Set<string>();
  for (const term of orderedFocusTerms(value)) {
    if (seen.has(term)) continue;
    seen.add(term);
    terms.push(term);
    if (terms.length >= maxTerms) break;
  }
  return terms.join(' ');
}

function phraseOccurrenceCount(value: string, phrase: string): number {
  const normalizedValue = value.toLocaleLowerCase('en-US');
  const normalizedPhrase = phrase.toLocaleLowerCase('en-US').trim();
  if (!normalizedPhrase) return 0;
  let count = 0;
  let offset = 0;
  while (offset < normalizedValue.length) {
    const found = normalizedValue.indexOf(normalizedPhrase, offset);
    if (found < 0) break;
    count += 1;
    offset = found + normalizedPhrase.length;
  }
  return count;
}

function selectOptionalRoles(
  question: string,
  focus: string,
): ProposedResearchRole[] {
  const remaining = [...OPTIONAL_ROLES];
  const selected: ProposedResearchRole[] = [];
  while (selected.length < 3) {
    const index = stableIndex(question, selected.length, remaining.length);
    const [role] = remaining.splice(index, 1);
    if (!role) throw new Error('role selection failed');
    selected.push({
      ...role,
      mission: `${role.title} investigates ${focus} under explicit uncertainty and evidence constraints.`,
    });
  }
  return selected;
}

function roleReportSection(role: ProposedResearchRole): string {
  switch (role.roleId) {
    case 'mechanism-mapper':
      return 'Mechanisms, causal constraints, and boundary conditions';
    case 'quantitative-analyst':
      return 'Magnitudes, measurements, and quantitative uncertainty';
    case 'transfer-scout':
      return 'Cross-domain mechanisms and transfer limits';
    case 'prior-art-challenger':
      return 'Prior art, counterexamples, and competing approaches';
    case 'implementation-analyst':
      return 'Implementation feasibility and operational constraints';
    case 'experiment-designer':
      return 'Decisive experiments and expected information value';
    default:
      return role.title;
  }
}

export function planInvestigation(questionInput: string): InvestigationPreview {
  const question = normalizedQuestion(questionInput);
  if (question.length < 12) {
    throw new Error('investigate requires a substantive question');
  }
  const terms = focusTerms(question);
  if (terms.length < 2) {
    throw new Error('investigate could not derive enough question terms');
  }
  const primary = terms.slice(0, 5).join(' ');
  const secondary = terms.slice(5, 16).join(' ') || terms.slice(0, 3).join(' ');
  const implementationFocus =
    orderedFocusTerms(question).slice(0, 16).join(' ') || primary;
  const constraints = deriveDecisionConstraints(question);
  const directConstraintFocus = constraints[0] ?? implementationFocus;
  const resourceConstraintFocus = constraints[1] ?? secondary;
  const deliveryConstraintFocus = constraints[2] ?? implementationFocus;
  const boundaryConstraintFocus = constraints[3] ?? secondary;
  const lateConstraintFocus = constraints[4] ?? boundaryConstraintFocus;
  const subjectConstraintFocus = constraints.reduce(
    (best, candidate) =>
      phraseOccurrenceCount(question, candidate) >
      phraseOccurrenceCount(question, best)
        ? candidate
        : best,
    directConstraintFocus,
  );
  const directSearch = searchStem(question);
  const sourceTopic = orderedFocusTerms(question).slice(0, 6).join(' ');
  const implementationQuery = compactQuery(
    [implementationFocus, ...constraints].join(' '),
  );
  const constraintQuery = compactQuery(
    [directConstraintFocus, resourceConstraintFocus, deliveryConstraintFocus]
      .filter(Boolean)
      .join(' '),
    14,
  );
  const boundaryQuery = compactQuery(
    [boundaryConstraintFocus, ...constraints.slice(2)].join(' '),
    14,
  );
  const investigationId = canonicalDigest({ question }).slice(7, 23);
  const optionalRoles = selectOptionalRoles(question, primary);
  const proposedTeam: ProposedResearchRole[] = [
    {
      roleId: 'problem-framer',
      title: 'Problem framer',
      mission:
        'Turns the submitted question into explicit decisions, constraints, and falsifiers.',
      independence:
        'Frames the problem before candidate solutions are generated.',
    },
    {
      roleId: 'evidence-lineage-analyst',
      title: 'Evidence and lineage analyst',
      mission: `Finds and audits direct evidence for the submitted question using the derived focus terms: ${primary}.`,
      independence:
        'Does not synthesize the final answer or evaluate its own evidence admissions.',
    },
    ...optionalRoles,
    {
      roleId: 'blind-critic',
      title: 'Blind critic',
      mission:
        'Challenges candidate conclusions using withheld contradictions and failure cases.',
      independence:
        'Reviews candidates without author identity or popularity signals.',
    },
    {
      roleId: 'synthesist',
      title: 'Synthesist',
      mission:
        'Produces a direct answer to the submitted question while preserving dissent and uncertainty.',
      independence:
        'Cannot admit unsupported factual claims into the evidence record.',
    },
  ];
  const body = {
    schemaVersion: '1.0.0' as const,
    contractFamily: 'investigation.preview.v1' as const,
    investigationId: `investigation:${investigationId}`,
    question,
    interpretation: {
      objective: `Determine the strongest defensible answer and actionable opportunities for: “${question}”`,
      decisionCriterion:
        'Prefer conclusions that remain useful after evidence quality, feasibility, counterexamples, and uncertainty are considered.',
      constraints: [
        'Keep conclusions responsive to the submitted question.',
        'Separate observations, deductions, analogies, hypotheses, and speculation.',
        'Do not execute experiments or external actions without later explicit authority.',
        ...constraints
          .slice(0, 4)
          .map(
            (constraint) =>
              `Decision constraint from the question: ${constraint}.`,
          ),
      ],
      unknowns: [
        'Which assumptions materially affect the answer?',
        `Which evidence concerning ${secondary} is current, independent, and reproducible?`,
        'Which relevant constraints or stakeholder perspectives are absent from the question?',
      ],
      falsifiers: [
        `Credible evidence that the apparent relationship between ${primary} does not generalize.`,
        `Boundary conditions showing that candidate opportunities fail under ${secondary}.`,
      ],
    },
    proposedTeam,
    ambiguities: [
      'The intended decision horizon and acceptable trade-offs are not specified.',
      'The desired balance between breadth, depth, recency, and cost is not specified.',
    ],
    assumptions: [
      'Publicly accessible evidence may be requested after approval.',
      'Research-only completion is acceptable; experiment execution remains unauthorized.',
      'The final answer must expose meaningful dissent and unresolved uncertainty.',
    ],
    plan: {
      subquestions: [
        `What is directly observed and well supported for ${primary}?`,
        `What competing explanations and counterexamples apply to ${secondary}?`,
        `Which underlying mechanisms and constraints determine outcomes involving ${primary}?`,
        `Which transferable approaches address analogous constraints, and where do they break?`,
        `What opportunities survive feasibility, prior-art, risk, and falsification checks?`,
      ],
      searchQueries: [
        `${constraintQuery || implementationQuery || sourceTopic || primary} official project documentation`,
        `${subjectConstraintFocus} ${deliveryConstraintFocus} ${resourceConstraintFocus} repository readme implementation`,
        `${subjectConstraintFocus} ${lateConstraintFocus} github repository readme implementation`,
        `${subjectConstraintFocus} ${deliveryConstraintFocus} practical applications use cases local deployment`,
        `${subjectConstraintFocus} ${deliveryConstraintFocus} privacy local deployment architecture`,
        `${resourceConstraintFocus || secondary} fixed compute budget benchmark comparison`,
        `${implementationQuery || constraintQuery || sourceTopic || primary} approaches alternatives comparison`,
        `${constraintQuery || implementationQuery || sourceTopic || primary} open source implementation comparison`,
        `${subjectConstraintFocus} ${lateConstraintFocus} measured benchmark resource requirements`,
        `${subjectConstraintFocus} ${lateConstraintFocus} deployment hardware requirements`,
        `${boundaryQuery || implementationQuery || sourceTopic || primary} limitations counterexamples failure cases`,
        `${sourceTopic || directSearch} official project documentation`,
        `${sourceTopic || primary} ${directConstraintFocus} primary source technical report`,
        `${sourceTopic || primary} ${resourceConstraintFocus} measured benchmark resource requirements`,
        `${constraintQuery || implementationQuery || sourceTopic || primary} official implementation constraints`,
        `${boundaryQuery || implementationQuery || sourceTopic || primary} benchmark feasibility comparison`,
        `${sourceTopic || primary} ${directConstraintFocus} independent evaluation comparison`,
      ],
      evidenceRequirements: [
        'Prefer direct, current, and reproducible evidence for critical factual claims.',
        'Require independent support for consequential claims when available.',
        'Capture exact source spans, immutable snapshots, parsing lineage, and freshness.',
      ],
      falsificationChecks: [
        `Search explicitly for evidence inconsistent with leading claims about ${primary}.`,
        `Record conditions under which conclusions involving ${secondary} cease to hold.`,
        'Design the cheapest decisive experiments for uncertainties that research cannot resolve.',
      ],
      contradictionChecks: [
        'Preserve supported disagreement instead of forcing consensus.',
        'Distinguish genuine contradiction from differences in definitions, populations, or time horizons.',
      ],
      reportSections: [
        'Direct answer to the submitted question',
        'Strongest findings and why they matter',
        ...optionalRoles.map((role) => roleReportSection(role)),
        'Competing explanations and dissent',
        'Ranked opportunities, risks, and falsifiers',
        'Experiments worth running next',
        'Uncertainties and recommended actions',
      ],
      stopCriteria: [
        'Every mandatory subquestion is answered, explicitly inconclusive, or blocked.',
        'Critical claims have admitted evidence or are clearly labelled unsupported.',
        'At least one meaningful counterargument has been investigated.',
        'Additional work is unlikely to change the ranked conclusions within the approved budget.',
      ],
    },
    requestedAuthority: {
      status: 'not_granted' as const,
      approvalRequired: true as const,
      localProviders: ['local-deterministic-question-planner/v1'],
      requestedCloudCapabilities: [
        'research synthesis',
        'independent claim evaluation',
      ],
      requestedTools: [
        'public information search',
        'read-only retrieval and parsing',
        'immutable evidence storage',
      ],
      requestedNetworkAccess: ['read-only access to approved public sources'],
      maxTimeMinutes: 90,
      maxSpendUsd: 5,
      externalEffectsExecuted: false as const,
    },
    experiments: {
      mode: 'design_only' as const,
      executionAuthorized: false as const,
      statement:
        'Mammoth may propose bounded experiments, but this preview grants no authority to execute code, benchmarks, simulations, changes, paid effects, or external actions.',
    },
    approvalChoices: [
      {
        choice: 'approve' as const,
        effect:
          'Mint a separate scoped authority before any external research begins.',
      },
      {
        choice: 'revise' as const,
        effect:
          'Change the interpretation, team, plan, authority, time, or budget without external effects.',
      },
      {
        choice: 'cancel' as const,
        effect: 'End the investigation with no external effects.',
      },
    ],
    planner: {
      plannerId: 'local-deterministic-question-planner/v1' as const,
      questionDerived: true as const,
      networkUsed: false as const,
      externalProviderUsed: false as const,
    },
  };
  return InvestigationPreviewSchema.parse({
    ...body,
    previewDigest: canonicalDigest(body),
  });
}
