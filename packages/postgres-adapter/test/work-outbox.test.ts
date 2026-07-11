import { describe, expect, it } from 'vitest';
import type {
  PostgresConnection,
  QueryResult,
  TransactionOptions,
} from '../src/driver.js';
import { foundationMigrations } from '../src/migrations.js';
import {
  PostgresOutbox,
  PostgresWorkState,
  WorkStateConflictError,
} from '../src/work-outbox.js';

type Row = Record<string, unknown>;
class RecordingDatabase implements PostgresConnection {
  calls: { sql: string; parameters: readonly unknown[] }[] = [];
  transactions = 0;
  handler: (
    sql: string,
    parameters: readonly unknown[],
  ) => QueryResult<Row> | Promise<QueryResult<Row>> = () => empty(1);
  async query<R extends Row>(
    sql: string,
    parameters: readonly unknown[] = [],
  ): Promise<QueryResult<R>> {
    this.calls.push({ sql, parameters });
    return (await this.handler(sql, parameters)) as QueryResult<R>;
  }
  async transaction<T>(
    _options: TransactionOptions,
    operation: (transaction: PostgresConnection) => Promise<T>,
  ): Promise<T> {
    this.transactions += 1;
    const start = this.calls.length;
    try {
      return await operation(this);
    } catch (error) {
      this.calls.splice(start);
      throw error;
    }
  }
}

const now = '2026-07-10T12:00:00.000Z';
const options = {
  transaction: { statementTimeoutMs: 1_000, transactionTimeoutMs: 2_000 },
  now: () => now,
  id: (() => {
    let value = 0;
    return () => `id-${String(++value)}`;
  })(),
};

