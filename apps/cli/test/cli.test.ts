import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RuntimeResult } from '@mammoth/runtime';
import {
  LocalWorkflowStore,
  WorkflowRuntime,
  type WorkflowDefinition,
} from '@mammoth/workflow';
import { describe, expect, it } from 'vitest';
import {
  executeCli,
  nodeRuntimeFactory,
  parseArgs,
  type CliDependencies,
} from '../src/index.js';

const charter = {
  schemaVersion: 1,
  charter: {
    programId: 'program-1',
    criterionId: 'criterion-1',
    title: 'CLI fixture',
    question: 'What is established?',
    sourceUrl: 'https://example.test/source',
    evidencePolicyId: 'policy-1',
    evidencePolicyVersion: '1.0.0',
    proposals: [
      {
        id: 'claim-1',
        canonicalText: 'The value is 42.',
        subject: 'value',
        predicate: 'equals',
        object: '42',
        supportingQuote: 'The value is 42.',
      },
    ],
  },
  verifications: {
    'claim-1': {
      entails: false,
      receiptId: 'verify-1',
      verifierId: 'fixture-verifier',
      verifierVersion: '1.0.0',
    },
  },
};

async function setup() {
  const cwd = await mkdtemp(join(tmpdir(), 'mammoth-cli-'));
  const root = join(cwd, 'state');
  const charterPath = join(cwd, 'charter.json');
  await writeFile(charterPath, JSON.stringify(charter));
  const stdout: string[] = [];
  const stderr: string[] = [];
  const calls: unknown[] = [];
  const dependencies: CliDependencies = {
    cwd: () => cwd,
    io: {
      stdout: (value) => stdout.push(value),
      stderr: (value) => stderr.push(value),
    },
    runtime: {
      run: async (request) => {
        calls.push(request);
        const directory = join(request.root, request.charter.programId);
        await mkdir(directory, { recursive: true });
        try {
          await readFile(join(directory, 'workflow.json'));
        } catch {
          await makeExecution(join(directory, 'workflow.json'), 'completed');
        }
        await writeFile(
          join(directory, 'ledger.json'),
          JSON.stringify({ revision: 1 }),
        );
        await writeFile(
          join(directory, 'manifest.json'),
          JSON.stringify({ id: 'manifest-1' }),
        );
        await writeFile(
          join(directory, 'receipt.json'),
          JSON.stringify({ id: 'receipt-1' }),
        );
        await writeFile(join(directory, 'dossier.md'), '# Dossier\n');
        await writeFile(
          join(directory, 'audit.json'),
          JSON.stringify({ schemaVersion: 1, events: [] }),
        );
        await writeFile(
          join(directory, 'revalidation.json'),
          JSON.stringify({ schemaVersion: 1, schedules: [] }),
        );
        return result(request.root, request.charter.programId);
      },
    },
  };
  return { cwd, root, charterPath, stdout, stderr, calls, dependencies };
}

describe('strict CLI parser', () => {
  it('rejects unknown, duplicate, and misplaced flags', () => {
    expect(() => parseArgs(['run', 'x', '--wat'], '/tmp')).toThrow(
      'unknown option',
    );
    expect(() =>
      parseArgs(['status', 'p', '--max-steps', '2'], '/tmp'),
    ).toThrow('valid only for run and resume');
    expect(() => parseArgs(['inspect', '../escape'], '/tmp')).toThrow(
      'path-safe',
    );
  });
});

