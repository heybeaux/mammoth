import { z } from 'zod';
import {
  AuditJournal,
  copy,
  type Clock,
  type GovernanceAuditEvent,
  GovernanceError,
  systemClock,
} from './common.js';

export const BudgetAmountSchema = z
  .object({
    costUsd: z.number().finite().nonnegative(),
    tokens: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative(),
  })
  .strict();
export type BudgetAmount = z.infer<typeof BudgetAmountSchema>;

export interface BudgetAccount {
  id: string;
  programId: string;
  limit: BudgetAmount;
  spent: BudgetAmount;
  reserved: BudgetAmount;
  version: number;
}

export interface BudgetReservation {
  id: string;
  accountId: string;
  workItemId: string;
  idempotencyKey: string;
  amount: BudgetAmount;
  state: 'reserved' | 'committed' | 'released';
  actual?: BudgetAmount;
  createdAt: string;
  closedAt?: string;
}
export interface BudgetLedgerSnapshot {
  version: 1;
  accounts: BudgetAccount[];
  reservations: BudgetReservation[];
  audit: readonly GovernanceAuditEvent[];
}

const zero = (): BudgetAmount => ({ costUsd: 0, tokens: 0, durationMs: 0 });
const add = (a: BudgetAmount, b: BudgetAmount): BudgetAmount => ({
  costUsd: a.costUsd + b.costUsd,
  tokens: a.tokens + b.tokens,
  durationMs: a.durationMs + b.durationMs,
});
const subtract = (a: BudgetAmount, b: BudgetAmount): BudgetAmount => ({
  costUsd: a.costUsd - b.costUsd,
  tokens: a.tokens - b.tokens,
  durationMs: a.durationMs - b.durationMs,
});
const within = (value: BudgetAmount, ceiling: BudgetAmount): boolean =>
  value.costUsd <= ceiling.costUsd &&
  value.tokens <= ceiling.tokens &&
  value.durationMs <= ceiling.durationMs;

/** Atomic in one process. Production adapters must serialize these methods transactionally. */
export class BudgetLedger {
  readonly #accounts = new Map<string, BudgetAccount>();
  readonly #reservations = new Map<string, BudgetReservation>();
  readonly #idempotency = new Map<string, string>();
  audit = new AuditJournal();

  constructor(private readonly clock: Clock = systemClock) {}

