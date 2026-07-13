import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ensureTemporalNamespace,
  assertPinnedTemporalVersion,
  loadTemporalAdapterConfig,
  temporalDevServerArgs,
  TemporalDevServerService,
  TemporalProcessOwnershipError,
  type TemporalAdapterConfig,
  type TemporalOwnedChild,
  type TemporalProcessControl,
  type TemporalProcessIdentity,
  type CommandResult,
  type CommandRunner,
} from '../src/index.js';

class RecordingRunner implements CommandRunner {
  readonly calls: readonly string[][] = [];
  private readonly mutableCalls: string[][] = [];

  constructor(private readonly describeExitCode: number) {
    this.calls = this.mutableCalls;
  }

  run(command: string, args: readonly string[]): Promise<CommandResult> {
    this.mutableCalls.push([command, ...args]);
    const exitCode = args.includes('describe') ? this.describeExitCode : 0;
    return Promise.resolve({ stdout: '', stderr: '', exitCode });
  }
}

describe('Temporal dev service lifecycle arguments', () => {
  it('uses explicit address, namespace, and persistent dev database path', () => {
    const config = loadTemporalAdapterConfig({
      MAMMOTH_PROFILE_ROOT: '/tmp/mammoth-profile',
      MAMMOTH_TEMPORAL_HOST: '127.0.0.2',
      MAMMOTH_TEMPORAL_PORT: '17233',
      MAMMOTH_TEMPORAL_NAMESPACE: 'mammoth-ci',
    });
    expect(temporalDevServerArgs(config)).toEqual([
      'server',
      'start-dev',
      '--ip',
      '127.0.0.2',
      '--port',
      '17233',
      '--db-filename',
      '/tmp/mammoth-profile/temporal-dev.db',
    ]);
  });

  it('creates the configured namespace with explicit retention when absent', async () => {
    const config = loadTemporalAdapterConfig({
      MAMMOTH_TEMPORAL_NAMESPACE: 'mammoth-ci',
      MAMMOTH_TEMPORAL_RETENTION_DAYS: '9',
    });
    const runner = new RecordingRunner(1);
    await ensureTemporalNamespace(config, runner);
    expect(runner.calls.at(-1)).toEqual([
      'temporal',
      'operator',
      'namespace',
      'create',
      '--address',
      '127.0.0.1:7233',
      '--namespace',
      'mammoth-ci',
      '--retention',
      '9d',
    ]);
  });

  it('fails closed unless the installed CLI matches the pinned version', async () => {
    const config = loadTemporalAdapterConfig({
      MAMMOTH_TEMPORAL_SERVICE_VERSION: '1.8.0',
    });
    const wrong = new VersionRunner('Temporal CLI 1.5.0');
    await expect(assertPinnedTemporalVersion(config, wrong)).rejects.toThrow(
      'expected 1.8.0',
    );
    const exact = new VersionRunner('Temporal CLI 1.8.0');
    await expect(
      assertPinnedTemporalVersion(config, exact),
    ).resolves.toBeUndefined();
  });

  it('removes stale ownership metadata without signalling', async () => {
    await withProfile(async (config) => {
      await writeOwnership(config, ownership(config, 401));
      const control = new FakeProcessControl();
      const service = new TemporalDevServerService(
        config,
        new LifecycleRunner(),
        control,
      );
      await service.stop();
      expect(control.signals).toEqual([]);
      await expect(readOwnership(config)).resolves.toBeUndefined();
    });
  });

  it('refuses malformed ownership metadata without signalling', async () => {
    await withProfile(async (config) => {
      await writeFile(ownershipPath(config), '{"pid":"oops"}', {
        mode: 0o600,
      });
      const control = new FakeProcessControl();
      const service = new TemporalDevServerService(
        config,
        new LifecycleRunner(),
        control,
      );
      await expect(service.stop()).rejects.toBeInstanceOf(
        TemporalProcessOwnershipError,
      );
      expect(control.signals).toEqual([]);
    });
  });

  it('refuses a reused pid whose process identity no longer matches', async () => {
    await withProfile(async (config) => {
      const saved = ownership(config, 402);
      await writeOwnership(config, saved);
      const control = new FakeProcessControl();
      control.identities.set(402, {
        pid: 402,
        startTime: 'later',
        command: saved.command,
      });
      const service = new TemporalDevServerService(
        config,
        new LifecycleRunner(),
        control,
      );
      await expect(service.stop()).rejects.toThrow('reused pid');
      expect(control.signals).toEqual([]);
      await expect(readOwnership(config)).resolves.toBeDefined();
    });
  });

  it('stops an owned child handle and is idempotent', async () => {
    await withProfile(async (config) => {
      const runner = new LifecycleRunner();
      const control = new FakeProcessControl(runner);
      const service = new TemporalDevServerService(config, runner, control);
      await service.start();
      expect(control.spawned).toBe(1);
      await service.stop();
      expect(control.childKills).toBe(1);
      expect(control.signals).toEqual([]);
      await expect(service.stop()).resolves.toBeUndefined();
      expect(control.childKills).toBe(1);
    });
  });

  it('cleans up the child and ownership after readiness timeout', async () => {
    await withProfile(async (baseConfig) => {
      const config = { ...baseConfig, startupTimeoutMs: 10 };
      const runner = new LifecycleRunner({ becomesHealthyOnSpawn: false });
      const control = new FakeProcessControl(runner);
      const service = new TemporalDevServerService(config, runner, control);
      await expect(service.start()).rejects.toThrow('did not become ready');
      expect(control.childKills).toBe(1);
      await expect(readOwnership(config)).resolves.toBeUndefined();
      await expect(service.stop()).resolves.toBeUndefined();
    });
  });

  it('cleans up the child and ownership after namespace bootstrap failure', async () => {
    await withProfile(async (config) => {
      const runner = new LifecycleRunner({ namespaceCreateFails: true });
      const control = new FakeProcessControl(runner);
      const service = new TemporalDevServerService(config, runner, control);
      await expect(service.start()).rejects.toThrow('namespace create failed');
      expect(control.childKills).toBe(1);
      await expect(readOwnership(config)).resolves.toBeUndefined();
      await expect(service.stop()).resolves.toBeUndefined();
    });
  });
});

