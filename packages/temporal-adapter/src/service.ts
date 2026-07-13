import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import type { CommandRunner } from './commands.js';
import { ProcessCommandRunner } from './commands.js';
import type { TemporalAdapterConfig } from './config.js';

export class TemporalDevServerService {
  readonly #log: string;
  readonly #pid: string;
  #child: ChildProcess | undefined;

  constructor(
    readonly config: TemporalAdapterConfig,
    private readonly runner: CommandRunner = new ProcessCommandRunner(),
  ) {
    this.#log = join(config.root, 'temporal.log');
    this.#pid = join(config.root, 'temporal.pid');
  }

  async start(): Promise<void> {
    await assertPinnedTemporalVersion(this.config, this.runner);
    if (await this.serviceReady()) {
      await ensureTemporalNamespace(this.config, this.runner);
      return;
    }
    await mkdir(this.config.root, { recursive: true, mode: 0o700 });
    const log = createWriteStream(this.#log, { flags: 'a', mode: 0o600 });
    const child = spawn(
      this.config.cliPath,
      temporalDevServerArgs(this.config),
      {
        env: process.env,
        stdio: ['ignore', log, log],
      },
    );
    this.#child = child;
    child.once('exit', () => {
      if (this.#child === child) this.#child = undefined;
    });
    await writeFile(this.#pid, `${String(child.pid ?? '')}\n`, { mode: 0o600 });
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
  }

  async stop(): Promise<void> {
    const pid = await this.readPid();
    let signalled = false;
    if (pid !== undefined) {
      try {
        process.kill(pid, 'SIGTERM');
        signalled = true;
      } catch (error: unknown) {
        if (!isNoSuchProcess(error)) throw error;
      }
    }
    if (this.#child) {
      this.#child.kill('SIGTERM');
      this.#child = undefined;
      signalled = true;
    }
    if (signalled) {
      const deadline = Date.now() + this.config.shutdownTimeoutMs;
      while (Date.now() < deadline) {
        if (!(await this.serviceReady())) {
          await rm(this.#pid, { force: true });
          return;
        }
        await delay(100);
      }
      throw new TemporalShutdownError(this.config.shutdownTimeoutMs);
    }
    await rm(this.#pid, { force: true });
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

  private async readPid(): Promise<number | undefined> {
    const raw = await readFile(this.#pid, 'utf8').catch(() => undefined);
    if (!raw) return undefined;
    const pid = Number(raw.trim());
    return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isNoSuchProcess(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ESRCH'
  );
}
