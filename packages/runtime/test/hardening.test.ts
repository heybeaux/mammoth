import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  runResearchProgram,
  verifyRuntimeAudit,
  type RuntimeCharter,
  type RuntimeOptions,
  type RuntimeStage,
} from '../src/index.js';

const instant = new Date('2026-07-10T20:00:00.000Z');
const source = 'The fixture records a shoulder height of four metres.';
const baseCharter: RuntimeCharter = {
  programId: 'runtime-hardening',
  criterionId: 'criterion-1',
  title: 'Hardening fixture',
  question: 'What is supported?',
  sourceUrl: 'https://fixture.example.test/source.txt',
  evidencePolicyId: 'direct-fresh',
  evidencePolicyVersion: '1.0.0',
  proposals: [
    {
      id: 'claim-1',
      canonicalText: 'The fixture records a shoulder height of four metres.',
      subject: 'fixture',
      predicate: 'records shoulder height',
      object: 'four metres',
      supportingQuote: source,
    },
  ],
};

async function directory() {
  return mkdtemp(join(tmpdir(), 'mammoth-runtime-hardening-'));
}

function harness(
  rootDirectory: string,
  overrides: Partial<RuntimeOptions> = {},
) {
  let retrievalEffects = 0;
  const options: RuntimeOptions = {
    rootDirectory,
    charter: structuredClone(baseCharter),
    transport: () => {
      retrievalEffects += 1;
      return Promise.resolve({
        status: 200,
        headers: new Headers({ 'content-type': 'text/plain' }),
        body: new Response(source).body,
      });
    },
    resolveHost: () => Promise.resolve(['203.0.113.10']),
    now: () => instant,
    verifyEntailment: ({ claim }) => ({
      entails: claim.id === 'claim-1',
      receiptId: `verify:${claim.id}`,
      verifierId: 'deterministic-fixture-verifier',
      verifierVersion: '1.0.0',
    }),
    ...overrides,
  };
  return { options, effects: () => retrievalEffects };
}

describe('runtime durable boundaries', () => {
  for (const stage of [
    'budget_committed',
    'snapshot_committed',
    'claims_assessed',
    'ledger_committed',
    'report_compiled',
    'receipt_committed',
  ] as const satisfies readonly RuntimeStage[]) {
    it(`restarts after ${stage} without duplicating retrieval`, async () => {
      const root = await directory();
      let interrupt = true;
      const runtime = harness(root, {
        onStage: (observed) => {
          if (interrupt && observed === stage) {
            interrupt = false;
            throw new Error(`interrupt:${stage}`);
          }
        },
      });
      await expect(runResearchProgram(runtime.options)).rejects.toThrow(
        `interrupt:${stage}`,
      );
      const result = await runResearchProgram(runtime.options);
      expect(result.status).toBe('completed');
      expect(runtime.effects()).toBe(1);
      const queue = JSON.parse(await readFile(result.paths.queue, 'utf8')) as {
        receipts: unknown[];
      };
      expect(queue.receipts).toHaveLength(1);
    });
  }
});