  createAccount(
    input: Pick<BudgetAccount, 'id' | 'programId' | 'limit'>,
    actorId: string,
  ): BudgetAccount {
    const limit = BudgetAmountSchema.parse(input.limit);
    if (this.#accounts.has(input.id))
      throw new GovernanceError(
        'account_exists',
        'budget account already exists',
      );
    const account: BudgetAccount = {
      ...input,
      limit,
      spent: zero(),
      reserved: zero(),
      version: 0,
    };
    this.#accounts.set(account.id, account);
    this.audit.append({
      occurredAt: this.clock(),
      kind: 'budget.account_created',
      entityId: account.id,
      outcome: 'allowed',
      actorId,
      details: { programId: account.programId, limit },
    });
    return copy(account);
  }

  getAccount(id: string): BudgetAccount | undefined {
    const account = this.#accounts.get(id);
    return account ? copy(account) : undefined;
  }

  getReservation(id: string): BudgetReservation | undefined {
    const reservation = this.#reservations.get(id);
    return reservation ? copy(reservation) : undefined;
  }

  snapshot(): BudgetLedgerSnapshot {
    return {
      version: 1,
      accounts: copy([...this.#accounts.values()]),
      reservations: copy([...this.#reservations.values()]),
      audit: this.audit.snapshot(),
    };
  }

  static restore(input: unknown, clock: Clock = systemClock): BudgetLedger {
    const account = z
      .object({
        id: z.string().min(1),
        programId: z.string().min(1),
        limit: BudgetAmountSchema,
        spent: BudgetAmountSchema,
        reserved: BudgetAmountSchema,
        version: z.number().int().nonnegative(),
      })
      .strict();
    const reservation = z
      .object({
        id: z.string().min(1),
        accountId: z.string().min(1),
        workItemId: z.string().min(1),
        idempotencyKey: z.string().min(1),
        amount: BudgetAmountSchema,
        state: z.enum(['reserved', 'committed', 'released']),
        actual: BudgetAmountSchema.optional(),
        createdAt: z.string().datetime(),
        closedAt: z.string().datetime().optional(),
      })
      .strict();
    const snapshot = z
      .object({
        version: z.literal(1),
        accounts: z.array(account),
        reservations: z.array(reservation),
        audit: z.array(z.unknown()),
      })
      .strict()
      .parse(input);
    const ledger = new BudgetLedger(clock);
    for (const value of snapshot.accounts) {
      if (
        ledger.#accounts.has(value.id) ||
        !within(add(value.spent, value.reserved), value.limit)
      )
        throw new GovernanceError(
          'invalid_budget_snapshot',
          'duplicate or overdrawn budget account',
        );
      ledger.#accounts.set(value.id, copy(value));
    }
    for (const value of snapshot.reservations) {
      if (
        ledger.#reservations.has(value.id) ||
        ledger.#idempotency.has(value.idempotencyKey) ||
        !ledger.#accounts.has(value.accountId)
      )
        throw new GovernanceError(
          'invalid_budget_snapshot',
          'orphaned or duplicate reservation',
        );
      if (value.state === 'committed' && !value.actual)
        throw new GovernanceError(
          'invalid_budget_snapshot',
          'committed reservation requires actual usage',
        );
      if (value.state !== 'reserved' && !value.closedAt)
        throw new GovernanceError(
          'invalid_budget_snapshot',
          'closed reservation requires a close timestamp',
        );
      ledger.#reservations.set(value.id, copy(value) as BudgetReservation);
      ledger.#idempotency.set(value.idempotencyKey, value.id);
    }
    for (const value of ledger.#accounts.values()) {
      const reserved = [...ledger.#reservations.values()]
        .filter((r) => r.accountId === value.id && r.state === 'reserved')
        .reduce((sum, r) => add(sum, r.amount), zero());
      const spent = [...ledger.#reservations.values()]
        .filter((r) => r.accountId === value.id && r.state === 'committed')
        .reduce((sum, r) => {
          if (!r.actual) {
            throw new GovernanceError(
              'invalid_budget_snapshot',
              'committed reservation requires actual usage',
            );
          }
          return add(sum, r.actual);
        }, zero());
      if (JSON.stringify(reserved) !== JSON.stringify(value.reserved))
        throw new GovernanceError(
          'invalid_budget_snapshot',
          'reserved aggregate does not match open reservations',
        );
      if (JSON.stringify(spent) !== JSON.stringify(value.spent))
        throw new GovernanceError(
          'invalid_budget_snapshot',
          'spent aggregate does not match committed reservations',
        );
    }
    ledger.audit = AuditJournal.restore(snapshot.audit);
    return ledger;
  }

  reserve(
    input: Omit<BudgetReservation, 'state' | 'createdAt'>,
    actorId: string,
  ): BudgetReservation {
    let parsed: BudgetAmount;
    try {
      parsed = BudgetAmountSchema.parse(input.amount);
    } catch {
      this.#deny(input.id, actorId, 'invalid_amount');
      throw new GovernanceError(
        'invalid_amount',
        'reservation amount is invalid',
      );
    }
    const existingId = this.#idempotency.get(input.idempotencyKey);
    if (existingId) {
      const existing = this.#reservations.get(existingId);
      if (!existing) {
        throw new GovernanceError(
          'idempotency_index_corrupt',
          'idempotency key references a missing reservation',
        );
      }
      const same =
        existing.accountId === input.accountId &&
        existing.workItemId === input.workItemId &&
        JSON.stringify(existing.amount) === JSON.stringify(parsed);
      if (!same) {
        this.#deny(input.id, actorId, 'idempotency_conflict');
        throw new GovernanceError(
          'idempotency_conflict',
          'idempotency key was reused for different work',
        );
      }
      return copy(existing);
    }
    if (this.#reservations.has(input.id)) {
      this.#deny(input.id, actorId, 'reservation_exists');
      throw new GovernanceError(
        'reservation_exists',
        'reservation id already exists',
      );
    }
    const account = this.#accounts.get(input.accountId);
    if (!account) {
      this.#deny(input.id, actorId, 'account_not_found');
      throw new GovernanceError(
        'account_not_found',
        'budget account not found',
      );
    }
    const committed = add(add(account.spent, account.reserved), parsed);
    if (!within(committed, account.limit)) {
      this.#deny(input.id, actorId, 'budget_exhausted');
      throw new GovernanceError(
        'budget_exhausted',
        'reservation exceeds remaining budget',
      );
    }
    const reservation: BudgetReservation = {
      ...input,
      amount: parsed,
      state: 'reserved',
      createdAt: this.clock(),
    };
    account.reserved = add(account.reserved, parsed);
    account.version++;
    this.#reservations.set(input.id, reservation);
    this.#idempotency.set(input.idempotencyKey, input.id);
    this.audit.append({
      occurredAt: reservation.createdAt,
      kind: 'budget.reserved',
      entityId: input.id,
      outcome: 'allowed',
      actorId,
      details: {
        accountId: input.accountId,
        workItemId: input.workItemId,
        amount: parsed,
      },
    });
    return copy(reservation);
  }

  commit(
    id: string,
    actualInput: BudgetAmount,
    actorId: string,
  ): BudgetReservation {
    const reservation = this.#requireOpen(id, actorId, 'budget.commit_denied');
    let actual: BudgetAmount;
    try {
      actual = BudgetAmountSchema.parse(actualInput);
    } catch {
      this.#deny(id, actorId, 'invalid_actual', 'budget.commit_denied');
      throw new GovernanceError('invalid_actual', 'actual usage is invalid');
    }
    if (!within(actual, reservation.amount)) {
      this.#deny(id, actorId, 'reservation_exceeded', 'budget.commit_denied');
      throw new GovernanceError(
        'reservation_exceeded',
        'actual usage exceeds reservation',
      );
    }
    const account = this.#accounts.get(reservation.accountId);
    if (!account) {
      throw new GovernanceError(
        'account_not_found',
        'reservation references a missing budget account',
      );
    }
    account.reserved = subtract(account.reserved, reservation.amount);
    account.spent = add(account.spent, actual);
    account.version++;
    reservation.state = 'committed';
    reservation.actual = actual;
    reservation.closedAt = this.clock();
    this.audit.append({
      occurredAt: reservation.closedAt,
      kind: 'budget.committed',
      entityId: id,
      outcome: 'allowed',
      actorId,
      details: { actual },
    });
    return copy(reservation);
  }

  release(id: string, actorId: string, reason: string): BudgetReservation {
    if (!reason.trim())
      throw new GovernanceError(
        'reason_required',
        'release reason is required',
      );
    const reservation = this.#requireOpen(id, actorId, 'budget.release_denied');
    const account = this.#accounts.get(reservation.accountId);
    if (!account) {
      throw new GovernanceError(
        'account_not_found',
        'reservation references a missing budget account',
      );
    }
    account.reserved = subtract(account.reserved, reservation.amount);
    account.version++;
    reservation.state = 'released';
    reservation.closedAt = this.clock();
    this.audit.append({
      occurredAt: reservation.closedAt,
      kind: 'budget.released',
      entityId: id,
      outcome: 'allowed',
      actorId,
      reason,
      details: { amount: reservation.amount },
    });
    return copy(reservation);
  }

  #requireOpen(
    id: string,
    actorId: string,
    eventKind: string,
  ): BudgetReservation {
    const reservation = this.#reservations.get(id);
    if (!reservation) {
      this.#deny(id, actorId, 'reservation_not_found', eventKind);
      throw new GovernanceError(
        'reservation_not_found',
        'reservation not found',
      );
    }
    if (reservation.state !== 'reserved') {
      this.#deny(id, actorId, 'reservation_closed', eventKind);
      throw new GovernanceError(
        'reservation_closed',
        'reservation is already closed',
      );
    }
    return reservation;
  }

  #deny(
    entityId: string,
    actorId: string,
    reason: string,
    kind = 'budget.reservation_denied',
  ): void {
    this.audit.append({
      occurredAt: this.clock(),
      kind,
      entityId,
      outcome: 'denied',
      actorId,
      reason,
      details: {},
    });
  }
}
