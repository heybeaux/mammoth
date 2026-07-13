import { resolve } from 'node:path';

export interface TemporalAdapterConfig {
  readonly root: string;
  readonly cliPath: string;
  readonly address: string;
  readonly host: string;
  readonly port: number;
  readonly namespace: string;
  readonly taskQueue: string;
  readonly retentionDays: number;
  readonly serviceVersion: string;
  readonly workflowBundleId: string;
  readonly workerBuildId: string;
  readonly startupTimeoutMs: number;
  readonly shutdownTimeoutMs: number;
  readonly readinessTimeoutMs: number;
}

export class TemporalConfigError extends Error {
  override readonly name = 'TemporalConfigError';
}

export function loadTemporalAdapterConfig(
  env: NodeJS.ProcessEnv,
): TemporalAdapterConfig {
  const ci = env.CI === 'true' || env.GITHUB_ACTIONS === 'true';
  const host = nonEmpty(env.MAMMOTH_TEMPORAL_HOST ?? '127.0.0.1', 'host');
  const port = integer(env, 'MAMMOTH_TEMPORAL_PORT', 7233, 1024, 65535);
  const derivedAddress = `${host}:${String(port)}`;
  const address = nonEmpty(
    env.MAMMOTH_TEMPORAL_ADDRESS ?? derivedAddress,
    'MAMMOTH_TEMPORAL_ADDRESS',
  );
  if (address !== derivedAddress) {
    throw new TemporalConfigError(
      'MAMMOTH_TEMPORAL_ADDRESS must match MAMMOTH_TEMPORAL_HOST and MAMMOTH_TEMPORAL_PORT',
    );
  }
  return {
    root: resolve(env.MAMMOTH_PROFILE_ROOT ?? '.mammoth/production-profile'),
    cliPath: env.MAMMOTH_TEMPORAL_CLI ?? 'temporal',
    address,
    host,
    port,
    namespace: nonEmpty(
      env.MAMMOTH_TEMPORAL_NAMESPACE ?? defaultNamespace(env, ci),
      'MAMMOTH_TEMPORAL_NAMESPACE',
    ),
    taskQueue: nonEmpty(
      env.MAMMOTH_TEMPORAL_TASK_QUEUE ?? 'mammoth-research-control-v1',
      'MAMMOTH_TEMPORAL_TASK_QUEUE',
    ),
    retentionDays: integer(
      env,
      'MAMMOTH_TEMPORAL_RETENTION_DAYS',
      ci ? 1 : 7,
      1,
      30,
    ),
    serviceVersion: pinnedVersion(
      env.MAMMOTH_TEMPORAL_SERVICE_VERSION ?? '1.8.0',
    ),
    workflowBundleId: nonEmpty(
      env.MAMMOTH_TEMPORAL_WORKFLOW_BUNDLE_ID ?? 'mammoth-probe-v1',
      'MAMMOTH_TEMPORAL_WORKFLOW_BUNDLE_ID',
    ),
    workerBuildId: nonEmpty(
      env.MAMMOTH_TEMPORAL_WORKER_BUILD_ID ?? 'mammoth-p3-t1',
      'MAMMOTH_TEMPORAL_WORKER_BUILD_ID',
    ),
    startupTimeoutMs: integer(
      env,
      'MAMMOTH_TEMPORAL_STARTUP_TIMEOUT_MS',
      60_000,
      1_000,
      300_000,
    ),
    shutdownTimeoutMs: integer(
      env,
      'MAMMOTH_TEMPORAL_SHUTDOWN_TIMEOUT_MS',
      30_000,
      1_000,
      300_000,
    ),
    readinessTimeoutMs: integer(
      env,
      'MAMMOTH_TEMPORAL_READINESS_TIMEOUT_MS',
      5_000,
      500,
      60_000,
    ),
  };
}

function defaultNamespace(env: NodeJS.ProcessEnv, ci: boolean): string {
  if (!ci) return 'mammoth-local';
  const rawRun = env.GITHUB_RUN_ID?.trim();
  const rawAttempt = env.GITHUB_RUN_ATTEMPT?.trim();
  const run =
    rawRun === undefined || rawRun === ''
      ? `pid-${String(process.pid)}`
      : rawRun;
  const attempt =
    rawAttempt === undefined || rawAttempt === '' ? '1' : rawAttempt;
  return `mammoth-ci-${run}-${attempt}`;
}

function pinnedVersion(value: string): string {
  const trimmed = nonEmpty(value, 'MAMMOTH_TEMPORAL_SERVICE_VERSION');
  if (!/^\d+\.\d+\.\d+$/.test(trimmed)) {
    throw new TemporalConfigError(
      'MAMMOTH_TEMPORAL_SERVICE_VERSION must be an exact x.y.z version',
    );
  }
  return trimmed;
}

function nonEmpty(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new TemporalConfigError(`${label} is required`);
  return trimmed;
}

function integer(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = env[key] === undefined ? fallback : Number(env[key]);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new TemporalConfigError(
      `${key} must be an integer from ${String(min)} through ${String(max)}`,
    );
  }
  return value;
}
