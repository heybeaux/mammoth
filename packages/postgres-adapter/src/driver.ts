export interface QueryResult<
  Row extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly rows: readonly Row[];
  readonly rowCount: number;
}

export interface TransactionOptions {
  readonly statementTimeoutMs: number;
  readonly transactionTimeoutMs: number;
}

export interface PostgresConnection {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<QueryResult<Row>>;

  transaction<T>(
    options: TransactionOptions,
    operation: (transaction: PostgresConnection) => Promise<T>,
  ): Promise<T>;
}

export interface PostgresConnectionOptions {
  readonly applicationName: string;
  readonly connectionTimeoutMs: number;
  readonly statementTimeoutMs: number;
}

export interface PostgresDriver {
  connect(options: PostgresConnectionOptions): Promise<PostgresConnection>;
  close(options: { readonly timeoutMs: number }): Promise<void>;
}
