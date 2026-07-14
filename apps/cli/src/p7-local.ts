import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  createModelEgressPolicy,
  evaluateModelEgress,
  type ModelEgressPolicy,
} from '@mammoth/governance';
import { OpenAICompatibleModelProvider } from '@mammoth/openai-compatible-provider';
import {
  GovernedProviderCellExecutor,
  ModelWorkP7ResearchAuthority,
  P7ResearchApplicationService,
  createP7GovernedCellPlanner,
  type P7ExpectedCellReader,
  type P7GovernedCellExecutor,
  type P7GovernedCellPlanner,
  type P7ModelEgressEvaluator,
  type P7ResearchAuthorityReader,
  type P7ResearchOrchestrationPort,
} from '@mammoth/p7-application-service';
import { JournaledP7ModelWorkRepository } from '@mammoth/persistence';
import {
  FileContentStore,
  type ContentAddressedStore,
} from '@mammoth/retrieval';
import {
  deriveP7ResearchRunId,
  parseP7ResearchRunRequest,
  type P7ResearchApplicationPort,
  type P7ResearchRunRequest,
} from '@mammoth/workflow';
import { executeP7ResearchCli, type P7CliIo } from './p7-operator.js';

const RUN_DIGEST = /^sha256:[0-9a-f]{64}$/u;
const DEFAULT_PROVIDER_MODE = 'local';
const DEFAULT_PROVIDER_NAME = 'ollama';

export interface LocalP7Environment {
  readonly home: string;
  readonly cellIds: readonly string[];
  readonly cellDelayMs: number;
  readonly providerBaseUrl: string;
  readonly providerModel: string;
  readonly providerName: string;
  readonly providerMode: 'local' | 'governed';
  readonly providerApprovedOrigins: readonly string[];
  readonly providerApiKeyEnvironmentVariable?: string;
  readonly providerTimeoutMs: number;
  readonly providerMaximumResponseBytes: number;
  readonly dataClassification: 'local_only' | 'cloud_allowed';
  readonly egressPolicy: ModelEgressPolicy;
}

export function localP7EnvironmentFromEnv(
  env: NodeJS.ProcessEnv,
): LocalP7Environment {
  const home = env.MAMMOTH_P7_HOME;
  if (!home)
    throw new Error('MAMMOTH_P7_HOME must point to a local P7 state directory');
  const cellIds = (env.MAMMOTH_P7_CELLS ?? 'cell-a,cell-b,cell-c')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (cellIds.length === 0)
    throw new Error('MAMMOTH_P7_CELLS must name at least one cell');
  const cellDelayMs = Number(env.MAMMOTH_P7_TEST_DELAY_MS ?? '0');
  if (!Number.isInteger(cellDelayMs) || cellDelayMs < 0)
    throw new Error(
      'MAMMOTH_P7_TEST_DELAY_MS must be a non-negative integer of milliseconds',
    );
  const providerBaseUrl = requiredEnv(env, 'MAMMOTH_P7_PROVIDER_BASE_URL');
  const providerModel = requiredEnv(env, 'MAMMOTH_P7_PROVIDER_MODEL');
  const providerName = env.MAMMOTH_P7_PROVIDER_NAME ?? DEFAULT_PROVIDER_NAME;
  const providerMode = parseProviderMode(
    env.MAMMOTH_P7_PROVIDER_MODE ?? DEFAULT_PROVIDER_MODE,
  );
  const providerApprovedOrigins = parseCsv(
    env.MAMMOTH_P7_PROVIDER_APPROVED_ORIGINS ?? new URL(providerBaseUrl).origin,
  );
  const providerApiKeyEnvironmentVariable = env.MAMMOTH_P7_PROVIDER_API_KEY_ENV;
  const providerTimeoutMs = nonnegativeIntegerFromEnv(
    env,
    'MAMMOTH_P7_PROVIDER_TIMEOUT_MS',
    30_000,
  );
  const providerMaximumResponseBytes = nonnegativeIntegerFromEnv(
    env,
    'MAMMOTH_P7_PROVIDER_MAX_RESPONSE_BYTES',
    2 * 1024 * 1024,
  );
  const dataClassification = parseDataClassification(
    env.MAMMOTH_P7_DATA_CLASSIFICATION ?? 'local_only',
  );
  const egressPolicy = createModelEgressPolicy(
    parseCsv(env.MAMMOTH_P7_APPROVED_CLOUD_ORIGINS ?? ''),
  );
  return {
    home,
    cellIds,
    cellDelayMs,
    providerBaseUrl,
    providerModel,
    providerName,
    providerMode,
    providerApprovedOrigins,
    ...(providerApiKeyEnvironmentVariable === undefined
      ? {}
      : { providerApiKeyEnvironmentVariable }),
    providerTimeoutMs,
    providerMaximumResponseBytes,
    dataClassification,
    egressPolicy,
  };
}

/**
 * In-process orchestration over the durable local authority: `start` and
 * `resume` drive unresolved cells sequentially through the governed
 * executor; every acknowledged effect lives in the journal + CAS, so a
 * killed process resumes idempotently from reconstruction alone.
 */
class LocalP7ResearchOrchestrator implements P7ResearchOrchestrationPort {
  constructor(
    private readonly executor: P7GovernedCellExecutor,
    private readonly planner: P7GovernedCellPlanner,
    private readonly authority: P7ResearchAuthorityReader,
    private readonly cas: ContentAddressedStore,
    private readonly cellDelayMs: number,
  ) {}