class VersionRunner implements CommandRunner {
  constructor(private readonly versionOutput: string) {}

  run(): Promise<CommandResult> {
    return Promise.resolve({
      stdout: this.versionOutput,
      stderr: '',
      exitCode: 0,
    });
  }
}

class LifecycleRunner implements CommandRunner {
  running = false;

  constructor(
    readonly options: {
      readonly becomesHealthyOnSpawn?: boolean;
      readonly namespaceCreateFails?: boolean;
    } = {},
  ) {}

  run(_command: string, args: readonly string[]): Promise<CommandResult> {
    if (args.includes('--version')) {
      return Promise.resolve({
        stdout: 'Temporal CLI 1.8.0',
        stderr: '',
        exitCode: 0,
      });
    }
    if (args.includes('health')) {
      return Promise.resolve({
        stdout: '',
        stderr: '',
        exitCode: this.running ? 0 : 1,
      });
    }
    if (args.includes('namespace') && args.includes('describe')) {
      return Promise.resolve({ stdout: '', stderr: '', exitCode: 1 });
    }
    if (
      args.includes('namespace') &&
      args.includes('create') &&
      this.options.namespaceCreateFails === true
    ) {
      return Promise.reject(new Error('namespace create failed'));
    }
    return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 });
  }
}

class FakeProcessControl implements TemporalProcessControl {
  readonly identities = new Map<number, TemporalProcessIdentity>();
  readonly signals: { pid: number; signal: 'SIGTERM' }[] = [];
  spawned = 0;
  childKills = 0;

  constructor(private readonly runner?: LifecycleRunner) {}

  spawn(command: string, args: readonly string[]): TemporalOwnedChild {
    this.spawned += 1;
    const pid = 777;
    if (this.runner) {
      this.runner.running = this.runner.options.becomesHealthyOnSpawn !== false;
    }
    this.identities.set(pid, {
      pid,
      startTime: 'Mon Jul 13 00:00:00 2026',
      command: [command, ...args].join(' '),
    });
    return {
      pid,
      kill: () => {
        this.childKills += 1;
        if (this.runner) this.runner.running = false;
        return true;
      },
      onceExit: () => undefined,
    };
  }

  inspect(pid: number): Promise<TemporalProcessIdentity | undefined> {
    return Promise.resolve(this.identities.get(pid));
  }

  signal(pid: number, signal: 'SIGTERM'): void {
    this.signals.push({ pid, signal });
    if (this.runner) this.runner.running = false;
  }
}

async function withProfile(
  operation: (config: TemporalAdapterConfig) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'mammoth-temporal-service-'));
  const config = loadTemporalAdapterConfig({ MAMMOTH_PROFILE_ROOT: root });
  try {
    await operation(config);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function ownership(
  config: TemporalAdapterConfig,
  pid: number,
): {
  readonly schemaVersion: 1;
  readonly pid: number;
  readonly startTime: string;
  readonly command: string;
  readonly commandFingerprint: string;
} {
  const args = temporalDevServerArgs(config);
  return {
    schemaVersion: 1,
    pid,
    startTime: 'Mon Jul 13 00:00:00 2026',
    command: [config.cliPath, ...args].join(' '),
    commandFingerprint: JSON.stringify([config.cliPath, ...args]),
  };
}

function ownershipPath(config: TemporalAdapterConfig): string {
  return join(config.root, 'temporal-process.json');
}

function writeOwnership(
  config: TemporalAdapterConfig,
  value: ReturnType<typeof ownership>,
): Promise<void> {
  return writeFile(ownershipPath(config), JSON.stringify(value), {
    mode: 0o600,
  });
}

async function readOwnership(
  config: TemporalAdapterConfig,
): Promise<string | undefined> {
  return readFile(ownershipPath(config), 'utf8').catch(() => undefined);
}
