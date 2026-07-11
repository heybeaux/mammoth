export type PostgresAdapterErrorCode =
  | 'connection_failed'
  | 'checksum_drift'
  | 'interrupted_migration'
  | 'invalid_migration_set'
  | 'migration_failed'
  | 'not_started'
  | 'shutdown_failed';

export class PostgresAdapterError extends Error {
  readonly retryable: boolean;

  constructor(
    readonly code: PostgresAdapterErrorCode,
    message: string,
    options: { readonly retryable: boolean; readonly cause?: unknown },
  ) {
    super(message, { cause: options.cause });
    this.name = 'PostgresAdapterError';
    this.retryable = options.retryable;
  }
}
