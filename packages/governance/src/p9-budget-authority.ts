import {
  canonicalDigest,
  EffectCostBoundSchema,
  EffectRequestCeilingSchema,
  P9BudgetVectorSchema,
  ProviderPriceCatalogSchema,
  type EffectRequestCeiling,
  type P9BudgetVector,
  type ProviderPriceCatalog,
  type ProviderPriceCatalogEntry,
} from '@mammoth/domain';
import { z } from 'zod';
import {
  AuditJournal,
  copy,
  type Clock,
  type GovernanceAuditEvent,
  GovernanceError,
  systemClock,
} from './common.js';

const ReservationStateSchema = z.enum([
  'reserved',
  'settled',
  'released',
  'ambiguous',
  'breached',
]);
export type P9ReservationState = z.infer<typeof ReservationStateSchema>;

const SettlementCostStateSchema = z.enum([
  'known',
  'unknown',
  'settlement_lost',
  'not_incurred',
]);
export type P9SettlementCostState = z.infer<typeof SettlementCostStateSchema>;

const P9BudgetReservationSchema = z
  .object({
    id: z.string().min(1),
    accountId: z.string().min(1),
    workItemId: z.string().min(1),
    bound: EffectCostBoundSchema,
    state: ReservationStateSchema,
    transportStarted: z.boolean(),
    charged: P9BudgetVectorSchema,
    settlementCostState: SettlementCostStateSchema.nullable(),
    terminalFingerprint: z.string().min(1).nullable(),
    createdAt: z.string().datetime(),
    closedAt: z.string().datetime().nullable(),
  })
  .strict();
export type P9BudgetReservation = z.infer<typeof P9BudgetReservationSchema>;

export interface P9BudgetAuthoritySnapshot {
  readonly version: 1;
  readonly accountId: string;
  readonly programId: string;
  readonly catalog: ProviderPriceCatalog;
  readonly limit: P9BudgetVector;
  readonly spent: P9BudgetVector;
  readonly reserved: P9BudgetVector;
  readonly reservations: readonly P9BudgetReservation[];
  readonly quarantinedCatalogEntryIds: readonly string[];
  readonly audit: readonly GovernanceAuditEvent[];
}

export type P9SettlementInput =
  | {
      readonly costState: 'known';
      readonly actual: P9BudgetVector;
      readonly actorId: string;
    }
  | {
      readonly costState: 'unknown' | 'settlement_lost';
      readonly actorId: string;
    };

const ReserveInputSchema = z
  .object({
    reservationId: z.string().min(1),
    workItemId: z.string().min(1),
    effectId: z.string().min(1),
    idempotencyKey: z.string().min(1),
    catalogEntryId: z.string().min(1),
    ceiling: EffectRequestCeilingSchema,
    actorId: z.string().min(1),
  })
  .strict();

const VECTOR_KEYS = [
  'currencyUsd',
  'requests',
  'inputTokens',
  'outputTokens',
  'bytes',
  'durationMs',
] as const;

function zero(): P9BudgetVector {
  return {
    currencyUsd: 0,
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    bytes: 0,
    durationMs: 0,
  };
}

function roundedCurrency(value: number): number {
  if (value === 0) return 0;
  const scale = 1_000_000_000_000;
  const scaled = value * scale;
  return (value > 0 ? Math.ceil(scaled) : Math.floor(scaled)) / scale;
}

function add(a: P9BudgetVector, b: P9BudgetVector): P9BudgetVector {
  return {
    currencyUsd: roundedCurrency(a.currencyUsd + b.currencyUsd),
    requests: a.requests + b.requests,
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    bytes: a.bytes + b.bytes,
    durationMs: a.durationMs + b.durationMs,
  };
}

function subtract(a: P9BudgetVector, b: P9BudgetVector): P9BudgetVector {
  return {
    currencyUsd: roundedCurrency(a.currencyUsd - b.currencyUsd),
    requests: a.requests - b.requests,
    inputTokens: a.inputTokens - b.inputTokens,
    outputTokens: a.outputTokens - b.outputTokens,
    bytes: a.bytes - b.bytes,
    durationMs: a.durationMs - b.durationMs,
  };
}

function within(value: P9BudgetVector, ceiling: P9BudgetVector): boolean {
  return VECTOR_KEYS.every((key) => value[key] <= ceiling[key]);
}

function sameVector(a: P9BudgetVector, b: P9BudgetVector): boolean {
  return VECTOR_KEYS.every((key) => a[key] === b[key]);
}

