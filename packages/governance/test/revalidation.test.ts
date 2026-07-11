import { describe, expect, it } from 'vitest';
import { RevalidationScheduler } from '../src/index.js';

describe('RevalidationScheduler', () => {
  it('leases due work deterministically and recovers expired leases after a crash', () => {
    let now = '2026-07-10T20:00:00.000Z';
    const scheduler = new RevalidationScheduler(() => now);
    scheduler.schedule(
      {
        id: 'later',
        programId: 'p',
        subjectType: 'claim',
        subjectId: 'c2',
        dueAt: '2026-07-10T19:59:00.000Z',
      },
      'workflow',
    );
    scheduler.schedule(
      {
        id: 'first',
        programId: 'p',
        subjectType: 'claim',
        subjectId: 'c1',
        dueAt: '2026-07-10T19:58:00.000Z',
      },
      'workflow',
    );
    expect(
      scheduler.claimDue('worker-a', 1_000, 1).map((item) => item.id),
    ).toEqual(['first']);
    expect(
      scheduler.claimDue('worker-b', 1_000).map((item) => item.id),
    ).toEqual(['later']);
    now = '2026-07-10T20:00:02.000Z';
    expect(
      scheduler.claimDue('worker-c', 1_000).map((item) => item.id),
    ).toEqual(['first', 'later']);
    expect(scheduler.get('first')).toMatchObject({
      leaseOwner: 'worker-c',
      attempt: 2,
    });
  });

  it('requires a live owned lease, a receipt, and retry scheduling on failure', () => {
    const scheduler = new RevalidationScheduler(
      () => '2026-07-10T20:00:00.000Z',
    );
    scheduler.schedule(
      {
        id: 's1',
        programId: 'p',
        subjectType: 'evidence',
        subjectId: 'e',
        dueAt: '2026-07-10T19:00:00.000Z',
      },
      'workflow',
    );
    scheduler.claimDue('worker', 60_000);
    expect(() =>
      scheduler.complete('s1', {
        workerId: 'intruder',
        outcome: 'fresh',
        receiptId: 'r',
      }),
    ).toThrowError(/lease owner/);
    expect(() =>
      scheduler.complete('s1', {
        workerId: 'worker',
        outcome: 'failed',
        receiptId: 'r',
      }),
    ).toThrowError(/schedule a retry/);
    expect(scheduler.get('s1')?.state).toBe('leased');
    expect(
      scheduler.complete('s1', {
        workerId: 'worker',
        outcome: 'failed',
        receiptId: 'r',
        next: { id: 's2', dueAt: '2026-07-11T20:00:00.000Z' },
      }),
    ).toMatchObject({ state: 'completed', outcome: 'failed' });
    expect(scheduler.get('s2')).toMatchObject({
      state: 'scheduled',
      subjectId: 'e',
    });
    expect(
      scheduler.audit.list().filter((event) => event.outcome === 'denied'),
    ).toHaveLength(2);
  });
});
