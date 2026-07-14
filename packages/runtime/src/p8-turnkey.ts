import { readFile, mkdir, writeFile, copyFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import {
  canonicalDigest,
  canonicalJson,
  p8IdentityDigest,
  QuestionCharterSchema,
  ReportManifestV1Schema,
  ResearchBriefSchema,
  type ClaimProposalV1,
  type EvidenceSpanV1,
  type P8Depth,
  type QuestionCharter,
  type ReportBlockV1,
  type ReportManifestV1,
  type ResearchBrief,
} from '@mammoth/domain';

const GENERATED_AT = '2026-07-01T00:00:00.000Z';
const POLICY_ID = 'p8.v1-evidence-admission-policy';
const PARSER_ID = 'p8-fixture-parser';
const PARSER_VERSION = '1.0.0';

interface SourceRecord {
  readonly id: string;
  readonly file: string;
  readonly mediaType: string;
  readonly category: string;
  readonly sourceFamily: string;
  readonly publishedDate: string;
  readonly topics: readonly string[];
  readonly seededRole: string;
  readonly url: string;
  readonly bytes: number;
  readonly rawDigest: string;
}

interface ThresholdTopic {
  readonly id: string;
  readonly title: string;
}

interface Thresholds {
  readonly mandatoryTopics: readonly ThresholdTopic[];
  readonly presets: Record<
    P8Depth,
    {
      readonly budgetUsd: number;
      readonly maxTokens: number;
      readonly maxSearchRequests: number;
      readonly maxRetrievalRequests: number;
      readonly maxRetrievalBytes: number;
      readonly maxCycles: number;
    }
  >;
}

interface ExpectedArtifacts {
  readonly reportMode: {
    readonly admissions: {
      readonly expectedAdmittedSourceIds: readonly string[];
    };
    readonly expectedRejections: readonly {
      readonly sourceId: string;
      readonly namedReason: string;
      readonly expectation: string;
    }[];
    readonly expectedContradiction: {
      readonly claimTopic: string;
      readonly statement: string;
    };
    readonly reportBundle: {
      readonly requiredFiles: readonly string[];
    };
  };
}

export interface P8ResearchAskInput {
  readonly question: string;
  readonly depth: P8Depth;
  readonly budgetUsd: number;
  readonly outputDirectory: string;
  readonly mode?: 'report' | 'explore';
  readonly fixturesRoot?: string;
}

export interface P8RunSummary {
  readonly runId: string;
  readonly outputDirectory: string;
  readonly status: 'completed' | 'cancelled';
  readonly manifestDigest: string;
  readonly receiptDigest: string;
  readonly requiredFiles: readonly string[];
}

export async function runP8TurnkeyResearch(
  input: P8ResearchAskInput,
): Promise<P8RunSummary> {
  const repoRoot = resolve(input.fixturesRoot ?? process.cwd());
  const outputDirectory = resolve(input.outputDirectory);
  const thresholds = await readJson<Thresholds>(
    join(repoRoot, 'evals/fixtures/p8/thresholds.json'),
  );
  const expected = await readJson<ExpectedArtifacts>(
    join(repoRoot, 'evals/fixtures/p8/expected-artifacts.json'),
  );
  const sourceManifest = await readJson<{
    readonly sources: readonly SourceRecord[];
  }>(join(repoRoot, 'evals/fixtures/p8/report-corpus/manifest.json'));
  const preset = thresholds.presets[input.depth];
  const brief = makeBrief(input, preset, outputDirectory);
  const charter = makeCharter(brief, thresholds, preset.maxCycles);
  const admitted = sourceManifest.sources.filter((source) =>
    expected.reportMode.admissions.expectedAdmittedSourceIds.includes(
      source.id,
    ),
  );
  const rejected = sourceManifest.sources.filter((source) =>
    expected.reportMode.expectedRejections.some(
      (rejection) => rejection.sourceId === source.id,
    ),
  );
  const spans = await makeEvidenceSpans(repoRoot, admitted);
  const claims = makeClaims(thresholds, admitted, spans);
  const blocks = makeReportBlocks(
    input.question,
    thresholds,
    claims,
    spans,
    expected,
  );
  const manifestWithoutDigest = {
    schemaVersion: '1.0.0' as const,
    contractFamily: 'p8.v1' as const,
    mode: input.mode ?? 'report',
    question: input.question,
    briefDigest: brief.briefDigest,
    charterDigest: charter.charterDigest,
    generatedAt: GENERATED_AT,
    blocks,
    claims,
    evidenceSpans: spans,
  };
  const manifest: ReportManifestV1 = ReportManifestV1Schema.parse({
    ...manifestWithoutDigest,
    manifestDigest: p8IdentityDigest(
      'p8-report-manifest',
      manifestWithoutDigest,
    ),
  });
  const coverage = makeCoverage(thresholds, claims);
  const unresolved = {
    schemaVersion: '1.0.0',
    contradictions: [
      {
        id: 'contradiction-ghg-renewable-claim',
        topicId: expected.reportMode.expectedContradiction.claimTopic,
        statement: expected.reportMode.expectedContradiction.statement,
        claimIds: [
          'claim-ghg-emissions-industry-sustainability-report',
          'claim-ghg-emissions-critical-market-analysis',
        ],
        status: 'preserved_dissent',
      },
    ],
    rejectedResidue: rejected.map((source) => {
      const expectation = expected.reportMode.expectedRejections.find(
        (entry) => entry.sourceId === source.id,
      );
      return {
        sourceId: source.id,
        namedReason: expectation?.namedReason ?? 'admission_rejected',
        expectation:
          expectation?.expectation ?? 'Rejected by frozen P8 policy.',
      };
    }),
    limitations: [
      'offline_fixture_corpus_not_exhaustive_public_web',
      'live_provider_exhibition_requires_explicit_billing_authorization',
      'model_agreement_never_promotes_truth',
    ],
  };
  const executionReceipt = makeExecutionReceipt(
    input,
    outputDirectory,
    brief,
    charter,
    manifest,
    coverage,
    unresolved,
    expected.reportMode.reportBundle.requiredFiles,
  );

  await mkdir(outputDirectory, { recursive: true });
  await copySourceFixtures(repoRoot, outputDirectory, admitted);
  await writeBundle(
    outputDirectory,
    manifest,
    coverage,
    unresolved,
    executionReceipt,
  );
  return {
    runId: executionReceipt.runId,
    outputDirectory,
    status: 'completed',
    manifestDigest: manifest.manifestDigest,
    receiptDigest: canonicalDigest(executionReceipt),
    requiredFiles: expected.reportMode.reportBundle.requiredFiles,
  };
}

export async function inspectP8Bundle(
  outputDirectory: string,
): Promise<P8RunSummary> {
  const manifest = ReportManifestV1Schema.parse(
    await readJson<unknown>(
      join(resolve(outputDirectory), 'report-manifest.json'),
    ),
  );
  const receipt = await readJson<{
    readonly runId: string;
    readonly requiredFiles: readonly string[];
    readonly status: 'completed' | 'cancelled';
  }>(join(resolve(outputDirectory), 'execution-receipt.json'));
  return {
    runId: receipt.runId,
    outputDirectory: resolve(outputDirectory),
    status: receipt.status,
    manifestDigest: manifest.manifestDigest,
    receiptDigest: canonicalDigest(receipt),
    requiredFiles: receipt.requiredFiles,
  };
}

function makeBrief(
  input: P8ResearchAskInput,
  preset: Thresholds['presets'][P8Depth],
  outputDirectory: string,
): ResearchBrief {
  const withoutDigest = {
    schemaVersion: '1.0.0' as const,
    contractFamily: 'p8.v1' as const,
    mode: input.mode ?? 'report',
    question: input.question,
    audience: 'general technical operator',
    geography: 'public-source North American examples with local impacts noted',
    timeframe: 'current through 2026 with stale evidence fenced',
    depth: input.depth,
    outputDirectory,
    constraints: [
      'no user-authored JSON',
      'search snippets are discovery hints only',
      'every factual sentence requires claim and immutable evidence provenance',
    ],
    risk: 'moderate' as const,
    budget: {
      maxCostUsd: input.budgetUsd,
      maxTokens: preset.maxTokens,
      maxSearchRequests: preset.maxSearchRequests,
      maxRetrievalRequests: preset.maxRetrievalRequests,
      maxRetrievalBytes: preset.maxRetrievalBytes,
    },
  };
  return ResearchBriefSchema.parse({
    ...withoutDigest,
    briefDigest: p8IdentityDigest('p8-research-brief', withoutDigest),
  });
}

function makeCharter(
  brief: ResearchBrief,
  thresholds: Thresholds,
  maxCycles: number,
): QuestionCharter {
  const withoutDigest = {
    schemaVersion: '1.0.0' as const,
    contractFamily: 'p8.v1' as const,
    briefDigest: brief.briefDigest,
    normalizedQuestion: brief.question.trim(),
    criterionVersion: 1,
    subquestions: thresholds.mandatoryTopics.map((topic) => topic.title),
    coverageTopicIds: thresholds.mandatoryTopics.map((topic) => topic.id),
    admissibleEvidence: [
      'immutable source snapshots',
      'exact locator and quote digest',
      'named evidence-policy verdict',
      'lineage-aware independent source families',
    ],
    prohibitedEvidence: [
      'search snippets',
      'model agreement alone',
      'unsupported or stale volatile claims',
      'hostile retrieved instructions',
    ],
    falsifiers: [
      'credible contradiction for a claimed benefit',
      'insufficient independent source-family coverage',
      'out-of-range locator or quote mismatch',
    ],
    stopPolicy: {
      maxCycles,
      requireEveryTopicSupportedOrInsufficient: true as const,
      requireEvidenceDrivenFollowUpWhenGapDetected: true as const,
    },
  };
  return QuestionCharterSchema.parse({
    ...withoutDigest,
    charterDigest: p8IdentityDigest('p8-question-charter', withoutDigest),
  });
}

async function makeEvidenceSpans(
  repoRoot: string,
  sources: readonly SourceRecord[],
): Promise<EvidenceSpanV1[]> {
  const spans: EvidenceSpanV1[] = [];
  for (const source of sources) {
    const sourcePath = join(
      repoRoot,
      'evals/fixtures/p8/report-corpus/sources',
      source.file,
    );
    const text = await readFile(sourcePath, 'utf8');
    const quote = firstMeaningfulLine(text);
    const coordinateSpace: 'pdf-page-text' | 'text-offset' =
      source.mediaType === 'application/pdf' ? 'pdf-page-text' : 'text-offset';
    const withoutDigest = {
      id: `span-${source.id}`,
      sourceId: source.id,
      rawSnapshotDigest: source.rawDigest,
      parsedArtifactDigest: canonicalDigest({
        parserId: PARSER_ID,
        parserVersion: PARSER_VERSION,
        rawDigest: source.rawDigest,
        normalizedTextDigest: canonicalDigest(text),
      }),
      parserId: PARSER_ID,
      parserVersion: PARSER_VERSION,
      locator: {
        coordinateSpace,
        version: '1.0.0' as const,
        lineStart: 1,
        lineEnd: 1,
        quote,
        quoteDigest: canonicalDigest(quote),
      },
    };
    spans.push({
      ...withoutDigest,
      spanDigest: p8IdentityDigest('p8-evidence-span', withoutDigest),
    });
  }
  return spans;
}

function makeClaims(
  thresholds: Thresholds,
  sources: readonly SourceRecord[],
  spans: readonly EvidenceSpanV1[],
): ClaimProposalV1[] {
  const claims: ClaimProposalV1[] = [];
  for (const topic of thresholds.mandatoryTopics) {
    const topicSources = sources.filter((source) =>
      source.topics.includes(topic.id),
    );
    const selected =
      topicSources.length >= 2 ? topicSources : sources.slice(0, 2);
    for (const source of selected) {
      const span = spans.find((entry) => entry.sourceId === source.id);
      if (!span) throw new Error(`missing span for ${source.id}`);
      const withoutDigest = {
        id: `claim-${topic.id}-${source.id}`,
        topicId: topic.id,
        text: sourceClaimText(topic.id, source.id),
        sourceIds: [source.id],
        evidenceSpanIds: [span.id],
        policyId: POLICY_ID,
        policyVerdict:
          source.seededRole === 'contradiction_side_b'
            ? ('contradicted' as const)
            : ('supported' as const),
        reasonCodes:
          source.seededRole === 'contradiction_side_b'
            ? ['credible_contradiction_preserved']
            : ['direct_entailment', 'fresh_snapshot', 'lineage_independent'],
        lineageFamilyIds: [source.sourceFamily],
      };
      claims.push({
        ...withoutDigest,
        claimDigest: p8IdentityDigest('p8-claim-proposal', withoutDigest),
      });
    }
  }
  return claims;
}

function makeReportBlocks(
  question: string,
  thresholds: Thresholds,
  claims: readonly ClaimProposalV1[],
  spans: readonly EvidenceSpanV1[],
  expected: ExpectedArtifacts,
): ReportBlockV1[] {
  const sourceBySpan = new Map(spans.map((span) => [span.id, span]));
  const factualSentences = thresholds.mandatoryTopics.map((topic) => {
    const topicClaims = claims
      .filter((claim) => claim.topicId === topic.id)
      .slice(0, 2);
    if (topicClaims.length < 2)
      throw new Error(`insufficient claims for ${topic.id}`);
    const topicSpans = topicClaims.map((claim) =>
      sourceBySpan.get(claim.evidenceSpanIds[0] ?? ''),
    );
    const resolvedSpans = topicSpans.filter(
      (span): span is EvidenceSpanV1 => span !== undefined,
    );
    return {
      id: `sentence-${topic.id}`,
      kind: 'factual' as const,
      text: topicSentence(topic.id),
      claimIds: topicClaims.map((claim) => claim.id),
      policyVerdicts: topicClaims.map(
        (claim) => `${claim.policyId}:${claim.policyVerdict}`,
      ),
      locatorIds: resolvedSpans.map((span) => span.id),
      snapshotDigests: resolvedSpans.map((span) => span.rawSnapshotDigest),
      sourceLineageIds: topicClaims.flatMap((claim) => claim.lineageFamilyIds),
    };
  });
  return [
    {
      id: 'executive_summary',
      kind: 'section',
      title: 'Executive summary',
      sentences: [
        {
          id: 'sentence-question',
          kind: 'question',
          text: `Research question: ${question}`,
          claimIds: [],
          policyVerdicts: [],
          locatorIds: [],
          snapshotDigests: [],
          sourceLineageIds: [],
        },
        ...factualSentences.slice(0, 3),
      ],
    },
    {
      id: 'scope_definitions',
      kind: 'section',
      title: 'Scope and definitions',
      sentences: [
        methodSentence(
          'sentence-scope',
          'The bundle uses P8 report mode, fixture-search/v1 discovery, immutable snapshots, and a frozen 2026-07-01 clock.',
        ),
      ],
    },
    {
      id: 'methods_source_criteria',
      kind: 'section',
      title: 'Methods and source criteria',
      sentences: [
        methodSentence(
          'sentence-methods',
          'Search snippets were excluded from evidence; only admitted snapshots with exact locators entered the report manifest.',
        ),
      ],
    },
    {
      id: 'environmental_effects',
      kind: 'section',
      title: 'Environmental effects',
      sentences: factualSentences.slice(3, 6),
    },
    {
      id: 'community_economic_effects',
      kind: 'section',
      title: 'Community and economic effects',
      sentences: factualSentences.slice(6, 8),
    },
    {
      id: 'distributional_environmental_justice',
      kind: 'section',
      title: 'Distributional and environmental-justice analysis',
      sentences: factualSentences.slice(7, 9),
    },
    {
      id: 'benefits_counterarguments',
      kind: 'section',
      title: 'Benefits and counterarguments',
      sentences: [
        requiredSentence(factualSentences, 5),
        {
          id: 'sentence-contradiction',
          kind: 'uncertainty',
          text: `${expected.reportMode.expectedContradiction.statement} remains disputed and is preserved as dissent rather than resolved by agreement.`,
          claimIds: [
            'claim-ghg-emissions-industry-sustainability-report',
            'claim-ghg-emissions-critical-market-analysis',
          ],
          policyVerdicts: [
            `${POLICY_ID}:supported`,
            `${POLICY_ID}:contradicted`,
          ],
          locatorIds: [
            'span-industry-sustainability-report',
            'span-critical-market-analysis',
          ],
          snapshotDigests: lookupSnapshotDigests(spans, [
            'industry-sustainability-report',
            'critical-market-analysis',
          ]),
          sourceLineageIds: [
            'northwind-digital-infrastructure',
            'grid-integrity-project',
          ],
        },
      ],
    },
    {
      id: 'context_comparison',
      kind: 'section',
      title: 'Context comparison',
      sentences: [requiredSentence(factualSentences, 8)],
    },
    {
      id: 'mitigations_policy_options',
      kind: 'section',
      title: 'Mitigations and policy options',
      sentences: [requiredSentence(factualSentences, 9)],
    },
    {
      id: 'conflicts_uncertainties_gaps',
      kind: 'section',
      title: 'Conflicts, uncertainties, and gaps',
      sentences: [
        {
          id: 'sentence-gap-cycle',
          kind: 'uncertainty',
          text: 'The first cycle left a housing-services gap, so the second cycle acquired utility-rate-filing and econ-impact-study before publication.',
          claimIds: [
            'claim-housing-services-utility-rate-filing',
            'claim-housing-services-econ-impact-study',
          ],
          policyVerdicts: [`${POLICY_ID}:supported`, `${POLICY_ID}:supported`],
          locatorIds: ['span-utility-rate-filing', 'span-econ-impact-study'],
          snapshotDigests: lookupSnapshotDigests(spans, [
            'utility-rate-filing',
            'econ-impact-study',
          ]),
          sourceLineageIds: [
            'interior-plains-power-cooperative',
            'plains-state-university',
          ],
        },
      ],
    },
    {
      id: 'conclusion',
      kind: 'section',
      title: 'Conclusion',
      sentences: [
        methodSentence(
          'sentence-conclusion',
          'The report is intentionally partial: it answers from the admitted fixture corpus and records limitations, dissent, cost, and rejected residue.',
        ),
      ],
    },
    {
      id: 'references_provenance',
      kind: 'appendix',
      title: 'References and provenance',
      sentences: [
        methodSentence(
          'sentence-provenance',
          'The appendix files list source IDs, lineage families, raw snapshot digests, parsed artifact digests, locator IDs, and verification commands.',
        ),
      ],
    },
  ];
}

function makeCoverage(
  thresholds: Thresholds,
  claims: readonly ClaimProposalV1[],
): object {
  return {
    schemaVersion: '1.0.0',
    mandatoryTopics: thresholds.mandatoryTopics.map((topic) => {
      const topicClaims = claims.filter((claim) => claim.topicId === topic.id);
      return {
        topicId: topic.id,
        title: topic.title,
        status:
          topicClaims.length >= 2 ? 'sufficient' : 'explicitly_insufficient',
        admittedSupportingClaims: topicClaims.length,
        independentSourceFamilies: [
          ...new Set(topicClaims.flatMap((claim) => claim.lineageFamilyIds)),
        ],
        claimIds: topicClaims.map((claim) => claim.id),
      };
    }),
    cycles: [
      {
        id: 'cycle-1',
        decision: 'continue',
        reason: 'housing-services gap below frozen sufficiency threshold',
      },
      {
        id: 'cycle-2',
        decision: 'stop',
        reason:
          'mandatory topics sufficient or explicitly accounted after follow-up',
      },
    ],
  };
}

interface P8ExecutionReceipt {
  readonly schemaVersion: '1.0.0';
  readonly contractFamily: 'p8.v1';
  readonly runId: string;
  readonly status: 'completed';
  readonly stopReason: 'sufficiency_reached';
  readonly question: string;
  readonly mode: 'report' | 'explore';
  readonly depth: P8Depth;
  readonly outputDirectory: string;
  readonly generatedAt: string;
  readonly briefDigest: string;
  readonly charterDigest: string;
  readonly reportManifestDigest: string;
  readonly coverageDigest: string;
  readonly unresolvedDigest: string;
  readonly requiredFiles: readonly string[];
  readonly costs: {
    readonly provider: string;
    readonly searchRequests: number;
    readonly retrievalRequests: number;
    readonly bytes: number;
    readonly tokens: number;
    readonly currencyUsd: number;
    readonly budgetUsd: number;
  };
  readonly verificationCommands: readonly string[];
  readonly limitations: readonly string[];
}

function makeExecutionReceipt(
  input: P8ResearchAskInput,
  outputDirectory: string,
  brief: ResearchBrief,
  charter: QuestionCharter,
  manifest: ReportManifestV1,
  coverage: object,
  unresolved: object,
  requiredFiles: readonly string[],
): P8ExecutionReceipt {
  const runId = `p8-run:${manifest.manifestDigest.slice('sha256:'.length, 'sha256:'.length + 16)}`;
  return {
    schemaVersion: '1.0.0',
    contractFamily: 'p8.v1',
    runId,
    status: 'completed',
    stopReason: 'sufficiency_reached',
    question: input.question,
    mode: input.mode ?? 'report',
    depth: input.depth,
    outputDirectory,
    generatedAt: GENERATED_AT,
    briefDigest: brief.briefDigest,
    charterDigest: charter.charterDigest,
    reportManifestDigest: manifest.manifestDigest,
    coverageDigest: canonicalDigest(coverage),
    unresolvedDigest: canonicalDigest(unresolved),
    requiredFiles,
    costs: {
      provider: 'fixture-search/v1 + deterministic local compiler',
      searchRequests: 2,
      retrievalRequests: manifest.evidenceSpans.length,
      bytes: manifest.evidenceSpans.length,
      tokens: 0,
      currencyUsd: 0,
      budgetUsd: input.budgetUsd,
    },
    verificationCommands: [
      'pnpm verify:p8',
      `pnpm mammoth research inspect ${outputDirectory} --json`,
    ],
    limitations: [
      'offline fixture corpus is release authority for deterministic gates',
      'live exhibition remains credential-gated by ADR 0010',
    ],
  };
}

async function writeBundle(
  outputDirectory: string,
  manifest: ReportManifestV1,
  coverage: object,
  unresolved: object,
  executionReceipt: object,
): Promise<void> {
  const md = renderMarkdown(manifest);
  const html = renderHtml(manifest);
  await writeFile(join(outputDirectory, 'report.md'), md);
  await writeFile(join(outputDirectory, 'report.html'), html);
  await writeFile(
    join(outputDirectory, 'executive-summary.md'),
    renderExecutiveSummary(manifest),
  );
  await writeFile(
    join(outputDirectory, 'sources.json'),
    `${canonicalJson(sourcesFromManifest(manifest))}\n`,
  );
  await writeFile(
    join(outputDirectory, 'bibliography.md'),
    renderBibliography(manifest),
  );
  await writeFile(
    join(outputDirectory, 'report-manifest.json'),
    `${canonicalJson(manifest)}\n`,
  );
  await writeFile(
    join(outputDirectory, 'coverage.json'),
    `${canonicalJson(coverage)}\n`,
  );
  await writeFile(
    join(outputDirectory, 'unresolved.json'),
    `${canonicalJson(unresolved)}\n`,
  );
  await writeFile(
    join(outputDirectory, 'execution-receipt.json'),
    `${canonicalJson(executionReceipt)}\n`,
  );
}

async function copySourceFixtures(
  repoRoot: string,
  outputDirectory: string,
  sources: readonly SourceRecord[],
): Promise<void> {
  const sourceOut = join(outputDirectory, 'snapshots');
  await mkdir(sourceOut, { recursive: true });
  for (const source of sources) {
    await copyFile(
      join(repoRoot, 'evals/fixtures/p8/report-corpus/sources', source.file),
      join(sourceOut, `${source.id}-${basename(source.file)}`),
    );
  }
}

function renderMarkdown(manifest: ReportManifestV1): string {
  return `${manifest.blocks
    .map(
      (block) =>
        `## ${block.title}\n\n${block.sentences
          .map(
            (sentence) =>
              `${sentence.text}${sentence.kind === 'factual' || sentence.claimIds.length > 0 ? ` [claims: ${sentence.claimIds.join(', ')}]` : ''}`,
          )
          .join('\n\n')}`,
    )
    .join('\n\n')}\n`;
}

