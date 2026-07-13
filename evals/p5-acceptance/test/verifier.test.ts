import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  P5_FIXTURE_MANIFEST,
  P5_GATES,
  REQUIRED_P5_CASES,
  verifyP5,
  verifyP5FixtureManifest,
  type P5VerifierDependencies,
} from '../src/verifier.js';

describe('P5 acceptance verifier', () => {
  const firstGate = P5_GATES.at(0);
  if (firstGate === undefined) throw new Error('P5 gate registry is empty');

  it('runs every code-owned gate and requires all to pass', async () => {
    const commands: string[] = [];
    const dependencies: P5VerifierDependencies = {
      exists: () => Promise.resolve(true),
      validateTarget: () => Promise.resolve(undefined),
      run: (command) => {
        commands.push(command.join(' '));
        return Promise.resolve({ exitCode: 0 });
      },
    };
    const result = await verifyP5(repositoryRoot(), dependencies);
    expect(result.ok).toBe(true);
    expect(result.gates).toHaveLength(P5_GATES.length);
    expect(commands).toHaveLength(P5_GATES.length);
    expect(result.gates.flatMap(({ caseIds }) => caseIds ?? [])).toEqual(
      expect.arrayContaining([...REQUIRED_P5_CASES]),
    );
  });

  it('fails closed when a gate target is missing or red', async () => {
    const missing: P5VerifierDependencies = {
      exists: () => Promise.resolve(false),
      validateTarget: () => Promise.resolve(undefined),
      run: () => Promise.resolve({ exitCode: 0 }),
    };
    expect((await verifyP5(repositoryRoot(), missing)).ok).toBe(false);

    const red: P5VerifierDependencies = {
      exists: () => Promise.resolve(true),
      validateTarget: () => Promise.resolve(undefined),
      run: () =>
        Promise.resolve({ exitCode: 1, diagnostic: 'injected failure' }),
    };
    const redResult = await verifyP5(repositoryRoot(), red);
    expect(redResult.ok).toBe(false);
    expect(
      redResult.gates.every(
        ({ status, diagnostic }) =>
          status === 'failed' && diagnostic === 'injected failure',
      ),
    ).toBe(true);
  });

  it('rejects duplicate gate identifiers', async () => {
    await expect(
      verifyP5(
        repositoryRoot(),
        {
          exists: () => Promise.resolve(true),
          validateTarget: () => Promise.resolve(undefined),
          run: () => Promise.resolve({ exitCode: 0 }),
        },
        [firstGate, firstGate],
      ),
    ).rejects.toThrow(/P5_VERIFIER_DUPLICATE_GATE/);
  });

  it('freezes the exact adversarial fixture matrix', async () => {
    await expect(
      verifyP5FixtureManifest(repositoryRoot()),
    ).resolves.toBeUndefined();
    const root = await mkdtemp(join(tmpdir(), 'mammoth-p5-manifest-'));
    try {
      const target = join(root, P5_FIXTURE_MANIFEST);
      await mkdir(dirname(target), { recursive: true });
      const source = JSON.parse(
        await readFile(join(repositoryRoot(), P5_FIXTURE_MANIFEST), 'utf8'),
      ) as { cases: { id: string }[] };
      source.cases = source.cases.filter(
        ({ id }) => id !== REQUIRED_P5_CASES[0],
      );
      await writeFile(target, JSON.stringify(source));
      await expect(verifyP5FixtureManifest(root)).rejects.toThrow(
        /P5_FIXTURE_MANIFEST_DRIFT/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails closed when the production Postgres migration registry lacks P5 version 6', async () => {
    const result = await verifyP5(
      repositoryRoot(),
      {
        exists: () => Promise.resolve(true),
        validateTarget: (target) => {
          return Promise.resolve(
            target.id !== 'postgres-p5-migration'
              ? undefined
              : 'production Postgres migration registry lacks P5 version 6',
          );
        },
        run: () => Promise.resolve({ exitCode: 0 }),
      },
    );
    expect(result.ok).toBe(false);
    expect(
      result.gates.find(({ id }) => id === 'postgres-p5-migration')
        ?.diagnostic,
    ).toMatch(/P5 version 6/);
  });
});

function repositoryRoot(): string {
  return new URL('../../..', import.meta.url).pathname;
}
