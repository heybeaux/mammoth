import { describe, expect, it } from 'vitest';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { TEMPORAL_WORKFLOW_CAPABILITIES } from '@mammoth/adapter-contracts';
import {
  evaluateWorkerBundleManifestEvidence,
  loadTemporalAdapterConfig,
  runTemporalLiveProbe,
} from '../src/index.js';

describe('Temporal SDK live worker probe', () => {
  it('executes a real workflow path and proves advertised capabilities', async () => {
    const testEnv = await TestWorkflowEnvironment.createLocal();
    try {
      const config = loadTemporalAdapterConfig({
        MAMMOTH_TEMPORAL_NAMESPACE: testEnv.namespace ?? 'default',
      });
      const execution = await runTemporalLiveProbe({
        config,
        challengeId: 'live-probe-test',
        environment: {
          client: testEnv.client,
          nativeConnection: testEnv.nativeConnection,
          ...(testEnv.namespace === undefined
            ? {}
            : { namespace: testEnv.namespace }),
        },
      });

      expect(execution.workflowId).toBe(
        'mammoth-temporal-probe-live-probe-test',
      );
      expect(execution.runId).toMatch(/[0-9a-f-]{36}/);
      expect(execution.replayed).toBe(true);
      expect(execution.cancellationObserved).toBe(true);
      expect(execution.probedCapabilities).toEqual(
        TEMPORAL_WORKFLOW_CAPABILITIES,
      );
      const evaluation = evaluateWorkerBundleManifestEvidence(
        {
          manifest: execution.manifest,
          probedCapabilities: execution.probedCapabilities,
          live: true,
        },
        config,
      );
      expect(evaluation).toMatchObject({
        valid: true,
        live: true,
        identityMatches: true,
        unprovenClaims: [],
      });
      expect([...evaluation.advertisedCapabilities].sort()).toEqual(
        [...TEMPORAL_WORKFLOW_CAPABILITIES].sort(),
      );
    } finally {
      await testEnv.teardown();
    }
  }, 120_000);
});