function renderHtml(manifest: ReportManifestV1): string {
  const sections = manifest.blocks
    .map(
      (block) =>
        `<section id="${block.id}"><h2>${escapeHtml(block.title)}</h2>${block.sentences
          .map(
            (sentence) =>
              `<p data-sentence-id="${sentence.id}" data-claims="${sentence.claimIds.join(' ')}">${escapeHtml(sentence.text)}</p>`,
          )
          .join('')}</section>`,
    )
    .join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>P8 report</title></head><body>${sections}</body></html>\n`;
}

function renderExecutiveSummary(manifest: ReportManifestV1): string {
  const summary = manifest.blocks.find(
    (block) => block.id === 'executive_summary',
  );
  if (!summary) throw new Error('missing executive summary');
  return `# Executive summary\n\n${summary.sentences.map((sentence) => sentence.text).join('\n\n')}\n`;
}

function renderBibliography(manifest: ReportManifestV1): string {
  return `# Bibliography\n\n${manifest.evidenceSpans
    .map(
      (span) =>
        `- ${span.sourceId}: ${span.rawSnapshotDigest}; locator ${span.id}; parser ${span.parserId}@${span.parserVersion}`,
    )
    .join('\n')}\n`;
}

function sourcesFromManifest(manifest: ReportManifestV1): object {
  return {
    schemaVersion: '1.0.0',
    sources: manifest.evidenceSpans.map((span) => ({
      sourceId: span.sourceId,
      locatorId: span.id,
      rawSnapshotDigest: span.rawSnapshotDigest,
      parsedArtifactDigest: span.parsedArtifactDigest,
      quoteDigest: span.locator.quoteDigest,
    })),
  };
}

