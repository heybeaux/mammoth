import {
  ProviderPriceCatalogSchema,
  type EffectRequestCeiling,
  type P9BudgetVector,
  type ProviderPriceCatalog,
} from '@mammoth/domain';
import { describe, expect, it } from 'vitest';
import {
  GovernanceError,
  P9BudgetAuthority,
  priceCatalogDigest,
} from '../src/index.js';

const NOW = '2026-07-15T02:00:00.000Z';

const vector = (currencyUsd: number): P9BudgetVector => ({
  currencyUsd,
  requests: 10,
  inputTokens: 10_000,
  outputTokens: 10_000,
  bytes: 10_000_000,
  durationMs: 600_000,
});

const ceiling = (attempts = 1): EffectRequestCeiling => ({
  requests: 1,
  inputTokens: 0,
  outputTokens: 0,
  bytes: 0,
  durationMs: 1_000,
  attempts,
  parserClass: null,
});

function catalog(): ProviderPriceCatalog {
  const identity = {
    schemaVersion: '1.0.0' as const,
    contractFamily: 'p9.v1' as const,
    catalogId: 'catalog-test',
    version: '2026-07-15',
    entries: [
      {
        id: 'brave-search',
        provider: 'brave-search/v1',
        effectKind: 'search' as const,
        parserClass: null,
        flatCostUsd: 0,
        costPerRequestUsd: 0.6,
        costPerInputTokenUsd: 0,
        costPerOutputTokenUsd: 0,
        costPerByteUsd: 0,
      },
    ],
  };
  return { ...identity, catalogDigest: priceCatalogDigest(identity) };
}

function authority(limitUsd = 2): P9BudgetAuthority {
  return new P9BudgetAuthority(
    {
      accountId: 'budget-p9',
      programId: 'program-p9',
      catalog: catalog(),
      limit: vector(limitUsd),
    },
    () => NOW,
  );
}

function reserve(budget: P9BudgetAuthority, suffix: string, attempts = 1) {
  return budget.reserve({
    reservationId: `reservation-${suffix}`,
    workItemId: `work-${suffix}`,
    effectId: `effect-${suffix}`,
    idempotencyKey: `idempotency-${suffix}`,
    catalogEntryId: 'brave-search',
    ceiling: ceiling(attempts),
    actorId: 'planner',
  });
}