describe('operator commands', () => {
  it('runs with injected IO/runtime and pins an operator document', async () => {
    const fixture = await setup();
    expect(
      await executeCli(
        ['run', fixture.charterPath, '--root', fixture.root, '--json'],
        fixture.dependencies,
      ),
    ).toBe(0);
    expect(fixture.calls).toHaveLength(1);
    expect(lastJson(fixture.stdout)).toMatchObject({
      command: 'run',
      programId: 'program-1',
      status: 'completed',
    });
    expect(
      JSON.parse(
        await readFile(
          join(fixture.root, 'program-1', 'operator.json'),
          'utf8',
        ),
      ),
    ).toEqual(charter);
  });

  it('projects status and inspect from durable artifacts', async () => {
    const fixture = await setup();
    await executeCli(
      ['run', fixture.charterPath, '--root', fixture.root],
      fixture.dependencies,
    );
    fixture.stdout.splice(0);
    expect(
      await executeCli(
        ['status', 'program-1', '--root', fixture.root, '--json'],
        fixture.dependencies,
      ),
    ).toBe(0);
    expect(lastJson(fixture.stdout)).toMatchObject({
      command: 'status',
      programId: 'program-1',
      status: 'completed',
      completed: true,
    });
    expect(
      await executeCli(
        ['inspect', 'program-1', '--root', fixture.root, '--json'],
        fixture.dependencies,
      ),
    ).toBe(0);
    expect(lastJson(fixture.stdout)).toMatchObject({
      command: 'inspect',
      ledger: { revision: 1 },
      manifest: { id: 'manifest-1' },
      audit: { schemaVersion: 1, events: [] },
      revalidation: { schemaVersion: 1, schedules: [] },
    });
  });

  it('cancels pending work atomically', async () => {
    const fixture = await setup();
    const directory = join(fixture.root, 'program-1');
    await mkdir(directory, { recursive: true });
    await makeExecution(join(directory, 'workflow.json'), 'pending');
    expect(
      await executeCli(
        ['cancel', 'program-1', '--root', fixture.root, '--json'],
        fixture.dependencies,
      ),
    ).toBe(0);
    expect(lastJson(fixture.stdout)).toMatchObject({
      command: 'cancel',
      status: 'cancelled',
      cancellationReceipt: {
        status: 'cancelled',
        reason: 'operator request',
        completedStages: [],
      },
    });
    const state = JSON.parse(
      await readFile(join(directory, 'workflow.json'), 'utf8'),
    ) as { executions: Record<string, { status: string }> };
    expect(Object.values(state.executions)[0]?.status).toBe('cancelled');
    const receipt = JSON.parse(
      await readFile(join(directory, 'cancellation-receipt.json'), 'utf8'),
    ) as Record<string, unknown>;
    const body = { ...receipt };
    delete body.integrityHash;
    expect(receipt.integrityHash).toBe(canonicalDigest(body));
    fixture.stdout.splice(0);
    await executeCli(
      ['inspect', 'program-1', '--root', fixture.root, '--json'],
      fixture.dependencies,
    );
    expect(lastJson(fixture.stdout)).toMatchObject({
      cancellationReceipt: receipt,
    });
  });

  it('resumes paused work before delegating to the runtime factory', async () => {
    const fixture = await setup();
    const directory = join(fixture.root, 'program-1');
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'operator.json'), JSON.stringify(charter));
    const path = join(directory, 'workflow.json');
    const store = new LocalWorkflowStore(path);
    const runtime = registeredRuntime(store);
    await runtime.start('fixture', {}, 'execution-1');
    await runtime.pause('execution-1');
    expect(
      await executeCli(
        ['resume', 'program-1', '--root', fixture.root, '--json'],
        fixture.dependencies,
      ),
    ).toBe(0);
    expect(fixture.calls).toHaveLength(1);
    expect(lastJson(fixture.stdout)).toMatchObject({
      command: 'resume',
      status: 'completed',
    });
  });

  it('reports reserved max-steps honestly when the adapter cannot support it', async () => {
    const fixture = await setup();
    fixture.dependencies.runtime.run = () =>
      Promise.reject(new Error('run-to-idle only'));
    expect(
      await executeCli(
        [
          'run',
          fixture.charterPath,
          '--root',
          fixture.root,
          '--max-steps',
          '1',
        ],
        fixture.dependencies,
      ),
    ).toBe(5);
    expect(lastJson(fixture.stderr)).toMatchObject({
      error: 'COMMAND_FAILED',
      message: 'run-to-idle only',
    });
  });

  it('strictly parses and forwards budget, usage, and revalidation inputs', async () => {
    const fixture = await setup();
    const document = {
      ...charter,
      charter: {
        ...charter.charter,
        sourceRevalidateAfter: '2026-07-11T20:00:00.000Z',
        budgetLimit: { costUsd: 1, tokens: 100, durationMs: 1_000 },
      },
      retrievalUsage: {
        estimated: { costUsd: 0.1, tokens: 10, durationMs: 100 },
        actual: { costUsd: 0.05, tokens: 8, durationMs: 80 },
      },
    };
    await writeFile(fixture.charterPath, JSON.stringify(document));
    expect(
      await executeCli(
        ['run', fixture.charterPath, '--root', fixture.root, '--json'],
        fixture.dependencies,
      ),
    ).toBe(0);
    expect(fixture.calls[0]).toMatchObject({
      charter: {
        sourceRevalidateAfter: '2026-07-11T20:00:00.000Z',
        budgetLimit: { costUsd: 1, tokens: 100, durationMs: 1_000 },
      },
      retrievalUsage: document.retrievalUsage,
    });

    await writeFile(
      fixture.charterPath,
      JSON.stringify({
        ...document,
        retrievalUsage: {
          ...document.retrievalUsage,
          actual: { costUsd: -1, tokens: 8, durationMs: 80 },
        },
      }),
    );
    fixture.stderr.splice(0);
    expect(
      await executeCli(
        ['run', fixture.charterPath, '--root', join(fixture.cwd, 'other')],
        fixture.dependencies,
      ),
    ).toBe(2);
    expect(lastJson(fixture.stderr)).toMatchObject({
      error: 'INVALID_CHARTER',
      message: 'invalid retrievalUsage actual costUsd',
    });
  });

  it('runs a pinned offline fixture to a pause, then resumes through the production adapter', async () => {
    const fixture = await setup();
    const sourcePath = join(fixture.cwd, 'source.txt');
    const bytes = Buffer.from('The value is 42.');
    await writeFile(sourcePath, bytes);
    const document = {
      ...charter,
      sourceFixture: {
        path: 'source.txt',
        digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
        mediaType: 'text/plain',
      },
    };
    await writeFile(fixture.charterPath, JSON.stringify(document));
    fixture.dependencies.runtime = nodeRuntimeFactory();
    expect(
      await executeCli(
        [
          'run',
          fixture.charterPath,
          '--root',
          fixture.root,
          '--max-steps',
          '1',
          '--json',
        ],
        fixture.dependencies,
      ),
    ).toBe(0);
    expect(lastJson(fixture.stdout)).toMatchObject({
      command: 'run',
      status: 'paused',
      completedStages: ['budget_committed'],
    });
    expect(
      await executeCli(
        ['resume', 'program-1', '--root', fixture.root, '--json'],
        fixture.dependencies,
      ),
    ).toBe(0);
    expect(lastJson(fixture.stdout)).toMatchObject({
      command: 'resume',
      status: 'completed',
    });
  });

  it('cancels a production bounded run without fabricating workflow state', async () => {
    const fixture = await setup();
    const sourcePath = join(fixture.cwd, 'source.txt');
    const bytes = Buffer.from('The value is 42.');
    await writeFile(sourcePath, bytes);
    await writeFile(
      fixture.charterPath,
      JSON.stringify({
        ...charter,
        sourceFixture: {
          path: 'source.txt',
          digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
          mediaType: 'text/plain',
        },
      }),
    );
    fixture.dependencies.runtime = nodeRuntimeFactory();
    await executeCli(
      ['run', fixture.charterPath, '--root', fixture.root, '--max-steps', '1'],
      fixture.dependencies,
    );
    expect(
      await executeCli(
        ['cancel', 'program-1', '--root', fixture.root, '--json'],
        fixture.dependencies,
      ),
    ).toBe(0);
    expect(lastJson(fixture.stdout)).toMatchObject({
      command: 'cancel',
      status: 'cancelled',
      cancellationReceipt: {
        completedStages: ['budget_committed'],
        omittedStages: [
          'snapshot_committed',
          'claims_assessed',
          'ledger_committed',
          'report_compiled',
          'receipt_committed',
        ],
      },
    });
  });

  it('rejects an operator-authored positive entailment outside the pinned RFC oracle', async () => {
    const fixture = await setup();
    const sourcePath = join(fixture.cwd, 'source.txt');
    const bytes = Buffer.from('The value is 42.');
    await writeFile(sourcePath, bytes);
    await writeFile(
      fixture.charterPath,
      JSON.stringify({
        ...charter,
        verifications: {
          'claim-1': {
            entails: true,
            receiptId: 'self-authored',
            verifierId: 'self-authored',
            verifierVersion: '1.0.0',
          },
        },
        sourceFixture: {
          path: 'source.txt',
          digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
          mediaType: 'text/plain',
        },
      }),
    );
    fixture.dependencies.runtime = nodeRuntimeFactory();
    expect(
      await executeCli(
        ['run', fixture.charterPath, '--root', fixture.root, '--json'],
        fixture.dependencies,
      ),
    ).toBe(5);
    const failure = lastJson(fixture.stderr) as {
      error?: unknown;
      message?: unknown;
    };
    expect(failure.error).toBe('COMMAND_FAILED');
    expect(failure.message).toContain('UNTRUSTED_ENTAILMENT');
  });

  it('rejects symlinked, oversized, duplicate-key, and invalid UTF-8 charters', async () => {
    const cases: { content: string | Uint8Array }[] = [
      { content: Buffer.alloc(1024 * 1024 + 1, 0x20) },
      { content: '{"schemaVersion":1,"schemaVersion":1}' },
      { content: new Uint8Array([0xff]) },
    ];
    for (const input of cases) {
      const fixture = await setup();
      await writeFile(fixture.charterPath, input.content);
      expect(
        await executeCli(
          ['run', fixture.charterPath, '--root', fixture.root, '--json'],
          fixture.dependencies,
        ),
      ).toBe(2);
      const failure = lastJson(fixture.stderr) as { error?: unknown };
      expect(failure.error).toBeTypeOf('string');
      expect(String(failure.error)).toMatch(/CHARTER|INVALID/);
      expect(fixture.calls).toHaveLength(0);
    }

    const fixture = await setup();
    const linked = join(fixture.cwd, 'linked-charter.json');
    await symlink(fixture.charterPath, linked);
    expect(
      await executeCli(
        ['run', linked, '--root', fixture.root, '--json'],
        fixture.dependencies,
      ),
    ).toBe(2);
    expect(lastJson(fixture.stderr)).toMatchObject({
      error: 'CHARTER_READ_FAILED',
    });
  });

  it('rejects symlinked program directories and preserves documented exit codes', async () => {
    const fixture = await setup();
    const outside = join(fixture.cwd, 'outside');
    await mkdir(outside);
    await mkdir(fixture.root, { recursive: true });
    await symlink(outside, join(fixture.root, 'program-1'));
    expect(
      await executeCli(
        ['status', 'program-1', '--root', fixture.root, '--json'],
        fixture.dependencies,
      ),
    ).toBe(2);
    expect(lastJson(fixture.stderr)).toMatchObject({ error: 'UNSAFE_PATH' });

    const missingFixture = await setup();
    expect(
      await executeCli(
        ['status', 'missing', '--root', missingFixture.root, '--json'],
        missingFixture.dependencies,
      ),
    ).toBe(3);
    expect(lastJson(missingFixture.stderr)).toMatchObject({
      error: 'PROGRAM_NOT_FOUND',
    });
  });
});

