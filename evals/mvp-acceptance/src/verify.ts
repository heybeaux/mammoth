import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  canonicalJson,
  verifyCompletedProgram,
  verifyPartialReceipt,
} from './integrity.js';
import {
  invokeCli,
  parseEnvelope,
  type CliEnvelope,
  type ProcessResult,
} from './process.js';

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, '../../..');
const cliPackage = JSON.parse(
  await readFile(join(repositoryRoot, 'apps/cli/package.json'), 'utf8'),
) as { bin: { mammoth: string } };
const cli = resolve(repositoryRoot, 'apps/cli', cliPackage.bin.mammoth);
const fixtureSource = join(
  repositoryRoot,
  'evals/fixtures/mvp/source-rfc2606.txt',
);

interface Scenario {
  workspace: string;
  root: string;
  programId: string;
  charter: string;
}

function assertExit(
  result: ProcessResult,
  status: number,
  command?: string,
): CliEnvelope {
  assert.equal(
    result.signal,
    null,
    `${command ?? 'command'} terminated by ${String(result.signal)}`,
  );
  assert.equal(result.status, status, result.stderr || result.stdout);
  const envelope = parseEnvelope(result);
  assert.equal(envelope.schemaVersion, '1.0.0');
  if (status === 0) {
    assert.equal(envelope.ok, true);
    assert.equal(result.stderr, '');
    if (command) assert.equal(envelope.command, command);
  } else {
    assert.equal(envelope.ok, false);
    assert.match(result.stderr, /^mammoth: [A-Z0-9_]+: .+\n$/);
  }
  return envelope;
}

function charter(
  programId: string,
  sourcePath: string,
): Record<string, unknown> {
  return {
    programId,
    criterionId: 'criterion:mvp-example-domains:v1',
    title: 'Reserved example domains',
    question: 'Which domain is reserved and is HTTPS guaranteed?',
    sourceUrl: 'https://fixture.example.test/rfc2606.txt',
    sourcePath,
    evidencePolicyId: 'policy:public-direct-locator-v1',
    evidencePolicyVersion: '1.0.0',
    proposals: [
      {
        id: `${programId}:claim:reserved`,
        canonicalText: 'IANA reserves example.com for use as an example.',
        subject: 'IANA',
        predicate: 'reserves for examples',
        object: 'example.com',
        supportingQuote: 'example.com',
      },
      {
        id: `${programId}:claim:https`,
        canonicalText: 'IANA guarantees HTTPS availability for example.com.',
        subject: 'IANA',
        predicate: 'guarantees HTTPS availability',
        object: 'example.com',
        supportingQuote: 'IANA guarantees HTTPS availability for example.com',
      },
    ],
  };
}

async function scenario(
  name: string,
  sourcePath = fixtureSource,
): Promise<Scenario> {
  const workspace = await mkdtemp(join(tmpdir(), `mammoth-mvp-${name}-`));
  const root = join(workspace, 'home');
  const programId = `mvp-${name}`;
  const charterPath = join(workspace, 'charter.json');
  await writeFile(
    charterPath,
    `${JSON.stringify(charter(programId, sourcePath))}\n`,
  );
  return { workspace, root, programId, charter: charterPath };
}

async function completedAndIdempotent(): Promise<void> {
  const test = await scenario('completed');
  const firstProcess = await invokeCli(
    cli,
    test.workspace,
    test.root,
    'run',
    test.charter,
  );
  const first = assertExit(firstProcess, 0, 'run');
  assert.equal(first.programId, test.programId);
  assert.equal(first.status, 'completed');
  const directory = join(test.root, test.programId);
  const verified = await verifyCompletedProgram(directory);
  assert.deepEqual(verified.supportedClaimIds, [
    `${test.programId}:claim:reserved`,
  ]);
  assert.deepEqual(verified.unresolvedClaimIds, [
    `${test.programId}:claim:https`,
  ]);

  const repeated = assertExit(
    await invokeCli(cli, test.workspace, test.root, 'run', test.charter),
    0,
    'run',
  );
  assert.deepEqual(repeated.result, first.result);
  assert.deepEqual(await verifyCompletedProgram(directory), verified);

  for (const command of ['status', 'inspect'] as const) {
    const envelope = assertExit(
      await invokeCli(cli, tmpdir(), test.root, command, test.programId),
      0,
      command,
    );
    assert.equal(envelope.programId, test.programId);
    assert.ok(envelope.result);
  }
  const resume = assertExit(
    await invokeCli(cli, tmpdir(), test.root, 'resume', test.programId),
    4,
  );
  assert.equal(resume.error?.code, 'PROGRAM_NOT_RESUMABLE');
}

