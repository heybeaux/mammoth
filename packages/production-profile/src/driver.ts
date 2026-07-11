import { Pool, type PoolClient, type QueryResult as PgQueryResult } from 'pg';
import type {
  PostgresConnection,
  PostgresConnectionOptions,
  PostgresDriver,
  QueryResult,
  TransactionOptions,
} from '@mammoth/postgres-adapter';

export class NodePostgresDriver implements PostgresDriver {
  #pool: Pool | undefined;
  #connection: PostgresConnection | undefined;
  constructor(private readonly connectionString: string) {}

  async connect(
    options: PostgresConnectionOptions,
  ): Promise<PostgresConnection> {
    this.#pool = new Pool({
      connectionString: this.connectionString,
      application_name: options.applicationName,
      connectionTimeoutMillis: options.connectionTimeoutMs,
      statement_timeout: options.statementTimeoutMs,
      max: 8,
    });
    await this.#pool.query('select 1');
    this.#connection = new PoolConnection(this.#pool);
    return this.#connection;
  }

  connection(): PostgresConnection {
    if (!this.#connection) throw new Error('Postgres driver is not connected');
    return this.#connection;
  }

  async close(options: { readonly timeoutMs: number }): Promise<void> {
    if (!this.#pool) return;
    const pool = this.#pool;
    this.#pool = undefined;
    this.#connection = undefined;
    await Promise.race([
      pool.end(),
      new Promise<never>((_, reject) =>
        setTimeout(() => {
          reject(
            new Error(
              `Postgres pool shutdown exceeded ${String(options.timeoutMs)}ms`,
            ),
          );
        }, options.timeoutMs),
      ),
    ]);
  }
}

class PoolConnection implements PostgresConnection {
  constructor(private readonly client: Pool | PoolClient) {}
  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<QueryResult<Row>> {
    const result: PgQueryResult<Row> = await this.client.query<Row>(
      sql,
      parameters as unknown[] | undefined,
    );
    return { rows: result.rows, rowCount: result.rowCount ?? 0 };
  }
  async transaction<T>(
    options: TransactionOptions,
    operation: (transaction: PostgresConnection) => Promise<T>,
  ): Promise<T> {
    if (!(this.client instanceof Pool))
      throw new Error('nested transactions are not supported');
    const client = await this.client.connect();
    try {
      await client.query('begin');
      await client.query(
        `set local statement_timeout = ${String(options.statementTimeoutMs)}`,
      );
      await client.query(
        `set local idle_in_transaction_session_timeout = ${String(options.transactionTimeoutMs)}`,
      );
      const result = await operation(new PoolConnection(client));
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
}