  async start(
    request: P7ResearchRunRequest,
  ): Promise<{ readonly runId: string }> {
    const runId = deriveP7ResearchRunId(request);
    await this.drive(runId, request);
    return { runId };
  }

  async resume(input: { readonly runId: string }): Promise<void> {
    await this.drive(input.runId, await this.loadRequest(input.runId));
  }

  async cancel(input: {
    readonly runId: string;
    readonly reason: string;
  }): Promise<void> {
    const request = await this.loadRequest(input.runId);
    const cells = await this.planner.resolve(request);
    await this.executor.cancel({
      runId: input.runId,
      request,
      cells,
      reason: input.reason,
    });
  }

  private async drive(
    runId: string,
    request: P7ResearchRunRequest,
  ): Promise<void> {
    const cells = await this.planner.resolve(request);
    const status = await this.authority.status(runId);
    const resolved = new Set([
      ...status.completedCellIds,
      ...status.cancelledCellIds,
    ]);
    for (const [index, cell] of cells.entries()) {
      if (resolved.has(cell.cellId)) continue;
      const outcome = await this.executor.execute({
        runId,
        request,
        cells,
        cell,
      });
      if (outcome.status !== 'completed' && !outcome.retryable) break;
      if (this.cellDelayMs > 0 && index < cells.length - 1) {
        await sleep(this.cellDelayMs);
      }
    }
  }

  private async loadRequest(runId: string): Promise<P7ResearchRunRequest> {
    const segment = runId.slice(runId.lastIndexOf(':') + 1);
    const digest = decodeURIComponent(segment);
    if (!RUN_DIGEST.test(digest)) throw new Error('invalid P7 run ID');
    const bytes = await this.cas.get(digest);
    const request = parseP7ResearchRunRequest(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
    );
    if (deriveP7ResearchRunId(request) !== runId)
      throw new Error('P7 run request does not match run ID');
    return request;
  }
}

export async function withLocalP7ResearchApplication<T>(
  environment: LocalP7Environment,
  operation: (application: P7ResearchApplicationPort) => Promise<T>,
): Promise<T> {
  const repository = await JournaledP7ModelWorkRepository.open(
    join(environment.home, 'model-work.jsonl'),
  );
  try {
    const cas = new FileContentStore(join(environment.home, 'cas'));
    const provider = new OpenAICompatibleModelProvider({
      baseUrl: environment.providerBaseUrl,
      configuredModel: environment.providerModel,
      providerName: environment.providerName,
      mode: environment.providerMode,
      approvedOrigins: environment.providerApprovedOrigins,
      environment: process.env,
      ...(environment.providerApiKeyEnvironmentVariable === undefined
        ? {}
        : {
            apiKeyEnvironmentVariable:
              environment.providerApiKeyEnvironmentVariable,
          }),
      timeoutMs: environment.providerTimeoutMs,
      maximumResponseBytes: environment.providerMaximumResponseBytes,
    });
    const topology: P7ExpectedCellReader = {
      cellIds: () => Promise.resolve([...environment.cellIds]),
    };
    const authority = new ModelWorkP7ResearchAuthority(
      cas,
      repository,
      topology,
    );
    const egress: P7ModelEgressEvaluator = {
      policyDigest: environment.egressPolicy.digest,
      evaluate: (input) =>
        evaluateModelEgress(
          { ...input, allowedTools: [] },
          environment.egressPolicy,
        ),
    };
    const executor = new GovernedProviderCellExecutor({
      provider,
      repository,
      cas,
      authority,
      egress,
      destinationOrigin: new URL(environment.providerBaseUrl).origin,
      dataClassification: environment.dataClassification,
    });
    const planner = createP7GovernedCellPlanner(provider, topology);
    const orchestration = new LocalP7ResearchOrchestrator(
      executor,
      planner,
      authority,
      cas,
      environment.cellDelayMs,
    );
    return await operation(
      new P7ResearchApplicationService(orchestration, authority),
    );
  } finally {
    await repository.close();
  }
}

function requiredEnv(
  env: NodeJS.ProcessEnv,
  key: keyof NodeJS.ProcessEnv & string,
): string {
  const value = env[key];
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function parseCsv(value: string): readonly string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function parseProviderMode(value: string): 'local' | 'governed' {
  if (value === 'local' || value === 'governed') return value;
  throw new Error('MAMMOTH_P7_PROVIDER_MODE must be local or governed');
}

function parseDataClassification(
  value: string,
): 'local_only' | 'cloud_allowed' {
  if (value === 'local_only' || value === 'cloud_allowed') return value;
  throw new Error(
    'MAMMOTH_P7_DATA_CLASSIFICATION must be local_only or cloud_allowed',
  );
}

function nonnegativeIntegerFromEnv(
  env: NodeJS.ProcessEnv,
  key: keyof NodeJS.ProcessEnv & string,
  fallback: number,
): number {
  const raw = env[key];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${key} must be a positive integer`);
  }
  return value;
}

export async function executeLocalP7ResearchCli(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  io: P7CliIo,
): Promise<number> {
  try {
    const environment = localP7EnvironmentFromEnv(env);
    return await withLocalP7ResearchApplication(environment, (application) =>
      executeP7ResearchCli(argv, application, io),
    );
  } catch (error: unknown) {
    io.stderr(
      JSON.stringify({
        error: 'P7_RESEARCH_COMMAND_FAILED',
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return 2;
  }
}
