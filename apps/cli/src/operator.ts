import { mkdir, open, readFile, realpath, rename } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import {
  runResearchProgram,
  type EntailmentVerification,
  type RuntimeBudgetAmount,
  type RuntimeCharter,
} from '@mammoth/runtime';
import { LocalWorkflowStore, WorkflowRuntime } from '@mammoth/workflow';
import { assertProgramId, parseArgs } from './parser.js';
import {
  CliError,
  type CliDependencies,
  type CliIo,
  type RunRequest,
  type RuntimeFactory,
} from './types.js';

interface OperatorDocument {
  schemaVersion: 1;
  charter: RuntimeCharter;
  verifications: Record<string, EntailmentVerification>;
  sourceFixture?: { path: string; digest: string; mediaType: string };
  retrievalUsage?: {
    estimated: RuntimeBudgetAmount;
    actual: RuntimeBudgetAmount;
  };
}

const PINNED_MVP_ORACLE = {
  sourceUrl: 'https://www.rfc-editor.org/rfc/rfc2606.txt',
  sourceDigest:
    'sha256:02950ec26917b3cf2f613fd1ec16b4d2f8fd376fb9b3aa3e72f881d9d8ecc331',
  mediaType: 'text/plain',
  criterionId: 'criterion:mvp-example-domains:v1',
  policyId: 'policy:public-direct-locator-v1',
  policyVersion: '1.0.0',
  claim: {
    id: 'claim:example-com-reserved',
    canonicalText: 'IANA reserves example.com for use as an example.',
    subject: 'IANA',
    predicate: 'reserves for use as an example',
    object: 'example.com',
    quote:
      'The Internet Assigned Numbers Authority (IANA) also currently has the\nfollowing second level domain names reserved which can be used as examples.\n\nexample.com',
    startOffset: 95,
    endOffset: 253,
    receiptId: 'verification:rfc2606-example-com',
    verifierId: 'mvp-deterministic-fixture-verifier',
    verifierVersion: '1.0.0',
  },
} as const;

const PIPELINE_STAGES = [
  'budget_committed',
  'snapshot_committed',
  'claims_assessed',
  'ledger_committed',
  'report_compiled',
  'receipt_committed',
] as const;

export async function executeCli(
  argv: readonly string[],
  dependencies: CliDependencies,
): Promise<number> {
  try {
    const command = parseArgs(argv, dependencies.cwd());
    let output: unknown;
    if (command.name === 'run') {
      const document = await readOperatorInput(command.charterPath);
      assertProgramId(document.charter.programId);
      await persistOperatorDocument(command.root, document);
      const result = await dependencies.runtime.run({
        root: command.root,
        charter: document.charter,
        verifications: document.verifications,
        ...(document.sourceFixture
          ? { sourceFixture: document.sourceFixture }
          : {}),
        ...(document.retrievalUsage
          ? { retrievalUsage: document.retrievalUsage }
          : {}),
        ...(command.maxSteps === undefined
          ? {}
          : { maxSteps: command.maxSteps }),
      });
      output = { command: 'run', ...result };
    } else if (command.name === 'status') {
      output = await statusProjection(command.root, command.programId);
    } else if (command.name === 'inspect') {
      output = await inspectProjection(command.root, command.programId);
    } else if (command.name === 'cancel') {
      output = await cancelProgram(command.root, command.programId);
    } else {
      const document = await loadOperatorDocument(
        command.root,
        command.programId,
      );
      await resumePausedExecution(command.root, command.programId);
      const result = await dependencies.runtime.run({
        root: command.root,
        charter: document.charter,
        verifications: document.verifications,
        ...(document.sourceFixture
          ? { sourceFixture: document.sourceFixture }
          : {}),
        ...(document.retrievalUsage
          ? { retrievalUsage: document.retrievalUsage }
          : {}),
        ...(command.maxSteps === undefined
          ? {}
          : { maxSteps: command.maxSteps }),
      });
      output = { command: 'resume', ...result };
    }
    dependencies.io.stdout(
      command.json ? JSON.stringify(output) : renderHuman(output),
    );
    return 0;
  } catch (error: unknown) {
    const body = {
      error: error instanceof CliError ? error.code : 'COMMAND_FAILED',
      message: error instanceof Error ? error.message : String(error),
    };
    dependencies.io.stderr(JSON.stringify(body));
    return error instanceof CliError && error.code === 'USAGE' ? 2 : 1;
  }
}

