import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  p8IdentityDigest,
  ReportManifestV1Schema,
} from '../packages/domain/src/index.js';
import { executeP8ResearchCli } from '../apps/cli/src/p8-operator.js';
import { runP8TurnkeyResearch } from '../packages/runtime/src/index.js';

const repoRoot = resolve(process.cwd());

interface P8VerifierResult {
  readonly ok: boolean;
  readonly verifier: 'mammoth-p8-acceptance-v1';
  readonly outputDirectory: string;
  readonly manifestDigest: string;
  readonly checks: Record<string, boolean>;
  readonly failures: Record<string, readonly string[]>;
}

try {
  const result = await verifyP8(repoRoot);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ok) process.exitCode = 1;
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({
      ok: false,
      verifier: 'mammoth-p8-acceptance-v1',
      failure: 'P8_VERIFIER_UNEXPECTED',
      message: error instanceof Error ? error.message : String(error),
    })}\n`,
  );
  process.exitCode = 1;
}

export async function verifyP8(root: string): Promise<P8VerifierResult> {
  const temp = await mkdtemp(join(tmpdir(), 'mammoth-p8-verify-'));
  const restoredEnvironment = forceOfflineP8Environment();
  try {
    const output = join(temp, 'data-center-impacts');
    const summary = await runP8TurnkeyResearch({
      question:
        'What impacts do data centers have on the communities and environment around them?',
      depth: 'comprehensive',
      budgetUsd: 20,
      outputDirectory: output,
      fixturesRoot: root,
    });
    const expected = await readJson<{
      readonly reportMode: {
        readonly reportBundle: { readonly requiredFiles: readonly string[] };
        readonly admissions: {
          readonly expectedAdmittedSourceIds: readonly string[];
        };
      };
    }>(join(root, 'evals/fixtures/p8/expected-artifacts.json'));
    for (const file of expected.reportMode.reportBundle.requiredFiles) {
      await access(join(output, file));
    }
    const manifest = ReportManifestV1Schema.parse(
      await readJson<unknown>(join(output, 'report-manifest.json')),
    );
    const coverage = await readJson<{
      readonly mandatoryTopics: readonly {
        readonly topicId: string;
        readonly status: string;
        readonly admittedSupportingClaims: number;
        readonly independentSourceFamilies: readonly string[];
      }[];
      readonly cycles: readonly {
        readonly decision: string;
        readonly reason: string;
      }[];
    }>(join(output, 'coverage.json'));
    const unresolved = await readJson<{
      readonly contradictions: readonly unknown[];
      readonly rejectedResidue: readonly { readonly namedReason: string }[];
      readonly limitations: readonly string[];
    }>(join(output, 'unresolved.json'));
    const receipt = await readJson<{
      readonly reportManifestDigest: string;
      readonly verificationCommands: readonly string[];
      readonly costs: { readonly currencyUsd: number };
    }>(join(output, 'execution-receipt.json'));

    const factualSentences = manifest.blocks.flatMap((block) =>
      block.sentences.filter((sentence) => sentence.kind === 'factual'),
    );
    const unsupported = factualSentences.filter(
      (sentence) =>
        sentence.claimIds.length === 0 ||
        sentence.policyVerdicts.length === 0 ||
        sentence.locatorIds.length === 0 ||
        sentence.snapshotDigests.length === 0 ||
        sentence.sourceLineageIds.length === 0,
    );
    const topicFailures = coverage.mandatoryTopics.filter(
      (topic) =>
        topic.status !== 'sufficient' ||
        topic.admittedSupportingClaims < 2 ||
        topic.independentSourceFamilies.length < 2,
    );
    const followUp = coverage.cycles.some(
      (cycle) =>
        cycle.decision === 'continue' &&
        cycle.reason.includes('housing-services gap'),
    );
    const sourceIds = new Set(
      manifest.evidenceSpans.map((span) => span.sourceId),
    );
    const missingAdmitted =
      expected.reportMode.admissions.expectedAdmittedSourceIds.filter(
        (sourceId) => !sourceIds.has(sourceId),
      );
    const markdown = await readFile(join(output, 'report.md'), 'utf8');
    const html = await readFile(join(output, 'report.html'), 'utf8');
    const renderedMissing = manifest.blocks
      .flatMap((block) => block.sentences)
      .filter(
        (sentence) =>
          !markdown.includes(sentence.text) ||
          !html.includes(escapeForHtmlCheck(sentence.text)),
      );
    const factualTexts = factualSentences.map((sentence) => sentence.text);
    const duplicateFactualSentenceRatio =
      factualTexts.length === 0
        ? 0
        : (factualTexts.length - new Set(factualTexts).size) /
          factualTexts.length;
    const thresholds = await readJson<{
      readonly readability: {
        readonly maxDuplicateFactualSentenceRatio: number;
      };
    }>(join(root, 'evals/fixtures/p8/thresholds.json'));
    const words = markdown
      .split(/\s+/u)
      .map((word) => word.trim())
      .filter((word) => word.length > 0);
    const spanCountsBySource = new Map<string, number>();
    for (const span of manifest.evidenceSpans) {
      spanCountsBySource.set(
        span.sourceId,
        (spanCountsBySource.get(span.sourceId) ?? 0) + 1,
      );
    }
    const thinSources = [...spanCountsBySource.entries()]
      .filter(([, count]) => count < 3)
      .map(([sourceId]) => sourceId);
    const spanById = new Map(
      manifest.evidenceSpans.map((span) => [span.id, span]),
    );
    const claimById = new Map(
      manifest.claims.map((claim) => [claim.id, claim]),
    );
    const claimBoundSentences = manifest.blocks.flatMap((block) =>
      block.sentences.filter((sentence) => sentence.claimIds.length > 0),
    );
    const provenanceMismatches = claimBoundSentences.filter((sentence) =>
      sentence.claimIds.some((claimId) => {
        const claim = claimById.get(claimId);
        return (
          !claim ||
          claim.evidenceSpanIds.some(
            (spanId) =>
              !sentence.locatorIds.includes(spanId) || !spanById.has(spanId),
          )
        );
      }),
    );
    const sectionWordCounts = new Map(
      manifest.blocks.map((block) => [
        block.id,
        block.sentences
          .flatMap((sentence) => sentence.text.split(/\s+/u))
          .filter(Boolean).length,
      ]),
    );
    const thinSections = [
      ['environmental_effects', 500],
      ['community_economic_effects', 240],
      ['distributional_environmental_justice', 180],
      ['benefits_counterarguments', 180],
      ['context_comparison', 180],
      ['mitigations_policy_options', 220],
      ['conflicts_uncertainties_gaps', 140],
    ].filter(
      ([sectionId, minimum]) =>
        (sectionWordCounts.get(String(sectionId)) ?? 0) < Number(minimum),
    );
    const forbiddenBoilerplate = [
      /admitted source/giu,
      /exact locator quote/giu,
      /source-bound finding/giu,
      /raw snapshot digest/giu,
      /lineage family/giu,
      /sha256:/giu,
      /\bTj\b|\bT\*\b|\/F\d+|endstream/giu,
    ];
    const boilerplateHits = forbiddenBoilerplate.flatMap(
      (pattern) => markdown.match(pattern) ?? [],
    );
    const repeatedLeadPhrases = [
      'A complementary finding adds that',
      'That account is qualified by a competing finding',
    ].filter((phrase) => markdown.split(phrase).length - 1 > 8);
    const malformedFragments = manifest.blocks
      .flatMap((block) => block.sentences)
      .filter(
        (sentence) =>
          sentence.text.trim().length < 20 ||
          /\(\s*\d+\s+percent|\)\s*Tj|\bPublisher:\b|FEDERAL GRID RELIABILITY COMMISSION|Technical Report TR-|\bit (?:have|were|further estimate)\b/iu.test(
            sentence.text,
          ),
      );
    const executive = manifest.blocks.find(
      (block) => block.id === 'executive_summary',
    );
    const executiveText =
      executive?.sentences.map((sentence) => sentence.text).join(' ') ?? '';
    const executiveAnswersQuestion =
      executiveText.split(/\s+/u).length >= 180 &&
      /benefit|jobs?|tax/iu.test(executiveText) &&
      /electricity|grid/iu.test(executiveText) &&
      /water/iu.test(executiveText) &&
      /community|burden/iu.test(executiveText) &&
      /conditional|depends|trade-off/iu.test(executiveText);
    const compactCitationsPresent =
      (markdown.match(/\[\d+(?:, \d+)*\]/gu)?.length ?? 0) >= 20 &&
      markdown.includes('## References');
    const lowerMarkdown = markdown.toLowerCase();
    const requiredContentTerms = [
      'greenhouse',
      'water',
      'cooling',
      'drought',
      'diesel',
      'noise',
      'jobs',
      'tax',
      'residential',
      'environmental justice',
      'habitat',
      'tariff',
      'mitigation',
      'contested',
    ];
    const missingContentTerms = requiredContentTerms.filter(
      (term) => !lowerMarkdown.includes(term),
    );
    const rejectsUnrelatedQuestion = await rejectsP8Ask(root, {
      question: 'Do bananas improve battery storage economics?',
      depth: 'comprehensive',
      budgetUsd: 20,
      outputDirectory: join(temp, 'banana-output'),
      fixturesRoot: root,
    });
    const rejectsExploreMode = await rejectsP8Ask(root, {
      question:
        'What impacts do data centers have on the communities and environment around them?',
      depth: 'standard',
      budgetUsd: 12,
      mode: 'explore',
      outputDirectory: join(temp, 'explore-output'),
      fixturesRoot: root,
    });
    const runIdCommands = await p8RunIdCommands(
      join(temp, 'cli-data-center-impacts'),
      join(temp, 'other-cwd'),
      join(temp, 'run-index'),
    );

    const checks = {
      requiredFilesPresent: true,
      exactProvenanceForFactualSentences: unsupported.length === 0,
      mandatoryTopicsSufficient: topicFailures.length === 0,
      evidenceDrivenFollowUpCycle: followUp,
      admittedSourceCoverage: missingAdmitted.length === 0,
      contradictionsPreserved: unresolved.contradictions.length > 0,
      rejectedResiduePreserved: unresolved.rejectedResidue.length >= 5,
      limitationsVisible: unresolved.limitations.length > 0,
      rendererEquivalence: renderedMissing.length === 0,
      receiptCommandsPresent: receipt.verificationCommands.length > 0,
      zeroFixtureCurrencyCost: receipt.costs.currencyUsd === 0,
      receiptReferencesManifest:
        receipt.reportManifestDigest === manifest.manifestDigest,
      stableReplay: summary.manifestDigest === manifest.manifestDigest,
      canonicalDigestValid:
        p8IdentityDigest('p8-report-manifest', manifest) ===
        manifest.manifestDigest,
      duplicateFactualSentenceRatioWithinThreshold:
        duplicateFactualSentenceRatio <=
        thresholds.readability.maxDuplicateFactualSentenceRatio,
      substantiveWordCount: words.length >= 2500 && words.length <= 5000,
      multipleSpansPerAdmittedSource:
        manifest.evidenceSpans.length >= 30 && thinSources.length === 0,
      modelAssistedClaimDensity: manifest.claims.length >= 40,
      exactClaimSpanBinding: provenanceMismatches.length === 0,
      comprehensiveSectionDepth: thinSections.length === 0,
      noProvenanceBoilerplateInBody: boilerplateHits.length === 0,
      noRepeatedNarrativeTemplates: repeatedLeadPhrases.length === 0,
      noMalformedSourceFragments: malformedFragments.length === 0,
      executiveSummaryAnswersQuestion: executiveAnswersQuestion,
      compactHumanCitationsPresent: compactCitationsPresent,
      requiredDomainContentPresent: missingContentTerms.length === 0,
      unrelatedQuestionRejected: rejectsUnrelatedQuestion,
      exploreModeNotSilentlyDowngraded: rejectsExploreMode,
      returnedRunIdCommandsWorkAcrossCwd: runIdCommands,
    };
    return {
      ok: Object.values(checks).every(Boolean),
      verifier: 'mammoth-p8-acceptance-v1',
      outputDirectory: output,
      manifestDigest: manifest.manifestDigest,
      checks,
      failures: {
        unsupported: unsupported.map((sentence) => sentence.id),
        topicFailures: topicFailures.map((topic) => topic.topicId),
        missingAdmitted,
        renderedMissing: renderedMissing.map((sentence) => sentence.id),
        duplicateFactualSentences:
          duplicateFactualSentenceRatio >
          thresholds.readability.maxDuplicateFactualSentenceRatio
            ? factualTexts.filter(
                (text, index) => factualTexts.indexOf(text) !== index,
              )
            : [],
        thinSources,
        provenanceMismatches: provenanceMismatches.map(
          (sentence) => sentence.id,
        ),
        thinSections: thinSections.map(([sectionId]) => String(sectionId)),
        boilerplateHits,
        repeatedLeadPhrases,
        malformedFragments: malformedFragments.map((sentence) => sentence.id),
        executiveSummary: executiveAnswersQuestion
          ? []
          : ['does_not_directly_answer_question'],
        compactCitations: compactCitationsPresent
          ? []
          : ['missing_or_too_sparse'],
        missingContentTerms,
      },
    };
  } finally {
    restoredEnvironment();
    await rm(temp, { recursive: true, force: true });
  }
}

function forceOfflineP8Environment(): () => void {
  const keys = [
    'MAMMOTH_P8_LIVE_RESEARCH',
    'MAMMOTH_SEARCH_BRAVE_API_KEY',
    'MAMMOTH_SEARCH_BRAVE_BILLING_AUTHORIZATION',
    'MAMMOTH_P8_PROVIDER_BASE_URL',
    'MAMMOTH_P8_PROVIDER_MODEL',
    'MAMMOTH_P8_PROVIDER_API_KEY_ENV',
    'MAMMOTH_P8_PROVIDER_TIMEOUT_MS',
  ] as const;
  const previous = new Map<string, string | undefined>(
    keys.map((key) => [key, process.env[key]]),
  );
  for (const key of keys) Reflect.deleteProperty(process.env, key);
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = value;
    }
  };
}

async function rejectsP8Ask(
  _root: string,
  input: Parameters<typeof runP8TurnkeyResearch>[0],
): Promise<boolean> {
  try {
    await runP8TurnkeyResearch(input);
    return false;
  } catch {
    return true;
  }
}

async function p8RunIdCommands(
  outputDirectory: string,
  otherCwd: string,
  runIndexDirectory: string,
): Promise<boolean> {
  const previousIndexDirectory = process.env.MAMMOTH_P8_RUN_INDEX_DIR;
  const previousCwd = process.cwd();
  process.env.MAMMOTH_P8_RUN_INDEX_DIR = runIndexDirectory;
  const stdout: string[] = [];
  const stderr: string[] = [];
  try {
    const askExitCode = await executeP8ResearchCli(
      [
        'research',
        'ask',
        'What impacts do data centers have on the communities and environment around them?',
        '--depth',
        'comprehensive',
        '--budget-usd',
        '20',
        '--output',
        outputDirectory,
      ],
      {
        stdout: (value) => stdout.push(value),
        stderr: (value) => stderr.push(value),
      },
    );
    if (askExitCode !== 0 || stderr.length > 0) return false;
    const askSummary = JSON.parse(stdout.pop() ?? '{}') as {
      readonly runId?: unknown;
    };
    if (typeof askSummary.runId !== 'string') return false;
    await mkdir(otherCwd, { recursive: true });
    process.chdir(otherCwd);
    const commands = ['status', 'inspect', 'resume', 'cancel', 'export'];
    for (const command of commands) {
      const commandStdout: string[] = [];
      const commandStderr: string[] = [];
      const exitCode = await executeP8ResearchCli(
        ['research', command, askSummary.runId],
        {
          stdout: (value) => commandStdout.push(value),
          stderr: (value) => commandStderr.push(value),
        },
      );
      if (exitCode !== 0 || commandStderr.length > 0) return false;
      const parsed = JSON.parse(commandStdout.join('\n')) as {
        readonly runId?: unknown;
        readonly command?: unknown;
      };
      if (parsed.runId !== askSummary.runId || parsed.command !== command) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  } finally {
    process.chdir(previousCwd);
    if (previousIndexDirectory === undefined) {
      delete process.env.MAMMOTH_P8_RUN_INDEX_DIR;
    } else {
      process.env.MAMMOTH_P8_RUN_INDEX_DIR = previousIndexDirectory;
    }
  }
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

function escapeForHtmlCheck(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
