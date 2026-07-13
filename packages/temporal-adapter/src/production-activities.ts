import { activityInfo, heartbeat } from '@temporalio/activity';
import { ApplicationFailure } from '@temporalio/common';
import {
  ActivityFailure,
  activityPolicies,
  executeActivityEffect,
  nonRetryableActivityFailureCodes,
  validateHeartbeat,
  type ActivityEffectStore,
  type ActivityInvocationV1,
  type ActivityPolicyV1,
  type ActivityTypeV1,
  type AttributableWorkItemV1,
  type EffectProvider,
  type Digest,
  type HeartbeatProgressV1,
} from '@mammoth/work-queue';

export interface ActivityBinding<TResult = unknown> {
  readonly provider: EffectProvider<TResult>;
  readonly resultSchema: string;
  readonly validateResult: (value: unknown) => TResult;
}

export interface ProductionActivityDependencies {
  readonly effects: ActivityEffectStore;
  readonly resolveWork: (
    workItemId: string,
  ) => Promise<AttributableWorkItemV1 | undefined>;
  readonly binding: (
    activityType: ActivityTypeV1,
    invocation: ActivityInvocationV1,
  ) => ActivityBinding;
  readonly now?: () => string;
  readonly id?: () => string;
  readonly reportHeartbeat?: (progress: HeartbeatProgressV1) => void;
  readonly advanceWork?: (input: {
    readonly invocation: ActivityInvocationV1;
    readonly provider: string;
    readonly idempotencyKey: Digest;
  }) => Promise<void>;
}

export type ProductionActivity = (
  invocation: ActivityInvocationV1,
) => Promise<unknown>;

export type ProductionActivities = Readonly<
  Record<ActivityTypeV1, ProductionActivity>
>;

/**
 * The complete P3 Activity catalog. Dependencies are inward-facing ports so the
 * same functions run under Temporal or directly in contract/adversarial tests.
 */
export function createProductionActivities(
  dependencies: ProductionActivityDependencies,
): ProductionActivities {
  return Object.freeze({
    retrieval: createActivity('retrieval', dependencies),
    snapshot: createActivity('snapshot', dependencies),
    parsing: createActivity('parsing', dependencies),
    'claim-proposal-admission': createActivity(
      'claim-proposal-admission',
      dependencies,
    ),
    assessment: createActivity('assessment', dependencies),
    'ledger-mutation': createActivity('ledger-mutation', dependencies),
    'report-compilation': createActivity('report-compilation', dependencies),
    'artifact-commit': createActivity('artifact-commit', dependencies),
    'outbox-publication': createActivity('outbox-publication', dependencies),
    revalidation: createActivity('revalidation', dependencies),
    'human-gate-handoff': createActivity('human-gate-handoff', dependencies),
  });
}

/** Converts the frozen P3 ceilings into Temporal SDK Activity options. */
export function temporalActivityOptions(activityType: ActivityTypeV1): {
  readonly taskQueue: ActivityPolicyV1['taskQueue'];
  readonly scheduleToCloseTimeout: number;
  readonly startToCloseTimeout: number;
  readonly heartbeatTimeout?: number;
  readonly retry: {
    readonly maximumAttempts: number;
    readonly initialInterval: number;
    readonly backoffCoefficient: number;
    readonly maximumInterval: number;
    readonly nonRetryableErrorTypes: readonly string[];
  };
} {
  const policy = activityPolicies[activityType];
  return {
    taskQueue: policy.taskQueue,
    scheduleToCloseTimeout: policy.scheduleToCloseMs,
    startToCloseTimeout: policy.startToCloseMs,
    ...(policy.heartbeatTimeoutMs === undefined
      ? {}
      : { heartbeatTimeout: policy.heartbeatTimeoutMs }),
    retry: {
      maximumAttempts: policy.maximumAttempts,
      initialInterval: policy.initialIntervalMs,
      backoffCoefficient: policy.backoffCoefficient,
      maximumInterval: policy.maximumIntervalMs,
      nonRetryableErrorTypes: [...nonRetryableActivityFailureCodes],
    },
  };
}

export function reportActivityHeartbeat(
  progress: HeartbeatProgressV1,
  report: (progress: HeartbeatProgressV1) => void = heartbeat,
): void {
  report(validateHeartbeat(progress));
}

function createActivity(
  activityType: ActivityTypeV1,
  dependencies: ProductionActivityDependencies,
): ProductionActivity {
  return async (invocation) => {
    try {
      if (invocation.activityType !== activityType) {
        throw new ActivityFailure(
          'attribution_mismatch',
          `Expected ${activityType}, received ${invocation.activityType}`,
          false,
        );
      }
      const binding = dependencies.binding(activityType, invocation);
      return await executeActivityEffect({
        invocation,
        provider: binding.provider,
        store: dependencies.effects,
        resolveWork: dependencies.resolveWork,
        resultSchema: binding.resultSchema,
        validateResult: binding.validateResult,
        reportHeartbeat:
          dependencies.reportHeartbeat ??
          ((progress) => {
            reportActivityHeartbeat(progress);
          }),
        now: dependencies.now ?? (() => new Date().toISOString()),
        id:
          dependencies.id ??
          (() => {
            const info = activityInfo();
            return `${info.workflowExecution?.workflowId ?? 'activity-effect'}:${info.activityId}:${String(info.attempt)}`;
          }),
        ...(dependencies.advanceWork === undefined
          ? {}
          : { advanceWork: dependencies.advanceWork }),
      });
    } catch (error) {
      if (error instanceof ActivityFailure) {
        throw ApplicationFailure.create({
          message: error.message,
          type: error.code,
          nonRetryable: !error.retryable,
          details: [{ code: error.code }],
        });
      }
      throw ApplicationFailure.create({
        message:
          error instanceof Error ? error.message : 'Unknown Activity failure',
        type: 'worker_interrupted',
        nonRetryable: false,
      });
    }
  };
}
