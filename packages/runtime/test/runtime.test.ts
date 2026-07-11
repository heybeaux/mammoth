import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RuntimeCharter, RuntimeStage } from '../src/index.js';
import { runResearchProgram } from '../src/index.js';

const now = new Date('2026-07-10T20:00:00.000Z');
const source = [
  'Mammoths were large proboscideans.',
  'The public fixture records a shoulder height of four metres.',
].join('\n');

const charter: RuntimeCharter = {
  programId: 'program-mammoth-fixture',
  criterionId: 'criterion-mammoth-fixture-v1',
  title: 'Fixture findings',
  question: 'What does the fixture establish?',
  sourceUrl: 'https://fixture.example.test/mammoth.txt',
  evidencePolicyId: 'policy-direct-fresh-public',
  evidencePolicyVersion: '1.0.0',
  proposals: [
    {
      id: 'claim-supported',
      canonicalText: 'The fixture records a shoulder height of four metres.',
      subject: 'fixture',
      predicate: 'records shoulder height',
      object: 'four metres',
      supportingQuote:
        'The public fixture records a shoulder height of four metres.',
    },
    {
      id: 'claim-unresolved',
      canonicalText: 'The fixture records a mass of twelve tonnes.',
      subject: 'fixture',
      predicate: 'records mass',
      object: 'twelve tonnes',
      supportingQuote: 'The public fixture records a mass of twelve tonnes.',
    },
  ],
};

const transport = async () =>
  Promise.resolve({
    status: 200,
    headers: new Headers({ 'content-type': 'text/plain' }),
    body: new Response(source).body,
  });

const verifyEntailment = ({
  claim,
}: {
  claim: RuntimeCharter['proposals'][number];
}) => ({
  entails: claim.id === 'claim-supported',
  receiptId: `entailment:${claim.id}`,
  verifierId: 'fixture-entailment-verifier',
  verifierVersion: '1.0.0',
});

async function root(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'mammoth-runtime-'));
}

describe('local evidence-first runtime', () => {
  it('publishes only supported prose while durably preserving unresolved work', async () => {
    const directory = await root();
    const result = await runResearchProgram({
      rootDirectory: directory,
      charter,
      transport,
      verifyEntailment,
      resolveHost: () => Promise.resolve(['203.0.113.10']),
      now: () => now,
    });

    expect(result).toMatchObject({
      status: 'completed',
      publicationStatus: 'evidence_complete',
      supportedClaimIds: ['claim-supported'],
      unresolvedClaimIds: ['claim-unresolved'],
    });
    expect(result.snapshotDigest).toMatch(/^sha256:[0-9a-f]{64}$/);

    const report = await readFile(result.paths.report, 'utf8');
    expect(report).toContain('shoulder height of four metres');
    expect(report).not.toContain('mass of twelve tonnes');

    const manifest = JSON.parse(
      await readFile(result.paths.manifest, 'utf8'),
    ) as { compilerVersion: string; unresolvedIssueIds: string[] };
    expect(manifest.compilerVersion).toBe('1.0.0');
    expect(manifest.unresolvedIssueIds).toEqual(['claim-unresolved']);

    const ledger = JSON.parse(await readFile(result.paths.ledger, 'utf8')) as {
      claims: { id: string; status: string; assessmentId: string }[];
      assessments: { id: string; policyId: string; policyVersion: string }[];
      claimEvidenceEdges: {
        claimId: string;
        locator: { startOffset: number; endOffset: number };
      }[];
    };
    expect(ledger.claims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'claim-supported', status: 'supported' }),
        expect.objectContaining({
          id: 'claim-unresolved',
          status: 'unresolved',
        }),
      ]),
    );
    expect(new Set(ledger.assessments.map(({ id }) => id)).size).toBe(2);
    expect(ledger.assessments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'claim-supported:assessment',
          policyId: 'policy-direct-fresh-public',
          policyVersion: '1.0.0',
        }),
      ]),
    );
    const edge = ledger.claimEvidenceEdges[0];
    expect(edge?.claimId).toBe('claim-supported');
    expect(
      source.slice(edge?.locator.startOffset, edge?.locator.endOffset),
    ).toBe(charter.proposals[0]?.supportingQuote);

    for (const path of Object.values(result.paths) as string[]) {
      if (path === result.paths.programDirectory) continue;
      expect((await readFile(path)).byteLength).toBeGreaterThan(0);
    }
    const queueSnapshot = JSON.parse(
      await readFile(result.paths.queue, 'utf8'),
    ) as { receipts: { state: string; idempotencyKey: string }[] };
    expect(queueSnapshot.receipts).toHaveLength(1);
    expect(queueSnapshot.receipts[0]?.state).toBe('completed');
    expect(queueSnapshot.receipts[0]?.idempotencyKey).toContain(':snapshot');
  });

  it('resumes after a durable-boundary interruption without duplicate effects', async () => {
    const directory = await root();
    let crash = true;
    const onStage = (stage: RuntimeStage): void => {
      if (crash && stage === 'ledger_committed') {
        crash = false;
        throw new Error('injected interruption');
      }
    };
    await expect(
      runResearchProgram({
        rootDirectory: directory,
        charter,
        transport,
        verifyEntailment,
        resolveHost: () => Promise.resolve(['203.0.113.10']),
        now: () => now,
        onStage,
      }),
    ).rejects.toThrow('injected interruption');

    const resumed = await runResearchProgram({
      rootDirectory: directory,
      charter,
      transport,
      verifyEntailment,
      resolveHost: () => Promise.resolve(['203.0.113.10']),
      now: () => now,
      onStage,
    });
    expect(resumed.status).toBe('completed');
    const ledger = JSON.parse(await readFile(resumed.paths.ledger, 'utf8')) as {
      claims: unknown[];
      evidence: unknown[];
    };
    expect(ledger.claims).toHaveLength(2);
    expect(ledger.evidence).toHaveLength(1);
    const queue = JSON.parse(await readFile(resumed.paths.queue, 'utf8')) as {
      receipts: unknown[];
    };
    expect(queue.receipts).toHaveLength(1);
  });
});