async function restartAndResume(): Promise<void> {
  const test = await scenario('restart');
  assertExit(
    await invokeCli(cli, test.workspace, test.root, 'run', test.charter),
    0,
    'run',
  );
  const directory = join(test.root, test.programId);
  const before = await verifyCompletedProgram(directory);

  // Simulate an abrupt process death after the report/receipt durable boundary but
  // before workflow completion acknowledgement. A fresh CLI process must converge.
  const workflowPath = join(directory, 'workflow.json');
  const workflow = JSON.parse(await readFile(workflowPath, 'utf8')) as {
    executions: Record<
      string,
      { status: string; output?: unknown; error?: string }
    >;
  };
  const execution = Object.values(workflow.executions)[0];
  assert.ok(execution);
  execution.status = 'failed';
  delete execution.output;
  execution.error = 'MVP_INJECTED_POST_RECEIPT_PROCESS_DEATH';
  await writeFile(workflowPath, `${JSON.stringify(workflow)}\n`);

  assertExit(
    await invokeCli(cli, tmpdir(), test.root, 'resume', test.programId),
    0,
    'resume',
  );
  const after = await verifyCompletedProgram(directory);
  assert.equal(after.snapshotDigest, before.snapshotDigest);
  assert.deepEqual(after.semanticDigests, before.semanticDigests);
  assert.equal(after.effectReceiptCount, 1);
}

async function cancellationAndPartialTruth(): Promise<void> {
  const test = await scenario(
    'cancelled',
    join(tmpdir(), 'mammoth-source-does-not-exist'),
  );
  assertExit(
    await invokeCli(cli, test.workspace, test.root, 'run', test.charter),
    5,
  );
  const cancelled = assertExit(
    await invokeCli(cli, tmpdir(), test.root, 'cancel', test.programId),
    0,
    'cancel',
  );
  assert.equal(cancelled.status, 'cancelled');
  const directory = join(test.root, test.programId);
  await verifyPartialReceipt(directory);
  const receiptBefore = await readFile(join(directory, 'receipt.json'), 'utf8');
  assertExit(
    await invokeCli(cli, tmpdir(), test.root, 'cancel', test.programId),
    0,
    'cancel',
  );
  assert.equal(
    await readFile(join(directory, 'receipt.json'), 'utf8'),
    receiptBefore,
  );
  assertExit(
    await invokeCli(cli, tmpdir(), test.root, 'status', test.programId),
    0,
    'status',
  );
  assertExit(
    await invokeCli(cli, tmpdir(), test.root, 'inspect', test.programId),
    0,
    'inspect',
  );
  assertExit(
    await invokeCli(cli, tmpdir(), test.root, 'resume', test.programId),
    4,
  );
}

async function tamperMustBeDetected(): Promise<void> {
  const test = await scenario('tamper');
  assertExit(
    await invokeCli(cli, test.workspace, test.root, 'run', test.charter),
    0,
    'run',
  );
  const directory = join(test.root, test.programId);
  const receiptPath = join(directory, 'receipt.json');
  const receiptOriginal = await readFile(receiptPath);
  const receipt = JSON.parse(receiptOriginal.toString('utf8')) as {
    integrityHash: string;
  };
  receipt.integrityHash = receipt.integrityHash.replace(/.$/, '0');
  await writeFile(receiptPath, `${canonicalJson(receipt)}\n`);
  await assert.rejects(
    verifyCompletedProgram(directory),
    /receipt integrity hash mismatch/,
  );
  await writeFile(receiptPath, receiptOriginal);

  const tracesPath = join(directory, 'traces.json');
  const tracesOriginal = await readFile(tracesPath);
  const traces = JSON.parse(tracesOriginal.toString('utf8')) as {
    bindings: { locator: { endOffset: number } }[];
  }[];
  const binding = traces[0]?.bindings[0];
  assert.ok(binding);
  binding.locator.endOffset += 1;
  await writeFile(tracesPath, `${canonicalJson(traces)}\n`);
  await assert.rejects(
    verifyCompletedProgram(directory),
    /traces digest mismatch/,
  );
  await writeFile(tracesPath, tracesOriginal);

  const ledgerPath = join(directory, 'ledger.json');
  const ledger = JSON.parse(await readFile(ledgerPath, 'utf8')) as {
    claims: { canonicalText: string }[];
  };
  const first = ledger.claims[0];
  assert.ok(first);
  first.canonicalText = 'TAMPERED supported prose.';
  await writeFile(ledgerPath, `${canonicalJson(ledger)}\n`);
  await assert.rejects(
    verifyCompletedProgram(directory),
    /ledger digest mismatch/,
  );
}

async function invalidAndBudgetInputsFailClosed(): Promise<void> {
  const test = await scenario('budget');
  const value = JSON.parse(await readFile(test.charter, 'utf8')) as Record<
    string,
    unknown
  >;
  value.budget = { maxCostUsd: -1, maxTokens: -1, maxDurationSeconds: -1 };
  await writeFile(test.charter, `${JSON.stringify(value)}\n`);
  const result = await invokeCli(
    cli,
    test.workspace,
    test.root,
    'run',
    test.charter,
  );
  const envelope = assertExit(result, 2);
  assert.equal(envelope.error?.code, 'INVALID_CHARTER');
}

export async function verifyMvp(): Promise<void> {
  await completedAndIdempotent();
  await restartAndResume();
  await cancellationAndPartialTruth();
  await tamperMustBeDetected();
  await invalidAndBudgetInputsFailClosed();
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await verifyMvp();
  process.stdout.write('Mammoth MVP black-box acceptance passed.\n');
}