describe('D4 schema', () => {
  it('pins fencing, receipts, attribution, poison visibility, and dispatch uniqueness', () => {
    const migration = foundationMigrations.find(({ version }) => version === 3);
    expect(migration?.name).toBe('durable_work_effects_outbox');
    expect(migration?.sql).toMatch(/fencing_token bigint not null/);
    expect(migration?.sql).toMatch(/cancellation_requested_at/);
    expect(migration?.sql).toMatch(
      /unique \(provider, idempotency_key, state\)/,
    );
    expect(migration?.sql).toMatch(/authoritative_revision bigint/);
    expect(migration?.sql).toMatch(/poison_at timestamptz/);
    expect(migration?.sql).toMatch(/primary key \(outbox_id, destination\)/);
    expect(migration?.checksum).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('transactional work state', () => {
  it('atomically enqueues work and its attributable outbox event', async () => {
    const database = new RecordingDatabase();
    await new PostgresWorkState(database, options).enqueue({
      id: 'work-1',
      payload: { criterion: 'c1' },
      maxAttempts: 3,
      authoritativeRevision: 7,
    });
    expect(database.transactions).toBe(1);
    expect(database.calls).toHaveLength(2);
    expect(database.calls[0]?.sql).toContain('insert into mammoth_work_items');
    expect(database.calls[1]?.sql).toContain('insert into mammoth_work_outbox');
    expect(database.calls[1]?.parameters).toContain(7);
  });

  it('rolls work back when its outbox insert fails', async () => {
    const database = new RecordingDatabase();
    database.handler = (sql) => {
      if (sql.includes('mammoth_work_outbox'))
        throw new Error('injected death');
      return empty(1);
    };
    await expect(
      new PostgresWorkState(database, options).enqueue({
        id: 'work-1',
        payload: {},
        maxAttempts: 2,
      }),
    ).rejects.toThrow('injected death');
    expect(database.calls).toEqual([]);
  });

  it('claims with skip-locked leases and advances a fencing token', async () => {
    const database = new RecordingDatabase();
    database.handler = (sql) =>
      sql.includes('with candidate')
        ? result(
            workRow({ fencing_token: 4, attempt: 2, lease_owner: 'worker-b' }),
          )
        : empty();
    const claimed = await new PostgresWorkState(database, options).claim({
      owner: 'worker-b',
      now,
      leaseExpiresAt: '2026-07-10T12:01:00.000Z',
    });
    expect(claimed).toMatchObject({
      id: 'work-1',
      status: 'leased',
      leaseOwner: 'worker-b',
      fencingToken: 4,
      attempt: 2,
    });
    expect(database.calls[0]?.sql).toContain('for update skip locked');
    expect(database.calls[0]?.sql).toContain('fencing_token + 1');
  });

  it('fails closed for a stale owner or fencing token', async () => {
    const database = new RecordingDatabase();
    database.handler = () => empty();
    await expect(
      new PostgresWorkState(database, options).complete(
        effect({ fencingToken: 3 }),
      ),
    ).rejects.toBeInstanceOf(WorkStateConflictError);
    expect(database.calls).toEqual([]);
  });

  it('persists provider receipt, terminal state, and outbox in one transaction', async () => {
    const database = new RecordingDatabase();
    database.handler = (sql) => {
      if (sql.startsWith('select * from mammoth_work_items'))
        return result(workRow());
      if (sql.startsWith('insert into mammoth_effect_receipts'))
        return result({ work_id: 'work-1', fencing_token: 3 });
      return empty(1);
    };
    await new PostgresWorkState(database, options).complete(effect());
    expect(database.transactions).toBe(1);
    expect(database.calls.map(({ sql }) => sql)).toEqual([
      expect.stringContaining('for update'),
      expect.stringContaining('insert into mammoth_effect_receipts'),
      expect.stringContaining("status = 'completed'"),
      expect.stringContaining('insert into mammoth_work_outbox'),
    ]);
    expect(database.calls[1]?.sql).toContain(
      'on conflict (provider, idempotency_key, state) do nothing',
    );
    expect(database.calls[3]?.parameters).toContain('work.completed');
  });

  it('records partial receipts without acknowledging the work item', async () => {
    const database = new RecordingDatabase();
    database.handler = (sql) => {
      if (sql.startsWith('select * from mammoth_work_items'))
        return result(workRow());
      if (sql.startsWith('insert into mammoth_effect_receipts'))
        return result({ work_id: 'work-1', fencing_token: 3 });
      return empty(1);
    };
    await new PostgresWorkState(database, options).recordPartialEffect(
      effect(),
    );
    expect(database.calls).toHaveLength(2);
    expect(database.calls[1]?.parameters).toContain('partial');
    expect(
      database.calls.some(({ sql }) => sql.includes('work.completed')),
    ).toBe(false);
  });

  it('turns cancellation during a lease into cancelled state on failure', async () => {
    const database = new RecordingDatabase();
    database.handler = (sql) =>
      sql.startsWith('select * from mammoth_work_items')
        ? result(workRow({ cancellation_requested_at: now }))
        : empty(1);
    const status = await new PostgresWorkState(database, options).fail({
      workId: 'work-1',
      owner: 'worker-a',
      fencingToken: 3,
      reason: 'cancelled by operator',
      retryAt: '2026-07-10T12:02:00.000Z',
    });
    expect(status).toBe('cancelled');
    expect(database.calls[1]?.parameters).toContain('cancelled');
    expect(database.calls[2]?.parameters).toContain('work.cancelled');
  });
});

describe('durable outbox', () => {
  it('uses durable acknowledgments and a stable dispatch key', async () => {
    const database = new RecordingDatabase();
    let acknowledgments = 0;
    database.handler = (sql) => {
      if (sql.startsWith('select outbox.*')) return result(outboxRow());
      if (sql.startsWith('insert into mammoth_outbox_dispatches')) {
        acknowledgments += 1;
        return empty(acknowledgments === 1 ? 1 : 0);
      }
      return empty();
    };
    const outbox = new PostgresOutbox(database, options);
    expect(await outbox.pending('event-bus', 10, now)).toHaveLength(1);
    const ack = {
      outboxId: 'outbox-1',
      destination: 'event-bus',
      dispatchKey: 'mammoth:outbox-1:event-bus',
      providerReceipt: { messageId: 'provider-7' },
    };
    expect(await outbox.acknowledge(ack)).toBe(true);
    expect(await outbox.acknowledge(ack)).toBe(false);
    expect(database.calls[0]?.sql).toContain('not exists');
    expect(database.calls[0]?.parameters).toContain('event-bus');
    expect(database.calls[1]?.parameters).toContain(
      'mammoth:outbox-1:event-bus',
    );
  });

  it('retains retry errors and visibly poisons exhausted rows', async () => {
    const database = new RecordingDatabase();
    await new PostgresOutbox(database, options).reject({
      outboxId: 'outbox-1',
      error: 'provider rejected payload',
      retryAt: '2026-07-10T12:05:00.000Z',
      poisonAfter: 3,
    });
    expect(database.calls[0]?.sql).toContain('attempt_count + 1');
    expect(database.calls[0]?.sql).toContain('last_error = $2');
    expect(database.calls[0]?.sql).toContain('poison_at = case');
  });
});

function effect(overrides: Record<string, unknown> = {}) {
  return {
    workId: 'work-1',
    owner: 'worker-a',
    fencingToken: 3,
    provider: 'fixture-provider',
    idempotencyKey: 'program:p1:effect:e1',
    providerReceipt: { providerId: 'external-1' },
    ...overrides,
  };
}
function workRow(overrides: Partial<Row> = {}): Row {
  return {
    id: 'work-1',
    authoritative_revision: 7,
    status: 'leased',
    payload: {},
    attempt: 1,
    max_attempts: 3,
    next_attempt_at: now,
    lease_owner: 'worker-a',
    lease_expires_at: '2026-07-10T12:01:00.000Z',
    fencing_token: 3,
    cancellation_requested_at: null,
    terminal_reason: null,
    ...overrides,
  };
}
function outboxRow(): Row {
  return {
    id: 'outbox-1',
    work_id: 'work-1',
    authoritative_revision: 7,
    fencing_token: 3,
    topic: 'work.completed',
    payload: {},
    attempt_count: 0,
    last_error: null,
    poison_at: null,
  };
}
function result(row: Row): QueryResult<Row> {
  return { rows: [row], rowCount: 1 };
}
function empty(rowCount = 0): QueryResult<Row> {
  return { rows: [], rowCount };
}
