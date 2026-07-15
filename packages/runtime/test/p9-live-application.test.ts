import { describe, expect, it } from 'vitest';
import {
  P9_LIVE_EXHIBITION_QUESTION,
  buildAcceptedP9LivePlan,
  runP9LiveApplication,
  type P9LiveModelAdapter,
} from '../src/index.js';

const now = () => new Date('2026-07-15T18:00:00.000Z');

const model: P9LiveModelAdapter = {
  proposerProfile: {
    profileVersionId: 'fixture-proposer-profile',
    profileFamilyId: 'fixture-proposer-family',
    modelId: 'fixture/proposer',
  },
  evaluatorProfile: {
    profileVersionId: 'fixture-evaluator-profile',
    profileFamilyId: 'fixture-evaluator-family',
    modelId: 'fixture/evaluator',
  },
  proposeClaims: () => Promise.resolve([]),
  evaluateClaims: () => Promise.resolve([]),
};

describe('P9 live application', () => {
  it('freezes the exact Colibri question into an accepted technical due diligence plan', () => {
    const plan = buildAcceptedP9LivePlan({
      budgetUsd: 5,
      now: now().toISOString(),
      proposerProfile: model.proposerProfile,
    });

    expect(plan.plan.question).toBe(P9_LIVE_EXHIBITION_QUESTION);
    expect(plan.plan.domainPackId).toBe('technical-due-diligence/v1');
    expect(plan.plan.budget.currencyUsd).toBe(5);
    expect(
      plan.plan.sourceClassTargets.map((target) => target.sourceClass),
    ).toContain('hardware_vendor_docs');
    expect(plan.acceptanceReceipt.decision).toBe('accepted');
  });

  it('blocks every injected live effect path until the durable authority contract exists', async () => {
    let searchCalls = 0;
    let proposerCalls = 0;
    await expect(
      runP9LiveApplication({
        executionId: 'must-not-run',
        budgetUsd: 5,
        now,
        search: {
          search: () => {
            searchCalls += 1;
            return Promise.resolve([]);
          },
        },
        model: {
          ...model,
          proposeClaims: () => {
            proposerCalls += 1;
            return Promise.resolve([]);
          },
        },
      }),
    ).rejects.toThrow(/live executor unavailable/);
    expect(searchCalls).toBe(0);
    expect(proposerCalls).toBe(0);
  });
});
