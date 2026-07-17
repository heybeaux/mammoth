/**
 * End-to-end acceptance proof for governed offline execution: an ARBITRARY
 * question (not part of any fixture corpus) flows through the public
 * `mammoth investigate --execute` path — preview, recorded approval, immutable
 * plan, derived intents, release under an explicitly pinned trusted issuer,
 * governed no-effect execution — and yields a readable cited reader report
 * plus a complete audit projection that satisfies the frozen outcome-1
 * reader/audit bundle contract. Negative paths prove the same command fails
 * closed: an unpinned or wrongly pinned issuer refuses and executes nothing.
 * No step performs any network, provider, or paid effect.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { loadOutcome1Manifest } from '../src/fixtures.js';
import { verifyOutcome1ReaderAuditBundle } from '../src/verifier.js';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, '../../..');
const fixtureRoot = resolve(repositoryRoot, 'evals/fixtures/outcome-1');
const manifest = await loadOutcome1Manifest(fixtureRoot);

const OFFLINE_FIXTURE_ISSUER_ID = 'offline-fixture-issuer/v1';
const ARBITRARY_QUESTION =
  'Which maintenance practices keep a volunteer-run mountain hut water system safe through freeze-thaw cycles without full-time staff?';

const CATALOG = {
  schemaVersion: '1.0.0',
  catalogId: 'outcome1-e2e-catalog/v1',
  sourceClasses: [
    { sourceClass: 'primary', minimumIndependentSources: 1, mandatory: true },
    {
      sourceClass: 'secondary',
      minimumIndependentSources: 1,
      mandatory: false,
    },
  ],
  sources: [
    {
      url: 'https://hutassociation.example.org/reports/water-system-audit',
      sourceClass: 'primary',
      title: 'Hut water system audit',
      mediaType: 'text/plain',
      body: 'The association audit found that huts draining their supply lines before the first hard frost reported no burst fittings over three seasons. Huts relying on heat tape alone recorded four failures in the same period. Auditors recommended a written pre-winter checklist signed by the closing volunteer.',
    },
    {
      url: 'https://fieldguides.example.org/manuals/seasonal-plumbing',
      sourceClass: 'secondary',
      title: 'Seasonal plumbing manual',
      mediaType: 'text/plain',
      body: 'The seasonal manual states that gravity-fed systems tolerate freeze cycles when storage tanks are kept below half capacity and vents remain clear. Spring recommissioning with a documented flush and disinfection step preceded every season without a boil notice in the surveyed group.',
    },
    {
      url: 'https://volunteers.example.org/logs/rotation-summary',
      sourceClass: 'secondary',
      title: 'Volunteer rotation summary',
      mediaType: 'text/plain',
      body: 'Rotation logs show that pairing each new volunteer with an experienced closer halved missed checklist items in the first year. Simple laminated instructions at the intake valve reduced reopening mistakes reported by weekend crews.',
    },
  ],
};

interface CliResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function runInvestigate(args: readonly string[]): Promise<CliResult> {
  try {
    const result = await execFileAsync(
      process.execPath,
      [
        '--import',
        'tsx',
        resolve(repositoryRoot, 'apps/cli/src/bin.ts'),
        'investigate',
        ...args,
      ],
      { cwd: repositoryRoot, timeout: 60_000, env: { ...process.env } },
    );
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failed = error as {
      readonly code?: number;
      readonly stdout?: string;
      readonly stderr?: string;
    };
    return {
      exitCode: failed.code ?? 1,
      stdout: failed.stdout ?? '',
      stderr: failed.stderr ?? '',
    };
  }
}

function machineOutput(result: CliResult): Record<string, unknown> {
  const parsed = `${result.stdout}\n${result.stderr}`
    .split('\n')
    .filter(Boolean)
    .reverse()
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return undefined;
      }
    })
    .find((value) => value !== undefined);
  assert.ok(parsed, 'CLI must emit machine-readable output');
  return parsed;
}

const root = await mkdtemp(join(tmpdir(), 'mammoth-governed-e2e-'));
try {
  const catalogPath = join(root, 'catalog.json');
  await writeFile(catalogPath, `${JSON.stringify(CATALOG, null, 2)}\n`, 'utf8');

  // Positive path: pinned fixture issuer → complete governed offline run.
  const output = join(root, 'run');
  const complete = await runInvestigate([
    '--execute',
    ARBITRARY_QUESTION,
    '--offline-sources',
    catalogPath,
    '--approve',
    '--trusted-issuer',
    OFFLINE_FIXTURE_ISSUER_ID,
    '--output',
    output,
  ]);
  assert.equal(complete.exitCode, 0, complete.stderr);
  const completed = machineOutput(complete);
  assert.equal(completed.status, 'governed_execution_complete');
  assert.equal(completed.decision, 'authorized');
  assert.equal(completed.externalEffectsExecuted, false);
  const bundle = await verifyOutcome1ReaderAuditBundle(output, manifest);
  assert.deepEqual(bundle, { ok: true, failures: [] });
  const report = await readFile(join(output, 'reader/report.md'), 'utf8');
  assert.match(report, /^#\s+/u);
  assert.ok(report.includes('## Direct answer'));
  assert.match(report, /\[\d+\]/u);
  const references = await readFile(
    join(output, 'reader/references.md'),
    'utf8',
  );
  assert.match(references, /^\[\d+\]:\s+https:\/\//mu);

  // Negative path: no pinned issuer → refusal, nothing executed.
  const unpinnedOutput = join(root, 'run-unpinned');
  const unpinned = await runInvestigate([
    '--execute',
    ARBITRARY_QUESTION,
    '--offline-sources',
    catalogPath,
    '--approve',
    '--output',
    unpinnedOutput,
  ]);
  assert.equal(unpinned.exitCode, 0, unpinned.stderr);
  const unpinnedReport = machineOutput(unpinned);
  assert.equal(unpinnedReport.status, 'acquisition_release_refused');
  assert.deepEqual(unpinnedReport.reasonCodes, ['no_trusted_authority_issuer']);
  await assert.rejects(access(join(unpinnedOutput, 'reader')));
  await assert.rejects(access(join(unpinnedOutput, 'execution-receipt.json')));

  // Negative path: wrong pinned issuer → refusal, nothing executed.
  const wrongOutput = join(root, 'run-wrong-issuer');
  const wrong = await runInvestigate([
    '--execute',
    ARBITRARY_QUESTION,
    '--offline-sources',
    catalogPath,
    '--approve',
    '--trusted-issuer',
    'another-issuer/v1',
    '--output',
    wrongOutput,
  ]);
  assert.equal(wrong.exitCode, 0, wrong.stderr);
  const wrongReport = machineOutput(wrong);
  assert.equal(wrongReport.status, 'acquisition_release_refused');
  assert.deepEqual(wrongReport.reasonCodes, ['untrusted_authority_issuer']);
  await assert.rejects(access(join(wrongOutput, 'reader')));
} finally {
  await rm(root, { recursive: true, force: true });
}

process.stdout.write(
  `${JSON.stringify({
    status: 'passed',
    harness: 'outcome-1-governed-execution-e2e.v1',
  })}\n`,
);
