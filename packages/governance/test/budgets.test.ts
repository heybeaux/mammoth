import { describe, expect, it } from 'vitest';
import { BudgetLedger, GovernanceError } from '../src/index.js';

const amount = (costUsd: number, tokens: number, durationMs: number) => ({
  costUsd,
  tokens,
  durationMs,
});

describe('BudgetLedger', () => {
  it('atomically reserves, commits actual usage, and releases unused capacity', () => {
    const ledger = new BudgetLedger(() => '2026-07-10T20:00:00.000Z');
    ledger.createAccount(
      {
        id: 'budget-1',
        programId: 'program-1',
        limit: amount(10, 1_000, 60_000),
      },
      'owner',
    );
    ledger.reserve(
      {
        id: 'r1',
        accountId: 'budget-1',
        workItemId: 'work-1',
        idempotencyKey: 'key-1',
        amount: amount(4, 400, 20_000),
      },
      'planner',
    );
    ledger.commit('r1', amount(3, 350, 18_000), 'worker');
    ledger.reserve(
      {
        id: 'r2',
        accountId: 'budget-1',
        workItemId: 'work-2',
        idempotencyKey: 'key-2',
        amount: amount(7, 650, 42_000),
      },
      'planner',
    );
    ledger.release('r2', 'planner', 'work cancelled');

    expect(ledger.getAccount('budget-1')).toMatchObject({
      spent: amount(3, 350, 18_000),
      reserved: amount(0, 0, 0),
      version: 4,
    });
    expect(ledger.audit.list().map((event) => event.kind)).toEqual([
      'budget.account_created',
      'budget.reserved',
      'budget.committed',
      'budget.reserved',
      'budget.released',
    ]);
  });

  it('fails closed on exhaustion, overage, and idempotency conflicts while auditing denials', () => {
    const ledger = new BudgetLedger(() => '2026-07-10T20:00:00.000Z');
    ledger.createAccount(
      { id: 'b', programId: 'p', limit: amount(5, 100, 100) },
      'owner',
    );
    const input = {
      id: 'r',
      accountId: 'b',
      workItemId: 'w',
      idempotencyKey: 'same',
      amount: amount(4, 80, 80),
    };
    expect(ledger.reserve(input, 'planner')).toEqual(
      ledger.reserve(input, 'planner'),
    );
    expect(() =>
      ledger.reserve(
        { ...input, id: 'other', amount: amount(1, 1, 1) },
        'planner',
      ),
    ).toThrowError(GovernanceError);
    expect(() =>
      ledger.reserve(
        {
          id: 'r2',
          accountId: 'b',
          workItemId: 'w2',
          idempotencyKey: 'new',
          amount: amount(2, 1, 1),
        },
        'planner',
      ),
    ).toThrowError(/exceeds remaining budget/);
    expect(() => ledger.commit('r', amount(5, 80, 80), 'worker')).toThrowError(
      /exceeds reservation/,
    );
    expect(ledger.getReservation('r')?.state).toBe('reserved');
    expect(
      ledger.audit.list().filter((event) => event.outcome === 'denied'),
    ).toHaveLength(3);
  });
});
