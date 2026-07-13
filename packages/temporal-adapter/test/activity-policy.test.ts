import { describe, expect, it } from 'vitest';
import {
  activityTypes,
  nonRetryableActivityFailureCodes,
  type ActivityEffectStore,
} from '@mammoth/work-queue';
import {
  createProductionActivities,
  temporalActivityOptions,
} from '../src/production-activities.js';

describe('Temporal Activity policy', () => {
  it('maps the frozen retrieval timeout, heartbeat, and retry policy', () => {
    expect(temporalActivityOptions('retrieval')).toMatchObject({
      taskQueue: 'retrieval',
      scheduleToCloseTimeout: 600_000,
      startToCloseTimeout: 120_000,
      heartbeatTimeout: 15_000,
      retry: {
        maximumAttempts: 5,
        initialInterval: 1_000,
        backoffCoefficient: 2,
        maximumInterval: 30_000,
        nonRetryableErrorTypes: [...nonRetryableActivityFailureCodes],
      },
    });
  });

  it('omits heartbeat timeout for short transactional Activities', () => {
    expect(temporalActivityOptions('ledger-mutation')).not.toHaveProperty(
      'heartbeatTimeout',
    );
  });

  it('registers all eleven separately invokable production Activities', () => {
    const activities = createProductionActivities({
      effects: {} as ActivityEffectStore,
      resolveWork: () => Promise.resolve(undefined),
      binding: () => ({
        provider: {
          name: 'unused',
          execute: () => Promise.resolve({ receipt: {}, result: {} }),
        },
        resultSchema: 'unused@1',
        validateResult: (value) => value,
      }),
    });
    expect(Object.keys(activities).sort()).toEqual([...activityTypes].sort());
  });

  it('converts poison invocation mismatches into a typed non-retryable Temporal failure', async () => {
    const activities = createProductionActivities({
      effects: {} as ActivityEffectStore,
      resolveWork: () => Promise.resolve(undefined),
      binding: () => ({
        provider: {
          name: 'unused',
          execute: () => Promise.resolve({ receipt: {}, result: {} }),
        },
        resultSchema: 'unused@1',
        validateResult: (value) => value,
      }),
    });
    await expect(
      activities.retrieval({
        schemaVersion: 1,
        activityType: 'snapshot',
        operationKind: 'snapshot.metadata-commit',
        contractVersion: '2.0.0',
        programId: 'program-1',
        workItemId: 'work-1',
        input: {},
        inputDigest:
          'sha256:0000000000000000000000000000000000000000000000000000000000000000',
        workflow: {
          workflowId: 'workflow-1',
          runId: 'run-1',
          activityId: 'activity-1',
          attempt: 1,
          taskQueue: 'retrieval',
        },
      }),
    ).rejects.toMatchObject({
      type: 'attribution_mismatch',
      nonRetryable: true,
    });
  });
});
