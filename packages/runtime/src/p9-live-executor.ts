import {
  canonicalDigest,
  P9EffectReceiptSchema,
  type EffectRequestCeiling,
  type P9BudgetVector,
  type P9EffectReceipt,
  type P9ObservedUsage,
  type ProviderPriceCatalog,
  type ProviderPriceCatalogEntry,
} from '@mammoth/domain';
import {
  GovernanceError,
  type P9BudgetReservation,
  type P9DurableBudgetAuthority,
} from '@mammoth/governance';

export interface P9LiveEffectObservation<T> {
  readonly value: T;
  readonly usage: P9ObservedUsage | null;
  readonly usageSource: 'provider_reported' | 'measured_transport';
}

export type P9LiveEffectResult<T> =
  | {
      readonly status: 'ok';
      readonly value: T;
      readonly receipt: P9EffectReceipt;
      readonly reservation: P9BudgetReservation;
    }
  | {
      readonly status: 'failed';
      readonly error: unknown;
      readonly receipt: P9EffectReceipt;
      readonly reservation: P9BudgetReservation;
    };

function conservativeCurrency(value: number): number {
  if (value === 0) return 0;
  const scale = 1_000_000_000_000;
  return Math.ceil(value * scale) / scale;
}

/**
 * Prices an observed usage through the immutable catalog entry. Observed
 * charges are always derived from provider-reported or transport-measured
 * usage times catalog prices; no observed cost is ever hard-coded.
 */
export function priceObservedUsage(
  entry: ProviderPriceCatalogEntry,
  usage: P9ObservedUsage,
): P9BudgetVector {
  return {
    currencyUsd: conservativeCurrency(
      entry.flatCostUsd +
        usage.requests * entry.costPerRequestUsd +
        usage.inputTokens * entry.costPerInputTokenUsd +
        usage.outputTokens * entry.costPerOutputTokenUsd +
        usage.bytes * entry.costPerByteUsd,
    ),
    requests: usage.requests,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    bytes: usage.bytes,
    durationMs: usage.durationMs,
  };
}

/**
 * The only sanctioned path from the P9 live application to an outbound
 * effect. Each effect is mechanically preceded by a durable journaled
 * reservation and a durable transport-started record; settlement uses
 * observed usage priced through the immutable catalog, or conservatively
 * charges the reserved ceiling when the outcome is unknown or lost.
 */
export class P9LiveEffectExecutor {
  readonly #entries = new Map<string, ProviderPriceCatalogEntry>();
  readonly #receipts: P9EffectReceipt[] = [];

  constructor(
    private readonly authority: P9DurableBudgetAuthority,
    private readonly catalog: ProviderPriceCatalog,
    private readonly programId: string,
    private readonly actorId: string,
    private readonly clock: () => string,
  ) {
    for (const entry of catalog.entries) this.#entries.set(entry.id, entry);
  }

  get effectReceipts(): readonly P9EffectReceipt[] {
    return [...this.#receipts];
  }

  recordRecovered(
    reservations: readonly P9BudgetReservation[],
  ): readonly P9EffectReceipt[] {
    return reservations
      .filter(
        (reservation) =>
          reservation.settlementCostState === 'settlement_lost' ||
          reservation.settlementCostState === 'unknown',
      )
      .map((reservation) =>
        this.#receipt(reservation, {
          usageSource: 'absent',
          observedUsage: null,
          costState:
            reservation.settlementCostState === 'unknown'
              ? 'unknown'
              : 'settlement_lost',
        }),
      );
  }

  async execute<T>(input: {
    readonly id: string;
    readonly catalogEntryId: string;
    readonly ceiling: EffectRequestCeiling;
    readonly transport: () => Promise<P9LiveEffectObservation<T>>;
  }): Promise<P9LiveEffectResult<T>> {
    const entry = this.#entries.get(input.catalogEntryId);
    if (!entry) {
      throw new GovernanceError(
        'catalog_entry_unavailable',
        `live effect ${input.id} has no immutable catalog entry`,
      );
    }
    const reservation = this.authority.reserve({
      reservationId: input.id,
      workItemId: `work:${input.id}`,
      effectId: `effect:${input.id}`,
      idempotencyKey: `idem:${this.programId}:${input.id}`,
      catalogEntryId: input.catalogEntryId,
      ceiling: input.ceiling,
      actorId: this.actorId,
    });
    if (reservation.state !== 'reserved') {
      throw new GovernanceError(
        'effect_already_terminal',
        `live effect ${input.id} was already settled by a previous run; replay cannot repeat it`,
      );
    }
    this.authority.markTransportStarted(reservation.id, this.actorId);
    let observed: P9LiveEffectObservation<T>;
    try {
      observed = await input.transport();
    } catch (error) {
      const cancelled = this.authority.cancel(
        reservation.id,
        this.actorId,
        `live effect transport failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      const receipt = this.#receipt(cancelled, {
        usageSource: 'absent',
        observedUsage: null,
        costState: 'settlement_lost',
      });
      return { status: 'failed', error, receipt, reservation: cancelled };
    }
    if (observed.usage === null) {
      const settled = this.authority.settle(reservation.id, {
        costState: 'unknown',
        actorId: this.actorId,
      });
      const receipt = this.#receipt(settled, {
        usageSource: 'absent',
        observedUsage: null,
        costState: 'unknown',
      });
      return {
        status: 'ok',
        value: observed.value,
        receipt,
        reservation: settled,
      };
    }
    const charged = priceObservedUsage(entry, observed.usage);
    const settled = this.authority.settle(reservation.id, {
      costState: 'known',
      actual: charged,
      actorId: this.actorId,
    });
    const receipt = this.#receipt(settled, {
      usageSource: observed.usageSource,
      observedUsage: observed.usage,
      costState: 'observed',
    });
    return {
      status: 'ok',
      value: observed.value,
      receipt,
      reservation: settled,
    };
  }

  #receipt(
    reservation: P9BudgetReservation,
    outcome: {
      readonly usageSource: P9EffectReceipt['usageSource'];
      readonly observedUsage: P9ObservedUsage | null;
      readonly costState: P9EffectReceipt['costState'];
    },
  ): P9EffectReceipt {
    const identity = {
      schemaVersion: '1.0.0' as const,
      contractFamily: 'p9.v1' as const,
      receiptId: `effect-receipt:${reservation.id}`,
      effectId: reservation.bound.effectId,
      idempotencyKey: reservation.bound.idempotencyKey,
      effectKind: reservation.bound.effectKind,
      provider: reservation.bound.provider,
      catalogEntryId: reservation.bound.catalogEntryId,
      catalogDigest: this.catalog.catalogDigest,
      usageSource: outcome.usageSource,
      observedUsage: outcome.observedUsage,
      costState: outcome.costState,
      charged: reservation.charged,
      settledAt: reservation.closedAt ?? this.clock(),
    };
    const receipt = P9EffectReceiptSchema.parse({
      ...identity,
      receiptDigest: canonicalDigest(identity),
    });
    this.#receipts.push(receipt);
    return receipt;
  }
}
