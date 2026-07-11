import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GovernanceCoordinator, LocalGovernanceStore } from '../src/index.js';

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
    first.budgets.createAccount(
      {
        id: 'b',
        programId: 'p',
        limit: { costUsd: 10, tokens: 100, durationMs: 1_000 },
      },
      'owner',
    );
    first.budgets.reserve(
      {
        id: 'r',
        accountId: 'b',
        workItemId: 'w',
        idempotencyKey: 'key',
        amount: { costUsd: 4, tokens: 40, durationMs: 400 },
      },
      'planner',
    );
    first.humanGates.open(
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
    first.revalidation.schedule(
      {
        id: 's',
        programId: 'p',
        subjectType: 'claim',
        subjectId: 'c',
        dueAt: '2026-07-10T19:00:00.000Z',
      },
      'workflow',
    );
    first.revalidation.claimDue('dead-worker', 1_000);
    await first.checkpoint();

    now = '2026-07-10T20:00:02.000Z';
    const restarted = await store.load(() => now);
    expect(restarted).toBeDefined();
    if (!restarted) throw new Error('governance state did not restart');
    expect(restarted).not.toBe(first);
    expect(restarted.budgets.getAccount('b')?.reserved).toEqual({
      costUsd: 4,
      tokens: 40,
      durationMs: 400,
    });
    expect(restarted.humanGates.get('g')?.state).toBe('open');
    expect(restarted.revalidation.claimDue('new-worker', 1_000)).toMatchObject([
      { id: 's', leaseOwner: 'new-worker', attempt: 2 },
    ]);
    expect(restarted.budgets.audit.list()).toHaveLength(2);
    expect(restarted.humanGates.audit.list()).toHaveLength(1);
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
    coordinator.budgets.createAccount(
      {
        id: 'b',
        programId: 'p',
        limit: { costUsd: 1, tokens: 1, durationMs: 1 },
      },
      'owner',
    );
    await coordinator.checkpoint();
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
});
