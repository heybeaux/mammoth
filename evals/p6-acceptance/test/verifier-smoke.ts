import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  P6_FIXTURE_MANIFEST,
  P6_GATES,
  REQUIRED_P6_CASES,
  verifyP6,
  verifyP6FixtureManifest,
  type P6VerifierDependencies,
} from '../src/verifier.js';

const repository = repositoryRoot();
const firstGate = P6_GATES.at(0);
if (firstGate === undefined) throw new Error('P6 gate registry is empty');

await runsExecutableGates();
await failsClosedOnMissingOrRedGate();
await rejectsDuplicateGateIdentifiers();
await freezesFixtureMatrix();

async function runsExecutableGates(): Promise<void> {
  const commands: string[] = [];
  const dependencies: P6VerifierDependencies = {
    exists: () => Promise.resolve(true),
    validateTarget: () => Promise.resolve(undefined),
    run: (command) => {
      commands.push(command.join(' '));
      return Promise.resolve({ exitCode: 0 });
    },
  };

  const result = await verifyP6(repository, dependencies);

  assert.equal(result.ok, true);
  assert.deepEqual(commands, [
    'pnpm exec tsx evals/p6-acceptance/test/verifier-smoke.ts',
    'pnpm --filter @mammoth/domain test',
    'pnpm --filter @mammoth/workflow test',
    'pnpm --filter @mammoth/persistence test',
    'pnpm --filter @mammoth/postgres-adapter test',
    'pnpm --filter @mammoth/production-profile test',
    'pnpm --filter @mammoth/temporal-adapter test',
    'pnpm --filter @mammoth/report-compiler test',
    'pnpm --filter @mammoth/observatory-projection test',
  ]);
  assert.equal(
    result.gates.every(({ status }) => status === 'passed'),
    true,
  );
  const caseIds = result.gates.flatMap(({ caseIds }) => caseIds ?? []);
  for (const required of REQUIRED_P6_CASES)
    assert.ok(caseIds.includes(required));
}

async function failsClosedOnMissingOrRedGate(): Promise<void> {
  const missing: P6VerifierDependencies = {
    exists: () => Promise.resolve(false),
    validateTarget: () => Promise.resolve(undefined),
    run: () => Promise.resolve({ exitCode: 0 }),
  };
  assert.equal((await verifyP6(repository, missing)).ok, false);

  const red: P6VerifierDependencies = {
    exists: () => Promise.resolve(true),
    validateTarget: () => Promise.resolve(undefined),
    run: () => Promise.resolve({ exitCode: 1, diagnostic: 'injected failure' }),
  };
  const redResult = await verifyP6(repository, red);
  assert.equal(redResult.ok, false);
  assert.equal(
    redResult.gates
      .filter(({ command }) => command !== undefined)
      .every(({ status, diagnostic }) => {
        return status === 'failed' && diagnostic === 'injected failure';
      }),
    true,
  );
}

async function rejectsDuplicateGateIdentifiers(): Promise<void> {
  await assert.rejects(
    () =>
      verifyP6(
        repository,
        {
          exists: () => Promise.resolve(true),
          validateTarget: () => Promise.resolve(undefined),
          run: () => Promise.resolve({ exitCode: 0 }),
        },
        [firstGate, firstGate],
      ),
    /P6_VERIFIER_DUPLICATE_GATE/,
  );
}

async function freezesFixtureMatrix(): Promise<void> {
  await verifyP6FixtureManifest(repository);
  const root = await mkdtemp(join(tmpdir(), 'mammoth-p6-manifest-'));
  try {
    const target = join(root, P6_FIXTURE_MANIFEST);
    await mkdir(dirname(target), { recursive: true });
    const source = JSON.parse(
      await readFile(join(repository, P6_FIXTURE_MANIFEST), 'utf8'),
    ) as { cases: { id: string }[] };
    source.cases = source.cases.filter(({ id }) => id !== REQUIRED_P6_CASES[0]);
    await writeFile(target, JSON.stringify(source));
    await assert.rejects(
      () => verifyP6FixtureManifest(root),
      /P6_FIXTURE_MANIFEST_DRIFT/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function repositoryRoot(): string {
  return new URL('../../..', import.meta.url).pathname;
}
