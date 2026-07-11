import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  defaultFixtureRoot,
  verifyFixtureRoot,
} from '../src/verify-fixture.js';

void test('checked-in fixture has stable bytes, exact locators, and fail-closed outcomes', async () => {
  const result = await verifyFixtureRoot();
  assert.deepEqual(result, {
    fixtureId: 'mvp-public-rfc2606-v1',
    sourceDigests: {
      'evidence:rfc2606-section-3':
        'sha256:02950ec26917b3cf2f613fd1ec16b4d2f8fd376fb9b3aa3e72f881d9d8ecc331',
    },
    supportedClaimIds: ['claim:example-com-reserved'],
    nonSupportedClaimIds: ['claim:example-com-https-guarantee'],
  });
});

void test('verifier rejects snapshot byte drift', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mammoth-mvp-fixture-'));
  await cp(defaultFixtureRoot, root, { recursive: true });
  const path = join(root, 'source-rfc2606.txt');
  await writeFile(path, `${await readFile(path, 'utf8')}tampered\n`);
  await assert.rejects(
    verifyFixtureRoot(root),
    /contentDigest does not match|byteLength does not match/,
  );
});

void test('verifier rejects locator drift even when source bytes remain valid', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mammoth-mvp-fixture-'));
  await cp(defaultFixtureRoot, root, { recursive: true });
  const path = join(root, 'fixture.json');
  const fixture = JSON.parse(await readFile(path, 'utf8')) as {
    expected: { locators: { startOffset: number }[] };
  };
  const locator = fixture.expected.locators[0];
  assert.ok(locator);
  locator.startOffset += 1;
  await writeFile(path, `${JSON.stringify(fixture, null, 2)}\n`);
  await assert.rejects(
    verifyFixtureRoot(root),
    /offset slice does not match exactText/,
  );
});

void test('verifier rejects unknown fixture fields', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mammoth-mvp-fixture-'));
  await cp(defaultFixtureRoot, root, { recursive: true });
  const path = join(root, 'fixture.json');
  const fixture = JSON.parse(await readFile(path, 'utf8')) as Record<
    string,
    unknown
  >;
  fixture.unreviewed = true;
  await writeFile(path, `${JSON.stringify(fixture, null, 2)}\n`);
  await assert.rejects(verifyFixtureRoot(root), /keys must be exactly/);
});
