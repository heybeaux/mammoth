import { spawn } from 'node:child_process';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  deriveP7ResearchRunId,
  type P7ResearchRunRequest,
  type P7ResearchStatus,
} from '@mammoth/workflow';

const digest =
  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const checkpoint =
  'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
const repoRoot = resolve(fileURLToPath(new URL('../../..', import.meta.url)));

interface CliResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

interface ProviderFixture {
  readonly origin: string;
  readonly requests: readonly {
    readonly method: string;
    readonly path: string;
    readonly idempotencyKey?: string;
    readonly body?: unknown;
  }[];
  close(): Promise<void>;
}

let fixtures: ProviderFixture[] = [];
let roots: string[] = [];

beforeEach(() => {
  fixtures = [];
  roots = [];
});

afterEach(async () => {
  await Promise.all(fixtures.map((fixture) => fixture.close()));
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('P7 local research CLI black-box provider loop', () => {
  it('drives governed OpenAI-compatible provider work through the CLI', async () => {
    const provider = await startProvider();
    const root = await stateRoot();
    const requestPath = await writeRequest(root, request('blackbox'));

    const result = await mammoth(
      ['research', 'run', requestPath],
      env(root, provider.origin, ['cell-a']),
    );

    expect(result).toMatchObject({ code: 0, stderr: '' });
    const payload = JSON.parse(result.stdout) as P7ResearchStatus & {
      readonly command: string;
    };
    expect(payload).toMatchObject({
      command: 'research run',
      state: 'completed',
      completedCellIds: ['cell-a'],
      unresolvedCellIds: [],
    });
    const posts = provider.requests.filter((entry) => entry.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0]?.idempotencyKey).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(JSON.stringify(posts[0]?.body)).toContain('Cell cell-a');
  });

  it('reconstructs authority after killing the CLI process and resumes unresolved cells', async () => {
    const provider = await startProvider();
    const root = await stateRoot();
    const runRequest = request('restart');
    const requestPath = await writeRequest(root, runRequest);
    const runId = deriveP7ResearchRunId(runRequest);
    const running = spawnMammoth(
      ['research', 'run', requestPath],
      env(root, provider.origin, ['cell-a', 'cell-b'], {
        MAMMOTH_P7_TEST_DELAY_MS: '30000',
      }),
    );

    await waitForStatus(root, provider.origin, runId, (current) =>
      current.completedCellIds.includes('cell-a'),
    );
    running.kill('SIGKILL');
    await running.settled;

    const afterKill = await mammoth(
      ['research', 'status', runId],
      env(root, provider.origin, ['cell-a', 'cell-b']),
    );
    expect(afterKill.code).toBe(0);
    expect(JSON.parse(afterKill.stdout)).toMatchObject({
      command: 'research status',
      state: 'running',
      completedCellIds: ['cell-a'],
      unresolvedCellIds: ['cell-b'],
    });

    const resumed = await mammoth(
      ['research', 'resume', runId],
      env(root, provider.origin, ['cell-a', 'cell-b']),
    );
    expect(resumed.code).toBe(0);
    expect(JSON.parse(resumed.stdout)).toMatchObject({
      command: 'research resume',
      state: 'completed',
      completedCellIds: ['cell-a', 'cell-b'],
      unresolvedCellIds: [],
    });
    const posts = provider.requests.filter((entry) => entry.method === 'POST');
    expect(posts).toHaveLength(2);
    expect(new Set(posts.map((entry) => entry.idempotencyKey)).size).toBe(2);
  }, 20_000);
});

async function startProvider(): Promise<ProviderFixture> {
  const requests: {
    method: string;
    path: string;
    idempotencyKey?: string;
    body?: unknown;
  }[] = [];
  const server = createServer((incoming, response) => {
    void handleProviderRequest(incoming, response, requests);
  });
  await new Promise<void>((resolveListening) =>
    server.listen(0, '127.0.0.1', resolveListening),
  );
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('provider fixture did not bind a TCP port');
  }
  return {
    origin: `http://127.0.0.1:${String(address.port)}`,
    requests,
    close: () =>
      new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => {
          if (error) rejectClose(error);
          else resolveClose();
        });
      }),
  };
}

