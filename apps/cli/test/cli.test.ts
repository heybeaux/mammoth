import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { beforeAll, describe, expect, it } from 'vitest';

interface ProcessResult {
  status: number;
  stdout: string;
  stderr: string;
}

interface JsonEnvelope {
  ok: boolean;
  command?: string;
  programId?: string;
  result?: Record<string, unknown>;
  error?: { code: string; message: string };
}

const repositoryRoot = resolve(import.meta.dirname, '../../..');
const cli = join(repositoryRoot, 'apps/cli/bin/mammoth.js');
const source =
  'The durable fixture records that mammoths were proboscideans.\n';

async function temporaryRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'mammoth-cli-'));
}

function charter(
  programId: string,
  sourcePath = 'source.txt',
): Record<string, unknown> {
  return {
    programId,
    criterionId: `${programId}:criterion:v1`,
    title: 'Durable fixture findings',
    question: 'What does the durable fixture establish?',
    sourceUrl: 'https://fixture.example.test/source.txt',
    sourcePath,
    evidencePolicyId: 'policy-direct-fresh-public',
    evidencePolicyVersion: '1.0.0',
    proposals: [
      {
        id: `${programId}:claim:supported`,
        canonicalText:
          'The durable fixture records that mammoths were proboscideans.',
        subject: 'durable fixture',
        predicate: 'records',
        object: 'mammoths were proboscideans',
        supportingQuote: source.trim(),
      },
      {
        id: `${programId}:claim:unresolved`,
        canonicalText:
          'The durable fixture records that mammoths were reptiles.',
        subject: 'durable fixture',
        predicate: 'records',
        object: 'mammoths were reptiles',
        supportingQuote:
          'The durable fixture records that mammoths were reptiles.',
      },
    ],
  };
}

async function invoke(cwd: string, ...args: string[]): Promise<ProcessResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd,
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout
      .setEncoding('utf8')
      .on('data', (chunk: string) => (stdout += chunk));
    child.stderr
      .setEncoding('utf8')
      .on('data', (chunk: string) => (stderr += chunk));
    child.once('error', reject);
    child.once('close', (status) => {
      resolveResult({ status: status ?? -1, stdout, stderr });
    });
  });
}

function json(result: ProcessResult): JsonEnvelope {
  return JSON.parse(result.stdout || result.stderr) as JsonEnvelope;
}

