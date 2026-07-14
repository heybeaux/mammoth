import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  P7_GATES,
  REQUIRED_P7_CASES,
  verifyP7,
  verifyP7FixtureManifest,
  type P7VerifierDependencies,
} from '../src/verifier.js';

const repository = resolve(import.meta.dirname, '../../..');
await verifyP7FixtureManifest(repository);

const passing: P7VerifierDependencies = {
  exists: () => Promise.resolve(true),
  run: () => Promise.resolve({ exitCode: 0 }),
};
const passed = await verifyP7(repository, passing);
assert.equal(passed.ok, true);
assert.equal(passed.gates.length, P7_GATES.length);
assert.deepEqual(
  [...new Set(passed.gates.flatMap(({ caseIds }) => caseIds))].sort(),
  [...REQUIRED_P7_CASES].sort(),
);

const missing = await verifyP7(repository, {
  ...passing,
  exists: () => Promise.resolve(false),
});
assert.equal(missing.ok, false);
assert.ok(missing.gates.every(({ status }) => status === 'missing'));

const failed = await verifyP7(repository, {
  ...passing,
  run: () => Promise.resolve({ exitCode: 1, diagnostic: 'fixture failure' }),
});
assert.equal(failed.ok, false);
assert.ok(failed.gates.every(({ status }) => status === 'failed'));

const firstGate = P7_GATES[0];
assert.ok(firstGate);
await assert.rejects(
  verifyP7(repository, passing, [firstGate, firstGate]),
  /P7_VERIFIER_DUPLICATE_GATE/,
);

const driftRoot = await mkdtemp(join(tmpdir(), 'mammoth-p7-verifier-'));
try {
  const fixturePath = resolve(
    driftRoot,
    'evals/fixtures/p7/adversarial/manifest.json',
  );
  await mkdir(resolve(fixturePath, '..'), { recursive: true });
  const manifest = JSON.parse(
    await readFile(
      resolve(repository, 'evals/fixtures/p7/adversarial/manifest.json'),
      'utf8',
    ),
  ) as { cases: { id: string }[] };
  manifest.cases = manifest.cases.filter(
    ({ id }) => id !== 'projection-write-attempt',
  );
  await writeFile(fixturePath, JSON.stringify(manifest), 'utf8');
  await assert.rejects(
    verifyP7FixtureManifest(driftRoot),
    /P7_FIXTURE_MANIFEST_DRIFT/,
  );
} finally {
  await rm(driftRoot, { recursive: true, force: true });
}
