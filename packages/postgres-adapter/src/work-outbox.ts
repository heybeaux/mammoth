import type { PostgresConnection, TransactionOptions } from './driver.js';

export type WorkStatus =
  | 'pending'
  | 'leased'
  | 'retry_wait'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface WorkItem {
  readonly id: string;
  readonly authoritativeRevision: number | null;
  readonly status: WorkStatus;
  readonly payload: unknown;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly nextAttemptAt: string;
  readonly leaseOwner: string | null;
  readonly leaseExpiresAt: string | null;
  readonly fencingToken: number;
  readonly cancellationRequestedAt: string | null;
  readonly terminalReason: string | null;
}

export interface ClaimedWork extends WorkItem {
  readonly status: 'leased';
  readonly leaseOwner: string;
  readonly leaseExpiresAt: string;
}

export interface WorkOutboxRow {
  readonly id: string;
  readonly workId: string;
  readonly authoritativeRevision: number | null;
  readonly fencingToken: number;
  readonly topic: string;
  readonly payload: unknown;
  readonly attemptCount: number;
  readonly lastError: string | null;
  readonly poisonAt: string | null;
}

export interface WorkStateOptions {
  readonly transaction: TransactionOptions;
  readonly now: () => string;
  readonly id: () => string;
}

export class WorkStateConflictError extends Error {
  readonly code = 'work_state_conflict';
  readonly retryable = true;
  constructor(message: string) {
    super(message);
    this.name = 'WorkStateConflictError';
  }
}

/**
 * Postgres owns work-state atomicity. External providers own effect idempotency:
 * callers MUST send the persisted `idempotencyKey` to the provider and persist
 * the provider receipt before acknowledging completion.
 */
export class PostgresWorkState {
  constructor(
    private readonly database: PostgresConnection,
    private readonly options: WorkStateOptions,
  ) {}

  async enqueue(input: {
    readonly id: string;
    readonly payload: unknown;
    readonly maxAttempts: number;
    readonly authoritativeRevision?: number;
  }): Promise<void> {
    const now = this.options.now();
    await this.database.transaction(this.options.transaction, async (tx) => {
      await tx.query(
        `insert into mammoth_work_items
          (id, authoritative_revision, status, payload, max_attempts, next_attempt_at, created_at, updated_at)
         values ($1, $2, 'pending', $3::jsonb, $4, $5::timestamptz, $5::timestamptz, $5::timestamptz)`,
        [
          input.id,
          input.authoritativeRevision ?? null,
          JSON.stringify(input.payload),
          input.maxAttempts,
          now,
        ],
      );
      await this.insertOutbox(tx, {
        workId: input.id,
        authoritativeRevision: input.authoritativeRevision ?? null,
        fencingToken: 0,
        topic: 'work.enqueued',
        payload: { workId: input.id },
        now,
      });
    });
  }

  async claim(input: {
    readonly owner: string;
    readonly now: string;
    readonly leaseExpiresAt: string;
  }): Promise<ClaimedWork | null> {
    return this.database.transaction(this.options.transaction, async (tx) => {
      const claimed = await tx.query<WorkRow>(
        `with candidate as (
           select id from mammoth_work_items
           where cancellation_requested_at is null
             and ((status in ('pending','retry_wait') and next_attempt_at <= $1::timestamptz)
               or (status = 'leased' and lease_expires_at <= $1::timestamptz))
           order by next_attempt_at, id for update skip locked limit 1
         )
         update mammoth_work_items work
         set status = 'leased', lease_owner = $2, lease_expires_at = $3::timestamptz,
             fencing_token = fencing_token + 1, attempt = attempt + 1, updated_at = $1::timestamptz
         from candidate where work.id = candidate.id returning work.*`,
        [input.now, input.owner, input.leaseExpiresAt],
      );
      return claimed.rows[0] ? (toWork(claimed.rows[0]) as ClaimedWork) : null;
    });
  }

  async recordPartialEffect(input: EffectInput): Promise<void> {
    await this.database.transaction(this.options.transaction, async (tx) => {
      await this.assertLease(tx, input.workId, input.owner, input.fencingToken);
      await this.insertReceipt(tx, input, 'partial');
    });
  }

  async complete(input: EffectInput): Promise<void> {
    const now = this.options.now();
    await this.database.transaction(this.options.transaction, async (tx) => {
      const work = await this.assertLease(
        tx,
        input.workId,
        input.owner,
        input.fencingToken,
      );
      await this.insertReceipt(tx, input, 'completed');
      const updated = await tx.query(
        `update mammoth_work_items set status = 'completed', lease_owner = null,
           lease_expires_at = null, updated_at = $4::timestamptz
         where id = $1 and status = 'leased' and lease_owner = $2 and fencing_token = $3`,
        [input.workId, input.owner, input.fencingToken, now],
      );
      if (updated.rowCount !== 1) throw staleFence(input.workId);
      await this.insertOutbox(tx, {
        workId: input.workId,
        authoritativeRevision: work.authoritative_revision,
        fencingToken: input.fencingToken,
        topic: 'work.completed',
        payload: {
          workId: input.workId,
          provider: input.provider,
          idempotencyKey: input.idempotencyKey,
        },
        now,
      });
    });
  }