describe('runtime fail-closed boundaries', () => {
  it('rejects an explicit locator that does not select the quoted bytes', async () => {
    const runtime = harness(await directory());
    const proposal = runtime.options.charter.proposals[0];
    expect(proposal).toBeDefined();
    if (!proposal) throw new Error('fixture proposal missing');
    runtime.options.charter = {
      ...runtime.options.charter,
      proposals: [
        {
          ...proposal,
          locator: { startOffset: 1, endOffset: source.length },
        },
      ],
    };
    await expect(runResearchProgram(runtime.options)).rejects.toThrow(
      'declared locator does not select supporting quote',
    );
  });

  it('does not promote substring matches without an attributable entailment verdict', async () => {
    const runtime = harness(await directory(), {
      verifyEntailment: () => ({
        entails: false,
        receiptId: 'verify:false',
        verifierId: 'adversarial-verifier',
        verifierVersion: '1.0.0',
      }),
    });
    const result = await runResearchProgram(runtime.options);
    expect(result.supportedClaimIds).toEqual([]);
    expect(result.unresolvedClaimIds).toEqual(['claim-1']);
    expect(await readFile(result.paths.report, 'utf8')).toContain(
      'unresolved; excluded from supported findings',
    );
  });

  it('rejects stale source evidence instead of compiling it as supported', async () => {
    const runtime = harness(await directory());
    runtime.options.charter.sourceExpiresAt = '2026-07-10T19:00:00.000Z';
    await expect(runResearchProgram(runtime.options)).rejects.toThrow(
      'CLAIM_COMMIT_DENIED',
    );
  });

  it('detects a tampered CAS object on restart', async () => {
    const root = await directory();
    let interrupt = true;
    const runtime = harness(root, {
      onStage: (stage) => {
        if (interrupt && stage === 'snapshot_committed') {
          interrupt = false;
          throw new Error('interrupt-after-snapshot');
        }
      },
    });
    await expect(runResearchProgram(runtime.options)).rejects.toThrow(
      'interrupt-after-snapshot',
    );
    const snapshot = JSON.parse(
      await readFile(
        join(root, baseCharter.programId, 'snapshot.json'),
        'utf8',
      ),
    ) as { snapshot: { contentObject: { path: string } } };
    await chmod(snapshot.snapshot.contentObject.path, 0o600);
    await writeFile(snapshot.snapshot.contentObject.path, 'tampered');
    await expect(runResearchProgram(runtime.options)).rejects.toThrow(
      'snapshot CAS object failed digest validation',
    );
    expect(runtime.effects()).toBe(1);
  });

  it('pins the charter digest across resume attempts', async () => {
    const root = await directory();
    const runtime = harness(root, {
      onStage: () => {
        throw new Error('interrupt');
      },
    });
    await expect(runResearchProgram(runtime.options)).rejects.toThrow(
      'interrupt',
    );
    const changed = harness(root).options;
    changed.charter.question = 'A changed question';
    await expect(runResearchProgram(changed)).rejects.toThrow(
      'resume charter differs from the pinned durable charter',
    );
  });

  it('rejects path traversal program identifiers', async () => {
    const runtime = harness(await directory());
    runtime.options.charter.programId = '../escape';
    await expect(runResearchProgram(runtime.options)).rejects.toThrow(
      'path-safe identifier',
    );
  });

  it('pins one evaluation timestamp so exported assessments match the ledger after replay', async () => {
    const root = await directory();
    let tick = 0;
    let interrupt = true;
    const runtime = harness(root, {
      now: () => new Date(instant.getTime() + tick++ * 60_000),
      onStage: (stage) => {
        if (interrupt && stage === 'ledger_committed') {
          interrupt = false;
          throw new Error('interrupt-after-ledger');
        }
      },
    });
    await expect(runResearchProgram(runtime.options)).rejects.toThrow(
      'interrupt-after-ledger',
    );
    const result = await runResearchProgram(runtime.options);
    const ledger = JSON.parse(await readFile(result.paths.ledger, 'utf8')) as {
      claims: unknown[];
      assessments: unknown[];
      claimEvidenceEdges: unknown[];
    };
    const exported = JSON.parse(
      await readFile(result.paths.assessments, 'utf8'),
    ) as { claims: unknown[]; assessments: unknown[]; edges: unknown[] };
    expect(exported.claims).toEqual(ledger.claims);
    expect(exported.assessments).toEqual(ledger.assessments);
    expect(exported.edges).toEqual(ledger.claimEvidenceEdges);
  });

  it('emits a contiguous hash-chained audit and detects tampering', async () => {
    const runtime = harness(await directory());
    const result = await runResearchProgram(runtime.options);
    const audit = await verifyRuntimeAudit(result.paths.audit);
    expect(audit.events.map(({ stage }) => stage)).toEqual([
      'budget_committed',
      'snapshot_committed',
      'claims_assessed',
      'ledger_committed',
      'report_compiled',
      'receipt_committed',
      'completed',
    ]);
    expect(audit.eventCount).toBe(7);
    const tampered = structuredClone(audit);
    const event = tampered.events[2];
    expect(event).toBeDefined();
    if (!event) throw new Error('expected third audit event');
    event.stage = 'completed';
    await writeFile(result.paths.audit, JSON.stringify(tampered));
    await expect(verifyRuntimeAudit(result.paths.audit)).rejects.toThrow(
      'runtime audit hash is invalid',
    );
  });

  it('fails closed on nonzero budget exhaustion before any retrieval effect', async () => {
    const runtime = harness(await directory(), {
      retrievalUsage: {
        estimated: { costUsd: 2, tokens: 20, durationMs: 200 },
        actual: { costUsd: 1, tokens: 10, durationMs: 100 },
      },
    });
    runtime.options.charter = {
      ...runtime.options.charter,
      budgetLimit: { costUsd: 1, tokens: 100, durationMs: 1_000 },
    };
    await expect(runResearchProgram(runtime.options)).rejects.toThrow(
      'reservation exceeds remaining budget',
    );
    expect(runtime.effects()).toBe(0);
    const governance = JSON.parse(
      await readFile(
        join(
          runtime.options.rootDirectory,
          runtime.options.charter.programId,
          'governance.json',
        ),
        'utf8',
      ),
    ) as { budgets: { audit: { outcome: string; reason?: string }[] } };
    expect(governance.budgets.audit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          outcome: 'denied',
          reason: 'budget_exhausted',
        }),
      ]),
    );
  });

  it('persists one volatile-evidence revalidation schedule across restart', async () => {
    const root = await directory();
    let interrupt = true;
    const runtime = harness(root, {
      onStage: (stage) => {
        if (interrupt && stage === 'claims_assessed') {
          interrupt = false;
          throw new Error('interrupt-after-schedule');
        }
      },
    });
    runtime.options.charter = {
      ...runtime.options.charter,
      sourceRevalidateAfter: '2026-07-11T20:00:00.000Z',
    };
    await expect(runResearchProgram(runtime.options)).rejects.toThrow(
      'interrupt-after-schedule',
    );
    const result = await runResearchProgram(runtime.options);
    const artifact = JSON.parse(
      await readFile(result.paths.revalidation, 'utf8'),
    ) as { schedules: { id: string; state: string; dueAt: string }[] };
    expect(artifact.schedules).toEqual([
      expect.objectContaining({
        id: 'runtime-hardening:revalidate:snapshot',
        state: 'scheduled',
        dueAt: '2026-07-11T20:00:00.000Z',
      }),
    ]);
    const governance = JSON.parse(
      await readFile(result.paths.governance, 'utf8'),
    ) as { revalidation: { schedules: unknown[] } };
    expect(governance.revalidation.schedules).toHaveLength(1);
  });
});
