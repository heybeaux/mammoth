import type { PostgresConnection, PostgresDriver } from './driver.js';
import { PostgresAdapterError } from './errors.js';
import { MigrationRunner, type AppliedMigration } from './migration-runner.js';
import type { Migration } from './migrations.js';

export interface PostgresLifecycleConfig {
  readonly applicationName: string;
  readonly connectionTimeoutMs: number;
  readonly statementTimeoutMs: number;
  readonly transactionTimeoutMs: number;
  readonly shutdownTimeoutMs: number;
}

export type ReadinessReport =
  | {
      readonly ready: true;
      readonly status: 'ready';
      readonly schemaVersion: number;
    }
  | {
      readonly ready: false;
      readonly status:
        | 'not_started'
        | 'unavailable'
        | 'migration_required'
        | 'schema_unsafe';
      readonly detail: string;
    };

export interface HealthReport {
  readonly health: 'healthy' | 'unavailable';
  readonly detail?: string;
}

/** Structurally matches the frozen P1 AdapterDescriptor without importing its package. */
export interface PostgresLifecycleDescriptor {
  readonly id: 'postgres-lifecycle';
  readonly kind: 'epistemic-ledger';
  readonly contractVersion: '1.0.0';
  readonly implementationVersion: string;
  readonly profile: 'production-like-local';
  readonly capabilities: readonly ['durable-restart', 'health-reporting'];
  readonly health: 'healthy' | 'unavailable';
  readonly checkedAt: string;
}

export class PostgresLifecycle {
  private connection: PostgresConnection | undefined;

  constructor(
    private readonly driver: PostgresDriver,
    private readonly migrations: readonly Migration[],
    private readonly config: PostgresLifecycleConfig,
  ) {}

  async start(): Promise<readonly AppliedMigration[]> {
    if (this.connection) return this.runner().inspect();
    try {
      this.connection = await this.driver.connect({
        applicationName: this.config.applicationName,
        connectionTimeoutMs: this.config.connectionTimeoutMs,
        statementTimeoutMs: this.config.statementTimeoutMs,
      });
      return await this.runner().migrate();
    } catch (cause) {
      if (cause instanceof PostgresAdapterError) throw cause;
      this.connection = undefined;
      throw new PostgresAdapterError(
        'connection_failed',
        'failed to start Postgres adapter',
        {
          retryable: true,
          cause,
        },
      );
    }
  }

  async health(): Promise<HealthReport> {
    if (!this.connection)
      return { health: 'unavailable', detail: 'adapter is not started' };
    try {
      await this.connection.query('select 1 as healthy');
      return { health: 'healthy' };
    } catch (cause) {
      return { health: 'unavailable', detail: errorDetail(cause) };
    }
  }

  async descriptor(
    implementationVersion: string,
    now = new Date(),
  ): Promise<PostgresLifecycleDescriptor> {
    const [health, readiness] = await Promise.all([
      this.health(),
      this.readiness(),
    ]);
    return {
      id: 'postgres-lifecycle',
      kind: 'epistemic-ledger',
      contractVersion: '1.0.0',
      implementationVersion,
      profile: 'production-like-local',
      capabilities: ['durable-restart', 'health-reporting'],
      health:
        health.health === 'healthy' && readiness.ready
          ? 'healthy'
          : 'unavailable',
      checkedAt: now.toISOString(),
    };
  }

  async readiness(): Promise<ReadinessReport> {
    if (!this.connection) {
      return {
        ready: false,
        status: 'not_started',
        detail: 'adapter is not started',
      };
    }
    try {
      const applied = await this.runner().inspect();
      if (applied.length !== this.migrations.length) {
        return {
          ready: false,
          status: 'migration_required',
          detail: `schema has ${String(applied.length)} of ${String(this.migrations.length)} migrations`,
        };
      }
      return {
        ready: true,
        status: 'ready',
        schemaVersion: applied.at(-1)?.version ?? 0,
      };
    } catch (cause) {
      if (cause instanceof PostgresAdapterError) {
        return {
          ready: false,
          status: 'schema_unsafe',
          detail: `${cause.code}: ${cause.message}`,
        };
      }
      return {
        ready: false,
        status: 'unavailable',
        detail: errorDetail(cause),
      };
    }
  }

  async shutdown(): Promise<void> {
    if (!this.connection) return;
    try {
      await this.driver.close({ timeoutMs: this.config.shutdownTimeoutMs });
      this.connection = undefined;
    } catch (cause) {
      throw new PostgresAdapterError(
        'shutdown_failed',
        'Postgres adapter shutdown failed',
        {
          retryable: true,
          cause,
        },
      );
    }
  }

  private runner(): MigrationRunner {
    if (!this.connection) {
      throw new PostgresAdapterError(
        'not_started',
        'Postgres adapter is not started',
        {
          retryable: true,
        },
      );
    }
    return new MigrationRunner(this.connection, this.migrations, {
      statementTimeoutMs: this.config.statementTimeoutMs,
      transactionTimeoutMs: this.config.transactionTimeoutMs,
    });
  }
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown Postgres failure';
}
