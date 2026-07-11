import type { PostgresConnection, TransactionOptions } from './driver.js';
import { PostgresAdapterError } from './errors.js';
import type { Migration } from './migrations.js';
import { migrationChecksum } from './migrations.js';

const LEDGER = 'mammoth_schema_migrations';
const MIGRATION_LOCK = 4_607_839_863_424_771;

export interface AppliedMigration {
  readonly version: number;
  readonly name: string;
  readonly checksum: string;
  readonly appliedAt: string | null;
}

interface LedgerRow extends Record<string, unknown> {
  version: number;
  name: string;
  checksum: string;
  applied_at: string | null;
}

export interface MigrationRunnerOptions extends TransactionOptions {
  readonly now?: () => Date;
}

export class MigrationRunner {
  private readonly migrations: readonly Migration[];
  private readonly now: () => Date;

  constructor(
    private readonly connection: PostgresConnection,
    migrations: readonly Migration[],
    private readonly options: MigrationRunnerOptions,
  ) {
    this.migrations = validateMigrations(migrations);
    this.now = options.now ?? (() => new Date());
  }

  async migrate(): Promise<readonly AppliedMigration[]> {
    await this.ensureLedger();
    await this.connection.query('select pg_advisory_lock($1)', [
      MIGRATION_LOCK,
    ]);
    try {
      const applied = await this.readLedger();
      this.assertLedgerIsSafe(applied);

      for (const migration of this.migrations) {
        if (applied.some((entry) => entry.version === migration.version))
          continue;
        await this.markStarted(migration);
        try {
          await this.connection.transaction(
            this.options,
            async (transaction) => {
              await transaction.query(migration.sql);
              await transaction.query(
                `update ${LEDGER} set applied_at = $2 where version = $1 and applied_at is null`,
                [migration.version, this.now().toISOString()],
              );
            },
          );
        } catch (cause) {
          throw new PostgresAdapterError(
            'migration_failed',
            `migration ${String(migration.version)} (${migration.name}) failed`,
            { retryable: false, cause },
          );
        }
      }
      return await this.readLedger();
    } finally {
      await this.connection.query('select pg_advisory_unlock($1)', [
        MIGRATION_LOCK,
      ]);
    }
  }

  async inspect(): Promise<readonly AppliedMigration[]> {
    await this.ensureLedger();
    const applied = await this.readLedger();
    this.assertLedgerIsSafe(applied);
    return applied;
  }

  private async ensureLedger(): Promise<void> {
    await this.connection.query(
      `
create table if not exists ${LEDGER} (
  version integer primary key check (version > 0),
  name text not null,
  checksum text not null check (checksum ~ '^[0-9a-f]{64}$'),
  started_at timestamptz not null,
  applied_at timestamptz,
  check (applied_at is null or applied_at >= started_at)
)`.trim(),
    );
  }

  private async readLedger(): Promise<readonly AppliedMigration[]> {
    const result = await this.connection.query<LedgerRow>(
      `select version, name, checksum, applied_at from ${LEDGER} order by version`,
    );
    return result.rows.map((row) => ({
      version: Number(row.version),
      name: String(row.name),
      checksum: String(row.checksum),
      appliedAt: row.applied_at === null ? null : String(row.applied_at),
    }));
  }

  private assertLedgerIsSafe(applied: readonly AppliedMigration[]): void {
    for (const [index, entry] of applied.entries()) {
      if (entry.version !== index + 1) {
        throw new PostgresAdapterError(
          'checksum_drift',
          `migration ledger is not a contiguous prefix at version ${String(entry.version)}`,
          { retryable: false },
        );
      }
      if (entry.appliedAt === null) {
        throw new PostgresAdapterError(
          'interrupted_migration',
          `migration ${String(entry.version)} (${entry.name}) was started but not completed`,
          { retryable: false },
        );
      }
      const expected = this.migrations.find(
        (migration) => migration.version === entry.version,
      );
      if (
        !expected ||
        expected.name !== entry.name ||
        expected.checksum !== entry.checksum
      ) {
        throw new PostgresAdapterError(
          'checksum_drift',
          `migration ${String(entry.version)} does not match the immutable migration set`,
          { retryable: false },
        );
      }
    }
  }

  private async markStarted(migration: Migration): Promise<void> {
    await this.connection.query(
      `insert into ${LEDGER} (version, name, checksum, started_at) values ($1, $2, $3, $4)`,
      [
        migration.version,
        migration.name,
        migration.checksum,
        this.now().toISOString(),
      ],
    );
  }
}

function validateMigrations(
  migrations: readonly Migration[],
): readonly Migration[] {
  const sorted = [...migrations].sort(
    (left, right) => left.version - right.version,
  );
  for (let index = 0; index < sorted.length; index += 1) {
    const migration = sorted[index];
    if (!migration) continue;
    const expectedVersion = index + 1;
    const checksum = migrationChecksum(migration);
    if (
      migration.version !== expectedVersion ||
      !/^[a-z][a-z0-9_]*$/.test(migration.name) ||
      migration.sql.trim().length === 0 ||
      migration.checksum !== checksum
    ) {
      throw new PostgresAdapterError(
        'invalid_migration_set',
        `migration set is invalid at version ${String(migration.version)}`,
        { retryable: false },
      );
    }
  }
  return Object.freeze(sorted);
}
