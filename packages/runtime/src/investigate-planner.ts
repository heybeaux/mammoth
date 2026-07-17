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
  'individuals',
  'into',
  'lie',
  'matter',
  'most',
  'novel',
  'other',
  'researchers',
  'systems',
  'their',
  'there',
  'these',
  'today',
  'using',
  'ways',
  'what',
  'where',
  'whether',
  'which',
  'with',
  'would',
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
  const clauses = question.split(/(?<=[.!?])\s+/u);
  const decisionClause = clauses.at(-1) ?? question;
  const candidates = decisionClause
    .toLocaleLowerCase('en-US')
    .match(/[\p{L}\p{N}][\p{L}\p{N}-]{2,}/gu)
    ?.filter((term) => !STOP_WORDS.has(term));
  const unique = [...new Set(candidates ?? [])];
  if (unique.length >= 4) return unique.slice(0, 8);
  const fallback = [
    ...new Set(
      decisionClause
        .toLocaleLowerCase('en-US')
        .split(/\s+/u)
        .map((term) => term.replace(/[^\p{L}\p{N}-]/gu, ''))
        .filter((term) => term.length > 1),
    ),
  ];
  return fallback.slice(0, 8);
}

function stableIndex(seed: string, offset: number, size: number): number {
  const digest = canonicalDigest({ seed, offset }).slice(7);
  return Number.parseInt(digest.slice(0, 8), 16) % size;
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
  const primary = terms.slice(0, 3).join(' ');
  const secondary = terms.slice(3, 6).join(' ') || terms.slice(0, 2).join(' ');
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
        `${primary} primary evidence measurements`,
        `${secondary} limitations counterexamples`,
        `${primary} mechanisms constraints comparative analysis`,
        `${secondary} replication failures independent review`,
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