export function priceCatalogDigest(
  input: Omit<ProviderPriceCatalog, 'catalogDigest'>,
): string {
  return canonicalDigest(input);
}

function calculateBound(
  entry: ProviderPriceCatalogEntry,
  ceiling: EffectRequestCeiling,
): P9BudgetVector {
  if (entry.parserClass !== ceiling.parserClass) {
    throw new GovernanceError(
      'catalog_parser_class_mismatch',
      'effect parser class does not match the immutable catalog entry',
    );
  }
  const attempts = ceiling.attempts;
  const requests = ceiling.requests * attempts;
  const inputTokens = ceiling.inputTokens * attempts;
  const outputTokens = ceiling.outputTokens * attempts;
  const bytes = ceiling.bytes * attempts;
  const durationMs = ceiling.durationMs * attempts;
  return P9BudgetVectorSchema.parse({
    currencyUsd: roundedCurrency(
      entry.flatCostUsd +
        requests * entry.costPerRequestUsd +
        inputTokens * entry.costPerInputTokenUsd +
        outputTokens * entry.costPerOutputTokenUsd +
        bytes * entry.costPerByteUsd,
    ),
    requests,
    inputTokens,
    outputTokens,
    bytes,
    durationMs,
  });
}

/**
 * One-process P9 budget authority. Mutations are synchronous and atomic in the
 * JavaScript agent. Durable/hosted adapters must serialize snapshot mutations in
 * one authoritative transaction before invoking transport.
 */
export class P9BudgetAuthority {
  readonly #entries = new Map<string, ProviderPriceCatalogEntry>();
  readonly #reservations = new Map<string, P9BudgetReservation>();
  readonly #idempotency = new Map<string, string>();
  readonly #quarantined = new Set<string>();
  #spent = zero();
  #reserved = zero();
  audit = new AuditJournal();

  readonly accountId: string;
  readonly programId: string;
  readonly catalog: ProviderPriceCatalog;
  readonly limit: P9BudgetVector;

  constructor(
    input: {
      readonly accountId: string;
      readonly programId: string;
      readonly catalog: ProviderPriceCatalog;
      readonly limit: P9BudgetVector;
    },
    private readonly clock: Clock = systemClock,
  ) {
    if (!input.accountId.trim() || !input.programId.trim()) {
      throw new GovernanceError(
        'invalid_budget_identity',
        'budget account and program identities are required',
      );
    }
    this.accountId = input.accountId;
    this.programId = input.programId;
    const catalogResult = ProviderPriceCatalogSchema.safeParse(input.catalog);
    if (!catalogResult.success) {
      throw new GovernanceError(
        'catalog_digest_mismatch',
        'provider price catalog digest does not match its canonical contents',
      );
    }
    this.catalog = catalogResult.data;
    this.limit = P9BudgetVectorSchema.parse(input.limit);
    for (const entry of this.catalog.entries) {
      if (this.#entries.has(entry.id)) {
        throw new GovernanceError(
          'duplicate_catalog_entry',
          'provider price catalog entry identities must be unique',
        );
      }
      this.#entries.set(entry.id, entry);
    }
  }