  async fail(input: {
    readonly workId: string;
    readonly owner: string;
    readonly fencingToken: number;
    readonly reason: string;
    readonly retryAt: string;
  }): Promise<WorkStatus> {
    const now = this.options.now();
    return this.database.transaction(this.options.transaction, async (tx) => {
      const work = await this.assertLease(
        tx,
        input.workId,
        input.owner,
        input.fencingToken,
      );
      const status: WorkStatus =
        work.cancellation_requested_at !== null
          ? 'cancelled'
          : work.attempt >= work.max_attempts
            ? 'failed'
            : 'retry_wait';
      const updated = await tx.query(
        `update mammoth_work_items set status = $4, lease_owner = null,
           lease_expires_at = null, next_attempt_at = $5::timestamptz,
           terminal_reason = case when $4 = 'retry_wait' then null else $6 end,
           updated_at = $7::timestamptz
         where id = $1 and status = 'leased' and lease_owner = $2 and fencing_token = $3`,
        [
          input.workId,
          input.owner,
          input.fencingToken,
          status,
          input.retryAt,
          input.reason,
          now,
        ],
      );
      if (updated.rowCount !== 1) throw staleFence(input.workId);
      await this.insertOutbox(tx, {
        workId: input.workId,
        authoritativeRevision: work.authoritative_revision,
        fencingToken: input.fencingToken,
        topic: `work.${status}`,
        payload: { workId: input.workId, reason: input.reason },
        now,
      });
      return status;
    });
  }

  async cancel(workId: string, reason: string): Promise<void> {
    const now = this.options.now();
    await this.database.transaction(this.options.transaction, async (tx) => {
      const selected = await tx.query<WorkRow>(
        'select * from mammoth_work_items where id = $1 for update',
        [workId],
      );
      const work = selected.rows[0];
      if (!work)
        throw new WorkStateConflictError(`Unknown work item ${workId}`);
      if (['completed', 'failed', 'cancelled'].includes(work.status)) return;
      const leased = work.status === 'leased';
      await tx.query(
        `update mammoth_work_items set cancellation_requested_at = $2::timestamptz,
           status = case when status = 'leased' then status else 'cancelled' end,
           terminal_reason = case when status = 'leased' then terminal_reason else $3 end,
           updated_at = $2::timestamptz where id = $1`,
        [workId, now, reason],
      );
      if (!leased) {
        await this.insertOutbox(tx, {
          workId,
          authoritativeRevision: work.authoritative_revision,
          fencingToken: work.fencing_token,
          topic: 'work.cancelled',
          payload: { workId, reason },
          now,
        });
      }
    });
  }

  private async assertLease(
    tx: PostgresConnection,
    workId: string,
    owner: string,
    fencingToken: number,
  ): Promise<WorkRow> {
    const selected = await tx.query<WorkRow>(
      `select * from mammoth_work_items
       where id = $1 and status = 'leased' and lease_owner = $2 and fencing_token = $3
       for update`,
      [workId, owner, fencingToken],
    );
    if (!selected.rows[0]) throw staleFence(workId);
    return selected.rows[0];
  }

  private async insertReceipt(
    tx: PostgresConnection,
    input: EffectInput,
    state: 'partial' | 'completed',
  ): Promise<void> {
    const inserted = await tx.query<{
      work_id: string;
      fencing_token: number;
    }>(
      `insert into mammoth_effect_receipts
        (id, work_id, provider, idempotency_key, fencing_token, state, provider_receipt, recorded_at)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::timestamptz)
       on conflict (provider, idempotency_key, state) do nothing
       returning work_id, fencing_token`,
      [
        this.options.id(),
        input.workId,
        input.provider,
        input.idempotencyKey,
        input.fencingToken,
        state,
        JSON.stringify(input.providerReceipt),
        this.options.now(),
      ],
    );
    if (inserted.rowCount === 1) return;
    const existing = await tx.query<{
      work_id: string;
      fencing_token: number;
    }>(
      `select work_id, fencing_token from mammoth_effect_receipts
       where provider = $1 and idempotency_key = $2 and state = $3`,
      [input.provider, input.idempotencyKey, state],
    );
    const receipt = existing.rows[0];
    if (
      receipt?.work_id !== input.workId ||
      receipt.fencing_token !== input.fencingToken
    ) {
      throw new WorkStateConflictError(
        `Provider idempotency key is already attributed to different work: ${input.idempotencyKey}`,
      );
    }
  }

