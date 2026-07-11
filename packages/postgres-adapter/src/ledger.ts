import { randomUUID } from 'node:crypto';
import {
  validateLedgerState as validateAuthoritativeLedgerState,
  type EpistemicLedger,
  type LedgerState,
} from '@mammoth/persistence';

import type { PostgresConnection, TransactionOptions } from './driver.js';

export type LedgerConflictCode = 'stale_revision' | 'referential_integrity';

export class LedgerMutationError extends Error {
  public constructor(
    public readonly code: LedgerConflictCode,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'LedgerMutationError';
  }
}

export interface PostgresEpistemicLedgerOptions {
  readonly transaction: TransactionOptions;
  readonly now?: () => string;
  readonly id?: () => string;
}

interface StateRow extends Record<string, unknown> {
  revision: string | number;
  state: unknown;
}

/** Postgres-backed ledger. One locked row is the serialization point. */
export class PostgresEpistemicLedger implements EpistemicLedger {
  readonly #connection: PostgresConnection;
  readonly #options: PostgresEpistemicLedgerOptions;

  public constructor(
    connection: PostgresConnection,
    options: PostgresEpistemicLedgerOptions,
  ) {
    this.#connection = connection;
    this.#options = options;
  }

  public async read(): Promise<Readonly<LedgerState>> {
    const result = await this.#connection.query<StateRow>(
      'select revision, state from mammoth_epistemic_ledger where singleton = true',
    );
    const row = result.rows[0];
    if (!row) throw new Error('epistemic ledger is not installed');
    return validateLedgerState(row.state, Number(row.revision));
  }

  public transact(
    mutate: (draft: LedgerState) => void,
  ): Promise<Readonly<LedgerState>> {
    return this.#commit(undefined, mutate);
  }

  /** Explicit compare-and-swap entry point for callers holding a read revision. */
  public transactAtRevision(
    expectedRevision: number,
    mutate: (draft: LedgerState) => void,
  ): Promise<Readonly<LedgerState>> {
    return this.#commit(expectedRevision, mutate);
  }

  async #commit(
    expectedRevision: number | undefined,
    mutate: (draft: LedgerState) => void,
  ): Promise<Readonly<LedgerState>> {
    return this.#connection.transaction(
      this.#options.transaction,
      async (tx) => {
        const result = await tx.query<StateRow>(
          'select revision, state from mammoth_epistemic_ledger where singleton = true for update',
        );
        const row = result.rows[0];
        if (!row) throw new Error('epistemic ledger is not installed');
        const currentRevision = Number(row.revision);
        if (
          expectedRevision !== undefined &&
          expectedRevision !== currentRevision
        ) {
          throw new LedgerMutationError(
            'stale_revision',
            `expected ledger revision ${String(expectedRevision)}, found ${String(currentRevision)}`,
            true,
          );
        }

        const draft = structuredClone(
          validateLedgerState(row.state, currentRevision),
        );
        mutate(draft);
        draft.revision = currentRevision + 1;
        const committed = validateLedgerState(draft, draft.revision);
        const timestamp = (
          this.#options.now ?? (() => new Date().toISOString())
        )();
        const mutationId = (this.#options.id ?? randomUUID)();
        const stateJson = JSON.stringify(committed);
        const event = JSON.stringify({
          mutationId,
          revision: committed.revision,
          schemaVersion: committed.schemaVersion,
        });

        const updated = await tx.query(
          'update mammoth_epistemic_ledger set revision = $1, state = $2::jsonb, updated_at = $3 where singleton = true and revision = $4',
          [committed.revision, stateJson, timestamp, currentRevision],
        );
        if (updated.rowCount !== 1) {
          throw new LedgerMutationError(
            'stale_revision',
            `ledger revision ${String(currentRevision)} changed during commit`,
            true,
          );
        }
        await tx.query(
          'insert into mammoth_epistemic_revisions (revision, state, committed_at) values ($1, $2::jsonb, $3)',
          [committed.revision, stateJson, timestamp],
        );
        await tx.query(
          'insert into mammoth_audit_log (id, ledger_revision, event_type, payload, recorded_at) values ($1, $2, $3, $4::jsonb, $5)',
          [
            `audit:${mutationId}`,
            committed.revision,
            'ledger.mutated',
            event,
            timestamp,
          ],
        );
        await tx.query(
          'insert into mammoth_outbox (id, ledger_revision, topic, payload, created_at) values ($1, $2, $3, $4::jsonb, $5)',
          [
            `outbox:${mutationId}`,
            committed.revision,
            'epistemic-ledger.mutated',
            event,
            timestamp,
          ],
        );
        return committed;
      },
    );
  }
}

export function validateLedgerState(
  input: unknown,
  revision?: number,
): LedgerState {
  try {
    const state = validateAuthoritativeLedgerState(input);
    if (revision !== undefined && state.revision !== revision) {
      throw new Error('ledger row revision does not match its state');
    }
    return state;
  } catch (cause: unknown) {
    if (cause instanceof LedgerMutationError) throw cause;
    throw new LedgerMutationError(
      'referential_integrity',
      cause instanceof Error ? cause.message : 'invalid ledger state',
      false,
    );
  }
}
