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
      transport: async () => {
        retrievalEffects += 1;
        await new Promise((resolve) => setTimeout(resolve, 25));
        return {
          status: 200,
          headers: new Headers({ 'content-type': 'text/plain' }),
          body: new Response(source).body,
        };
      },
      resolveHost: () => Promise.resolve(['203.0.113.10']),
      now: () => new Date('2026-07-10T20:00:00.000Z'),
    };

    const settled = await Promise.allSettled([
      runResearchProgram(options),
      runResearchProgram(options),
    ]);
    const completed = settled.filter((result) => result.status === 'fulfilled');

    expect(completed).toHaveLength(1);
    expect(
      settled.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    expect(retrievalEffects).toBe(1);
  });
});
