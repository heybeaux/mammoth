import { describe, expect, it } from 'vitest';
import { canonicalDigest, type CompletedEffectV1 } from '@mammoth/work-queue';
import type {
  PostgresConnection,
  QueryResult,
  TransactionOptions,
} from '../src/driver.js';
import { foundationMigrations } from '../src/migrations.js';
import {
  activityEffectAdapterDescriptor,
  PostgresActivityEffectStore,
} from '../src/activity-effects.js';

type Row = Record<string, unknown>;
class RecordingDatabase implements PostgresConnection {
  readonly calls: { sql: string; parameters: readonly unknown[] }[] = [];
  handler: (sql: string, parameters: readonly unknown[]) => QueryResult<Row> =
    () => empty(1);
  query<R extends Row>(
    sql: string,
    parameters: readonly unknown[] = [],
  ): Promise<QueryResult<R>> {
    this.calls.push({ sql, parameters });
    return Promise.resolve(this.handler(sql, parameters) as QueryResult<R>);
  }
  async transaction<T>(
    _options: TransactionOptions,
    operation: (tx: PostgresConnection) => Promise<T>,
  ): Promise<T> {
    return operation(this);
  }
}
const now = '2026-07-13T12:00:00.000Z';
const options = {
  transaction: { statementTimeoutMs: 1_000, transactionTimeoutMs: 2_000 },
  now: () => now,
  id: () => 'id-1',
};
const inputDigest = canonicalDigest({ target: 'https://example.test' });
const key = canonicalDigest({ effect: 'one' });

