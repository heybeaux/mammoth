import type { AdapterDescriptor } from '@mammoth/adapter-contracts';
import {
  ActivityFailure,
  canonicalDigest,
  type ActivityAttemptInput,
  type ActivityEffectStore,
  type ActivityFailureCode,
  type ActivityInvocationV1,
  type AttributableWorkItemV1,
  type BeginEffectInput,
  type CompletedEffectV1,
  type Digest,
  type HeartbeatProgressV1,
  type PendingEffectV1,
} from '@mammoth/work-queue';
import type { PostgresConnection, TransactionOptions } from './driver.js';

const activityEffectCapabilities = Object.freeze([
  'stable-effect-identity',
  'attributable-attempts',
  'effect-lifecycle',
  'completed-effect-lookup',
  'strict-result-mapping',
  'provider-idempotency',
  'delivery-independent-replay',
  'fenced-work-completion',
  'cooperative-cancellation',
  'durable-restart',
  'health-reporting',
] as const);

export function activityEffectAdapterDescriptor(input: {
  readonly health: AdapterDescriptor['health'];
  readonly checkedAt: string;
  readonly implementationVersion?: string;
}): AdapterDescriptor {
  return Object.freeze({
    id: 'postgres-activity-effect-v2',
    kind: 'activity-effect',
    contractVersion: '2.0.0',
    implementationVersion: input.implementationVersion ?? '0.1.0',
    profile: 'production-like-local',
    capabilities: activityEffectCapabilities,
    health: input.health,
    checkedAt: input.checkedAt,
  });
}

export interface PostgresActivityEffectOptions {
  readonly transaction: TransactionOptions;
  readonly now: () => string;
  readonly id: () => string;
}

export class PostgresActivityEffectStore implements ActivityEffectStore {
  constructor(
    private readonly database: PostgresConnection,
    private readonly options: PostgresActivityEffectOptions,
  ) {}

  async registerWork(work: AttributableWorkItemV1): Promise<void> {
    await this.database.query(
      `insert into mammoth_activity_work
        (work_id, program_id, activity_type, contract_version, input_digest, created_at)
       values ($1, $2, $3, $4, $5, $6::timestamptz)
       on conflict (work_id) do nothing`,
      [
        work.id,
        work.programId,
        work.activityType,
        work.contractVersion,
        work.inputDigest,
        this.options.now(),
      ],
    );
    const stored = await this.resolveWork(work.id);
    if (
      !stored ||
      stored.programId !== work.programId ||
      stored.activityType !== work.activityType ||
      stored.contractVersion !== work.contractVersion ||
      stored.inputDigest !== work.inputDigest
    ) {
      throw new ActivityFailure(
        'attribution_mismatch',
        `Activity work attribution conflict for ${work.id}`,
        false,
      );
    }
  }

  async resolveWork(
    workItemId: string,
  ): Promise<AttributableWorkItemV1 | undefined> {
    const result = await this.database.query<ActivityWorkRow>(
      `select activity.*, work.status from mammoth_activity_work activity
       join mammoth_work_items work on work.id = activity.work_id where activity.work_id = $1`,
      [workItemId],
    );
    const row = result.rows[0];
    if (!row || !['pending', 'leased', 'retry_wait'].includes(row.status))
      return undefined;
    return {
      id: row.work_id,
      programId: row.program_id,
      activityType: row.activity_type,
      contractVersion: row.contract_version,
      inputDigest: row.input_digest,
      state: row.status,
    };
  }

  async appendAttempt(input: ActivityAttemptInput): Promise<void> {
    const { invocation } = input;
    await this.database.query(
      `insert into mammoth_activity_attempts
        (id, work_id, idempotency_key, workflow_id, run_id, activity_id, activity_attempt,
         task_queue, worker_id, lease_owner, fencing_token, recorded_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::timestamptz,$12::timestamptz)
       on conflict (workflow_id, run_id, activity_id, activity_attempt) do nothing`,
      [
        this.options.id(),
        invocation.workItemId,
        input.idempotencyKey,
        invocation.workflow.workflowId,
        invocation.workflow.runId,
        invocation.workflow.activityId,
        invocation.workflow.attempt,
        invocation.workflow.taskQueue,
        invocation.workflow.workerId ?? null,
        invocation.lease?.owner ?? null,
        invocation.lease?.fencingToken ?? null,
        this.options.now(),
      ],
    );
    const stored = await this.database.query<ActivityAttemptRow>(
      `select work_id, idempotency_key, task_queue, worker_id, lease_owner, fencing_token
       from mammoth_activity_attempts
       where workflow_id = $1 and run_id = $2 and activity_id = $3 and activity_attempt = $4`,
      [
        invocation.workflow.workflowId,
        invocation.workflow.runId,
        invocation.workflow.activityId,
        invocation.workflow.attempt,
      ],
    );
    const row = stored.rows[0];
    if (
      !row ||
      row.work_id !== invocation.workItemId ||
      row.idempotency_key !== input.idempotencyKey ||
      row.task_queue !== invocation.workflow.taskQueue ||
      row.worker_id !== (invocation.workflow.workerId ?? null) ||
      row.lease_owner !== (invocation.lease?.owner ?? null) ||
      row.fencing_token !== (invocation.lease?.fencingToken ?? null)
    ) {
      throw new ActivityFailure(
        'attribution_mismatch',
        'Temporal Activity attempt identity conflicts with its durable attribution',
        false,
      );
    }
  }

