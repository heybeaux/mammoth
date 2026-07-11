import { describe, expect, it } from 'vitest';
import {
  assertProductionTemporalReady,
  loadProductionTemporalConfig,
} from '../src/temporal.js';
import type { CommandResult, CommandRunner } from '@mammoth/temporal-adapter';

class FailingRunner implements CommandRunner {
  run(): Promise<CommandResult> {
    return Promise.resolve({ stdout: '', stderr: '', exitCode: 1 });
  }
}

describe('production profile Temporal integration', () => {
  it('loads the same explicit Temporal namespace and task queue used by the adapter', () => {
    const config = loadProductionTemporalConfig({
      MAMMOTH_TEMPORAL_NAMESPACE: 'mammoth-ci',
      MAMMOTH_TEMPORAL_TASK_QUEUE: 'research-control-ci',
    });
    expect(config.namespace).toBe('mammoth-ci');
    expect(config.taskQueue).toBe('research-control-ci');
  });

  it('fails closed when the Temporal-backed profile is not ready', async () => {
    await expect(
      assertProductionTemporalReady(
        {
          MAMMOTH_TEMPORAL_PORT: '17998',
          MAMMOTH_TEMPORAL_READINESS_TIMEOUT_MS: '500',
        },
        new FailingRunner(),
      ),
    ).rejects.toThrow('Temporal adapter is not ready');
  });
});
