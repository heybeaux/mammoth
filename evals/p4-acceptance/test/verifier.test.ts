import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  P4_FIXTURE_MANIFEST,
  P4_GATES,
  REQUIRED_P4_CASES,
  verifyP4,
  verifyP4FixtureManifest,
  type P4VerifierDependencies,
} from '../src/verifier.js';

describe('P4 acceptance verifier', () => {
  const firstGate = P4_GATES.at(0);
  if (firstGate === undefined) throw new Error('P4 gate registry is empty');

  it('runs every code-owned gate and requires all to pass', async () => {
    const commands: string[] = [];
    const dependencies: P4VerifierDependencies = {
      exists: () => Promise.resolve(true),
      validateTarget: () => Promise.resolve(undefined),
      run: (command) => {
        commands.push(command.join(' '));
        return Promise.resolve({ exitCode: 0 });
      },
    };
    const result = await verifyP4(repositoryRoot(), dependencies);
    expect(result.ok).toBe(true);
    expect(result.gates).toHaveLength(P4_GATES.length);
    expect(commands).toHaveLength(P4_GATES.length);
  });

  it('fails closed when a gate target is missing or red', async () => {
    const missing: P4VerifierDependencies = {
      exists: () => Promise.resolve(false),
      validateTarget: () => Promise.resolve(undefined),
      run: () => Promise.resolve({ exitCode: 0 }),
    };
    expect((await verifyP4(repositoryRoot(), missing, [firstGate])).ok).toBe(
      false,
    );

    const red: P4VerifierDependencies = {
      exists: () => Promise.resolve(true),
      validateTarget: () => Promise.resolve(undefined),
      run: () =>
        Promise.resolve({ exitCode: 1, diagnostic: 'injected failure' }),
    };
    expect(await verifyP4(repositoryRoot(), red, [firstGate])).toMatchObject({
      ok: false,
      gates: [{ status: 'failed', diagnostic: 'injected failure' }],
    });
  });

  it('rejects duplicate gate identifiers', async () => {
    await expect(
      verifyP4(
        repositoryRoot(),
        {
          exists: () => Promise.resolve(true),
          validateTarget: () => Promise.resolve(undefined),
          run: () => Promise.resolve({ exitCode: 0 }),
        },
        [firstGate, firstGate],
      ),
    ).rejects.toThrow(/P4_VERIFIER_DUPLICATE_GATE/);
  });

  it('freezes the exact adversarial fixture matrix', async () => {
    await expect(
      verifyP4FixtureManifest(repositoryRoot()),
    ).resolves.toBeUndefined();
    const root = await mkdtemp(join(tmpdir(), 'mammoth-p4-manifest-'));
    try {
      const target = join(root, P4_FIXTURE_MANIFEST);
      await mkdir(dirname(target), { recursive: true });
      const source = JSON.parse(
        await readFile(join(repositoryRoot(), P4_FIXTURE_MANIFEST), 'utf8'),
      ) as {
        cases: {
          id: string;
          evaluator: string;
          expected: string;
          input: Record<string, unknown>;
        }[];
      };
      source.cases = source.cases.filter(
        ({ id }) => id !== REQUIRED_P4_CASES[0],
      );
      await writeFile(target, JSON.stringify(source));
      await expect(verifyP4FixtureManifest(root)).rejects.toThrow(
        /P4_FIXTURE_MANIFEST_DRIFT/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('executes every frozen case and rejects a false expected outcome', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mammoth-p4-executable-'));
    try {
      const target = join(root, P4_FIXTURE_MANIFEST);
      await mkdir(dirname(target), { recursive: true });
      const source = JSON.parse(
        await readFile(join(repositoryRoot(), P4_FIXTURE_MANIFEST), 'utf8'),
      ) as {
        cases: { id: string; input: Record<string, unknown> }[];
      };
      const targetCase = source.cases.find(
        ({ id }) => id === 'unsupported-agreement-one',
      );
      if (!targetCase) throw new Error('missing executable fixture case');
      targetCase.input.claimAdmitted = true;
      await writeFile(target, JSON.stringify(source));
      await expect(verifyP4FixtureManifest(root)).rejects.toThrow(
        /P4_FIXTURE_CASE_FAILED/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function repositoryRoot(): string {
  return new URL('../../..', import.meta.url).pathname;
}