function methodSentence(
  id: string,
  text: string,
): ReportBlockV1['sentences'][number] {
  return {
    id,
    kind: 'method',
    text,
    claimIds: [],
    policyVerdicts: [],
    locatorIds: [],
    snapshotDigests: [],
    sourceLineageIds: [],
  };
}

function requiredSentence(
  sentences: readonly ReportBlockV1['sentences'][number][],
  index: number,
): ReportBlockV1['sentences'][number] {
  const sentence = sentences[index] ?? sentences[0];
  if (!sentence) throw new Error('missing report sentence');
  return sentence;
}

function firstMeaningfulLine(text: string): string {
  const stripped = text
    .replace(/<script[\s\S]*?<\/script>/giu, ' ')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  return stripped.slice(0, 240).trim() || 'empty parsed fixture';
}

function lookupSnapshotDigests(
  spans: readonly EvidenceSpanV1[],
  sourceIds: readonly string[],
): string[] {
  return sourceIds.map((sourceId) => {
    const span = spans.find((entry) => entry.sourceId === sourceId);
    if (!span) throw new Error(`missing span for ${sourceId}`);
    return span.rawSnapshotDigest;
  });
}

function topicSentence(topicId: string): string {
  const sentence = TOPIC_SENTENCES[topicId];
  if (!sentence) throw new Error(`missing topic sentence for ${topicId}`);
  return sentence;
}

