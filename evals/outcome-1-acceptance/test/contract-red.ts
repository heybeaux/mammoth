import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { loadOutcome1Corpus, loadOutcome1Manifest } from '../src/fixtures.js';
import {
  scanCrossFixtureLeakage,
  scanOutcome1GenericSources,
} from '../src/no-hardcoding.js';
import {
  verifyOutcome1PlanDifferentiation,
  verifyOutcome1Preview,
} from '../src/verifier.js';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, '../../..');
const fixtureRoot = resolve(repositoryRoot, 'evals/fixtures/outcome-1');
const manifest = await loadOutcome1Manifest(fixtureRoot);
const failures: string[] = [];
const renderedByCase: Record<string, string> = {};
const proposalsByCase: Record<string, string> = {};

for (const fixtureCase of manifest.cases) {
  await loadOutcome1Corpus(fixtureRoot, fixtureCase);
  const output = await mkdtemp(
    join(tmpdir(), `mammoth-outcome1-${fixtureCase.caseId}-`),
  );
  try {
    let exitCode = 0;
    let stdout = '';
    let stderr = '';
    try {
      const result = await execFileAsync(
        process.execPath,
        [
          '--import',
          'tsx',
          resolve(repositoryRoot, 'apps/cli/src/bin.ts'),
          'research',
          'investigate',
          fixtureCase.question,
          '--depth',
          'quick',
          '--budget-usd',
          '0',
          '--output',
          output,
        ],
        {
          cwd: repositoryRoot,
          timeout: 30_000,
          env: {
            ...process.env,
            MAMMOTH_OUTCOME1_FIXTURE_ROOT: fixtureRoot,
            MAMMOTH_OUTCOME1_CASE_ID: fixtureCase.caseId,
          },
        },
      );
      stdout = result.stdout;
      stderr = result.stderr;
    } catch (error) {
      const result = error as {
        readonly code?: number;
        readonly stdout?: string;
        readonly stderr?: string;
      };
      exitCode = result.code ?? 1;
      stdout = result.stdout ?? '';
      stderr = result.stderr ?? '';
    }
    if (exitCode !== manifest.expectedPreviewExitCode) {
      failures.push(
        `${fixtureCase.caseId}:preview_exit_expected_${String(manifest.expectedPreviewExitCode)}_got_${String(exitCode)}`,
      );
    }
    const machineOutput = `${stdout}\n${stderr}`
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
    if (machineOutput?.status !== manifest.expectedPreviewStatus) {
      failures.push(`${fixtureCase.caseId}:approval_required_status_missing`);
    }
    const preview = await verifyOutcome1Preview(output, fixtureCase, manifest);
    failures.push(
      ...preview.failures.map((failure) => `${fixtureCase.caseId}:${failure}`),
    );
    try {
      proposalsByCase[fixtureCase.caseId] = await readFile(
        resolve(output, 'research-plan-proposal.json'),
        'utf8',
      );
      renderedByCase[fixtureCase.caseId] = [
        await readFile(resolve(output, 'problem-contract.json'), 'utf8'),
        await readFile(resolve(output, 'team-plan.json'), 'utf8'),
        proposalsByCase[fixtureCase.caseId],
      ].join('\n');
    } catch {
      // Missing preview artifacts are already recorded above.
    }
  } finally {
    await rm(output, { recursive: true, force: true });
  }
}

const differentiation = verifyOutcome1PlanDifferentiation(
  proposalsByCase,
  manifest,
);
failures.push(...differentiation.failures);
for (const finding of scanCrossFixtureLeakage(manifest, renderedByCase)) {
  failures.push(`cross_fixture_leakage:${finding.path}:${finding.fingerprint}`);
}
for (const finding of await scanOutcome1GenericSources(
  repositoryRoot,
  manifest,
)) {
  failures.push(
    `generic_source_${finding.reason}:${finding.path}:${finding.fingerprint}`,
  );
}

if (failures.length > 0) {
  process.stderr.write(
    `${JSON.stringify(
      {
        status: 'red',
        contract: manifest.contractFamily,
        failures,
      },
      null,
      2,
    )}\n`,
  );
  throw new Error(
    `OUTCOME1_CONTRACT_RED: ${String(failures.length)} acceptance predicates failed`,
  );
}

process.stdout.write(
  `${JSON.stringify({ status: 'passed', contract: manifest.contractFamily })}\n`,
);