export function nodeDependencies(io: CliIo = consoleIo): CliDependencies {
  return { io, runtime: nodeRuntimeFactory(), cwd: () => process.cwd() };
}

export function nodeRuntimeFactory(): RuntimeFactory {
  return {
    async run(request: RunRequest) {
      const stages = new Set<string>();
      const pauseMessage = '__MAMMOTH_OPERATOR_PAUSE__';
      const sourceFixture = request.sourceFixture;
      const maxSteps = request.maxSteps;
      try {
        return await runResearchProgram({
          rootDirectory: request.root,
          charter: request.charter,
          transport: sourceFixture
            ? async (url) => {
                if (url.href !== request.charter.sourceUrl)
                  throw new CliError(
                    'FIXTURE_URL_MISMATCH',
                    'unexpected fixture URL',
                  );
                const bytes = await readFile(sourceFixture.path);
                if (sha256(bytes) !== sourceFixture.digest)
                  throw new CliError(
                    'FIXTURE_DIGEST_MISMATCH',
                    'fixture digest mismatch',
                  );
                return {
                  status: 200,
                  headers: new Headers({
                    'content-type': sourceFixture.mediaType,
                  }),
                  body: new Response(bytes).body,
                };
              }
            : (url, init) => fetch(url, { ...init, redirect: 'manual' }),
          ...(sourceFixture
            ? { resolveHost: () => Promise.resolve(['203.0.113.10']) }
            : {}),
          ...(request.retrievalUsage
            ? { retrievalUsage: request.retrievalUsage }
            : {}),
          verifyEntailment: (input) => verifyPinnedEntailment(request, input),
          ...(maxSteps === undefined
            ? {}
            : {
                onStage: (stage: string) => {
                  stages.add(stage);
                  if (stages.size >= maxSteps) throw new Error(pauseMessage);
                },
              }),
        });
      } catch (error: unknown) {
        if (!(error instanceof Error) || !error.message.includes(pauseMessage))
          throw error;
        const directory = await safeProgramDirectory(
          request.root,
          request.charter.programId,
          false,
        );
        const store = new LocalWorkflowStore(join(directory, 'workflow.json'));
        const execution = await store.transact((snapshot) => {
          const latest = latestExecution(snapshot);
          if (!latest || latest.status !== 'failed')
            throw new CliError(
              'PAUSE_FAILED',
              'bounded run did not stop safely',
            );
          latest.status = 'paused';
          latest.state.__pausedFrom = 'pending';
          delete latest.error;
          return structuredClone(latest);
        });
        return {
          programId: request.charter.programId,
          executionId: execution.id,
          status: 'paused',
          publicationStatus: 'partial',
          completedStages: [...stages],
        };
      }
    },
  };
}

