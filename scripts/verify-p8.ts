import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  p8IdentityDigest,
  ReportManifestV1Schema,
} from '../packages/domain/src/index.js';
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
      },
    };
  } finally {
    await rm(temp, { recursive: true, force: true });
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