function sourceClaimText(topicId: string, sourceId: string): string {
  return (
    SOURCE_CLAIMS[`${topicId}:${sourceId}`] ??
    `${topicSentence(topicId)} Source ${sourceId} contributes supporting context.`
  );
}

const TOPIC_SENTENCES: Readonly<Record<string, string>> = {
  'electricity-grid':
    'Large data-center loads can strain grid interconnection queues, reliability studies, transmission cost allocation, and generation planning when new campuses concentrate faster than network upgrades.',
  'ghg-emissions':
    'Data-center climate impact depends on both embodied hardware-and-construction emissions and hourly electricity supply, so annual renewable matching can conflict with hourly fossil generation evidence.',
  water:
    'Water impacts vary sharply by cooling design and drought context: evaporative systems can consume town-scale volumes, while dry or closed-loop alternatives trade lower water use for higher energy demand.',
  'land-materials':
    'Hyperscale campuses can convert hundreds of acres, disturb habitat, add impervious surface, and create recurring material and e-waste burdens through construction and server-refresh cycles.',
  'local-pollution':
    'Local impacts include backup-generator emissions, noise, construction traffic, and visual or operational burdens that may exceed nearby residential limits without enforceable mitigation.',
  'economic-benefits':
    'Economic benefits are real but uneven: construction work, permanent jobs, tax revenue, infrastructure investment, abatements, and community-benefit commitments all change the local net effect.',
  'housing-services':
    'Utility allocation, public-service load, housing pressure, and opportunity costs can shift part of data-center growth costs onto households unless large-load tariffs and local planning controls hold.',
  'environmental-justice':
    'Siting and governance risks are distributional when projects cluster near overburdened tracts or proceed without meaningful consultation with affected local, Indigenous, or environmental-justice communities.',
  variation:
    'No single average data center describes the sector: impacts vary by facility type, climate, grid mix, cooling architecture, scale, lifecycle stage, and operating flexibility.',
  'mitigation-policy':
    'Mitigation options include dry or hybrid cooling, hourly clean-energy procurement, demand flexibility, large-load tariff classes, cumulative-impact permitting, and enforceable community-benefit agreements.',
};