  private async insertOutbox(
    tx: PostgresConnection,
    input: {
      workId: string;
      authoritativeRevision: number | null;
      fencingToken: number;
      topic: string;
      payload: unknown;
      now: string;
    },
  ): Promise<void> {
    await tx.query(
      `insert into mammoth_work_outbox
        (id, work_id, authoritative_revision, fencing_token, topic, payload, created_at, available_at)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7::timestamptz, $7::timestamptz)`,
      [
        this.options.id(),
        input.workId,
        input.authoritativeRevision,
        input.fencingToken,
        input.topic,
        JSON.stringify(input.payload),
        input.now,
      ],
    );
  }
}

export class PostgresOutbox {
  constructor(
    private readonly database: PostgresConnection,
    private readonly options: WorkStateOptions,
  ) {}

  async pending(
    destination: string,
    limit: number,
    now: string,
  ): Promise<readonly WorkOutboxRow[]> {
    const result = await this.database.query<OutboxRow>(
      `select outbox.* from mammoth_work_outbox outbox
       where outbox.poison_at is null and outbox.available_at <= $1::timestamptz
         and not exists (select 1 from mammoth_outbox_dispatches dispatch
           where dispatch.outbox_id = outbox.id and dispatch.destination = $3)
       order by outbox.available_at, outbox.id limit $2`,
      [now, limit, destination],
    );
    return result.rows.map(toOutbox);
  }

  async acknowledge(input: {
    readonly outboxId: string;
    readonly destination: string;
    readonly dispatchKey: string;
    readonly providerReceipt: unknown;
  }): Promise<boolean> {
    const result = await this.database.query(
      `insert into mammoth_outbox_dispatches
        (outbox_id, destination, dispatch_key, provider_receipt, dispatched_at)
       values ($1, $2, $3, $4::jsonb, $5::timestamptz)
       on conflict (outbox_id, destination) do nothing`,
      [
        input.outboxId,
        input.destination,
        input.dispatchKey,
        JSON.stringify(input.providerReceipt),
        this.options.now(),
      ],
    );
    return result.rowCount === 1;
  }

  async reject(input: {
    readonly outboxId: string;
    readonly error: string;
    readonly retryAt: string;
    readonly poisonAfter: number;
  }): Promise<void> {
    await this.database.query(
      `update mammoth_work_outbox set attempt_count = attempt_count + 1,
         last_error = $2, available_at = $3::timestamptz,
         poison_at = case when attempt_count + 1 >= $4 then $5::timestamptz else null end
       where id = $1`,
      [
        input.outboxId,
        input.error,
        input.retryAt,
        input.poisonAfter,
        this.options.now(),
      ],
    );
  }
}

interface EffectInput {
  readonly workId: string;
  readonly owner: string;
  readonly fencingToken: number;
  readonly provider: string;
  readonly idempotencyKey: string;
  readonly providerReceipt: unknown;
}

interface WorkRow extends Record<string, unknown> {
  id: string;
  authoritative_revision: number | null;
  status: WorkStatus;
  payload: unknown;
  attempt: number;
  max_attempts: number;
  next_attempt_at: string;
  lease_owner: string | null;
  lease_expires_at: string | null;
  fencing_token: number;
  cancellation_requested_at: string | null;
  terminal_reason: string | null;
}
interface OutboxRow extends Record<string, unknown> {
  id: string;
  work_id: string;
  authoritative_revision: number | null;
  fencing_token: number;
  topic: string;
  payload: unknown;
  attempt_count: number;
  last_error: string | null;
  poison_at: string | null;
}
function toWork(row: WorkRow): WorkItem {
  return {
    id: row.id,
    authoritativeRevision: row.authoritative_revision,
    status: row.status,
    payload: row.payload,
    attempt: row.attempt,
    maxAttempts: row.max_attempts,
    nextAttemptAt: row.next_attempt_at,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    fencingToken: row.fencing_token,
    cancellationRequestedAt: row.cancellation_requested_at,
    terminalReason: row.terminal_reason,
  };
}
function toOutbox(row: OutboxRow): WorkOutboxRow {
  return {
    id: row.id,
    workId: row.work_id,
    authoritativeRevision: row.authoritative_revision,
    fencingToken: row.fencing_token,
    topic: row.topic,
    payload: row.payload,
    attemptCount: row.attempt_count,
    lastError: row.last_error,
    poisonAt: row.poison_at,
  };
}
function staleFence(workId: string): WorkStateConflictError {
  return new WorkStateConflictError(
    `Lease owner or fencing token is stale for work item ${workId}`,
  );
}
