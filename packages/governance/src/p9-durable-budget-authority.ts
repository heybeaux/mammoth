import {
  canonicalDigest,
  EffectRequestCeilingSchema,
  P9BudgetVectorSchema,
  P9LiveAuthorityReceiptSchema,
  ProviderPriceCatalogSchema,
  type P9BudgetVector,
  type P9LiveAuthorityReceipt,
  type ProviderPriceCatalog,
} from '@mammoth/domain';
import {
  closeSync,
  constants as fsConstants,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { GovernanceError, systemClock, type Clock } from './common.js';
import {
  P9BudgetAuthority,
  type P9BudgetReservation,
  type P9SettlementInput,
} from './p9-budget-authority.js';

const DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);

const GenesisEntrySchema = z
  .object({
    kind: z.literal('genesis'),
    accountId: z.string().min(1),
    programId: z.string().min(1),
    catalogDigest: DigestSchema,
    authorityReceiptDigest: DigestSchema,
    consumptionNonce: z.string().min(16),
    consumptionStoreDigest: DigestSchema,
    limit: P9BudgetVectorSchema,
  })
  .strict();

const ReserveEntrySchema = z
  .object({
    kind: z.literal('reserve'),
    reservationId: z.string().min(1),
    workItemId: z.string().min(1),
    effectId: z.string().min(1),
    idempotencyKey: z.string().min(1),
    catalogEntryId: z.string().min(1),
    ceiling: EffectRequestCeilingSchema,
    actorId: z.string().min(1),
  })
  .strict();

const TransportStartedEntrySchema = z
  .object({
    kind: z.literal('transport_started'),
    reservationId: z.string().min(1),
    actorId: z.string().min(1),
  })
  .strict();

const SettleEntrySchema = z
  .object({
    kind: z.literal('settle'),
    reservationId: z.string().min(1),
    input: z.union([
      z
        .object({
          costState: z.literal('known'),
          actual: P9BudgetVectorSchema,
          actorId: z.string().min(1),
        })
        .strict(),
      z
        .object({
          costState: z.enum(['unknown', 'settlement_lost']),
          actorId: z.string().min(1),
        })
        .strict(),
    ]),
  })
  .strict();

const CancelEntrySchema = z
  .object({
    kind: z.literal('cancel'),
    reservationId: z.string().min(1),
    actorId: z.string().min(1),
    reason: z.string().min(1),
  })
  .strict();

const JournalEntrySchema = z.discriminatedUnion('kind', [
  GenesisEntrySchema,
  ReserveEntrySchema,
  TransportStartedEntrySchema,
  SettleEntrySchema,
  CancelEntrySchema,
]);
export type P9DurableJournalEntry = z.infer<typeof JournalEntrySchema>;

export const P9DurableJournalRecordSchema = z
  .object({
    sequence: z.number().int().nonnegative(),
    prevDigest: DigestSchema.nullable(),
    at: z.string().datetime(),
    entry: JournalEntrySchema,
    recordDigest: DigestSchema,
  })
  .strict();
export type P9DurableJournalRecord = z.infer<
  typeof P9DurableJournalRecordSchema
>;

/**
 * Append-only durable line store. `appendDurable` must not return until the
 * appended line is flushed to stable storage; the executor relies on this to
 * guarantee that no transport starts without a durable reservation record.
 */
export interface P9DurableJournalStore {
  identityId(): string;
  identityDigest(): string;
  acquireExclusive(): void;
  releaseExclusive(): void;
  appendDurable(line: string): void;
  readLines(): readonly string[];
}

export class FileP9DurableJournalStore implements P9DurableJournalStore {
  readonly #path: string;
  readonly #lockPath: string;
  #locked = false;