describe('P9BudgetAuthority', () => {
  it('atomically rejects one of two concurrent effects spending the same remainder', async () => {
    const budget = authority(1);
    const results = await Promise.allSettled([
      Promise.resolve().then(() => reserve(budget, 'a')),
      Promise.resolve().then(() => reserve(budget, 'b')),
    ]);

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    expect(budget.snapshot().reserved.currencyUsd).toBe(0.6);
    expect(budget.snapshot().spent.currencyUsd).toBe(0);
  });

  it('charges the conservative bound when provider cost is unknown', () => {
    const budget = authority();
    reserve(budget, 'unknown');
    budget.markTransportStarted('reservation-unknown', 'worker');
    const settled = budget.settle('reservation-unknown', {
      costState: 'unknown',
      actorId: 'worker',
    });

    expect(settled.state).toBe('ambiguous');
    expect(settled.settlementCostState).toBe('unknown');
    expect(settled.charged.currencyUsd).toBe(0.6);
    expect(budget.snapshot().spent.currencyUsd).toBe(0.6);
  });

  it('prices every retry in the frozen bound and denies a split exceeding authorization', () => {
    const budget = authority(1.3);
    const first = reserve(budget, 'retry', 2);
    expect(first.bound.reserved.currencyUsd).toBe(1.2);
    expect(first.bound.reserved.requests).toBe(2);

    expect(() => reserve(budget, 'split')).toThrowError(
      /remaining P9 authorization/,
    );
  });

  it('preserves lost settlement as ambiguous conservative spend', () => {
    const budget = authority();
    reserve(budget, 'lost');
    budget.markTransportStarted('reservation-lost', 'worker');
    const settled = budget.settle('reservation-lost', {
      costState: 'settlement_lost',
      actorId: 'worker',
    });

    expect(settled).toMatchObject({
      state: 'ambiguous',
      settlementCostState: 'settlement_lost',
      charged: { currencyUsd: 0.6 },
    });
  });

  it('allows exactly one terminal outcome when cancellation races settlement', () => {
    const budget = authority();
    reserve(budget, 'race');
    budget.markTransportStarted('reservation-race', 'worker');
    budget.settle('reservation-race', {
      costState: 'known',
      actual: {
        currencyUsd: 0.4,
        requests: 1,
        inputTokens: 0,
        outputTokens: 0,
        bytes: 0,
        durationMs: 500,
      },
      actorId: 'worker',
    });

    expect(() =>
      budget.cancel('reservation-race', 'operator', 'cancel requested'),
    ).toThrowError(/different terminal result/);
    expect(budget.getReservation('reservation-race')?.state).toBe('settled');
    expect(budget.snapshot().reservations).toHaveLength(1);
    expect(budget.snapshot().spent.currencyUsd).toBe(0.4);
  });

  it('records an over-bound settlement, quarantines its catalog entry, and stops future effects', () => {
    const budget = authority(2);
    reserve(budget, 'breach');
    budget.markTransportStarted('reservation-breach', 'worker');

    expect(() =>
      budget.settle('reservation-breach', {
        costState: 'known',
        actual: {
          currencyUsd: 0.8,
          requests: 1,
          inputTokens: 0,
          outputTokens: 0,
          bytes: 0,
          durationMs: 500,
        },
        actorId: 'worker',
      }),
    ).toThrowError(/entry quarantined/);
    expect(budget.getReservation('reservation-breach')).toMatchObject({
      state: 'breached',
      charged: { currencyUsd: 0.8 },
    });
    expect(budget.isCatalogEntryQuarantined('brave-search')).toBe(true);
    expect(() => reserve(budget, 'after-breach')).toThrowError(/quarantined/);
    try {
      budget.settle('reservation-breach', {
        costState: 'known',
        actual: {
          currencyUsd: 0.8,
          requests: 1,
          inputTokens: 0,
          outputTokens: 0,
          bytes: 0,
          durationMs: 500,
        },
        actorId: 'worker',
      });
      throw new Error('expected breached settlement replay to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(GovernanceError);
      if (!(error instanceof GovernanceError)) return;
      expect(error.code).toBe('provider_bound_breached');
    }
  });

  it('never rounds a positive conservative catalog charge down to zero', () => {
    const base = catalog();
    const identity = {
      ...base,
      entries: base.entries.map((entry) => ({
        ...entry,
        costPerRequestUsd: 0.000_000_000_000_1,
      })),
    };
    const tinyCatalog = {
      ...identity,
      catalogDigest: priceCatalogDigest({
        schemaVersion: identity.schemaVersion,
        contractFamily: identity.contractFamily,
        catalogId: identity.catalogId,
        version: identity.version,
        entries: identity.entries,
      }),
    };
    const budget = new P9BudgetAuthority({
      accountId: 'tiny-budget',
      programId: 'tiny-program',
      catalog: tinyCatalog,
      limit: vector(0.000_000_000_001),
    });

    expect(reserve(budget, 'tiny').bound.reserved.currencyUsd).toBe(
      0.000_000_000_001,
    );
  });

  it('rejects empty reservation identities before mutating authority state', () => {
    const budget = authority();
    const before = budget.snapshot();
    expect(() =>
      budget.reserve({
        reservationId: '',
        workItemId: 'work-invalid',
        effectId: 'effect-invalid',
        idempotencyKey: 'key-invalid',
        catalogEntryId: 'brave-search',
        ceiling: ceiling(),
        actorId: 'planner',
      }),
    ).toThrowError();
    expect(budget.snapshot()).toEqual(before);
  });

  it('restores reservations, conservative charges, quarantine, and audit identity', () => {
    const budget = authority();
    reserve(budget, 'restore');
    budget.markTransportStarted('reservation-restore', 'worker');
    budget.settle('reservation-restore', {
      costState: 'unknown',
      actorId: 'worker',
    });

    const restored = P9BudgetAuthority.restore(budget.snapshot(), () => NOW);
    expect(restored.snapshot()).toEqual(budget.snapshot());
  });

  it('rejects restored bounds and quarantine that are not derivable from authoritative reservations', () => {
    const budget = authority(2);
    reserve(budget, 'tamper');
    const snapshot = budget.snapshot();
    const loweredBound = {
      ...snapshot,
      reserved: { ...snapshot.reserved, currencyUsd: 0.01 },
      reservations: snapshot.reservations.map((reservation) => ({
        ...reservation,
        bound: {
          ...reservation.bound,
          reserved: { ...reservation.bound.reserved, currencyUsd: 0.01 },
        },
      })),
    };
    expect(() => P9BudgetAuthority.restore(loweredBound)).toThrowError(
      /non-authoritative reservations/,
    );

    budget.markTransportStarted('reservation-tamper', 'worker');
    expect(() =>
      budget.settle('reservation-tamper', {
        costState: 'known',
        actual: {
          currencyUsd: 0.8,
          requests: 1,
          inputTokens: 0,
          outputTokens: 0,
          bytes: 0,
          durationMs: 500,
        },
        actorId: 'worker',
      }),
    ).toThrowError(/entry quarantined/);
    expect(() =>
      P9BudgetAuthority.restore({
        ...budget.snapshot(),
        quarantinedCatalogEntryIds: [],
      }),
    ).toThrowError(/quarantine does not match breached reservations/);
  });

  it('rejects tampered catalogs and effects without a conservative catalog entry', () => {
    const valid = catalog();
    const invalid = {
      ...valid,
      entries: valid.entries.map((entry) => ({
        ...entry,
        costPerRequestUsd: 0.01,
      })),
    };
    expect(() => ProviderPriceCatalogSchema.parse(invalid)).toThrowError(
      /digest must bind the exact immutable price catalog/,
    );
    expect(
      () =>
        new P9BudgetAuthority({
          accountId: 'b',
          programId: 'p',
          catalog: invalid,
          limit: vector(2),
        }),
    ).toThrowError(GovernanceError);

    const budget = authority();
    expect(() =>
      budget.reserve({
        reservationId: 'missing',
        workItemId: 'missing',
        effectId: 'missing',
        idempotencyKey: 'missing',
        catalogEntryId: 'operator-low-estimate',
        ceiling: ceiling(),
        actorId: 'planner',
      }),
    ).toThrowError(/no conservative immutable provider price entry/);
  });
});
