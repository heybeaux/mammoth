import { describe, expect, it } from 'vitest';
import {
  P3_GATES,
  verifyP3,
  type P3VerifierDependencies,
} from '../src/verifier.js';

describe('P3 acceptance verifier', () => {
  const firstGate = P3_GATES.at(0);
  if (firstGate === undefined) throw new Error('P3 gate registry is empty');

  it('runs every code-owned gate and requires all to pass', async () => {
    const commands: string[] = [];
    const dependencies: P3VerifierDependencies = {
      exists: () => Promise.resolve(true),
      validateTarget: () => Promise.resolve(undefined),
      run: (command) => {
        commands.push(command.join(' '));
        return Promise.resolve({ exitCode: 0 });
      },
    };
    const result = await verifyP3('/repo', dependencies);
    expect(result.ok).toBe(true);
    expect(result.gates).toHaveLength(P3_GATES.length);
    expect(commands).toHaveLength(P3_GATES.length);
  });

  it('fails closed when a gate target is missing or red', async () => {
    const missing: P3VerifierDependencies = {
      exists: () => Promise.resolve(false),
      validateTarget: () => Promise.resolve(undefined),
      run: () => Promise.resolve({ exitCode: 0 }),
    };
    expect((await verifyP3('/repo', missing, [firstGate])).ok).toBe(false);

    const red: P3VerifierDependencies = {
      exists: () => Promise.resolve(true),
      validateTarget: () => Promise.resolve(undefined),
      run: () =>
        Promise.resolve({ exitCode: 1, diagnostic: 'injected failure' }),
    };
    const result = await verifyP3('/repo', red, [firstGate]);
    expect(result.ok).toBe(false);
    expect(result.gates[0]).toMatchObject({
      status: 'failed',
      diagnostic: 'injected failure',
    });
  });

  it('rejects duplicate gate identifiers', async () => {
    await expect(
      verifyP3(
        '/repo',
        {
          exists: () => Promise.resolve(true),
          validateTarget: () => Promise.resolve(undefined),
          run: () => Promise.resolve({ exitCode: 0 }),
        },
        [firstGate, firstGate],
      ),
    ).rejects.toThrow(/P3_VERIFIER_DUPLICATE_GATE/);
  });
});
