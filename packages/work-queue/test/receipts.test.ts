import { describe, expect, it } from 'vitest';

import { executeExactlyOnce, InMemoryReceiptStore } from '../src/index.js';

describe('external side-effect receipts', () => {
  it('returns the completed receipt without redelivering', async () => {
    const receipts = new InMemoryReceiptStore();
    let deliveries = 0;
    const execute = (key: string) => {
      deliveries += 1;
      return Promise.resolve({
        providerReceiptId: `provider:${key}`,
        result: { messageId: '42' },
      });
    };
    const options = {
      idempotencyKey: 'send:report-1',
      receipts,
      execute,
      now: () => 10,
    };
    const first = await executeExactlyOnce(options);
    const duplicate = await executeExactlyOnce(options);

    expect(duplicate).toEqual(first);
    expect(deliveries).toBe(1);
  });

  it('restores completed receipts after a process restart', async () => {
    const beforeRestart = new InMemoryReceiptStore();
    beforeRestart.begin('publish:1', 1);
    beforeRestart.complete('publish:1', 'provider-1', { published: true }, 2);
    const afterRestart = new InMemoryReceiptStore(beforeRestart.snapshot());
    let deliveries = 0;
    const receipt = await executeExactlyOnce({
      idempotencyKey: 'publish:1',
      receipts: afterRestart,
      execute: () => {
        deliveries += 1;
        return Promise.resolve({ providerReceiptId: 'provider-2', result: {} });
      },
    });
    expect(receipt.providerReceiptId).toBe('provider-1');
    expect(deliveries).toBe(0);
  });

  it('does not duplicate the remote effect when a worker crashes after provider commit', async () => {
    const receipts = new InMemoryReceiptStore();
    const providerResults = new Map<
      string,
      { providerReceiptId: string; result: { messageId: string } }
    >();
    let actualSideEffects = 0;
    let crashAfterCommit = true;
    const idempotentProvider = (key: string) => {
      const prior = providerResults.get(key);
      if (prior) return Promise.resolve(prior);
      actualSideEffects += 1;
      const committed = {
        providerReceiptId: 'mail-42',
        result: { messageId: '42' },
      };
      providerResults.set(key, committed);
      if (crashAfterCommit)
        throw new Error('worker process died after remote commit');
      return Promise.resolve(committed);
    };

    await expect(
      executeExactlyOnce({
        idempotencyKey: 'email:report-1',
        receipts,
        execute: idempotentProvider,
      }),
    ).rejects.toThrow('worker process died');
    expect(receipts.get('email:report-1')).toMatchObject({ state: 'started' });

    crashAfterCommit = false;
    const recovered = await executeExactlyOnce({
      idempotencyKey: 'email:report-1',
      receipts,
      execute: idempotentProvider,
    });
    expect(recovered).toMatchObject({
      state: 'completed',
      providerReceiptId: 'mail-42',
      result: { messageId: '42' },
    });
    expect(actualSideEffects).toBe(1);
  });
});
