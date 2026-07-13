import { describe, expect, it } from 'vitest';
import {
  ensureTemporalNamespace,
  assertPinnedTemporalVersion,
  loadTemporalAdapterConfig,
  temporalDevServerArgs,
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