  async lookup(
    provider: string,
    idempotencyKey: Digest,
  ): Promise<CompletedEffectV1 | PendingEffectV1 | undefined> {
    const result = await this.database.query<EffectRow>(
      'select * from mammoth_activity_effects where provider = $1 and idempotency_key = $2',
      [provider, idempotencyKey],
    );
    return result.rows[0] ? toEffect(result.rows[0]) : undefined;
  }

  async begin(input: BeginEffectInput): Promise<'started' | 'existing'> {
    const attribution = attributionOf(input.invocation);
    const inserted = await this.database.query(
      `insert into mammoth_activity_effects
        (id, provider, idempotency_key, program_id, work_id, operation_kind,
         contract_version, input_digest, state, original_attribution, started_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,'started',$9::jsonb,$10::timestamptz)
       on conflict (provider, idempotency_key) do nothing`,
      [
        this.options.id(),
        input.provider,
        input.idempotencyKey,
        input.identity.programId,
        input.identity.workItemId,
        input.identity.operationKind,
        input.identity.contractVersion,
        input.identity.inputDigest,
        JSON.stringify(attribution),
        input.startedAt,
      ],
    );
    if (inserted.rowCount === 1) return 'started';
    const existing = await this.lookup(input.provider, input.idempotencyKey);
    if (!existing || !sameIdentity(existing, input.identity))
      throw new ActivityFailure(
        'effect_identity_conflict',
        'Stored Activity effect identity does not match the invocation',
        false,
      );
    return 'existing';
  }

  async markAmbiguous(
    provider: string,
    idempotencyKey: Digest,
    code: ActivityFailureCode,
  ): Promise<void> {
    await this.database.query(
      `update mammoth_activity_effects set state = 'ambiguous', ambiguous_at = $3::timestamptz
       where provider = $1 and idempotency_key = $2 and state = 'started'`,
      [provider, idempotencyKey, this.options.now()],
    );
    await this.updateAttempt(provider, idempotencyKey, 'ambiguous', code);
  }

  async complete(input: CompletedEffectV1): Promise<CompletedEffectV1> {
    await this.database.transaction(this.options.transaction, async (tx) => {
      await tx.query(
        `update mammoth_activity_effects set state = 'completed', provider_receipt = $3::jsonb,
           result_schema = $4, result_digest = $5, result = $6::jsonb, completed_at = $7::timestamptz
         where provider = $1 and idempotency_key = $2 and state in ('started','ambiguous')`,
        [
          input.provider,
          input.idempotencyKey,
          JSON.stringify(input.providerReceipt),
          input.resultSchema,
          input.resultDigest,
          JSON.stringify(input.result),
          input.completedAt,
        ],
      );
      await tx.query(
        `update mammoth_activity_attempts set provider = $1, outcome = 'completed', updated_at = $3::timestamptz
         where idempotency_key = $2 and outcome is null`,
        [input.provider, input.idempotencyKey, this.options.now()],
      );
    });
    const stored = await this.lookup(input.provider, input.idempotencyKey);
    if (
      !stored ||
      stored.state !== 'completed' ||
      !sameCompletion(stored, input)
    ) {
      throw new ActivityFailure(
        'effect_identity_conflict',
        'Stored Activity completion conflicts with the provider result',
        false,
      );
    }
    return stored;
  }

  async heartbeat(
    input: ActivityAttemptInput,
    progress: HeartbeatProgressV1,
  ): Promise<void> {
    await this.database.query(
      `update mammoth_activity_attempts set heartbeat_progress = $5::jsonb, updated_at = $6::timestamptz
       where workflow_id = $1 and run_id = $2 and activity_id = $3 and activity_attempt = $4`,
      [
        input.invocation.workflow.workflowId,
        input.invocation.workflow.runId,
        input.invocation.workflow.activityId,
        input.invocation.workflow.attempt,
        JSON.stringify(progress),
        this.options.now(),
      ],
    );
  }

  async failAttempt(
    input: ActivityAttemptInput,
    failure: ActivityFailure,
  ): Promise<void> {
    await this.database.query(
      `update mammoth_activity_attempts set outcome = 'failed', failure_code = $5,
         updated_at = $6::timestamptz where workflow_id = $1 and run_id = $2
         and activity_id = $3 and activity_attempt = $4`,
      [
        input.invocation.workflow.workflowId,
        input.invocation.workflow.runId,
        input.invocation.workflow.activityId,
        input.invocation.workflow.attempt,
        failure.code,
        this.options.now(),
      ],
    );
  }