describe('Activity-effect v2 migration', () => {
  it('adds forward-only attribution, attempt, lifecycle, lookup, and diagnostic schema', () => {
    const migration = foundationMigrations.find(({ version }) => version === 4);
    expect(migration?.name).toBe('activity_effect_v2');
    expect(migration?.sql).toContain('create table mammoth_activity_work');
    expect(migration?.sql).toContain('create table mammoth_activity_attempts');
    expect(migration?.sql).toContain('create table mammoth_activity_effects');
    expect(migration?.sql).toContain(
      "state in ('started','ambiguous','completed')",
    );
    expect(migration?.sql).toContain('unique (provider, idempotency_key)');
    expect(migration?.sql).toContain('mammoth_activity_attempt_workflow_idx');
    expect(migration?.sql).toContain(
      'completed Activity effects are immutable',
    );
    expect(migration?.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(foundationMigrations.map(({ version }) => version)).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });

  it('advertises only the explicit major-2 Activity-effect capabilities', () => {
    const descriptor = activityEffectAdapterDescriptor({
      health: 'healthy',
      checkedAt: now,
    });
    expect(descriptor).toMatchObject({
      kind: 'activity-effect',
      contractVersion: '2.0.0',
      health: 'healthy',
      checkedAt: now,
    });
    expect(descriptor.capabilities).toContain('completed-effect-lookup');
    expect(descriptor.capabilities).toContain('delivery-independent-replay');
  });
});

describe('Postgres Activity effects', () => {
  it('registers and strictly resolves attributable work', async () => {
    const database = new RecordingDatabase();
    database.handler = (sql) =>
      sql.startsWith('select activity.*') ? result(workRow()) : empty(1);
    const store = new PostgresActivityEffectStore(database, options);
    await store.registerWork({
      id: 'work-1',
      programId: 'program-1',
      activityType: 'retrieval',
      contractVersion: '2.0.0',
      inputDigest,
      state: 'leased',
    });
    expect(database.calls[0]?.sql).toContain(
      'on conflict (work_id) do nothing',
    );
    expect(await store.resolveWork('work-1')).toMatchObject({
      id: 'work-1',
      programId: 'program-1',
      state: 'leased',
    });
  });

  it('looks up a completed typed result independently of its original delivery fence', async () => {
    const database = new RecordingDatabase();
    database.handler = (sql) =>
      sql.startsWith('select * from mammoth_activity_effects')
        ? result(effectRow())
        : empty(1);
    const completed = await new PostgresActivityEffectStore(
      database,
      options,
    ).lookup('fixture-provider', key);
    expect(completed).toMatchObject({
      state: 'completed',
      idempotencyKey: key,
      originalAttribution: { runId: 'old-run', fencingToken: 3 },
      result: { artifactId: 'artifact-1' },
    });
    expect(database.calls[0]?.parameters).toEqual(['fixture-provider', key]);
  });

  it('records each Temporal delivery attempt with workflow, worker, lease, and fence attribution', async () => {
    const database = new RecordingDatabase();
    database.handler = (sql) =>
      sql.includes('from mammoth_activity_attempts')
        ? result({
            work_id: 'work-1',
            idempotency_key: key,
            task_queue: 'retrieval',
            worker_id: 'worker-b',
            lease_owner: 'lease-b',
            fencing_token: 9,
          })
        : empty(1);
    await new PostgresActivityEffectStore(database, options).appendAttempt({
      idempotencyKey: key,
      invocation: {
        schemaVersion: 1,
        activityType: 'retrieval',
        operationKind: 'retrieval.fetch',
        contractVersion: '2.0.0',
        programId: 'program-1',
        workItemId: 'work-1',
        input: {},
        inputDigest,
        workflow: {
          workflowId: 'workflow-1',
          runId: 'run-2',
          activityId: 'activity-1',
          attempt: 4,
          taskQueue: 'retrieval',
          workerId: 'worker-b',
        },
        lease: { owner: 'lease-b', fencingToken: 9 },
      },
    });
    expect(database.calls[0]?.sql).toContain('mammoth_activity_attempts');
    expect(database.calls[0]?.sql).toContain(
      'on conflict (workflow_id, run_id, activity_id, activity_attempt)',
    );
    expect(database.calls[0]?.parameters).toEqual(
      expect.arrayContaining([
        'workflow-1',
        'run-2',
        4,
        'worker-b',
        'lease-b',
        9,
      ]),
    );
  });

  it('rejects a duplicate delivery tuple with conflicting durable attribution', async () => {
    const database = new RecordingDatabase();
    database.handler = (sql) =>
      sql.includes('from mammoth_activity_attempts')
        ? result({
            work_id: 'other-work',
            idempotency_key: key,
            task_queue: 'retrieval',
            worker_id: 'worker-b',
            lease_owner: 'lease-b',
            fencing_token: 9,
          })
        : empty(1);
    await expect(
      new PostgresActivityEffectStore(database, options).appendAttempt({
        idempotencyKey: key,
        invocation: attemptInvocation(),
      }),
    ).rejects.toMatchObject({ code: 'attribution_mismatch', retryable: false });
  });

  it('advances work only under the current fence after durable effect completion', async () => {
    const database = new RecordingDatabase();
    database.handler = (sql) =>
      sql.startsWith('select work_id, program_id from mammoth_activity_effects')
        ? result({ work_id: 'work-1', program_id: 'program-1' })
        : empty(1);
    const store = new PostgresActivityEffectStore(database, options);
    await store.completeWorkFromEffect({
      invocation: {
        schemaVersion: 1,
        activityType: 'retrieval',
        operationKind: 'retrieval.fetch',
        contractVersion: '2.0.0',
        programId: 'program-1',
        workItemId: 'work-1',
        input: {},
        inputDigest,
        workflow: {
          workflowId: 'workflow-1',
          runId: 'run-new',
          activityId: 'activity-1',
          attempt: 2,
          taskQueue: 'retrieval',
        },
        lease: { owner: 'worker-current', fencingToken: 9 },
      },
      provider: 'fixture-provider',
      idempotencyKey: key,
    });
    const update = database.calls.find((call) =>
      call.sql.includes("set status = 'completed'"),
    );
    expect(update?.sql).toContain('lease_owner = $2 and fencing_token = $3');
    expect(update?.parameters).toEqual(['work-1', 'worker-current', 9, now]);
  });

  it('rejects a conflicting provider receipt instead of replacing completion', async () => {
    const database = new RecordingDatabase();
    database.handler = (sql) =>
      sql.startsWith('select * from mammoth_activity_effects')
        ? result(effectRow())
        : empty(0);
    const stored = effectRow();
    const candidate: CompletedEffectV1 = {
      schemaVersion: 1,
      id: 'effect-new',
      provider: stored.provider as string,
      idempotencyKey: key,
      state: 'completed',
      programId: stored.program_id as string,
      workItemId: stored.work_id as string,
      operationKind: 'retrieval.fetch',
      contractVersion: stored.contract_version as string,
      inputDigest,
      originalAttribution:
        stored.original_attribution as CompletedEffectV1['originalAttribution'],
      providerReceipt: { providerId: 'conflicting-external-effect' },
      resultSchema: stored.result_schema as string,
      resultDigest: stored.result_digest as CompletedEffectV1['resultDigest'],
      result: stored.result,
      startedAt: now,
      completedAt: now,
    };
    await expect(
      new PostgresActivityEffectStore(database, options).complete(candidate),
    ).rejects.toMatchObject({
      code: 'effect_identity_conflict',
      retryable: false,
    });
  });
});

function workRow(): Row {
  return {
    work_id: 'work-1',
    program_id: 'program-1',
    activity_type: 'retrieval',
    contract_version: '2.0.0',
    input_digest: inputDigest,
    status: 'leased',
  };
}
function attemptInvocation() {
  return {
    schemaVersion: 1 as const,
    activityType: 'retrieval' as const,
    operationKind: 'retrieval.fetch' as const,
    contractVersion: '2.0.0',
    programId: 'program-1',
    workItemId: 'work-1',
    input: {},
    inputDigest,
    workflow: {
      workflowId: 'workflow-1',
      runId: 'run-2',
      activityId: 'activity-1',
      attempt: 4,
      taskQueue: 'retrieval',
      workerId: 'worker-b',
    },
    lease: { owner: 'lease-b', fencingToken: 9 },
  };
}
function effectRow(): Row {
  return {
    id: 'effect-1',
    provider: 'fixture-provider',
    idempotency_key: key,
    program_id: 'program-1',
    work_id: 'work-1',
    operation_kind: 'retrieval.fetch',
    contract_version: '2.0.0',
    input_digest: inputDigest,
    state: 'completed',
    original_attribution: {
      workflowId: 'workflow-1',
      runId: 'old-run',
      activityId: 'activity-1',
      attempt: 1,
      taskQueue: 'retrieval',
      leaseOwner: 'worker-a',
      fencingToken: 3,
    },
    provider_receipt: { providerId: 'external-1' },
    result_schema: 'retrieval-result@1',
    result_digest: canonicalDigest({ artifactId: 'artifact-1' }),
    result: { artifactId: 'artifact-1' },
    started_at: now,
    completed_at: now,
  };
}
function result(row: Row): QueryResult<Row> {
  return { rows: [row], rowCount: 1 };
}
function empty(rowCount = 0): QueryResult<Row> {
  return { rows: [], rowCount };
}
