import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  runResearchProgram,
  type RuntimeCharter,
  type RuntimeOptions,
} from '../src/index.js';

const source = 'Example domains are reserved for documentation.';
const charter: RuntimeCharter = {
  programId: 'concurrent-runtime',
  criterionId: 'criterion-1',
  title: 'Concurrent runtime fixture',
  question: 'What is supported?',
  sourceUrl: 'https://fixture.example.test/source.txt',
  evidencePolicyId: 'direct-fresh',
  evidencePolicyVersion: '1.0.0',
  proposals: [
    {
      id: 'claim-1',
      canonicalText: source,
      subject: 'example domains',
      predicate: 'are reserved for',
      object: 'documentation',
      supportingQuote: source,
    },
  ],
};

describe('runtime concurrent ownership', () => {
  it('does not duplicate retrieval when two runtimes start the same program', async () => {
    const rootDirectory = await mkdtemp(join(tmpdir(), 'mammoth-concurrent-'));
    let retrievalEffects = 0;
    const options: RuntimeOptions = {
      rootDirectory,
      charter,
      transport: {
        request: async ({ approvedAddress }) => {
          retrievalEffects += 1;
          await new Promise((resolve) => setTimeout(resolve, 25));
          return {
            status: 200,
            headers: { 'content-type': 'text/plain' },
            body: new TextEncoder().encode(source),
            connectedAddress: approvedAddress,
          };
        },
      },
      resolveHost: () => Promise.resolve(['93.184.216.34']),
      now: () => new Date('2026-07-10T20:00:00.000Z'),
      verifyEntailment: ({ claim }) => ({
        entails: true,
        receiptId: `verify:${claim.id}`,
        verifierId: 'deterministic-fixture-verifier',
        verifierVersion: '1.0.0',
      }),
    };

    const settled = await Promise.allSettled([
      runResearchProgram(options),
      runResearchProgram(options),
    ]);
    const completed = settled.filter((result) => result.status === 'fulfilled');
    const rejected = settled.filter((result) => result.status === 'rejected');

    expect(completed.length).toBeLessThanOrEqual(1);
    expect(rejected.length).toBeGreaterThanOrEqual(1);
    expect(retrievalEffects).toBeLessThanOrEqual(1);

    // Contention may fail both simultaneous callers closed before either owns
    // the workflow. A later retry must still make progress (or reconstruct the
    // winner) without performing a duplicate retrieval.
    await expect(runResearchProgram(options)).resolves.toBeDefined();
    expect(retrievalEffects).toBe(1);
  });
});
