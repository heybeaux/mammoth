import { describe, expect, it } from 'vitest';

import type {
  PostgresConnection,
  PostgresConnectionOptions,
  PostgresDriver,
  QueryResult,
  TransactionOptions,
} from '../src/driver.js';
import { PostgresAdapterError } from '../src/errors.js';
import {
  PostgresLifecycle,
  type PostgresLifecycleConfig,
} from '../src/lifecycle.js';
import { defineMigration, type Migration } from '../src/migrations.js';

interface LedgerEntry {
  version: number;
  name: string;
  checksum: string;
  applied_at: string | null;
}

class FakePostgres implements PostgresDriver, PostgresConnection {
  readonly ledger = new Map<number, LedgerEntry>();
  readonly executedMigrations: string[] = [];
  connectionOptions: PostgresConnectionOptions | undefined;
  transactionOptions: TransactionOptions | undefined;
  closeTimeoutMs: number | undefined;
  failSql: string | undefined;

  async connect(
    options: PostgresConnectionOptions,
  ): Promise<PostgresConnection> {
    await Promise.resolve();
    this.connectionOptions = options;
    return this;
  }

  async close(options: { readonly timeoutMs: number }): Promise<void> {
    await Promise.resolve();
    this.closeTimeoutMs = options.timeoutMs;
  }

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    parameters: readonly unknown[] = [],
  ): Promise<QueryResult<Row>> {
    await Promise.resolve();
    if (sql === this.failSql)
      throw new Error('injected migration interruption');
    if (sql.startsWith('select version, name, checksum')) {
      const rows = [...this.ledger.values()].sort(
        (left, right) => left.version - right.version,
      );
      return { rows: rows as unknown as readonly Row[], rowCount: rows.length };
    }
    if (sql.startsWith('insert into mammoth_schema_migrations')) {
      const version = Number(parameters[0]);
      this.ledger.set(version, {
        version,
        name: String(parameters[1]),
        checksum: String(parameters[2]),
        applied_at: null,
      });
      return emptyResult<Row>();
    }
    if (sql.startsWith('update mammoth_schema_migrations')) {
      const entry = this.ledger.get(Number(parameters[0]));
      if (entry) entry.applied_at = String(parameters[1]);
      return emptyResult<Row>();
    }
    if (
      sql.startsWith('create table if not exists mammoth_schema_migrations')
    ) {
      return emptyResult<Row>();
    }
    if (
      sql.startsWith('select pg_advisory_') ||
      sql === 'select 1 as healthy'
    ) {
      return emptyResult<Row>();
    }
    this.executedMigrations.push(sql);
    return emptyResult<Row>();
  }

  async transaction<T>(
    options: TransactionOptions,
    operation: (transaction: PostgresConnection) => Promise<T>,
  ): Promise<T> {
    this.transactionOptions = options;
    const snapshot = new Map(
      [...this.ledger].map(([key, value]) => [key, { ...value }]),
    );
    try {
      return await operation(this);
    } catch (error) {
      this.ledger.clear();
      for (const [key, value] of snapshot) this.ledger.set(key, value);
      throw error;
    }
  }
}

const config: PostgresLifecycleConfig = {
  applicationName: 'mammoth-test',
  connectionTimeoutMs: 1_000,
  statementTimeoutMs: 2_000,
  transactionTimeoutMs: 3_000,
  shutdownTimeoutMs: 4_000,
};

const migrations: readonly Migration[] = [
  defineMigration({
    version: 1,
    name: 'first',
    sql: 'create table first_table (id integer)',
  }),
  defineMigration({
    version: 2,
    name: 'second',
    sql: 'create table second_table (id integer)',
  }),
];
const firstMigration = migrations[0];
const secondMigration = migrations[1];
if (!firstMigration || !secondMigration) {
  throw new Error('migration fixtures are incomplete');
}

describe('Postgres lifecycle and migrations', () => {
  it('installs an empty database in order with explicit timeout behavior', async () => {
    const database = new FakePostgres();
    const lifecycle = new PostgresLifecycle(
      database,
      [...migrations].reverse(),
      config,
    );

    const applied = await lifecycle.start();

    expect(applied.map((entry) => entry.version)).toEqual([1, 2]);
    expect(database.executedMigrations).toEqual(
      migrations.map((migration) => migration.sql),
    );
    expect(database.connectionOptions).toEqual({
      applicationName: 'mammoth-test',
      connectionTimeoutMs: 1_000,
      statementTimeoutMs: 2_000,
    });
    expect(database.transactionOptions).toEqual({
      statementTimeoutMs: 2_000,
      transactionTimeoutMs: 3_000,
    });
    expect(await lifecycle.readiness()).toEqual({
      ready: true,
      status: 'ready',
      schemaVersion: 2,
    });
  });

  it('upgrades a prior schema and does not rerun an applied migration after restart', async () => {
    const database = new FakePostgres();
    const firstRelease = new PostgresLifecycle(
      database,
      [firstMigration],
      config,
    );
    await firstRelease.start();
    await firstRelease.shutdown();

    const restarted = new PostgresLifecycle(database, migrations, config);
    await restarted.start();

    expect(database.executedMigrations).toEqual(
      migrations.map((migration) => migration.sql),
    );
    expect(database.closeTimeoutMs).toBe(4_000);
    expect((await restarted.descriptor('0.2.0')).health).toBe('healthy');
  });

  it('preserves and detects an interrupted migration instead of silently retrying', async () => {
    const database = new FakePostgres();
    database.failSql = secondMigration.sql;
    const lifecycle = new PostgresLifecycle(database, migrations, config);

    await expect(lifecycle.start()).rejects.toMatchObject({
      code: 'migration_failed',
    });
    database.failSql = undefined;

    await expect(lifecycle.start()).rejects.toMatchObject({
      code: 'interrupted_migration',
    });
    expect(await lifecycle.readiness()).toMatchObject({
      ready: false,
      status: 'schema_unsafe',
    });
    expect(database.executedMigrations).toEqual([firstMigration.sql]);
  });

  it('fails closed when released migration contents drift', async () => {
    const database = new FakePostgres();
    const lifecycle = new PostgresLifecycle(database, migrations, config);
    await lifecycle.start();
    await lifecycle.shutdown();

    const drifted = [
      defineMigration({
        version: 1,
        name: 'first',
        sql: 'create table first_table (id bigint)',
      }),
      secondMigration,
    ];
    const restarted = new PostgresLifecycle(database, drifted, config);

    await expect(restarted.start()).rejects.toMatchObject({
      code: 'checksum_drift',
      retryable: false,
    });
  });

  it('does not advertise healthy when the schema ledger is unsafe', async () => {
    const database = new FakePostgres();
    database.failSql = secondMigration.sql;
    const lifecycle = new PostgresLifecycle(database, migrations, config);
    await expect(lifecycle.start()).rejects.toMatchObject({
      code: 'migration_failed',
    });

    expect(await lifecycle.descriptor('0.2.0')).toMatchObject({
      profile: 'production-like-local',
      health: 'unavailable',
    });
  });

  it('rejects non-contiguous or pre-checksummed-invalid migration sets', async () => {
    const lifecycle = new PostgresLifecycle(
      new FakePostgres(),
      [
        {
          version: 2,
          name: 'second',
          sql: 'select 2',
          checksum: '0'.repeat(64),
        },
      ],
      config,
    );
    await expect(lifecycle.start()).rejects.toBeInstanceOf(
      PostgresAdapterError,
    );
  });
});

function emptyResult<Row extends Record<string, unknown>>(): QueryResult<Row> {
  return { rows: [], rowCount: 0 };
}
