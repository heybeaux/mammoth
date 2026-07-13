import { execFile, spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { Writable } from 'node:stream';
import type { CommandRunner } from './commands.js';
import { ProcessCommandRunner } from './commands.js';
import type { TemporalAdapterConfig } from './config.js';

export interface TemporalProcessIdentity {
  readonly pid: number;
  readonly startTime: string;
  readonly command: string;
}

export interface TemporalOwnedChild {
  readonly pid: number | undefined;
  kill(signal: 'SIGTERM'): boolean;
  onceExit(listener: () => void): void;
}

export interface TemporalProcessControl {
  spawn(
    command: string,
    args: readonly string[],
    log: Writable,
  ): TemporalOwnedChild;
  inspect(pid: number): Promise<TemporalProcessIdentity | undefined>;
  signal(pid: number, signal: 'SIGTERM'): void;
}

export interface TemporalProcessOwnership extends TemporalProcessIdentity {
  readonly schemaVersion: 1;
  readonly commandFingerprint: string;
}

export class TemporalProcessOwnershipError extends Error {
  override readonly name = 'TemporalProcessOwnershipError';
}

export class NodeTemporalProcessControl implements TemporalProcessControl {
  spawn(
    command: string,
    args: readonly string[],
    log: Writable,
  ): TemporalOwnedChild {
    const child = spawn(command, args, {
      env: process.env,
      stdio: ['ignore', log, log],
    });
    return {
      pid: child.pid,
      kill: (signal) => child.kill(signal),
      onceExit: (listener) => {
        child.once('exit', listener);
      },
    };
  }

  inspect(pid: number): Promise<TemporalProcessIdentity | undefined> {
    return inspectProcessWithPs(pid);
  }

  signal(pid: number, signal: 'SIGTERM'): void {
    process.kill(pid, signal);
  }
}

export class TemporalDevServerService {
  readonly #log: string;
  readonly #ownership: string;
  #child: TemporalOwnedChild | undefined;

  constructor(
    readonly config: TemporalAdapterConfig,
    private readonly runner: CommandRunner = new ProcessCommandRunner(),
    private readonly processControl: TemporalProcessControl = new NodeTemporalProcessControl(),
  ) {
    this.#log = join(config.root, 'temporal.log');
    this.#ownership = join(config.root, 'temporal-process.json');
  }

  async start(): Promise<void> {
    await assertPinnedTemporalVersion(this.config, this.runner);
    if (await this.serviceReady()) {
      await ensureTemporalNamespace(this.config, this.runner);
      return;
    }
    await mkdir(this.config.root, { recursive: true, mode: 0o700 });
    const log = createWriteStream(this.#log, { flags: 'a', mode: 0o600 });
    const args = temporalDevServerArgs(this.config);
    const child = this.processControl.spawn(this.config.cliPath, args, log);
    this.#child = child;
    child.onceExit(() => {
      if (this.#child === child) this.#child = undefined;
    });
    try {
      const pid = child.pid;
      if (pid === undefined || !Number.isSafeInteger(pid) || pid <= 0) {
        throw new TemporalProcessOwnershipError(
          'Temporal child did not expose a valid process id',
        );
      }
      const identity = await this.processControl.inspect(pid);
      if (
        identity === undefined ||
        !commandMatchesConfig(identity.command, this.config)
      ) {
        throw new TemporalProcessOwnershipError(
          'Temporal child process identity could not be verified',
        );
      }
      await writeFile(
        this.#ownership,
        `${JSON.stringify({
          schemaVersion: 1,
          ...identity,
          commandFingerprint: commandFingerprint(this.config),
        } satisfies TemporalProcessOwnership)}\n`,
        { mode: 0o600 },
      );
      const deadline = Date.now() + this.config.startupTimeoutMs;
      while (Date.now() < deadline) {
        if (await this.serviceReady()) {
          await ensureTemporalNamespace(this.config, this.runner);
          return;
        }
        await delay(250);
      }
      const detail = await readFile(this.#log, 'utf8').catch(() => '<no log>');
      throw new Error(
        `Temporal dev server did not become ready within ${String(this.config.startupTimeoutMs)}ms\n${detail.slice(-8_000)}`,
      );
    } catch (error: unknown) {
      try {
        await this.cleanupFailedStart(child);
      } catch (cleanupError: unknown) {
        throw new AggregateError(
          [asError(error), asError(cleanupError)],
          'Temporal startup failed and cleanup was incomplete',
        );
      }
      throw error;
    }
  }

  async stop(): Promise<void> {
    const child = this.#child;
    if (child !== undefined) {
      this.#child = undefined;
      child.kill('SIGTERM');
      await this.waitUntilStopped();
      await rm(this.#ownership, { force: true });
      return;
    }

    const raw = await readFile(this.#ownership, 'utf8').catch(() => undefined);
    if (raw === undefined) return;
    const ownership = parseTemporalProcessOwnership(raw);
    if (ownership === undefined) {
      throw new TemporalProcessOwnershipError(
        'Temporal process ownership metadata is malformed; refusing to signal',
      );
    }
    if (ownership.commandFingerprint !== commandFingerprint(this.config)) {
      throw new TemporalProcessOwnershipError(
        'Temporal process ownership metadata does not match this profile',
      );
    }
    const observed = await this.processControl.inspect(ownership.pid);
    if (observed === undefined) {
      await rm(this.#ownership, { force: true });
      return;
    }
    if (
      observed.startTime !== ownership.startTime ||
      observed.command !== ownership.command ||
      !commandMatchesConfig(observed.command, this.config)
    ) {
      throw new TemporalProcessOwnershipError(
        'Temporal process identity changed; refusing to signal a reused pid',
      );
    }
    try {
      this.processControl.signal(ownership.pid, 'SIGTERM');
    } catch (error: unknown) {
      if (!isNoSuchProcess(error)) throw error;
      await rm(this.#ownership, { force: true });
      return;
    }
    await this.waitUntilStopped();
    await rm(this.#ownership, { force: true });
  }

  async serviceReady(): Promise<boolean> {
    const result = await this.runner.run(
      this.config.cliPath,
      ['operator', 'cluster', 'health', '--address', this.config.address],
      {
        timeoutMs: this.config.readinessTimeoutMs,
        allowFailure: true,
      },
    );
    return result.exitCode === 0;
  }

  private async waitUntilStopped(): Promise<void> {
    const deadline = Date.now() + this.config.shutdownTimeoutMs;
    while (Date.now() < deadline) {
      if (!(await this.serviceReady())) return;
      await delay(100);
    }
    throw new TemporalShutdownError(this.config.shutdownTimeoutMs);
  }

  private async cleanupFailedStart(child: TemporalOwnedChild): Promise<void> {
    if (this.#child === child) this.#child = undefined;
    try {
      child.kill('SIGTERM');
      await this.waitUntilStopped();
    } finally {
      await rm(this.#ownership, { force: true });
    }
  }
}

export class TemporalShutdownError extends Error {
  override readonly name = 'TemporalShutdownError';

  constructor(readonly timeoutMs: number) {
    super(`Temporal shutdown exceeded ${String(timeoutMs)}ms`);
  }
}

export function temporalDevServerArgs(
  config: TemporalAdapterConfig,
): readonly string[] {
  return [
    'server',
    'start-dev',
    '--ip',
    config.host,
    '--port',
    String(config.port),
    '--db-filename',
    join(config.root, 'temporal-dev.db'),
  ];
}

export function parseTemporalProcessOwnership(
  raw: string,
): TemporalProcessOwnership | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  const keys = Object.keys(value).sort();
  const expected = [
    'command',
    'commandFingerprint',
    'pid',
    'schemaVersion',
    'startTime',
  ];
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index]) ||
    value.schemaVersion !== 1 ||
    !Number.isSafeInteger(value.pid) ||
    (value.pid as number) <= 0 ||
    typeof value.startTime !== 'string' ||
    value.startTime.length === 0 ||
    typeof value.command !== 'string' ||
    value.command.length === 0 ||
    typeof value.commandFingerprint !== 'string' ||
    value.commandFingerprint.length === 0
  ) {
    return undefined;
  }
  return value as unknown as TemporalProcessOwnership;
}

export async function ensureTemporalNamespace(
  config: TemporalAdapterConfig,
  runner: CommandRunner,
): Promise<void> {
  const describe = await runner.run(
    config.cliPath,
    [
      'operator',
      'namespace',
      'describe',
      '--address',
      config.address,
      '--namespace',
      config.namespace,
    ],
    { timeoutMs: config.readinessTimeoutMs, allowFailure: true },
  );
  if (describe.exitCode === 0) return;
  await runner.run(
    config.cliPath,
    [
      'operator',
      'namespace',
      'create',
      '--address',
      config.address,
      '--namespace',
      config.namespace,
      '--retention',
      `${String(config.retentionDays)}d`,
    ],
    { timeoutMs: config.readinessTimeoutMs },
  );
}

export async function assertPinnedTemporalVersion(
  config: TemporalAdapterConfig,
  runner: CommandRunner,
): Promise<void> {
  const result = await runner.run(config.cliPath, ['--version'], {
    timeoutMs: config.readinessTimeoutMs,
    allowFailure: true,
  });
  if (
    result.exitCode !== 0 ||
    !`${result.stdout}\n${result.stderr}`.includes(config.serviceVersion)
  ) {
    throw new Error(
      `Temporal CLI version mismatch: expected ${config.serviceVersion}`,
    );
  }
}

function commandFingerprint(config: TemporalAdapterConfig): string {
  return JSON.stringify([config.cliPath, ...temporalDevServerArgs(config)]);
}

function commandMatchesConfig(
  command: string,
  config: TemporalAdapterConfig,
): boolean {
  const executable = basename(config.cliPath);
  return [executable, ...temporalDevServerArgs(config)].every((token) =>
    command.includes(token),
  );
}

function inspectProcessWithPs(
  pid: number,
): Promise<TemporalProcessIdentity | undefined> {
  return new Promise((resolve, reject) => {
    execFile(
      'ps',
      ['-p', String(pid), '-o', 'lstart=', '-o', 'command='],
      (error, stdout) => {
        if (error) {
          if ('code' in error && error.code === 1) resolve(undefined);
          else {
            reject(
              error instanceof Error
                ? error
                : new Error('Process inspection failed'),
            );
          }
          return;
        }
        const match =
          /^(\S+\s+\S+\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.+)$/.exec(
            stdout.trim(),
          );
        if (!match?.[1] || !match[2]) {
          reject(
            new Error(
              `Unable to parse process identity for pid ${String(pid)}`,
            ),
          );
          return;
        }
        resolve({ pid, startTime: match[1], command: match[2] });
      },
    );
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error('Unknown Temporal failure');
}

function isNoSuchProcess(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ESRCH'
  );
}