async function readOperatorInput(path: string): Promise<OperatorDocument> {
  let input: unknown;
  try {
    input = JSON.parse(await readFile(path, 'utf8'));
  } catch (error: unknown) {
    throw new CliError(
      'INVALID_CHARTER',
      `cannot read charter: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const document = validateOperatorDocument(input);
  if (document.sourceFixture) {
    document.sourceFixture.path = resolve(
      dirname(path),
      document.sourceFixture.path,
    );
    const bytes = await readFile(document.sourceFixture.path);
    if (sha256(bytes) !== document.sourceFixture.digest)
      throw new CliError('INVALID_CHARTER', 'source fixture digest mismatch');
  }
  return document;
}

function validateOperatorDocument(input: unknown): OperatorDocument {
  if (!isRecord(input))
    throw new CliError('INVALID_CHARTER', 'expected object');
  exactKeys(
    input,
    [
      'schemaVersion',
      'charter',
      'verifications',
      'sourceFixture',
      'retrievalUsage',
    ],
    true,
  );
  if (input.schemaVersion !== 1 || !isRecord(input.charter))
    throw new CliError('INVALID_CHARTER', 'unsupported charter schema');
  const charter = input.charter;
  exactKeys(
    charter,
    [
      'programId',
      'criterionId',
      'title',
      'question',
      'sourceUrl',
      'evidencePolicyId',
      'evidencePolicyVersion',
      'sourceExpiresAt',
      'sourceRevalidateAfter',
      'budgetLimit',
      'proposals',
    ],
    true,
  );
  for (const key of [
    'programId',
    'criterionId',
    'title',
    'question',
    'sourceUrl',
    'evidencePolicyId',
    'evidencePolicyVersion',
  ]) {
    if (typeof charter[key] !== 'string' || !charter[key].trim())
      throw new CliError('INVALID_CHARTER', `invalid ${key}`);
  }
  try {
    new URL(charter.sourceUrl as string);
  } catch {
    throw new CliError('INVALID_CHARTER', 'invalid sourceUrl');
  }
  for (const key of ['sourceExpiresAt', 'sourceRevalidateAfter']) {
    if (
      charter[key] !== undefined &&
      (typeof charter[key] !== 'string' ||
        !Number.isFinite(Date.parse(charter[key])))
    )
      throw new CliError('INVALID_CHARTER', `invalid ${key}`);
  }
  if (charter.budgetLimit !== undefined)
    validateBudgetAmount(charter.budgetLimit, 'charter budgetLimit');
  if (!Array.isArray(charter.proposals) || charter.proposals.length === 0)
    throw new CliError('INVALID_CHARTER', 'proposals must be non-empty');
  for (const proposal of charter.proposals) {
    if (!isRecord(proposal))
      throw new CliError('INVALID_CHARTER', 'invalid proposal');
    exactKeys(
      proposal,
      [
        'id',
        'canonicalText',
        'subject',
        'predicate',
        'object',
        'supportingQuote',
        'locator',
      ],
      true,
    );
    for (const key of [
      'id',
      'canonicalText',
      'subject',
      'predicate',
      'object',
      'supportingQuote',
    ])
      if (typeof proposal[key] !== 'string' || !proposal[key].trim())
        throw new CliError('INVALID_CHARTER', `invalid proposal ${key}`);
  }
  if (!isRecord(input.verifications))
    throw new CliError('INVALID_CHARTER', 'verifications must be an object');
  for (const [claimId, value] of Object.entries(input.verifications)) {
    if (!isRecord(value))
      throw new CliError('INVALID_CHARTER', `invalid verification ${claimId}`);
    exactKeys(value, ['entails', 'receiptId', 'verifierId', 'verifierVersion']);
    if (
      typeof value.entails !== 'boolean' ||
      !nonempty(value.receiptId) ||
      !nonempty(value.verifierId) ||
      !nonempty(value.verifierVersion)
    )
      throw new CliError('INVALID_CHARTER', `invalid verification ${claimId}`);
  }
  if (input.sourceFixture !== undefined) {
    if (!isRecord(input.sourceFixture))
      throw new CliError('INVALID_CHARTER', 'sourceFixture must be an object');
    exactKeys(input.sourceFixture, ['path', 'digest', 'mediaType']);
    if (
      !nonempty(input.sourceFixture.path) ||
      !/^sha256:[0-9a-f]{64}$/.test(String(input.sourceFixture.digest)) ||
      !nonempty(input.sourceFixture.mediaType)
    )
      throw new CliError('INVALID_CHARTER', 'invalid sourceFixture');
  }
  if (input.retrievalUsage !== undefined) {
    if (!isRecord(input.retrievalUsage))
      throw new CliError('INVALID_CHARTER', 'retrievalUsage must be an object');
    exactKeys(input.retrievalUsage, ['estimated', 'actual']);
    validateBudgetAmount(
      input.retrievalUsage.estimated,
      'retrievalUsage estimated',
    );
    validateBudgetAmount(input.retrievalUsage.actual, 'retrievalUsage actual');
  }
  return input as unknown as OperatorDocument;
}

async function persistOperatorDocument(
  root: string,
  document: OperatorDocument,
) {
  const directory = await safeProgramDirectory(
    root,
    document.charter.programId,
    true,
  );
  const stored = structuredClone(document);
  if (document.sourceFixture) {
    const bytes = await readFile(document.sourceFixture.path);
    const fixturePath = join(directory, 'operator-source.bin');
    await writeAtomic(fixturePath, bytes);
    stored.sourceFixture = { ...document.sourceFixture, path: fixturePath };
  }
  const path = join(directory, 'operator.json');
  try {
    const prior = validateOperatorDocument(
      JSON.parse(await readFile(path, 'utf8')),
    );
    if (canonicalOperator(prior) !== canonicalOperator(stored))
      throw new CliError(
        'CHARTER_CONFLICT',
        'operator charter differs from pinned input',
      );
    return;
  } catch (error: unknown) {
    if (!missing(error)) throw error;
  }
  await writeAtomic(path, `${JSON.stringify(stored)}\n`);
}

async function loadOperatorDocument(root: string, programId: string) {
  const directory = await safeProgramDirectory(root, programId, false);
  return readOperatorInput(join(directory, 'operator.json'));
}

async function statusProjection(root: string, programId: string) {
  const directory = await safeProgramDirectory(root, programId, false);
  const workflow = await readJson(join(directory, 'workflow.json'));
  if (!isRecord(workflow) || !isRecord(workflow.executions))
    throw new CliError('CORRUPT_STATE', 'invalid workflow projection');
  const executions = Object.values(workflow.executions).filter(isRecord);
  const latest = executions
    .sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt)))
    .at(-1);
  if (!latest)
    throw new CliError('PROGRAM_NOT_FOUND', `no execution for ${programId}`);
  return {
    command: 'status',
    programId,
    executionId: latest.id,
    status: latest.status,
    stepId: latest.stepId,
    stepIndex: latest.stepIndex,
    attempt: latest.attempt,
    updatedAt: latest.updatedAt,
    completed: latest.status === 'completed',
    artifacts: await artifactPresence(directory),
  };
}

async function inspectProjection(root: string, programId: string) {
  const directory = await safeProgramDirectory(root, programId, false);
  const status = await statusProjection(root, programId);
  return {
    command: 'inspect',
    programId,
    status,
    charter: await optionalJson(join(directory, 'charter.json')),
    ledger: await optionalJson(join(directory, 'ledger.json')),
    manifest: await optionalJson(join(directory, 'manifest.json')),
    assessments: await optionalJson(join(directory, 'assessments.json')),
    revalidation: await optionalJson(join(directory, 'revalidation.json')),
    traces: await optionalJson(join(directory, 'traces.json')),
    receipt: await optionalJson(join(directory, 'receipt.json')),
    cancellationReceipt: await optionalJson(
      join(directory, 'cancellation-receipt.json'),
    ),
    audit: await optionalJson(join(directory, 'audit.json')),
    report: await optionalText(join(directory, 'dossier.md')),
  };
}

async function cancelProgram(root: string, programId: string) {
  const directory = await safeProgramDirectory(root, programId, false);
  const store = new LocalWorkflowStore(join(directory, 'workflow.json'));
  const latest = latestExecution(await store.load());
  if (!latest)
    throw new CliError('PROGRAM_NOT_FOUND', `no execution for ${programId}`);
  const cancellation = await new WorkflowRuntime(store).cancel(
    latest.id,
    'operator request',
  );
  const cancellationReceipt = await writeCancellationReceipt(
    directory,
    programId,
    latest.id,
    cancellation,
  );
  return {
    command: 'cancel',
    programId,
    executionId: latest.id,
    status: 'cancelled',
    cancellation,
    cancellationReceipt,
  };
}

async function resumePausedExecution(root: string, programId: string) {
  const directory = await safeProgramDirectory(root, programId, false);
  const store = new LocalWorkflowStore(join(directory, 'workflow.json'));
  const latest = latestExecution(await store.load());
  if (!latest)
    throw new CliError('PROGRAM_NOT_FOUND', `no execution for ${programId}`);
  if (latest.status === 'cancelled' || latest.status === 'completed')
    throw new CliError(
      'NOT_RESUMABLE',
      `cannot resume ${latest.status} execution`,
    );
  if (latest.status === 'paused')
    await new WorkflowRuntime(store).resume(latest.id);
}

function latestExecution(
  snapshot: Awaited<ReturnType<LocalWorkflowStore['load']>>,
) {
  return Object.values(snapshot.executions)
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
    .at(-1);
}

async function safeProgramDirectory(root: string, id: string, create: boolean) {
  assertProgramId(id);
  const resolvedRoot = resolve(root);
  const directory = resolve(resolvedRoot, id);
  if (create) await mkdir(directory, { recursive: true });
  try {
    const [realRoot, realDirectory] = await Promise.all([
      realpath(resolvedRoot),
      realpath(directory),
    ]);
    const location = relative(realRoot, realDirectory);
    if (!location || location.startsWith('..'))
      throw new CliError('UNSAFE_PATH', 'program path escapes root');
  } catch (error: unknown) {
    if (missing(error))
      throw new CliError('PROGRAM_NOT_FOUND', `program not found: ${id}`);
    throw error;
  }
  return directory;
}

async function artifactPresence(directory: string) {
  const names = [
    'charter.json',
    'workflow.json',
    'queue.json',
    'governance.json',
    'ledger.json',
    'snapshot.json',
    'assessments.json',
    'revalidation.json',
    'manifest.json',
    'traces.json',
    'dossier.md',
    'receipt.json',
    'cancellation-receipt.json',
    'audit.json',
  ];
  return Object.fromEntries(
    await Promise.all(
      names.map(
        async (name) => [name, await exists(join(directory, name))] as const,
      ),
    ),
  );
}

async function readJson(path: string) {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}
async function optionalJson(path: string) {
  try {
    return await readJson(path);
  } catch (error) {
    if (missing(error)) return undefined;
    throw error;
  }
}
async function optionalText(path: string) {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (missing(error)) return undefined;
    throw error;
  }
}
async function exists(path: string) {
  try {
    await readFile(path);
    return true;
  } catch (error) {
    if (missing(error)) return false;
    throw error;
  }
}

async function writeAtomic(path: string, content: string | Uint8Array) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${String(process.pid)}.${crypto.randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, path);
  const parent = await open(dirname(path), 'r');
  try {
    await parent.sync();
  } finally {
    await parent.close();
  }
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  optional = false,
) {
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extras.length)
    throw new CliError(
      'INVALID_CHARTER',
      `unknown field: ${extras[0] ?? '<unknown>'}`,
    );
  if (!optional)
    for (const key of allowed)
      if (!(key in value))
        throw new CliError('INVALID_CHARTER', `missing field: ${key}`);
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
function validateBudgetAmount(value: unknown, name: string): void {
  if (!isRecord(value))
    throw new CliError('INVALID_CHARTER', `${name} must be an object`);
  exactKeys(value, ['costUsd', 'tokens', 'durationMs']);
  for (const unit of ['costUsd', 'tokens', 'durationMs']) {
    const amount = value[unit];
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0)
      throw new CliError('INVALID_CHARTER', `invalid ${name} ${unit}`);
  }
}
function missing(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}
function renderHuman(value: unknown) {
  return JSON.stringify(value, null, 2);
}
function canonicalOperator(value: OperatorDocument) {
  return JSON.stringify({
    ...value,
    ...(value.sourceFixture
      ? { sourceFixture: { ...value.sourceFixture, path: '<pinned-source>' } }
      : {}),
  });
}
function sha256(value: Uint8Array) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function verifyPinnedEntailment(
  request: RunRequest,
  input: Parameters<
    NonNullable<Parameters<typeof runResearchProgram>[0]['verifyEntailment']>
  >[0],
): EntailmentVerification {
  const supplied = request.verifications[input.claim.id];
  if (!supplied?.entails) {
    return {
      entails: false,
      receiptId: supplied?.receiptId ?? `cli:no-verification:${input.claim.id}`,
      verifierId: supplied?.verifierId ?? 'mammoth-cli-fail-closed',
      verifierVersion: supplied?.verifierVersion ?? '1.0.0',
    };
  }
  const oracle = PINNED_MVP_ORACLE;
  const claim = oracle.claim;
  const fixture = request.sourceFixture;
  const trusted =
    fixture?.digest === oracle.sourceDigest &&
    fixture.mediaType === oracle.mediaType &&
    request.charter.sourceUrl === oracle.sourceUrl &&
    request.charter.criterionId === oracle.criterionId &&
    request.charter.evidencePolicyId === oracle.policyId &&
    request.charter.evidencePolicyVersion === oracle.policyVersion &&
    input.snapshotDigest === oracle.sourceDigest &&
    input.claim.id === claim.id &&
    input.claim.canonicalText === claim.canonicalText &&
    input.claim.subject === claim.subject &&
    input.claim.predicate === claim.predicate &&
    input.claim.object === claim.object &&
    input.quote === claim.quote &&
    input.locator.startOffset === claim.startOffset &&
    input.locator.endOffset === claim.endOffset &&
    supplied.receiptId === claim.receiptId &&
    supplied.verifierId === claim.verifierId &&
    supplied.verifierVersion === claim.verifierVersion;
  if (!trusted) {
    throw new CliError(
      'UNTRUSTED_ENTAILMENT',
      'UNTRUSTED_ENTAILMENT: support promotion is limited to the pinned RFC 2606 MVP fixture oracle',
    );
  }
  return supplied;
}

async function writeCancellationReceipt(
  directory: string,
  programId: string,
  executionId: string,
  cancellation: {
    requestedAt: string;
    completedAt: string;
    reason?: string;
    partialState: Record<string, unknown>;
  },
) {
  const path = join(directory, 'cancellation-receipt.json');
  const existing = await optionalJson(path);
  if (isRecord(existing)) return existing;
  const completedStages = await completedPipelineStages(
    directory,
    cancellation.partialState,
  );
  const body = {
    schemaVersion: 1,
    receiptId: `${programId}:cancellation:${executionId}`,
    programId,
    executionId,
    status: 'cancelled',
    reason: cancellation.reason ?? 'unspecified',
    requestedAt: cancellation.requestedAt,
    completedAt: cancellation.completedAt,
    completedStages,
    omittedStages: PIPELINE_STAGES.filter(
      (stage) => !completedStages.includes(stage),
    ),
    partialState: cancellation.partialState,
  };
  const receipt = { ...body, integrityHash: canonicalDigest(body) };
  await writeAtomic(path, `${canonicalJson(receipt)}\n`);
  return receipt;
}

async function completedPipelineStages(
  directory: string,
  partialState: Readonly<Record<string, unknown>>,
): Promise<(typeof PIPELINE_STAGES)[number][]> {
  const completed = new Set<(typeof PIPELINE_STAGES)[number]>();
  const audit = await optionalJson(join(directory, 'audit.json'));
  if (isRecord(audit) && Array.isArray(audit.events)) {
    for (const event of audit.events) {
      if (
        isRecord(event) &&
        PIPELINE_STAGES.includes(
          event.stage as (typeof PIPELINE_STAGES)[number],
        )
      ) {
        completed.add(event.stage as (typeof PIPELINE_STAGES)[number]);
      }
    }
  }
  const stateStages: readonly (readonly [
    string,
    (typeof PIPELINE_STAGES)[number],
  ])[] = [
    ['commit-budget', 'budget_committed'],
    ['snapshot-source', 'snapshot_committed'],
    ['assess-claims', 'claims_assessed'],
    ['persist-ledger', 'ledger_committed'],
    ['compile-report', 'report_compiled'],
    ['commit-receipt', 'receipt_committed'],
  ];
  for (const [key, stage] of stateStages)
    if (partialState[key] === 'committed') completed.add(stage);
  const artifactStages: readonly (readonly [
    string,
    (typeof PIPELINE_STAGES)[number],
  ])[] = [
    ['governance.json', 'budget_committed'],
    ['snapshot.json', 'snapshot_committed'],
    ['assessments.json', 'claims_assessed'],
    ['ledger.json', 'ledger_committed'],
    ['manifest.json', 'report_compiled'],
    ['receipt.json', 'receipt_committed'],
  ];
  for (const [name, stage] of artifactStages)
    if (await exists(join(directory, name))) completed.add(stage);
  return PIPELINE_STAGES.filter((stage) => completed.has(stage));
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function canonicalDigest(value: unknown): string {
  return sha256(new TextEncoder().encode(canonicalJson(value)));
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
const consoleIo: CliIo = {
  stdout: (value) => {
    console.log(value);
  },
  stderr: (value) => {
    console.error(value);
  },
};
import { createHash } from 'node:crypto';
