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
  const host = nonEmpty(env.MAMMOTH_TEMPORAL_HOST ?? '127.0.0.1', 'host');
  const port = integer(env, 'MAMMOTH_TEMPORAL_PORT', 7233, 1024, 65535);
  const address = env.MAMMOTH_TEMPORAL_ADDRESS ?? `${host}:${String(port)}`;
  return {
    root: resolve(env.MAMMOTH_PROFILE_ROOT ?? '.mammoth/production-profile'),
    cliPath: env.MAMMOTH_TEMPORAL_CLI ?? 'temporal',
    address: nonEmpty(address, 'MAMMOTH_TEMPORAL_ADDRESS'),
    host,
    port,
    namespace: nonEmpty(
      env.MAMMOTH_TEMPORAL_NAMESPACE ?? 'mammoth-local',
      'MAMMOTH_TEMPORAL_NAMESPACE',
    ),
    taskQueue: nonEmpty(
      env.MAMMOTH_TEMPORAL_TASK_QUEUE ?? 'research-control',
      'MAMMOTH_TEMPORAL_TASK_QUEUE',
    ),
    retentionDays: integer(env, 'MAMMOTH_TEMPORAL_RETENTION_DAYS', 3, 1, 30),
    startupTimeoutMs: integer(
      env,
      'MAMMOTH_TEMPORAL_STARTUP_TIMEOUT_MS',
      30_000,
      1_000,
      300_000,
    ),
    shutdownTimeoutMs: integer(
      env,
      'MAMMOTH_TEMPORAL_SHUTDOWN_TIMEOUT_MS',
      15_000,
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
