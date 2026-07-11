import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { verifyRuntimeBridge } from '../src/verify-runtime.js';

void test('executes the checked fixture through runtime and independently verifies outputs', async () => {
  const output = await mkdtemp(join(tmpdir(), 'mammoth-m2-output-'));
  const result = await verifyRuntimeBridge(undefined, output);
  assert.equal(result.fixtureId, 'mvp-public-rfc2606-v1');
  assert.deepEqual(result.supportedClaimIds, ['claim:example-com-reserved']);
  assert.deepEqual(result.nonSupportedClaimIds, [
    'claim:example-com-https-guarantee',
  ]);
  assert.equal(result.transportCalls, 1);
  assert.equal(result.traceCount, 1);
});

void test('verifier rejects a runtime artifact changed after execution', async () => {
  const output = await mkdtemp(join(tmpdir(), 'mammoth-m2-tamper-'));
  const first = await verifyRuntimeBridge(undefined, output);
  const report = join(first.programDirectory, 'dossier.md');
  await writeFile(report, `${await readFile(report, 'utf8')}fabricated fact\n`);
  // A completed runtime is reused, so independent verification must still reject
  // the modified artifact against its receipt rather than trusting completion.
  await assert.rejects(
    verifyRuntimeBridge(undefined, output),
    /receipt report digest failed/,
  );
});