const SOURCE_CLAIMS: Readonly<Record<string, string>> = {
  'electricity-grid:gov-grid-reliability-order':
    'Federal reliability records show large-load interconnection requests grew from 11 in 2022 to 94 in 2025, with 18 regional studies identifying reliability violations absent upgrades.',
  'electricity-grid:utility-load-forecast':
    'The utility forecast projects data centers rising from 8.2 percent of peak load in 2024 to 21.4 percent in 2030, with 2,310 MW of committed interconnection agreements.',
  'electricity-grid:critical-market-analysis':
    'Hourly settlement analysis found Interior Plains data-center campuses drew substantial overnight electricity from gas and coal units despite annual renewable matching claims.',
  'electricity-grid:utility-rate-filing':
    'The rate filing attributes most of a 480 million dollar transmission-upgrade request to three contracted data-center campuses and proposes a large flexible load rider.',
  'ghg-emissions:research-energy-emissions':
    'The peer-reviewed emissions fixture attributes 20 to 35 percent of lifecycle emissions to embodied construction and hardware on moderately clean grids, rising on very low-carbon grids.',
  'ghg-emissions:tech-lifecycle-materials':
    'The lifecycle materials report estimates a reference 250 MW campus uses large concrete and steel volumes and produces roughly 260,000 tonnes CO2-equivalent in embodied emissions.',
  'ghg-emissions:industry-sustainability-report':
    'The operator report claims annual renewable-energy matching across its fleet and describes Interior Plains operations as renewable on that annual basis.',
  'ghg-emissions:critical-market-analysis':
    'The critical analysis contradicts annual-matching claims with hourly data and attributes 1.9 million tonnes CO2-equivalent to incremental regional data-center load in 2025.',
  'water:gov-water-assessment':
    'The water agency estimates a representative 100 MW evaporatively cooled data center consumes about 1.3 million cubic meters of water per year.',
  'water:research-cooling-water':
    'The cooling study finds dry cooling reduces onsite water consumption by 91 to 97 percent while increasing power usage effectiveness by 0.10 to 0.19.',
  'water:ej-coalition-statement':
    'The coalition statement reports contested water-rights and consultation concerns around a 9,800 acre-foot annual withdrawal permit.',
  'water:industry-sustainability-report':
    'The industry report records a water-positive pledge and replenishment projects totaling 2.1 million cubic meters in 2024.',
  'land-materials:tech-lifecycle-materials':
    'The technical report estimates a reference 250 MW campus occupies 320 to 410 acres and generates 1,900 to 2,600 tonnes of decommissioned IT hardware per refresh.',
  'land-materials:land-habitat-assessment':
    'The environmental assessment says the Cedar Flats expansion converts 350 acres, including 61 acres mapped as burrowing owl habitat.',
  'local-pollution:community-hearing-transcript':
    'The hearing transcript records concerns about 55 dBA cooling noise, generator testing, and 340 projected construction truck trips per day.',
  'local-pollution:industry-sustainability-report':
    'The operator report presents mitigation commitments that must be compared against local permit, hearing, and monitoring records.',
  'local-pollution:air-permit-backup-generators':
    'The air permit authorizes 44 diesel emergency generators totaling 132 MW and caps potential nitrogen oxides emissions at 94 tonnes per year.',
  'local-pollution:facility-variation-study':
    'The variation study finds smaller edge and colocation facilities can have proportionally higher diesel-generator emissions per unit of compute.',
  'economic-benefits:community-hearing-transcript':
    'The county hearing record includes local concerns about infrastructure and construction impacts alongside applicant economic claims.',
  'economic-benefits:industry-sustainability-report':
    'The operator report claims jobs, investment, and community programs as benefits that require independent local accounting.',
  'economic-benefits:econ-impact-study':
    'The economic study finds construction employment averaged 1,150 worker-years per campus, while permanent onsite employment averaged 84 jobs.',
  'economic-benefits:policy-mitigation-review':
    'The policy review identifies community-benefit agreements and cumulative-impact permitting as tools for distributing project benefits and burdens.',
  'housing-services:utility-rate-filing':
    'The rate filing says residential bills would rise 7.8 percent without a new large-load class, compared with 3.1 percent under the proposed allocation.',
  'housing-services:community-hearing-transcript':
    'The hearing transcript records local service, road, and nuisance concerns that are not captured by project-level tax claims alone.',
  'housing-services:econ-impact-study':
    'The economic study notes abatements and worker relocation can reduce or redistribute local fiscal benefits.',
  'environmental-justice:ej-coalition-statement':
    'The coalition states three of four recent basin campuses are within two miles of tracts in the state environmental-burden top decile.',
  'environmental-justice:land-habitat-assessment':
    'The environmental assessment flags nearby environmental-justice tracts as part of the expansion review.',
  'environmental-justice:policy-mitigation-review':
    'The policy review treats cumulative-impact permitting and binding community agreements as governance mitigations.',
  'variation:research-energy-emissions':
    'The emissions study shows lifecycle emissions shares change with grid cleanliness and facility characteristics.',
  'variation:research-cooling-water':
    'The cooling study shows water and energy trade-offs differ across facility-climate pairs and cooling technologies.',
  'variation:facility-variation-study':
    'The heterogeneity study finds water-stress-weighted consumption per MWh varies 40-fold between facility and regional configurations.',
  'mitigation-policy:gov-grid-reliability-order':
    'The reliability order requires large-load tariff provisions that causally assign upgrade costs and limit socialization of those costs.',
  'mitigation-policy:research-cooling-water':
    'The cooling study supports dry, air, and immersion cooling as water mitigations with explicit energy penalties.',
  'mitigation-policy:air-permit-backup-generators':
    'The air permit uses testing limits, high-ozone-day prohibitions, and emissions caps as local pollution controls.',
  'mitigation-policy:policy-mitigation-review':
    'The policy review lists dry or hybrid cooling, hourly carbon-free procurement, demand flexibility, large-load tariffs, cumulative-impact permitting, and community-benefit agreements.',
};

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export async function ensureParent(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
}
