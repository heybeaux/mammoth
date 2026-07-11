import { describe, expect, it } from 'vitest';

import {
  InMemoryWorkQueue,
  LeaseConflictError,
  type WorkQueueName,
} from '../src/index.js';

function setup() {
  let time = 1_000;
  const queue = new InMemoryWorkQueue(() => time);
  return { queue, advance: (milliseconds: number) => (time += milliseconds) };
}

function claim(
  queue: InMemoryWorkQueue,
  name: WorkQueueName,
  worker = 'worker',
) {
  const claimed = queue.claim(name, worker, 100);
  if (!claimed) throw new Error(`expected work on ${name}`);
  return claimed;
}

describe('work queue', () => {
  it('deduplicates enqueue by stable idempotency key', () => {
    const { queue } = setup();
    const first = queue.enqueue({
      id: 'work-1',
      programId: 'program-1',
      kind: 'retrieve',
      queue: 'retrieval',
      input: { url: 'https://example.test' },
      idempotencyKey: 'stable-key',
    });
    const duplicate = queue.enqueue({
      id: 'work-2',
      programId: 'program-1',
      kind: 'retrieve',
      queue: 'retrieval',
      input: { url: 'https://example.test' },
      idempotencyKey: 'stable-key',
    });
    expect(duplicate.id).toBe(first.id);
    expect(queue.list()).toHaveLength(1);
  });

  it('reclaims a worker lease after a crash and rejects the stale worker', () => {
    const { queue, advance } = setup();
    queue.enqueue({
      id: 'work-1',
      programId: 'program-1',
      kind: 'evaluate',
      queue: 'local-small',
      input: {},
      idempotencyKey: 'key-1',
    });

    const crashedWorker = claim(queue, 'local-small', 'worker-a');
    advance(100);
    const replacementWorker = claim(queue, 'local-small', 'worker-b');

    expect(replacementWorker.item.attemptCount).toBe(2);
    expect(() =>
      queue.complete('work-1', crashedWorker.leaseToken, {}),
    ).toThrow(LeaseConflictError);
    expect(
      queue.complete('work-1', replacementWorker.leaseToken, {
        accepted: true,
      }),
    ).toMatchObject({ state: 'succeeded', output: { accepted: true } });
  });

  it('restores authoritative queue state after a process restart', () => {
    let time = 1_000;
    const beforeCrash = new InMemoryWorkQueue(() => time);
    beforeCrash.enqueue({
      id: 'work-1',
      programId: 'program-1',
      kind: 'retrieve',
      queue: 'retrieval',
      input: {},
      idempotencyKey: 'key-1',
    });
    claim(beforeCrash, 'retrieval', 'crashed-worker');

    const durableState = structuredClone(beforeCrash.snapshot());
    time += 101;
    const afterRestart = new InMemoryWorkQueue(() => time, durableState);
    const recovered = claim(afterRestart, 'retrieval', 'replacement-worker');
    expect(recovered.item).toMatchObject({ id: 'work-1', attemptCount: 2 });
  });

  it('applies deterministic exponential retry delay and quarantines poison work', () => {
    const { queue, advance } = setup();
    queue.enqueue({
      id: 'work-1',
      programId: 'program-1',
      kind: 'falsify',
      queue: 'experiment',
      input: {},
      idempotencyKey: 'key-1',
      retry: {
        maxAttempts: 3,
        initialDelayMs: 10,
        backoffCoefficient: 2,
        maxDelayMs: 15,
      },
    });

    const first = claim(queue, 'experiment');
    expect(queue.fail('work-1', first.leaseToken, 'temporary')).toMatchObject({
      state: 'queued',
      availableAt: 1_010,
    });
    expect(queue.claim('experiment', 'worker', 100)).toBeUndefined();
    advance(10);
    const second = claim(queue, 'experiment');
    expect(queue.fail('work-1', second.leaseToken, 'temporary')).toMatchObject({
      state: 'queued',
      availableAt: 1_025,
    });
    advance(15);
    const third = claim(queue, 'experiment');
    expect(
      queue.fail('work-1', third.leaseToken, 'still broken'),
    ).toMatchObject({ state: 'dead-lettered', attemptCount: 3 });
  });

  it('orders available work by priority with a stable id tie-breaker', () => {
    const { queue } = setup();
    for (const [id, priority] of [
      ['b', 2],
      ['a', 2],
      ['c', 1],
    ] as const) {
      queue.enqueue({
        id,
        programId: 'p',
        kind: 'plan',
        queue: 'research-control',
        input: {},
        idempotencyKey: id,
        priority,
      });
    }
    expect(queue.claim('research-control', 'worker', 100)?.item.id).toBe('a');
  });
});