describe('mammoth operator CLI spawned-process behavior', () => {
  let workspace: string;
  let root: string;
  let charterPath: string;
  const programId = 'cli-e2e-program';

  beforeAll(async () => {
    workspace = await temporaryRoot();
    root = join(workspace, 'programs');
    charterPath = join(workspace, 'charter.json');
    await writeFile(join(workspace, 'source.txt'), source);
    await writeFile(charterPath, JSON.stringify(charter(programId)));
  });

  it('shows discoverable help from either conventional help flag', async () => {
    for (const flag of ['--help', '-h']) {
      const result = await invoke(workspace, flag);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain('mammoth run <charter>');
      expect(result.stdout).toContain('--root <directory>');
      expect(result.stdout).toContain('-h, --help');
    }
  });

  it('runs the checked-in README quickstart without network access', async () => {
    const quickstartRoot = join(await temporaryRoot(), 'programs');
    const quickstartCharter = join(
      repositoryRoot,
      'examples/quickstart/charter.json',
    );
    const result = await invoke(
      repositoryRoot,
      'run',
      quickstartCharter,
      '--root',
      quickstartRoot,
      '--json',
    );

    expect(result.status, result.stderr).toBe(0);
    expect(json(result)).toMatchObject({
      ok: true,
      command: 'run',
      programId: 'quickstart-example-domains',
      status: 'completed',
      result: {
        publicationStatus: 'evidence_complete',
        supportedClaimIds: ['claim:quickstart:reserved-domains'],
        unresolvedClaimIds: ['claim:quickstart:https-guarantee'],
      },
    });
  });

  it('runs a charter and emits a stable JSON envelope', async () => {
    const result = await invoke(
      workspace,
      'run',
      charterPath,
      '--root',
      root,
      '--json',
    );
    expect(result.status, result.stderr).toBe(0);
    expect(json(result)).toMatchObject({
      schemaVersion: '1.0.0',
      ok: true,
      command: 'run',
      programId,
      status: 'completed',
      result: {
        status: 'completed',
        supportedClaimIds: [`${programId}:claim:supported`],
        unresolvedClaimIds: [`${programId}:claim:unresolved`],
      },
    });
    expect(result.stderr).toBe('');

    const repeated = await invoke(
      workspace,
      'run',
      charterPath,
      '--root',
      root,
      '--json',
    );
    expect(repeated.status, repeated.stderr).toBe(0);
    expect(json(repeated).result).toEqual(json(result).result);
    const queue = JSON.parse(
      await readFile(join(root, programId, 'queue.json'), 'utf8'),
    ) as { receipts: unknown[] };
    expect(queue.receipts).toHaveLength(1);
  });

  it('reads status and full inspection artifacts in brand-new processes', async () => {
    const status = await invoke(
      workspace,
      '--json',
      'status',
      programId,
      `--root=${root}`,
    );
    expect(status.status, status.stderr).toBe(0);
    expect(json(status)).toMatchObject({
      ok: true,
      command: 'status',
      programId,
      result: { programId, status: 'completed', resumable: false },
    });

    const inspect = await invoke(
      workspace,
      'inspect',
      programId,
      '--root',
      root,
      '--json',
    );
    expect(inspect.status, inspect.stderr).toBe(0);
    const envelope = json(inspect);
    expect(envelope).toMatchObject({
      ok: true,
      command: 'inspect',
      programId,
      result: { status: { status: 'completed' } },
    });
    expect(envelope.result?.receipt).toBeTruthy();
    expect(envelope.result?.ledger).toBeTruthy();
    expect(Array.isArray(envelope.result?.executions)).toBe(true);
  });

  it('resumes an interrupted program from durable state in a new process', async () => {
    const interruptedId = 'cli-resume-program';
    const lateCharter = join(workspace, 'resume-charter.json');
    await writeFile(lateCharter, JSON.stringify(charter(interruptedId)));

    const initial = await invoke(
      workspace,
      'run',
      lateCharter,
      '--root',
      root,
      '--json',
    );
    expect(initial.status, initial.stderr).toBe(0);
    const workflowPath = join(root, interruptedId, 'workflow.json');
    const workflow = JSON.parse(await readFile(workflowPath, 'utf8')) as {
      executions: Record<string, { status: string; error?: string }>;
    };
    const execution = Object.values(workflow.executions)[0];
    if (!execution) throw new Error('fixture workflow execution missing');
    execution.status = 'failed';
    execution.error =
      'injected process interruption after durable completion boundary';
    await writeFile(workflowPath, `${JSON.stringify(workflow)}\n`);

    const resumed = await invoke(
      workspace,
      'resume',
      interruptedId,
      '--root',
      root,
      '--json',
    );
    expect(resumed.status, resumed.stderr).toBe(0);
    expect(json(resumed)).toMatchObject({
      ok: true,
      command: 'resume',
      programId: interruptedId,
      result: { status: 'completed' },
    });
  });

  it('cancels interrupted work and returns a durable partial receipt', async () => {
    const cancelledId = 'cli-cancel-program';
    const cancelCharter = join(workspace, 'cancel-charter.json');
    await writeFile(
      cancelCharter,
      JSON.stringify(charter(cancelledId, 'never-created.txt')),
    );
    const failed = await invoke(
      workspace,
      'run',
      cancelCharter,
      '--root',
      root,
      '--json',
    );
    expect(failed.status).toBe(5);

    const cancelled = await invoke(
      workspace,
      'cancel',
      cancelledId,
      '--root',
      root,
      '--json',
    );
    expect(cancelled.status, cancelled.stderr).toBe(0);
    expect(json(cancelled)).toMatchObject({
      ok: true,
      command: 'cancel',
      programId: cancelledId,
      result: { status: 'cancelled' },
    });
    const receipt = JSON.parse(
      await readFile(join(root, cancelledId, 'receipt.json'), 'utf8'),
    ) as { status: string; publicationStatus: string };
    expect(receipt).toMatchObject({
      status: 'cancelled',
      publicationStatus: 'partial',
    });
    const repeated = await invoke(
      workspace,
      'cancel',
      cancelledId,
      '--root',
      root,
      '--json',
    );
    expect(repeated.status, repeated.stderr).toBe(0);
    expect(json(repeated).result).toEqual(json(cancelled).result);
  });

  it('provides deterministic human output and documented state-conflict exits', async () => {
    const human = await invoke(workspace, 'status', programId, '--root', root);
    expect(human).toEqual({
      status: 0,
      stdout: `Program ${programId} status: completed\n`,
      stderr: '',
    });
    const resume = await invoke(
      workspace,
      'resume',
      programId,
      '--root',
      root,
      '--json',
    );
    expect(resume.status).toBe(4);
    expect(json(resume)).toMatchObject({
      ok: false,
      error: { code: 'PROGRAM_NOT_RESUMABLE' },
    });
  });

  it('rejects traversal IDs without touching paths outside the root', async () => {
    await mkdir(root, { recursive: true });
    const traversal = await invoke(
      workspace,
      'inspect',
      '../escape',
      '--root',
      root,
      '--json',
    );
    expect(traversal.status).toBe(2);
    expect(json(traversal)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_PROGRAM_ID' },
    });

    const outside = join(workspace, 'outside');
    const sentinel = join(outside, 'sentinel.txt');
    await mkdir(outside);
    await writeFile(sentinel, 'do not touch');
    await symlink(outside, join(root, 'symlink-program'));
    const hostileCharter = join(workspace, 'symlink-charter.json');
    await writeFile(hostileCharter, JSON.stringify(charter('symlink-program')));
    const linked = await invoke(
      workspace,
      'run',
      hostileCharter,
      '--root',
      root,
      '--json',
    );
    expect(linked.status).toBe(5);
    expect(await readFile(sentinel, 'utf8')).toBe('do not touch');
  });

  it('distinguishes an unknown program from invalid input', async () => {
    const missing = await invoke(
      workspace,
      'status',
      'never-created-program',
      '--root',
      root,
      '--json',
    );
    expect(missing.status).toBe(3);
    expect(json(missing)).toMatchObject({
      schemaVersion: '1.0.0',
      ok: false,
      error: { code: 'PROGRAM_NOT_FOUND' },
    });
    expect(missing.stderr).toContain('PROGRAM_NOT_FOUND');
  });
});