  constructor(path: string) {
    if (!path.trim()) {
      throw new GovernanceError(
        'journal_path_required',
        'durable P9 budget journal path is required',
      );
    }
    this.#path = resolve(path);
    this.#lockPath = `${this.#path}.lock`;
    mkdirSync(dirname(this.#path), { recursive: true });
  }

  identityId(): string {
    return this.#path;
  }

  identityDigest(): string {
    return canonicalDigest({
      kind: 'p9-consumption-store/v1',
      id: this.identityId(),
    });
  }

  acquireExclusive(): void {
    if (this.#locked) {
      throw new GovernanceError(
        'journal_already_locked',
        'this durable P9 budget journal store already holds its run lock',
      );
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const fd = openSync(
          this.#lockPath,
          fsConstants.O_WRONLY |
            fsConstants.O_CREAT |
            fsConstants.O_EXCL |
            fsConstants.O_NOFOLLOW,
          0o600,
        );
        try {
          writeSync(fd, `${String(process.pid)}\n`, null, 'utf8');
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
        this.#locked = true;
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const owner = Number.parseInt(readFileSync(this.#lockPath, 'utf8'), 10);
        if (
          !Number.isSafeInteger(owner) ||
          owner <= 0 ||
          processIsAlive(owner)
        ) {
          throw new GovernanceError(
            'journal_locked',
            'another process owns the durable P9 budget journal run lock',
          );
        }
        unlinkSync(this.#lockPath);
      }
    }
    throw new GovernanceError(
      'journal_locked',
      'durable P9 budget journal run lock could not be acquired',
    );
  }

  releaseExclusive(): void {
    if (!this.#locked) return;
    unlinkSync(this.#lockPath);
    this.#locked = false;
  }

  appendDurable(line: string): void {
    if (line.includes('\n')) {
      throw new GovernanceError(
        'journal_line_invalid',
        'durable journal lines must not contain newlines',
      );
    }
    const fd = openSync(
      this.#path,
      fsConstants.O_WRONLY |
        fsConstants.O_APPEND |
        fsConstants.O_CREAT |
        fsConstants.O_NOFOLLOW,
      0o600,
    );
    try {
      writeSync(fd, `${line}\n`, null, 'utf8');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }

  readLines(): readonly string[] {
    let raw: string;
    try {
      raw = readFileSync(this.#path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error instanceof Error ? error : new Error(String(error));
    }
    return raw.split('\n').filter((line) => line.length > 0);
  }
}

export class MemoryP9DurableJournalStore implements P9DurableJournalStore {
  readonly #lines: string[] = [];
  #locked = false;
  failNextAppend = false;

  constructor(
    private readonly storeId = 'p9-memory-durable-budget-journal/default',
  ) {}

  identityId(): string {
    return this.storeId;
  }

  identityDigest(): string {
    return canonicalDigest({
      kind: 'p9-consumption-store/v1',
      id: this.identityId(),
    });
  }

  acquireExclusive(): void {
    if (this.#locked) {
      throw new GovernanceError(
        'journal_locked',
        'another run owns the in-memory P9 budget journal lock',
      );
    }
    this.#locked = true;
  }

  releaseExclusive(): void {
    this.#locked = false;
  }

  appendDurable(line: string): void {
    if (this.failNextAppend) {
      this.failNextAppend = false;
      throw new GovernanceError(
        'journal_append_failed',
        'simulated durable append failure',
      );
    }
    this.#lines.push(line);
  }

  readLines(): readonly string[] {
    return [...this.#lines];
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

function recordDigestOf(
  record: Omit<P9DurableJournalRecord, 'recordDigest'>,
): string {
  return canonicalDigest(record);
}

/**
 * Durable P9 budget authority. Every state transition is journaled to an
 * append-only hash-chained store and flushed to stable storage before the
 * mutation is visible to callers, so no external transport can start without
 * a durable reservation record and no restart can double-spend a remainder.
 *
 * The genesis record binds the immutable price catalog digest and the scoped
 * human authorization receipt digest; environment flags never appear in the
 * chain and cannot substitute for it.
 */
export class P9DurableBudgetAuthority {
  #inner: P9BudgetAuthority;
  #lastDigest: string | null;
  #sequence: number;
  #poisoned = false;

  readonly authorizationReceipt: P9LiveAuthorityReceipt;

  private constructor(
    inner: P9BudgetAuthority,
    authorizationReceipt: P9LiveAuthorityReceipt,
    private readonly store: P9DurableJournalStore,
    private readonly clock: Clock,
    lastDigest: string | null,
    sequence: number,
  ) {
    this.#inner = inner;
    this.authorizationReceipt = authorizationReceipt;
    this.#lastDigest = lastDigest;
    this.#sequence = sequence;
  }

  static open(
    input: {
      readonly accountId: string;
      readonly programId: string;
      readonly catalog: ProviderPriceCatalog;
      readonly limit: P9BudgetVector;
      readonly authorizationReceipt: unknown;
      readonly store: P9DurableJournalStore;
      readonly actorId: string;
    },
    clock: Clock = systemClock,
  ): P9DurableBudgetAuthority {
    const receiptResult = P9LiveAuthorityReceiptSchema.safeParse(
      input.authorizationReceipt,
    );
    if (!receiptResult.success) {
      throw new GovernanceError(
        'authorization_receipt_invalid',
        'scoped human authorization receipt is missing, malformed, or digest-broken',
      );
    }
    const receipt = receiptResult.data;
    if (
      receipt.consumptionStoreId !== input.store.identityId() ||
      receipt.consumptionStoreDigest !== input.store.identityDigest()
    ) {
      throw new GovernanceError(
        'authorization_consumption_store_mismatch',
        'authorization receipt binds a different protected consumption store',
      );
    }
    const catalog = ProviderPriceCatalogSchema.parse(input.catalog);
    if (receipt.priceCatalogDigest !== catalog.catalogDigest) {
      throw new GovernanceError(
        'authorization_catalog_mismatch',
        'authorization receipt binds a different immutable price catalog',
      );
    }
    const limit = P9BudgetVectorSchema.parse(input.limit);
    if (canonicalDigest(limit) !== canonicalDigest(receipt.budgetLimit)) {
      throw new GovernanceError(
        'authorization_budget_exceeded',
        'requested budget limit does not match the scoped human authorization',
      );
    }
    const lines = input.store.readLines();
    if (lines.length === 0) {
      const inner = new P9BudgetAuthority(
        {
          accountId: input.accountId,
          programId: input.programId,
          catalog,
          limit,
        },
        clock,
      );
      const authority = new P9DurableBudgetAuthority(
        inner,
        receipt,
        input.store,
        clock,
        null,
        0,
      );
      authority.#append({
        kind: 'genesis',
        accountId: input.accountId,
        programId: input.programId,
        catalogDigest: catalog.catalogDigest,
        authorityReceiptDigest: receipt.receiptDigest,
        consumptionNonce: receipt.consumptionNonce,
        consumptionStoreDigest: input.store.identityDigest(),
        limit,
      });
      return authority;
    }
    return P9DurableBudgetAuthority.#replay(
      lines,
      { catalog, receipt, store: input.store },
      {
        accountId: input.accountId,
        programId: input.programId,
        limit,
      },
      clock,
    );
  }

  static #replay(
    lines: readonly string[],
    context: {
      readonly catalog: ProviderPriceCatalog;
      readonly receipt: P9LiveAuthorityReceipt;
      readonly store: P9DurableJournalStore;
    },
    expected: {
      readonly accountId: string;
      readonly programId: string;
      readonly limit: P9BudgetVector;
    },
    clock: Clock,
  ): P9DurableBudgetAuthority {
    const records: P9DurableJournalRecord[] = [];
    let previousDigest: string | null = null;
    for (const [index, line] of lines.entries()) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        throw new GovernanceError(
          'journal_corrupt',
          `durable P9 budget journal line ${String(index)} is not valid JSON`,
        );
      }
      const record = P9DurableJournalRecordSchema.safeParse(parsed);
      if (!record.success) {
        throw new GovernanceError(
          'journal_corrupt',
          `durable P9 budget journal line ${String(index)} fails schema validation`,
        );
      }
      const { recordDigest, ...identity } = record.data;
      if (
        record.data.sequence !== index ||
        record.data.prevDigest !== previousDigest ||
        recordDigest !== recordDigestOf(identity)
      ) {
        throw new GovernanceError(
          'journal_chain_broken',
          `durable P9 budget journal hash chain breaks at line ${String(index)}`,
        );
      }
      previousDigest = recordDigest;
      records.push(record.data);
    }
    const genesisRecord = records[0];
    if (!genesisRecord || genesisRecord.entry.kind !== 'genesis') {
      throw new GovernanceError(
        'journal_missing_genesis',
        'durable P9 budget journal must begin with a genesis record',
      );
    }
    const genesis = genesisRecord.entry;
    if (
      genesis.accountId !== expected.accountId ||
      genesis.programId !== expected.programId ||
      genesis.catalogDigest !== context.catalog.catalogDigest ||
      genesis.authorityReceiptDigest !== context.receipt.receiptDigest ||
      genesis.consumptionNonce !== context.receipt.consumptionNonce ||
      genesis.consumptionStoreDigest !== context.store.identityDigest() ||
      genesis.consumptionStoreDigest !==
        context.receipt.consumptionStoreDigest ||
      canonicalDigest(genesis.limit) !== canonicalDigest(expected.limit)
    ) {
      throw new GovernanceError(
        'journal_genesis_mismatch',
        'durable P9 budget journal genesis does not bind this catalog, authorization, and limit',
      );
    }
    const inner = new P9BudgetAuthority(
      {
        accountId: genesis.accountId,
        programId: genesis.programId,
        catalog: context.catalog,
        limit: genesis.limit,
      },
      clock,
    );
    for (const record of records.slice(1)) {
      const entry = record.entry;
      switch (entry.kind) {
        case 'genesis':
          throw new GovernanceError(
            'journal_corrupt',
            'durable P9 budget journal contains a second genesis record',
          );
        case 'reserve': {
          inner.reserve({
            reservationId: entry.reservationId,
            workItemId: entry.workItemId,
            effectId: entry.effectId,
            idempotencyKey: entry.idempotencyKey,
            catalogEntryId: entry.catalogEntryId,
            ceiling: entry.ceiling,
            actorId: entry.actorId,
          });
          break;
        }
        case 'transport_started':
          inner.markTransportStarted(entry.reservationId, entry.actorId);
          break;
        case 'settle':
          try {
            inner.settle(entry.reservationId, entry.input);
          } catch (error) {
            if (
              !(error instanceof GovernanceError) ||
              error.code !== 'provider_bound_breached'
            ) {
              throw error instanceof Error ? error : new Error(String(error));
            }
          }
          break;
        case 'cancel':
          inner.cancel(entry.reservationId, entry.actorId, entry.reason);
          break;
      }
    }
    const last = records.at(-1);
    return new P9DurableBudgetAuthority(
      inner,
      context.receipt,
      context.store,
      clock,
      last ? last.recordDigest : null,
      records.length,
    );
  }

  #append(entry: P9DurableJournalEntry): void {
    const identity = {
      sequence: this.#sequence,
      prevDigest: this.#lastDigest,
      at: this.clock(),
      entry,
    };
    const record: P9DurableJournalRecord = {
      ...identity,
      recordDigest: recordDigestOf(identity),
    };
    try {
      this.store.appendDurable(JSON.stringify(record));
    } catch (error) {
      this.#poisoned = true;
      throw new GovernanceError(
        'journal_append_failed',
        `durable P9 budget journal append failed; authority is closed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    this.#sequence += 1;
    this.#lastDigest = record.recordDigest;
  }

  #assertUsable(): void {
    if (this.#poisoned) {
      throw new GovernanceError(
        'journal_append_failed',
        'durable P9 budget authority is closed after a journal append failure',
      );
    }
  }

  reserve(
    input: Parameters<P9BudgetAuthority['reserve']>[0],
  ): P9BudgetReservation {
    this.#assertUsable();
    const before = this.#inner.getReservation(input.reservationId);
    const reservation = this.#inner.reserve(input);
    if (!before) this.#append({ kind: 'reserve', ...input });
    return reservation;
  }

  markTransportStarted(id: string, actorId: string): P9BudgetReservation {
    this.#assertUsable();
    const reservation = this.#inner.markTransportStarted(id, actorId);
    this.#append({ kind: 'transport_started', reservationId: id, actorId });
    return reservation;
  }

  settle(id: string, input: P9SettlementInput): P9BudgetReservation {
    this.#assertUsable();
    const before = this.#inner.getReservation(id);
    const wasOpen = before?.state === 'reserved';
    try {
      const reservation = this.#inner.settle(id, input);
      if (wasOpen) this.#append({ kind: 'settle', reservationId: id, input });
      return reservation;
    } catch (error) {
      if (
        wasOpen &&
        error instanceof GovernanceError &&
        error.code === 'provider_bound_breached'
      ) {
        this.#append({ kind: 'settle', reservationId: id, input });
      }
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  cancel(id: string, actorId: string, reason: string): P9BudgetReservation {
    this.#assertUsable();
    const before = this.#inner.getReservation(id);
    const wasOpen = before?.state === 'reserved';
    const reservation = this.#inner.cancel(id, actorId, reason);
    if (wasOpen)
      this.#append({ kind: 'cancel', reservationId: id, actorId, reason });
    return reservation;
  }

  /**
   * Conservatively closes every reservation left open by an interrupted run.
   * Reservations that had durably started transport are settled as
   * `settlement_lost` (charging the full reserved ceiling); reservations that
   * never crossed the transport boundary are released without charge.
   */
  recoverInterrupted(actorId: string): readonly P9BudgetReservation[] {
    this.#assertUsable();
    const recovered: P9BudgetReservation[] = [];
    for (const reservation of this.#inner.snapshot().reservations) {
      if (reservation.state !== 'reserved') continue;
      recovered.push(
        reservation.transportStarted
          ? this.settle(reservation.id, {
              costState: 'settlement_lost',
              actorId,
            })
          : this.cancel(
              reservation.id,
              actorId,
              'recovered_interrupted_before_transport',
            ),
      );
    }
    return recovered;
  }

  getReservation(id: string): P9BudgetReservation | undefined {
    return this.#inner.getReservation(id);
  }

  remaining(): P9BudgetVector {
    return this.#inner.remaining();
  }

  isCatalogEntryQuarantined(id: string): boolean {
    return this.#inner.isCatalogEntryQuarantined(id);
  }

  snapshot(): ReturnType<P9BudgetAuthority['snapshot']> {
    return this.#inner.snapshot();
  }
}
