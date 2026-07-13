import { describe, expect, it } from 'vitest';
import {
  TemporalConfigError,
  loadTemporalAdapterConfig,
} from '../src/index.js';

describe('Temporal adapter configuration', () => {
  it('loads explicit namespace, task queue, retention, and service bounds', () => {
    const config = loadTemporalAdapterConfig({
      MAMMOTH_PROFILE_ROOT: '/tmp/mammoth-profile',
      MAMMOTH_TEMPORAL_CLI: '/opt/temporal',
      MAMMOTH_TEMPORAL_HOST: '127.0.0.2',
      MAMMOTH_TEMPORAL_PORT: '17233',
      MAMMOTH_TEMPORAL_NAMESPACE: 'mammoth-ci',
      MAMMOTH_TEMPORAL_TASK_QUEUE: 'mammoth-research-control-v1',
      MAMMOTH_TEMPORAL_RETENTION_DAYS: '7',
      MAMMOTH_TEMPORAL_SERVICE_VERSION: '1.8.0',
      MAMMOTH_TEMPORAL_WORKFLOW_BUNDLE_ID: 'probe-v1',
      MAMMOTH_TEMPORAL_WORKER_BUILD_ID: 'worker-v1',
      MAMMOTH_TEMPORAL_STARTUP_TIMEOUT_MS: '2000',
      MAMMOTH_TEMPORAL_SHUTDOWN_TIMEOUT_MS: '3000',
      MAMMOTH_TEMPORAL_READINESS_TIMEOUT_MS: '1000',
    });
    expect(config).toMatchObject({
      root: '/tmp/mammoth-profile',
      cliPath: '/opt/temporal',
      address: '127.0.0.2:17233',
      host: '127.0.0.2',
      port: 17233,
      namespace: 'mammoth-ci',
      taskQueue: 'mammoth-research-control-v1',
      retentionDays: 7,
      serviceVersion: '1.8.0',
      workflowBundleId: 'probe-v1',
      workerBuildId: 'worker-v1',
      startupTimeoutMs: 2000,
      shutdownTimeoutMs: 3000,
      readinessTimeoutMs: 1000,
    });
  });

  it('fails closed for blank identifiers and invalid bounds', () => {
    expect(() =>
      loadTemporalAdapterConfig({
        MAMMOTH_TEMPORAL_NAMESPACE: ' ',
      }),
    ).toThrow(TemporalConfigError);
    expect(() =>
      loadTemporalAdapterConfig({
        MAMMOTH_TEMPORAL_RETENTION_DAYS: '0',
      }),
    ).toThrow('MAMMOTH_TEMPORAL_RETENTION_DAYS');
    expect(() =>
      loadTemporalAdapterConfig({
        MAMMOTH_TEMPORAL_SERVICE_VERSION: 'latest',
      }),
    ).toThrow('exact x.y.z version');
    expect(() =>
      loadTemporalAdapterConfig({
        MAMMOTH_TEMPORAL_TASK_QUEUE: 'research-control-ci',
      }),
    ).toThrow('must match registered workflow queue');
  });

  it('uses run-unique CI namespace and disposable retention defaults', () => {
    const config = loadTemporalAdapterConfig({
      CI: 'true',
      GITHUB_RUN_ID: '42',
      GITHUB_RUN_ATTEMPT: '3',
    });
    expect(config.namespace).toBe('mammoth-ci-42-3');
    expect(config.retentionDays).toBe(1);
  });
});