  /**
   * Advances only the currently fenced delivery after the immutable completion
   * is durable. A completion created under an older fence remains reusable, but
   * the old worker can never advance current work state.
   */
  async completeWorkFromEffect(input: {
    readonly invocation: ActivityInvocationV1;
    readonly provider: string;
    readonly idempotencyKey: Digest;
  }): Promise<void> {
    const lease = input.invocation.lease;
    if (lease === undefined)
      throw new ActivityFailure(
        'stale_fence',
        'A fenced work completion requires a current lease',
        false,
      );
    await this.database.transaction(this.options.transaction, async (tx) => {
      const effect = await tx.query<{ work_id: string; program_id: string }>(
        `select work_id, program_id from mammoth_activity_effects
         where provider = $1 and idempotency_key = $2 and state = 'completed'
         for share`,
        [input.provider, input.idempotencyKey],
      );
      const effectRow = effect.rows[0];
      if (
        effectRow === undefined ||
        effectRow.work_id !== input.invocation.workItemId ||
        effectRow.program_id !== input.invocation.programId
      ) {
        throw new ActivityFailure(
          'effect_identity_conflict',
          'Completed effect does not match the attributable work item',
          false,
        );
      }
      const updated = await tx.query(
        `update mammoth_work_items set status = 'completed', lease_owner = null,
           lease_expires_at = null, updated_at = $4::timestamptz
         where id = $1 and status = 'leased'
           and lease_owner = $2 and fencing_token = $3`,
        [
          input.invocation.workItemId,
          lease.owner,
          lease.fencingToken,
          this.options.now(),
        ],
      );
      if (updated.rowCount !== 1)
        throw new ActivityFailure(
          'stale_fence',
          'The Activity delivery no longer owns the current work fence',
          false,
        );
    });
  }

  private async updateAttempt(
    provider: string,
    key: Digest,
    outcome: string,
    code: string,
  ): Promise<void> {
    await this.database.query(
      `update mammoth_activity_attempts set provider = $1, outcome = $3, failure_code = $4,
       updated_at = $5::timestamptz where idempotency_key = $2 and outcome is null`,
      [provider, key, outcome, code, this.options.now()],
    );
  }
}

interface ActivityWorkRow extends Record<string, unknown> {
  work_id: string;
  program_id: string;
  activity_type: AttributableWorkItemV1['activityType'];
  contract_version: string;
  input_digest: Digest;
  status: AttributableWorkItemV1['state'];
}
interface ActivityAttemptRow extends Record<string, unknown> {
  work_id: string;
  idempotency_key: Digest;
  task_queue: string;
  worker_id: string | null;
  lease_owner: string | null;
  fencing_token: number | null;
}
interface EffectRow extends Record<string, unknown> {
  id: string;
  provider: string;
  idempotency_key: Digest;
  program_id: string;
  work_id: string;
  operation_kind: CompletedEffectV1['operationKind'];
  contract_version: string;
  input_digest: Digest;
  state: 'started' | 'ambiguous' | 'completed';
  original_attribution: CompletedEffectV1['originalAttribution'];
  provider_receipt: unknown;
  result_schema: string | null;
  result_digest: Digest | null;
  result: unknown;
  started_at: string;
  completed_at: string | null;
}
function toEffect(row: EffectRow): CompletedEffectV1 | PendingEffectV1 {
  const identity = {
    schemaVersion: 1 as const,
    programId: row.program_id,
    workItemId: row.work_id,
    contractVersion: row.contract_version,
    inputDigest: row.input_digest,
    operationKind: row.operation_kind,
  };
  if (row.state !== 'completed')
    return {
      ...identity,
      provider: row.provider,
      idempotencyKey: row.idempotency_key,
      state: row.state,
    };
  if (!row.result_schema || !row.result_digest || !row.completed_at)
    throw new ActivityFailure(
      'integrity_failure',
      'Completed Activity effect is missing required result fields',
      false,
    );
  return {
    ...identity,
    id: row.id,
    provider: row.provider,
    idempotencyKey: row.idempotency_key,
    state: 'completed',
    originalAttribution: row.original_attribution,
    providerReceipt: row.provider_receipt,
    resultSchema: row.result_schema,
    resultDigest: row.result_digest,
    result: row.result,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}
function attributionOf(
  invocation: ActivityInvocationV1,
): CompletedEffectV1['originalAttribution'] {
  return {
    ...invocation.workflow,
    ...(invocation.lease === undefined
      ? {}
      : {
          leaseOwner: invocation.lease.owner,
          fencingToken: invocation.lease.fencingToken,
        }),
  };
}
function sameIdentity(
  left: PendingEffectV1 | CompletedEffectV1,
  right: BeginEffectInput['identity'],
): boolean {
  return (
    left.programId === right.programId &&
    left.workItemId === right.workItemId &&
    left.operationKind === right.operationKind &&
    left.contractVersion === right.contractVersion &&
    left.inputDigest === right.inputDigest
  );
}
function sameCompletion(
  left: CompletedEffectV1,
  right: CompletedEffectV1,
): boolean {
  return (
    sameIdentity(left, right) &&
    left.resultSchema === right.resultSchema &&
    left.resultDigest === right.resultDigest &&
    canonicalDigest(left.result) === left.resultDigest &&
    canonicalDigest(right.result) === right.resultDigest &&
    canonicalDigest(left.providerReceipt) ===
      canonicalDigest(right.providerReceipt)
  );
}