  reserve(input: {
    readonly reservationId: string;
    readonly workItemId: string;
    readonly effectId: string;
    readonly idempotencyKey: string;
    readonly catalogEntryId: string;
    readonly ceiling: EffectRequestCeiling;
    readonly actorId: string;
  }): P9BudgetReservation {
    const request = ReserveInputSchema.parse(input);
    const existingId = this.#idempotency.get(request.idempotencyKey);
    if (existingId) {
      const existing = this.#reservations.get(existingId);
      if (!existing) {
        throw new GovernanceError(
          'idempotency_index_corrupt',
          'idempotency index references a missing P9 reservation',
        );
      }
      const same =
        existing.id === request.reservationId &&
        existing.workItemId === request.workItemId &&
        existing.bound.effectId === request.effectId &&
        existing.bound.catalogEntryId === request.catalogEntryId &&
        canonicalDigest(existing.bound.ceiling) ===
          canonicalDigest(request.ceiling);
      if (!same) {
        this.#deny(
          request.reservationId,
          request.actorId,
          'idempotency_conflict',
        );
        throw new GovernanceError(
          'idempotency_conflict',
          'idempotency key was reused for different P9 effect work',
        );
      }
      return copy(existing);
    }
    if (this.#reservations.has(request.reservationId)) {
      this.#deny(request.reservationId, request.actorId, 'reservation_exists');
      throw new GovernanceError(
        'reservation_exists',
        'P9 reservation identity already exists',
      );
    }
    const entry = this.#entries.get(request.catalogEntryId);
    if (!entry) {
      this.#deny(
        request.reservationId,
        request.actorId,
        'catalog_entry_unavailable',
      );
      throw new GovernanceError(
        'catalog_entry_unavailable',
        'effect has no conservative immutable provider price entry',
      );
    }
    if (this.#quarantined.has(entry.id)) {
      this.#deny(
        request.reservationId,
        request.actorId,
        'catalog_entry_quarantined',
      );
      throw new GovernanceError(
        'catalog_entry_quarantined',
        'provider price catalog entry is quarantined after a bound breach',
      );
    }
    const reserved = calculateBound(entry, request.ceiling);
    const prospective = add(add(this.#spent, this.#reserved), reserved);
    if (!within(prospective, this.limit)) {
      this.#deny(request.reservationId, request.actorId, 'budget_exhausted');
      throw new GovernanceError(
        'budget_exhausted',
        'effect cost bound exceeds remaining P9 authorization',
      );
    }
    const boundedAt = this.clock();
    const bound = EffectCostBoundSchema.parse({
      schemaVersion: '1.0.0',
      contractFamily: 'p9.v1',
      effectId: request.effectId,
      idempotencyKey: request.idempotencyKey,
      catalogId: this.catalog.catalogId,
      catalogVersion: this.catalog.version,
      catalogDigest: this.catalog.catalogDigest,
      catalogEntryId: entry.id,
      provider: entry.provider,
      effectKind: entry.effectKind,
      ceiling: request.ceiling,
      reserved,
      boundedAt,
    });
    const reservation: P9BudgetReservation = {
      id: request.reservationId,
      accountId: this.accountId,
      workItemId: request.workItemId,
      bound,
      state: 'reserved',
      transportStarted: false,
      charged: zero(),
      settlementCostState: null,
      terminalFingerprint: null,
      createdAt: boundedAt,
      closedAt: null,
    };
    this.#reserved = add(this.#reserved, bound.reserved);
    this.#reservations.set(reservation.id, reservation);
    this.#idempotency.set(request.idempotencyKey, reservation.id);
    this.audit.append({
      occurredAt: boundedAt,
      kind: 'p9.budget.reserved_before_transport',
      entityId: reservation.id,
      outcome: 'allowed',
      actorId: request.actorId,
      details: { bound, remaining: this.remaining() },
    });
    return copy(reservation);
  }

  markTransportStarted(id: string, actorId: string): P9BudgetReservation {
    const reservation = this.#requireReserved(id, actorId);
    reservation.transportStarted = true;
    this.audit.append({
      occurredAt: this.clock(),
      kind: 'p9.budget.transport_started',
      entityId: id,
      outcome: 'allowed',
      actorId,
      details: { effectId: reservation.bound.effectId },
    });
    return copy(reservation);
  }

  settle(id: string, input: P9SettlementInput): P9BudgetReservation {
    const fingerprint = canonicalDigest(input);
    const existing = this.#reservations.get(id);
    if (!existing) {
      this.#deny(id, input.actorId, 'reservation_not_found');
      throw new GovernanceError(
        'reservation_not_found',
        'P9 reservation not found',
      );
    }
    if (existing.state !== 'reserved') {
      if (existing.terminalFingerprint === fingerprint) {
        if (existing.state === 'breached') {
          throw new GovernanceError(
            'provider_bound_breached',
            'provider settlement exceeded its accepted bound; entry quarantined',
          );
        }
        return copy(existing);
      }
      this.#deny(id, input.actorId, 'terminal_settlement_conflict');
      throw new GovernanceError(
        'terminal_settlement_conflict',
        'P9 reservation already has a different terminal result',
      );
    }
    if (!existing.transportStarted) {
      this.#deny(id, input.actorId, 'transport_not_started');
      throw new GovernanceError(
        'transport_not_started',
        'cannot settle an effect that never crossed the transport boundary',
      );
    }
    const charged =
      input.costState === 'known'
        ? P9BudgetVectorSchema.parse(input.actual)
        : existing.bound.reserved;
    const breached = !within(charged, existing.bound.reserved);
    this.#reserved = subtract(this.#reserved, existing.bound.reserved);
    this.#spent = add(this.#spent, charged);
    existing.charged = charged;
    existing.state = breached
      ? 'breached'
      : input.costState === 'known'
        ? 'settled'
        : 'ambiguous';
    existing.settlementCostState = input.costState;
    existing.terminalFingerprint = fingerprint;
    existing.closedAt = this.clock();
    if (breached) this.#quarantined.add(existing.bound.catalogEntryId);
    this.audit.append({
      occurredAt: existing.closedAt,
      kind: breached
        ? 'p9.budget.provider_bound_breached'
        : input.costState === 'known'
          ? 'p9.budget.settled'
          : 'p9.budget.conservative_unknown_settlement',
      entityId: id,
      outcome: breached ? 'denied' : 'allowed',
      actorId: input.actorId,
      ...(breached ? { reason: 'reported_usage_exceeded_accepted_bound' } : {}),
      details: {
        costState: input.costState,
        charged,
        acceptedBound: existing.bound.reserved,
        catalogEntryId: existing.bound.catalogEntryId,
      },
    });
    if (breached) {
      throw new GovernanceError(
        'provider_bound_breached',
        'provider settlement exceeded its accepted bound; entry quarantined',
      );
    }
    return copy(existing);
  }

  cancel(id: string, actorId: string, reason: string): P9BudgetReservation {
    if (!reason.trim()) {
      throw new GovernanceError(
        'reason_required',
        'P9 cancellation requires a reason',
      );
    }
    const existing = this.#reservations.get(id);
    const fingerprint = canonicalDigest({
      action: 'cancel',
      actorId,
      reason,
      transportStarted: existing?.transportStarted ?? null,
    });
    if (!existing) {
      this.#deny(id, actorId, 'reservation_not_found');
      throw new GovernanceError(
        'reservation_not_found',
        'P9 reservation not found',
      );
    }
    if (existing.state !== 'reserved') {
      if (existing.terminalFingerprint === fingerprint) return copy(existing);
      this.#deny(id, actorId, 'terminal_settlement_conflict');
      throw new GovernanceError(
        'terminal_settlement_conflict',
        'P9 reservation already has a different terminal result',
      );
    }
    this.#reserved = subtract(this.#reserved, existing.bound.reserved);
    const charged = existing.transportStarted
      ? existing.bound.reserved
      : zero();
    this.#spent = add(this.#spent, charged);
    existing.charged = charged;
    existing.state = existing.transportStarted ? 'ambiguous' : 'released';
    existing.settlementCostState = existing.transportStarted
      ? 'settlement_lost'
      : 'not_incurred';
    existing.terminalFingerprint = fingerprint;
    existing.closedAt = this.clock();
    this.audit.append({
      occurredAt: existing.closedAt,
      kind: existing.transportStarted
        ? 'p9.budget.cancelled_after_transport'
        : 'p9.budget.released_before_transport',
      entityId: id,
      outcome: 'allowed',
      actorId,
      reason,
      details: { charged, transportStarted: existing.transportStarted },
    });
    return copy(existing);
  }

  getReservation(id: string): P9BudgetReservation | undefined {
    const reservation = this.#reservations.get(id);
    return reservation ? copy(reservation) : undefined;
  }

  remaining(): P9BudgetVector {
    return subtract(subtract(this.limit, this.#spent), this.#reserved);
  }

  isCatalogEntryQuarantined(id: string): boolean {
    return this.#quarantined.has(id);
  }

  snapshot(): P9BudgetAuthoritySnapshot {
    return {
      version: 1,
      accountId: this.accountId,
      programId: this.programId,
      catalog: copy(this.catalog),
      limit: copy(this.limit),
      spent: copy(this.#spent),
      reserved: copy(this.#reserved),
      reservations: copy([...this.#reservations.values()]),
      quarantinedCatalogEntryIds: [...this.#quarantined].sort(),
      audit: this.audit.snapshot(),
    };
  }

  static restore(
    input: unknown,
    clock: Clock = systemClock,
  ): P9BudgetAuthority {
    const parsed = z
      .object({
        version: z.literal(1),
        accountId: z.string().min(1),
        programId: z.string().min(1),
        catalog: ProviderPriceCatalogSchema,
        limit: P9BudgetVectorSchema,
        spent: P9BudgetVectorSchema,
        reserved: P9BudgetVectorSchema,
        reservations: z.array(P9BudgetReservationSchema),
        quarantinedCatalogEntryIds: z.array(z.string().min(1)),
        audit: z.array(z.unknown()),
      })
      .strict()
      .parse(input);
    const authority = new P9BudgetAuthority(
      {
        accountId: parsed.accountId,
        programId: parsed.programId,
        catalog: parsed.catalog,
        limit: parsed.limit,
      },
      clock,
    );
    const restoredAudit = AuditJournal.restore(parsed.audit);
    const validatedReservations: P9BudgetReservation[] = [];
    const seenReservationIds = new Set<string>();
    const seenIdempotencyKeys = new Set<string>();
    const derivedQuarantine = new Set<string>();
    for (const reservation of parsed.reservations) {
      const entry = authority.#entries.get(reservation.bound.catalogEntryId);
      let recalculated: P9BudgetVector | undefined;
      if (entry) {
        try {
          recalculated = calculateBound(entry, reservation.bound.ceiling);
        } catch {
          recalculated = undefined;
        }
      }
      if (
        seenReservationIds.has(reservation.id) ||
        seenIdempotencyKeys.has(reservation.bound.idempotencyKey) ||
        reservation.accountId !== parsed.accountId ||
        !entry ||
        !recalculated ||
        reservation.bound.catalogId !== parsed.catalog.catalogId ||
        reservation.bound.catalogVersion !== parsed.catalog.version ||
        reservation.bound.catalogDigest !== parsed.catalog.catalogDigest ||
        reservation.bound.provider !== entry.provider ||
        reservation.bound.effectKind !== entry.effectKind ||
        !sameVector(reservation.bound.reserved, recalculated)
      ) {
        throw new GovernanceError(
          'invalid_p9_budget_snapshot',
          'P9 budget snapshot has duplicate, foreign, or non-authoritative reservations',
        );
      }
      seenReservationIds.add(reservation.id);
      seenIdempotencyKeys.add(reservation.bound.idempotencyKey);
      if (reservation.state === 'breached') {
        derivedQuarantine.add(reservation.bound.catalogEntryId);
      }
      validatedReservations.push(copy(reservation));
    }
    const serializedQuarantine = [...parsed.quarantinedCatalogEntryIds].sort();
    const expectedQuarantine = [...derivedQuarantine].sort();
    if (
      new Set(serializedQuarantine).size !== serializedQuarantine.length ||
      canonicalDigest(serializedQuarantine) !==
        canonicalDigest(expectedQuarantine)
    ) {
      throw new GovernanceError(
        'invalid_p9_budget_snapshot',
        'P9 budget snapshot quarantine does not match breached reservations',
      );
    }
    const calculatedReserved = validatedReservations
      .filter((reservation) => reservation.state === 'reserved')
      .reduce(
        (sum, reservation) => add(sum, reservation.bound.reserved),
        zero(),
      );
    const calculatedSpent = validatedReservations
      .filter((reservation) => reservation.state !== 'reserved')
      .reduce((sum, reservation) => add(sum, reservation.charged), zero());
    if (
      !sameVector(calculatedReserved, parsed.reserved) ||
      !sameVector(calculatedSpent, parsed.spent) ||
      (!within(add(parsed.spent, parsed.reserved), parsed.limit) &&
        !parsed.reservations.some(
          (reservation) => reservation.state === 'breached',
        ))
    ) {
      throw new GovernanceError(
        'invalid_p9_budget_snapshot',
        'P9 budget snapshot aggregates do not match authoritative reservations',
      );
    }
    authority.#reserved = copy(parsed.reserved);
    authority.#spent = copy(parsed.spent);
    for (const reservation of validatedReservations) {
      authority.#reservations.set(reservation.id, reservation);
      authority.#idempotency.set(
        reservation.bound.idempotencyKey,
        reservation.id,
      );
    }
    for (const entryId of derivedQuarantine) {
      authority.#quarantined.add(entryId);
    }
    authority.audit = restoredAudit;
    return authority;
  }

  #requireReserved(id: string, actorId: string): P9BudgetReservation {
    const reservation = this.#reservations.get(id);
    if (!reservation) {
      this.#deny(id, actorId, 'reservation_not_found');
      throw new GovernanceError(
        'reservation_not_found',
        'P9 reservation not found',
      );
    }
    if (reservation.state !== 'reserved') {
      this.#deny(id, actorId, 'reservation_closed');
      throw new GovernanceError(
        'reservation_closed',
        'P9 reservation is already terminal',
      );
    }
    return reservation;
  }

  #deny(entityId: string, actorId: string, reason: string): void {
    this.audit.append({
      occurredAt: this.clock(),
      kind: 'p9.budget.effect_denied',
      entityId,
      outcome: 'denied',
      actorId,
      reason,
      details: {},
    });
  }
}
