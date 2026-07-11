import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GovernanceCoordinator, LocalGovernanceStore } from '../src/index.js';

class FailingGovernanceStore extends LocalGovernanceStore {
  failNextSave = false;

  override async save(snapshot: Parameters<LocalGovernanceStore['save']>[0]) {
    if (this.failNextSave) {
      this.failNextSave = false;
      throw new Error('injected governance save failure');
    }
    await super.save(snapshot);
  }
}

const directories: string[] = [];
afterEach(async () =>
  Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  ),
);

describe('local governance restart', () => {
  it('restores authoritative budget, gate, schedule, and audit state into fresh instances', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mammoth-governance-'));
    directories.push(directory);
    const store = new LocalGovernanceStore(join(directory, 'state.json'));
    let now = '2026-07-10T20:00:00.000Z';
    const first = new GovernanceCoordinator(store, () => now);
    await first.createBudgetAccount(
      {
        id: 'b',
        programId: 'p',
        limit: { costUsd: 10, tokens: 100, durationMs: 1_000 },
      },
      'owner',
    );
    await first.reserveBudget(
      {
        id: 'r',
        accountId: 'b',
        workItemId: 'w',
        idempotencyKey: 'key',
        amount: { costUsd: 4, tokens: 40, durationMs: 400 },
      },
      'planner',
    );
    await first.openHumanGate(
      {
        id: 'g',
        programId: 'p',
        workItemId: 'w',
        kind: 'egress',
        summary: 'Cloud call',
        requestedDecision: 'Allow?',
        evidenceIds: [],
        claimIds: [],
        riskCodes: ['cloud'],
        expiresAt: '2026-07-10T21:00:00.000Z',
      },
      'workflow',
    );
    await first.scheduleRevalidation(
      {
        id: 's',
        programId: 'p',
        subjectType: 'claim',
        subjectId: 'c',
        dueAt: '2026-07-10T19:00:00.000Z',
      },
      'workflow',
    );
    await first.claimDueRevalidations('dead-worker', 1_000);

    now = '2026-07-10T20:00:02.000Z';
    const restarted = await store.load(() => now);
    expect(restarted).toBeDefined();
    if (!restarted) throw new Error('governance state did not restart');
    expect(restarted).not.toBe(first);
    expect(restarted.getBudgetAccount('b')?.reserved).toEqual({
      costUsd: 4,
      tokens: 40,
      durationMs: 400,
    });
    expect((await restarted.getHumanGate('g'))?.state).toBe('open');
    expect(
      await restarted.claimDueRevalidations('new-worker', 1_000),
    ).toMatchObject([{ id: 's', leaseOwner: 'new-worker', attempt: 2 }]);
    expect(restarted.budgetAudit()).toHaveLength(2);
    expect(restarted.humanGateAudit()).toHaveLength(1);
  });

  it('fails closed on tampered aggregates and malformed files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mammoth-governance-'));
    directories.push(directory);
    const path = join(directory, 'state.json');
    const store = new LocalGovernanceStore(path);
    const coordinator = new GovernanceCoordinator(
      store,
      () => '2026-07-10T20:00:00.000Z',
    );
    await coordinator.createBudgetAccount(
      {
        id: 'b',
        programId: 'p',
        limit: { costUsd: 1, tokens: 1, durationMs: 1 },
      },
      'owner',
    );
    const snapshot = JSON.parse(await readFile(path, 'utf8')) as {
      budgets: { accounts: { reserved: { costUsd: number } }[] };
    };
    const account = snapshot.budgets.accounts[0];
    if (!account) throw new Error('budget snapshot account missing');
    account.reserved.costUsd = 1;
    await writeFile(path, JSON.stringify(snapshot));
    await expect(store.load()).rejects.toThrow(/reserved aggregate/);
    await writeFile(path, '{broken');
    await expect(store.load()).rejects.toThrow(/not valid JSON/);
  });

  it('does not acknowledge or retain any mutation whose durable save fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mammoth-governance-'));
    directories.push(directory);
    const store = new FailingGovernanceStore(join(directory, 'state.json'));
    let now = '2026-07-10T20:00:00.000Z';
    const clock = () => now;
    const coordinator = new GovernanceCoordinator(store, clock);
    const fail = async (operation: () => Promise<unknown>) => {
      store.failNextSave = true;
      await expect(operation()).rejects.toThrow(
        'injected governance save failure',
      );
    };
    const restart = async () => {
      const value = await store.load(clock);
      expect(value).toBeDefined();
      if (!value) throw new Error('expected persisted governance state');
      return value;
    };

    await fail(() =>
      coordinator.createBudgetAccount(
        {
          id: 'budget-failed',
          programId: 'program',
          limit: { costUsd: 10, tokens: 100, durationMs: 1_000 },
        },
        'owner',
      ),
    );
    expect(coordinator.getBudgetAccount('budget-failed')).toBeUndefined();

    await coordinator.createBudgetAccount(
      {
        id: 'budget',
        programId: 'program',
        limit: { costUsd: 10, tokens: 100, durationMs: 1_000 },
      },
      'owner',
    );
    const reservation = {
      id: 'reservation',
      accountId: 'budget',
      workItemId: 'work',
      idempotencyKey: 'budget:work',
      amount: { costUsd: 4, tokens: 40, durationMs: 400 },
    };
    await fail(() => coordinator.reserveBudget(reservation, 'planner'));
    expect(coordinator.getBudgetReservation('reservation')).toBeUndefined();
    expect(
      (await restart()).getBudgetReservation('reservation'),
    ).toBeUndefined();
    await coordinator.reserveBudget(reservation, 'planner');
    await fail(() =>
      coordinator.commitBudget(
        'reservation',
        { costUsd: 3, tokens: 30, durationMs: 300 },
        'worker',
      ),
    );
    expect(coordinator.getBudgetReservation('reservation')?.state).toBe(
      'reserved',
    );
    expect((await restart()).getBudgetReservation('reservation')?.state).toBe(
      'reserved',
    );
    await fail(() =>
      coordinator.releaseBudget('reservation', 'planner', 'cancelled'),
    );
    expect(coordinator.getBudgetReservation('reservation')?.state).toBe(
      'reserved',
    );

    const gate = {
      id: 'gate',
      programId: 'program',
      workItemId: 'work',
      kind: 'egress',
      summary: 'Cloud call',
      requestedDecision: 'Allow?',
      evidenceIds: [] as string[],
      claimIds: [] as string[],
      riskCodes: ['cloud'],
      expiresAt: '2026-07-10T21:00:00.000Z',
    };
    await fail(() => coordinator.openHumanGate(gate, 'workflow'));
    expect(await coordinator.getHumanGate('gate')).toBeUndefined();
    await coordinator.openHumanGate(gate, 'workflow');
    await fail(() =>
      coordinator.decideHumanGate('gate', 'approve', {
        actorId: 'reviewer',
        reason: 'approved',
        receiptId: 'receipt',
      }),
    );
    expect((await coordinator.getHumanGate('gate'))?.state).toBe('open');
    await fail(() => coordinator.cancelHumanGate('gate', 'workflow', 'stop'));
    const afterCancelFailure = await restart();
    await expect(
      afterCancelFailure.getHumanGate('gate'),
    ).resolves.toMatchObject({
      state: 'open',
    });
    now = '2026-07-10T22:00:00.000Z';
    await fail(() => coordinator.getHumanGate('gate'));
    expect(
      coordinator.snapshot().humanGates.gates.find(({ id }) => id === 'gate')
        ?.state,
    ).toBe('open');
    expect(
      (await restart())
        .snapshot()
        .humanGates.gates.find(({ id }) => id === 'gate')?.state,
    ).toBe('open');
    now = '2026-07-10T20:00:00.000Z';

    const schedule = {
      id: 'schedule',
      programId: 'program',
      subjectType: 'claim' as const,
      subjectId: 'claim',
      dueAt: '2026-07-10T19:00:00.000Z',
    };
    await fail(() => coordinator.scheduleRevalidation(schedule, 'workflow'));
    expect(coordinator.getRevalidation('schedule')).toBeUndefined();
    await coordinator.scheduleRevalidation(schedule, 'workflow');
    await fail(() => coordinator.claimDueRevalidations('worker', 60_000));
    expect(coordinator.getRevalidation('schedule')?.state).toBe('scheduled');
    await coordinator.claimDueRevalidations('worker', 60_000);
    await fail(() =>
      coordinator.completeRevalidation('schedule', {
        workerId: 'worker',
        outcome: 'fresh',
        receiptId: 'revalidation-receipt',
      }),
    );
    expect(coordinator.getRevalidation('schedule')?.state).toBe('leased');
    expect((await restart()).getRevalidation('schedule')?.state).toBe('leased');
  });
});
