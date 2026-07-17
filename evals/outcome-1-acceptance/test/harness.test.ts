import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { loadOutcome1Corpus, loadOutcome1Manifest } from '../src/fixtures.js';
import {
  normalizeFingerprint,
  scanCrossFixtureLeakage,
  scanOutcome1GenericSources,
} from '../src/no-hardcoding.js';
import { verifyOutcome1ReaderAuditBundle } from '../src/verifier.js';

const repositoryRoot = resolve(import.meta.dirname, '../../..');
const fixtureRoot = resolve(repositoryRoot, 'evals/fixtures/outcome-1');
const manifest = await loadOutcome1Manifest(fixtureRoot);

assert.equal(manifest.cases.length, 4);
for (const fixtureCase of manifest.cases) {
  const corpus = await loadOutcome1Corpus(fixtureRoot, fixtureCase);
  assert.equal(corpus.caseId, fixtureCase.caseId);
  assert.ok(corpus.sources.length >= 3);
  assert.ok(corpus.contradictionPairs.length >= 1);
}

assert.equal(
  normalizeFingerprint('Single-consumer_GPU'),
  normalizeFingerprint('single consumer gpu'),
);
assert.deepEqual(
  scanCrossFixtureLeakage(manifest, {
    'world-model-local': 'This accidentally contains moth_canary_d2e6.',
  }).map(({ path }) => path),
  ['world-model-local'],
);

const scanRoot = await mkdtemp(join(tmpdir(), 'mammoth-outcome1-scan-'));
try {
  for (const target of manifest.genericSourceTargets) {
    const path = resolve(scanRoot, target);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, 'export const generic = true;\n', 'utf8');
  }
  assert.deepEqual(await scanOutcome1GenericSources(scanRoot, manifest), []);
  await writeFile(
    resolve(scanRoot, manifest.genericSourceTargets[0] ?? ''),
    'const hidden = "SINGLE_consumer---GPU";\n',
    'utf8',
  );
  const findings = await scanOutcome1GenericSources(scanRoot, manifest);
  assert.ok(
    findings.some(({ fingerprint }) => fingerprint === 'single consumer GPU'),
  );
} finally {
  await rm(scanRoot, { recursive: true, force: true });
}

const bundleRoot = await mkdtemp(join(tmpdir(), 'mammoth-outcome1-bundle-'));
try {
  const sha256 = (value: string) =>
    `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
  const authority = {
    runId: 'run:harness',
    authoritativeRevision: 7,
    planDigest: `sha256:${'a'.repeat(64)}`,
  };
  const artifactContents: Record<string, string> = {
    'reader/report.md':
      '# Fixture result\n\n## Direct answer\n\nThe bounded fixture supports a cautious first test [1].\n',
    'reader/references.md':
      '[1]: https://fixtures.mammoth.invalid/primary-source\n',
    'audit/problem-contract.json': '{}\n',
    'audit/team-plan.json': '{}\n',
    'audit/research-plan.json': '{}\n',
    'audit/retrieval-attempts.jsonl': '{"status":"admitted"}\n',
    'audit/parser-receipts.jsonl': '{"status":"parsed"}\n',
    'audit/claim-admissions.jsonl':
      '{"claimId":"claim-1","decision":"admitted"}\n',
    'audit/rejected-claims.jsonl':
      '{"claimId":"claim-rejected","reason":"insufficient"}\n',
    'audit/contradictions.jsonl': '{"contradictionId":"contra-1"}\n',
    'audit/model-work.jsonl': '{"workId":"work-1"}\n',
    'audit/budget-journal.jsonl': '{"effect":"none"}\n',
  };
  artifactContents['reader/projection.json'] = `${JSON.stringify({
    schemaVersion: '1.0.0',
    ...authority,
    reportDigest: sha256(artifactContents['reader/report.md'] ?? ''),
    referencesDigest: sha256(artifactContents['reader/references.md'] ?? ''),
    factualSentences: [
      {
        sentenceId: 'sentence-1',
        text: 'The bounded fixture supports a cautious first test.',
        claimIds: ['claim-1'],
      },
    ],
  })}\n`;
  artifactContents['audit/manifest.json'] = `${JSON.stringify({
    schemaVersion: '1.0.0',
    ...authority,
    readerProjectionDigest: sha256(
      artifactContents['reader/projection.json'] ?? '',
    ),
  })}\n`;
  const artifactDigests = Object.fromEntries(
    Object.entries(artifactContents).map(([name, content]) => [
      name,
      sha256(content),
    ]),
  );
  artifactContents['execution-receipt.json'] = `${JSON.stringify({
    schemaVersion: '1.0.0',
    ...authority,
    artifactDigests,
  })}\n`;
  for (const [name, content] of Object.entries(artifactContents)) {
    const path = resolve(bundleRoot, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, 'utf8');
  }
  assert.deepEqual(
    await verifyOutcome1ReaderAuditBundle(bundleRoot, manifest),
    { ok: true, failures: [] },
  );
  await writeFile(
    resolve(bundleRoot, 'reader/report.md'),
    `${await readFile(resolve(bundleRoot, 'reader/report.md'), 'utf8')}tampered\n`,
    'utf8',
  );
  const tampered = await verifyOutcome1ReaderAuditBundle(bundleRoot, manifest);
  assert.equal(tampered.ok, false);
  assert.ok(
    tampered.failures.includes('reader_projection_digest_mismatch') ||
      tampered.failures.includes(
        'execution_receipt_digest_mismatch:reader/report.md',
      ),
  );
} finally {
  await rm(bundleRoot, { recursive: true, force: true });
}

process.stdout.write(
  `${JSON.stringify({ status: 'passed', cases: manifest.cases.length, harness: 'outcome-1.v1' })}\n`,
);
