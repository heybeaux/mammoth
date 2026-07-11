import { resolve } from 'node:path';

export interface ProfileConfig {
  readonly root: string;
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly database: string;
  readonly startupTimeoutMs: number;
  readonly shutdownTimeoutMs: number;
}

export class ProfileConfigError extends Error {
  override readonly name = 'ProfileConfigError';
}

export function loadProfileConfig(env: NodeJS.ProcessEnv): ProfileConfig {
  const password = required(env, 'MAMMOTH_PG_PASSWORD');
  if (password.length < 12) {
    throw new ProfileConfigError(
      'MAMMOTH_PG_PASSWORD must contain at least 12 characters',
    );
  }
  return {
    root: resolve(env.MAMMOTH_PROFILE_ROOT ?? '.mammoth/production-profile'),
    host: env.MAMMOTH_PG_HOST ?? '127.0.0.1',
    port: integer(env, 'MAMMOTH_PG_PORT', 55432, 1024, 65535),
    user: env.MAMMOTH_PG_USER ?? 'mammoth',
    password,
    database: env.MAMMOTH_PG_DATABASE ?? 'mammoth',
    startupTimeoutMs: integer(
      env,
      'MAMMOTH_STARTUP_TIMEOUT_MS',
      30_000,
      1_000,
      300_000,
    ),
    shutdownTimeoutMs: integer(
      env,
      'MAMMOTH_SHUTDOWN_TIMEOUT_MS',
      15_000,
      1_000,
      300_000,
    ),
  };
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value)
    throw new ProfileConfigError(
      `${key} is required; no credential is embedded or defaulted`,
    );
  return value;
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
    throw new ProfileConfigError(
      `${key} must be an integer from ${String(min)} through ${String(max)}`,
    );
  }
  return value;
}
