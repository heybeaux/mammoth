import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RuntimeCharter, RuntimeStage } from '../src/index.js';
import {
  cancelResearchProgram,
  getResearchProgramStatus,
  inspectResearchProgram,
  resumeResearchProgram,
  runResearchProgram,
} from '../src/index.js';

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

async function root(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'mammoth-runtime-'));
}

describe('local evidence-first runtime', () => {
  it.each([
    '../escape',
    '..',
    '/absolute',
    'nested/program',
    'nested\\program',
    'control\u0000byte',
    `p${'x'.repeat(128)}`,
  ])(
    'rejects unsafe program id %j at every filesystem boundary',
    async (programId) => {
      const directory = await root();
      await expect(
        runResearchProgram({
          rootDirectory: directory,
          charter: { ...charter, programId },
          transport,
        }),
      ).rejects.toMatchObject({ code: 'INVALID_CHARTER' });

      for (const operation of [
        () => getResearchProgramStatus({ rootDirectory: directory, programId }),
        () => inspectResearchProgram({ rootDirectory: directory, programId }),
        () =>
          resumeResearchProgram({
            rootDirectory: directory,
            programId,
            transport,
          }),
        () => cancelResearchProgram({ rootDirectory: directory, programId }),
      ]) {
        await expect(operation()).rejects.toMatchObject({
          code: 'INVALID_PROGRAM_ID',
        });
      }
    },
  );

  it('rejects a pre-existing program-directory symlink', async () => {
    const directory = await root();
    const outside = await root();
    await mkdir(directory, { recursive: true });
    await symlink(outside, join(directory, charter.programId), 'dir');

    await expect(
      runResearchProgram({
        rootDirectory: directory,
        charter,
        transport,
      }),
    ).rejects.toMatchObject({ code: 'INTEGRITY_FAILED' });
    await expect(
      getResearchProgramStatus({
        rootDirectory: directory,
        programId: charter.programId,
      }),
    ).rejects.toMatchObject({ code: 'INTEGRITY_FAILED' });
  });

  it('runs the checked-in RFC 2606 MVP fixture end to end', async () => {
    const fixtureRoot = join(
      import.meta.dirname,
      '../../../evals/fixtures/mvp',
    );
    const fixture = JSON.parse(
      await readFile(join(fixtureRoot, 'fixture.json'), 'utf8'),
    ) as {
      clock: string;
      sources: {
        sourceUri: string;
        snapshotPath: string;
        contentDigest: string;
      }[];
      claims: {
        id: string;
        canonicalText: string;
        subject: string;
        predicate: string;
        object: string;
      }[];
      expected: {
        locators: { claimId: string; exactText: string }[];
        renderedClaimIds: string[];
        excludedClaimIds: string[];
      };
    };
    const charterFile = JSON.parse(
      await readFile(join(fixtureRoot, 'charter.json'), 'utf8'),
    ) as {
      id: string;
      title: string;
      question: string;
      criterion: { id: string };
      evidencePolicyId: string;
    };
    const sourceFile = fixture.sources[0];
    if (!sourceFile) throw new Error('MVP fixture source missing');
    const bytes = await readFile(join(fixtureRoot, sourceFile.snapshotPath));
    const quoteByClaim = new Map(
      fixture.expected.locators.map(({ claimId, exactText }) => [
        claimId,
        exactText,
      ]),
    );
    const checkedCharter: RuntimeCharter = {
      programId: charterFile.id,
      criterionId: charterFile.criterion.id,
      title: charterFile.title,
      question: charterFile.question,
      sourceUrl: sourceFile.sourceUri,
      evidencePolicyId: charterFile.evidencePolicyId,
      evidencePolicyVersion: '1.0.0',
      proposals: fixture.claims.map((claim) => ({
        ...claim,
        supportingQuote:
          quoteByClaim.get(claim.id) ??
          'No exact source passage supports this proposed claim.',
      })),
    };
    const result = await runResearchProgram({
      rootDirectory: await root(),
      charter: checkedCharter,
      transport: () =>
        Promise.resolve({
          status: 200,
          headers: new Headers({ 'content-type': 'text/plain' }),
          body: new Response(bytes).body,
        }),
      resolveHost: () => Promise.resolve(['203.0.113.10']),
      now: () => new Date(fixture.clock),
    });

    expect(result.snapshotDigest).toBe(sourceFile.contentDigest);
    expect(result.supportedClaimIds).toEqual(fixture.expected.renderedClaimIds);
    expect(result.unresolvedClaimIds).toEqual(
      fixture.expected.excludedClaimIds,
    );
    const report = await readFile(result.paths.report, 'utf8');
    expect(report).toContain('example.com');
    expect(report).not.toContain('HTTPS');
  });

  it('publishes only supported prose while durably preserving unresolved work', async () => {
    const directory = await root();
    const result = await runResearchProgram({
      rootDirectory: directory,
      charter,
      transport,
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
    const governance = JSON.parse(
      await readFile(result.paths.governance, 'utf8'),
    ) as {
      revalidation: {
        schedules: {
          programId: string;
          subjectType: string;
          subjectId: string;
          dueAt: string;
        }[];
      };
    };
    expect(governance.revalidation.schedules).toEqual([
      expect.objectContaining({
        programId: charter.programId,
        subjectType: 'evidence',
        subjectId: `${charter.programId}:evidence:snapshot`,
        dueAt: '2026-07-11T20:00:00.000Z',
      }),
    ]);
  });

  it('fails closed on completed artifact tampering without repairing bytes', async () => {
    const directory = await root();
    const result = await runResearchProgram({
      rootDirectory: directory,
      charter,
      transport,
      resolveHost: () => Promise.resolve(['203.0.113.10']),
      now: () => now,
    });
    const tampered = '{"claims":[]}\n';
    await writeFile(result.paths.ledger, tampered);

    await expect(
      getResearchProgramStatus({
        rootDirectory: directory,
        programId: charter.programId,
      }),
    ).rejects.toMatchObject({ code: 'INTEGRITY_FAILED' });
    await expect(
      inspectResearchProgram({
        rootDirectory: directory,
        programId: charter.programId,
      }),
    ).rejects.toMatchObject({ code: 'INTEGRITY_FAILED' });
    expect(await readFile(result.paths.ledger, 'utf8')).toBe(tampered);
  });

  it.each<RuntimeStage>([
    'snapshot_committed',
    'claims_assessed',
    'ledger_committed',
    'report_compiled',
    'receipt_committed',
  ])(
    'resumes after an interruption at %s without lost state or duplicate effects',
    async (interruptedStage) => {
      const directory = await root();
      let crash = true;
      const onStage = (stage: RuntimeStage): void => {
        if (crash && stage === interruptedStage) {
          crash = false;
          throw new Error('injected interruption');
        }
      };
      await expect(
        runResearchProgram({
          rootDirectory: directory,
          charter,
          transport,
          resolveHost: () => Promise.resolve(['203.0.113.10']),
          now: () => now,
          onStage,
        }),
      ).rejects.toThrow('injected interruption');

      const interrupted = await getResearchProgramStatus({
        rootDirectory: directory,
        programId: charter.programId,
      });
      expect(interrupted).toMatchObject({
        status: 'interrupted',
        resumable: true,
      });

      // No charter is supplied: a fresh operator process loads the durable input.
      const resumed = await resumeResearchProgram({
        rootDirectory: directory,
        programId: charter.programId,
        transport,
        resolveHost: () => Promise.resolve(['203.0.113.10']),
        now: () => now,
        onStage,
      });
      expect(resumed.status).toBe('completed');
      const ledger = JSON.parse(
        await readFile(resumed.paths.ledger, 'utf8'),
      ) as {
        claims: unknown[];
        evidence: unknown[];
      };
      expect(ledger.claims).toHaveLength(2);
      expect(ledger.evidence).toHaveLength(1);
      const queue = JSON.parse(await readFile(resumed.paths.queue, 'utf8')) as {
        receipts: unknown[];
      };
      expect(queue.receipts).toHaveLength(1);

      const inspection = await inspectResearchProgram({
        rootDirectory: directory,
        programId: charter.programId,
      });
      expect(inspection.status.status).toBe('completed');
      expect(inspection.ledger).toEqual({
        claimCount: 2,
        evidenceCount: 1,
        assessmentCount: 2,
      });
      expect(inspection.artifacts.report).toMatchObject({ present: true });
    },
  );

  it('replays from a durable receipt byte-identically under a different wall clock', async () => {
    const directory = await root();
    await expect(
      runResearchProgram({
        rootDirectory: directory,
        charter,
        transport,
        resolveHost: () => Promise.resolve(['203.0.113.10']),
        now: () => now,
        onStage: (stage) => {
          if (stage === 'receipt_committed')
            throw new Error('crash after durable receipt');
        },
      }),
    ).rejects.toThrow('crash after durable receipt');

    const names = [
      'ledger',
      'manifest',
      'report',
      'traces',
      'receipt',
    ] as const;
    const paths = Object.fromEntries(
      names.map((name) => [
        name,
        join(
          directory,
          charter.programId,
          {
            ledger: 'ledger.json',
            manifest: 'manifest.json',
            report: 'dossier.md',
            traces: 'traces.json',
            receipt: 'receipt.json',
          }[name],
        ),
      ]),
    ) as Record<(typeof names)[number], string>;
    const before = Object.fromEntries(
      await Promise.all(
        names.map(async (name) => [name, await readFile(paths[name])]),
      ),
    ) as Record<(typeof names)[number], Buffer>;

    await resumeResearchProgram({
      rootDirectory: directory,
      programId: charter.programId,
      transport,
      resolveHost: () => Promise.resolve(['203.0.113.10']),
      now: () => new Date('2030-01-01T00:00:00.000Z'),
    });
    for (const name of names)
      expect(await readFile(paths[name])).toEqual(before[name]);
  });

  it('reclaims a runtime lock left by a dead process', async () => {
    const directory = await root();
    const programDirectory = join(directory, charter.programId);
    await mkdir(programDirectory, { recursive: true });
    await writeFile(join(programDirectory, '.runtime.lock'), '99999999\n');

    const result = await runResearchProgram({
      rootDirectory: directory,
      charter,
      transport,
      resolveHost: () => Promise.resolve(['203.0.113.10']),
      now: () => now,
    });

    expect(result.status).toBe('completed');
    await expect(
      readFile(join(programDirectory, '.runtime.lock'), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('cancels terminally, preserves completed artifacts, and emits an honest partial receipt', async () => {
    const directory = await root();
    let retrievals = 0;
    let cancellationReceipt:
      | Awaited<ReturnType<typeof cancelResearchProgram>>
      | undefined;
    await expect(
      runResearchProgram({
        rootDirectory: directory,
        charter,
        transport: async () => {
          retrievals += 1;
          return transport();
        },
        resolveHost: () => Promise.resolve(['203.0.113.10']),
        now: () => now,
        onStage: async (stage) => {
          if (stage === 'ledger_committed') {
            cancellationReceipt = await cancelResearchProgram({
              rootDirectory: directory,
              programId: charter.programId,
              now: () => new Date('2026-07-10T20:01:00.000Z'),
            });
          }
        },
      }),
    ).rejects.toMatchObject({ code: 'PROGRAM_CANCELLED' });

    const ledgerBefore = await readFile(
      join(directory, charter.programId, 'ledger.json'),
      'utf8',
    );
    const receipt = cancellationReceipt;
    if (!receipt) throw new Error('cancellation receipt was not emitted');
    expect(receipt).toMatchObject({
      status: 'cancelled',
      publicationStatus: 'partial',
    });
    expect(receipt.completedArtifacts.ledger).toMatch(/^sha256:/);
    expect(receipt.completedArtifacts.workflow).toMatch(/^sha256:/);
    expect(receipt.completedArtifacts.queue).toMatch(/^sha256:/);
    expect(receipt.completedArtifacts.governance).toMatch(/^sha256:/);
    expect(receipt.missingArtifacts).toEqual(
      expect.arrayContaining(['report', 'manifest', 'traces']),
    );

    await expect(
      runResearchProgram({
        rootDirectory: directory,
        charter,
        transport: async () => {
          retrievals += 1;
          return transport();
        },
        resolveHost: () => Promise.resolve(['203.0.113.10']),
        now: () => now,
      }),
    ).rejects.toMatchObject({ code: 'PROGRAM_CANCELLED' });
    await expect(
      resumeResearchProgram({
        rootDirectory: directory,
        programId: charter.programId,
        transport,
      }),
    ).rejects.toMatchObject({ code: 'PROGRAM_CANCELLED' });

    expect(retrievals).toBe(1);
    expect(
      await readFile(join(directory, charter.programId, 'ledger.json'), 'utf8'),
    ).toBe(ledgerBefore);
    expect(
      await getResearchProgramStatus({
        rootDirectory: directory,
        programId: charter.programId,
      }),
    ).toMatchObject({ status: 'cancelled', resumable: false });

    const inspection = await inspectResearchProgram({
      rootDirectory: directory,
      programId: charter.programId,
    });
    expect(inspection.status.status).toBe('cancelled');
    expect(inspection.receipt).toMatchObject({ publicationStatus: 'partial' });
  });
});