function lastJson(values: readonly string[]): unknown {
  const value = values.at(-1);
  if (value === undefined) throw new Error('expected captured JSON output');
  return JSON.parse(value) as unknown;
}

function registeredRuntime(store: LocalWorkflowStore) {
  const definition: WorkflowDefinition = {
    name: 'fixture',
    version: 1,
    steps: [{ id: 'step', execute: () => ({ kind: 'complete', output: {} }) }],
  };
  return new WorkflowRuntime(store).register(definition);
}

async function makeExecution(path: string, status: 'pending' | 'completed') {
  const store = new LocalWorkflowStore(path);
  const runtime = registeredRuntime(store);
  await runtime.start('fixture', {}, 'execution-1');
  if (status === 'completed') await runtime.runUntilIdle();
}

function result(root: string, programId: string): RuntimeResult {
  const directory = join(root, programId);
  return {
    programId,
    executionId: `${programId}:runtime:v1`,
    status: 'completed',
    publicationStatus: 'evidence_complete',
    supportedClaimIds: ['claim-1'],
    unresolvedClaimIds: [],
    snapshotDigest: `sha256:${'a'.repeat(64)}`,
    paths: {
      programDirectory: directory,
      ledger: join(directory, 'ledger.json'),
      workflow: join(directory, 'workflow.json'),
      queue: join(directory, 'queue.json'),
      governance: join(directory, 'governance.json'),
      report: join(directory, 'dossier.md'),
      manifest: join(directory, 'manifest.json'),
      traces: join(directory, 'traces.json'),
      receipt: join(directory, 'receipt.json'),
      snapshot: join(directory, 'snapshot.json'),
      assessments: join(directory, 'assessments.json'),
      charter: join(directory, 'charter.json'),
      audit: join(directory, 'audit.json'),
      revalidation: join(directory, 'revalidation.json'),
    },
  };
}

function canonicalDigest(value: unknown): string {
  return `sha256:${createHash('sha256')
    .update(JSON.stringify(normalize(value)))
    .digest('hex')}`;
}

function normalize(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(normalize);
  const source = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(source)
      .sort()
      .filter((key) => source[key] !== undefined)
      .map((key) => [key, normalize(source[key])]),
  );
}
import { createHash } from 'node:crypto';
