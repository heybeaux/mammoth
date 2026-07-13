import { describe, expect, it } from 'vitest';
import {
  InMemoryActivityEffectStore,
  activityTypes,
  canonicalDigest,
  type ActivityInvocationV1,
  type ActivityTypeV1,
} from '@mammoth/work-queue';

import {
  createProductionActivities,
  reportActivityHeartbeat,
} from '../src/production-activities.js';

function invocation(activityType: ActivityTypeV1): ActivityInvocationV1 {
  const input = { activityType, stable: true };
  return {
    schemaVersion: 1,
    activityType,
    operationKind:
      activityType === 'retrieval'
        ? 'retrieval.fetch'
        : activityType === 'snapshot'
          ? 'snapshot.metadata-commit'
          : activityType === 'parsing'
            ? 'parser.execute'
            : activityType === 'claim-proposal-admission'
              ? 'claim.proposal-admit'
              : activityType === 'assessment'
                ? 'claim.assess'
                : activityType === 'ledger-mutation'
                  ? 'ledger.mutate'
                  : activityType === 'report-compilation'
                    ? 'report.compile'
                    : activityType === 'artifact-commit'
                      ? 'artifact.metadata-commit'
                      : activityType === 'outbox-publication'
                        ? 'outbox.publish'
                        : activityType === 'revalidation'
                          ? 'revalidation.complete'
                          : 'human-gate.open',
    contractVersion: '2.0.0',
    programId: 'program-1',
    workItemId: `work-${activityType}`,
    input,
    inputDigest: canonicalDigest(input),
    workflow: {
      workflowId: 'workflow-1',
      runId: 'run-1',
      activityId: `activity-${activityType}`,
      attempt: 1,
      taskQueue: 'test',
    },
  };
}

describe('production Activity catalog', () => {
  it('registers and directly executes all eleven separately testable Activities', async () => {
    const effects = new InMemoryActivityEffectStore();
    const calls: string[] = [];
    const activities = createProductionActivities({
      effects,
      resolveWork(workItemId) {
        const activityType = workItemId.slice('work-'.length) as ActivityTypeV1;
        const input = { activityType, stable: true };
        return Promise.resolve({
          id: workItemId,
          programId: 'program-1',
          activityType,
          contractVersion: '2.0.0',
          inputDigest: canonicalDigest(input),
          state: 'leased',
        });
      },
      binding(activityType) {
        return {
          provider: {
            name: `fixture-${activityType}`,
            execute(key) {
              calls.push(activityType);
              return Promise.resolve({
                receipt: { key },
                result: { activityType },
              });
            },
          },
          resultSchema: `${activityType}-result@1`,
          validateResult(value) {
            return value;
          },
        };
      },
      now: () => '2026-07-13T00:00:00.000Z',
      id: () => `effect-${String(calls.length)}`,
    });

    expect(Object.keys(activities)).toEqual(activityTypes);
    for (const activityType of activityTypes) {
      await expect(
        activities[activityType](invocation(activityType)),
      ).resolves.toEqual({
        activityType,
      });
    }
    for (const activityType of activityTypes) {
      const original = invocation(activityType);
      await expect(
        activities[activityType]({
          ...original,
          workflow: {
            ...original.workflow,
            runId: 'run-after-restart',
            activityId: `activity-${activityType}-redelivery`,
            attempt: 2,
          },
        }),
      ).resolves.toEqual({ activityType });
    }
    expect(calls).toEqual(activityTypes);
    expect(effects.snapshot().effects).toHaveLength(11);
    expect(effects.snapshot().attempts).toHaveLength(22);
  });

  it('validates heartbeat progress before reporting it to Temporal', () => {
    const reported: unknown[] = [];
    reportActivityHeartbeat({ chunk: 2 }, (progress) => {
      reported.push(progress);
    });
    expect(reported).toEqual([{ chunk: 2 }]);
    expect(() => {
      reportActivityHeartbeat({ page: -1 }, () => {
        return undefined;
      });
    }).toThrow(/non-negative safe integers/);
  });
});