async function handleProviderRequest(
  requestMessage: IncomingMessage,
  response: ServerResponse,
  requests: {
    method: string;
    path: string;
    idempotencyKey?: string;
    body?: unknown;
  }[],
): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of requestMessage as AsyncIterable<Buffer>) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  const body = raw.length === 0 ? undefined : (JSON.parse(raw) as unknown);
  const path = requestMessage.url ?? '/';
  const idempotencyKey = requestMessage.headers['idempotency-key'];
  requests.push({
    method: requestMessage.method ?? 'GET',
    path,
    ...(typeof idempotencyKey === 'string' ? { idempotencyKey } : {}),
    ...(body === undefined ? {} : { body }),
  });
  response.setHeader('content-type', 'application/json');
  if (requestMessage.method === 'GET' && path === '/api/tags') {
    response.end(
      JSON.stringify({
        models: [
          {
            name: 'fixture:latest',
            model: 'fixture:latest',
            digest: checkpoint,
            details: { context_length: 8192 },
          },
        ],
      }),
    );
    return;
  }
  if (requestMessage.method === 'POST' && path === '/v1/chat/completions') {
    response.end(
      JSON.stringify({
        id: `operation-${String(requests.filter((entry) => entry.method === 'POST').length)}`,
        model: 'fixture:latest',
        choices: [
          {
            finish_reason: 'stop',
            message: {
              role: 'assistant',
              content: JSON.stringify({
                observations: ['black-box governed provider observation'],
                claimProposals: [],
                evidenceReferences: [],
                assumptions: [],
                dissent: [],
                proposedFalsifiers: [],
              }),
            },
          },
        ],
        usage: {
          prompt_tokens: 12,
          completion_tokens: 8,
          total_tokens: 20,
        },
      }),
    );
    return;
  }
  response.statusCode = 404;
  response.end(JSON.stringify({ error: 'not found' }));
}

async function stateRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'mammoth-p7-blackbox-'));
  roots.push(root);
  return root;
}

async function writeRequest(
  root: string,
  value: P7ResearchRunRequest,
): Promise<string> {
  const path = join(root, 'request.json');
  await writeFile(path, JSON.stringify(value));
  return path;
}

function request(suffix: string): P7ResearchRunRequest {
  return {
    applicationContractMajor: 1,
    workflowVersion: 1,
    charterDigest: digest,
    topology: {
      topologyId: `topology-cli-${suffix}`,
      topologyDigest: digest,
      dependencyDigest: digest,
      programId: `program-cli-${suffix}`,
      workItemId: `work-cli-${suffix}`,
      criterion: {
        criterionId: `criterion-cli-${suffix}`,
        criterionVersion: 1,
        criterionDigest: digest,
        branchId: 'main',
      },
      topologyPlanVersion: '1.0.0',
      plannerPolicyVersion: '1.0.0',
      templateCatalogVersion: '1.0.0',
    },
    modelWorkPolicyDigest: digest,
    modelProfileVersionId: 'profile-cli',
    modelProfileVersionDigest: digest,
    promptTemplateDigest: digest,
    toolContractDigest: digest,
    outputSchemaDigest: digest,
    budget: {
      inputTokens: 100,
      outputTokens: 50,
      currencyMicros: 0,
      wallClockMs: 30_000,
      toolCalls: 0,
    },
  };
}

function env(
  root: string,
  origin: string,
  cellIds: readonly string[],
  overrides: Readonly<Record<string, string>> = {},
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    MAMMOTH_P7_HOME: root,
    MAMMOTH_P7_CELLS: cellIds.join(','),
    MAMMOTH_P7_PROVIDER_BASE_URL: origin,
    MAMMOTH_P7_PROVIDER_MODEL: 'fixture:latest',
    MAMMOTH_P7_PROVIDER_NAME: 'fixture-openai-compatible',
    MAMMOTH_P7_PROVIDER_MODE: 'local',
    MAMMOTH_P7_PROVIDER_APPROVED_ORIGINS: origin,
    ...overrides,
  };
}

function spawnMammoth(
  args: readonly string[],
  childEnv: NodeJS.ProcessEnv,
): {
  readonly settled: Promise<CliResult>;
  kill(signal: NodeJS.Signals): void;
} {
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', 'apps/cli/src/bin.ts', ...args],
    {
      cwd: repoRoot,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });
  return {
    settled: new Promise((resolveProcess, rejectProcess) => {
      child.on('error', rejectProcess);
      child.on('close', (code) => {
        resolveProcess({ code, stdout, stderr });
      });
    }),
    kill: (signal) => {
      child.kill(signal);
    },
  };
}

async function mammoth(
  args: readonly string[],
  childEnv: NodeJS.ProcessEnv,
): Promise<CliResult> {
  return spawnMammoth(args, childEnv).settled;
}

async function waitForStatus(
  root: string,
  origin: string,
  runId: string,
  predicate: (current: P7ResearchStatus) => boolean,
): Promise<void> {
  const deadline = Date.now() + 15_000;
  let last = '';
  while (Date.now() < deadline) {
    const result = await mammoth(
      ['research', 'status', runId],
      env(root, origin, ['cell-a', 'cell-b']),
    );
    last = result.stdout || result.stderr;
    if (result.code === 0) {
      const current = JSON.parse(result.stdout) as P7ResearchStatus;
      if (predicate(current)) return;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`timed out waiting for P7 status: ${last}`);
}
