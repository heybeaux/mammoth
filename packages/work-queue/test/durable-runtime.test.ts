import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DurableWorkRuntime, LocalWorkStateStore } from '../src/index.js';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function statePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'mammoth-work-'));
  directories.push(directory);
  return join(directory, 'state.json');
}

describe('durable work runtime', () => {
  it('atomically persists authoritative state and reclaims work in a fresh process', () => {
    let time = 1_000;
    const path = statePath();
    const firstProcess = new DurableWorkRuntime(
      new LocalWorkStateStore(path),
      () => time,
    );
    firstProcess.enqueue({
      id: 'work-1',
      programId: 'program-1',
      kind: 'retrieve',
      queue: 'retrieval',
      input: { url: 'https://example.test' },
      idempotencyKey: 'retrieve:1',
    });
    const abandoned = firstProcess.claim('retrieval', 'worker-that-dies', 100);
    if (!abandoned) throw new Error('expected initial work claim');

    // The original runtime is discarded, like a SIGKILL. A new instance reads
    // only the fsynced state file and waits for the persisted lease to expire.
    time += 101;
    const replacementProcess = new DurableWorkRuntime(
      new LocalWorkStateStore(path),
      () => time,
    );
    const recovered = replacementProcess.claim(
      'retrieval',
      'replacement-worker',
      100,
    );
    if (!recovered) throw new Error('expected reclaimed work');
    replacementProcess.complete('work-1', recovered.leaseToken, {
      snapshotId: 'snapshot-1',
    });

    const thirdProcess = new DurableWorkRuntime(
      new LocalWorkStateStore(path),
      () => time,
    );
    expect(thirdProcess.queue.get('work-1')).toMatchObject({
      state: 'succeeded',
      attemptCount: 2,
      output: { snapshotId: 'snapshot-1' },
    });
    expect(() => {
      JSON.parse(readFileSync(path, 'utf8')) as unknown;
    }).not.toThrow();
  });

  it('survives process death after a remote commit without duplicating the effect', async () => {
    const path = statePath();
    const providerResults = new Map<
      string,
      { providerReceiptId: string; result: { messageId: string } }
    >();
    let actualEffects = 0;
    let crash = true;
    const provider = (key: string) => {
      const prior = providerResults.get(key);
      if (prior) return Promise.resolve(prior);
      actualEffects += 1;
      const committed = {
        providerReceiptId: 'mail-provider-1',
        result: { messageId: 'message-1' },
      };
      providerResults.set(key, committed);
      if (crash) throw new Error('simulated SIGKILL after provider commit');
      return Promise.resolve(committed);
    };

    const firstProcess = new DurableWorkRuntime(new LocalWorkStateStore(path));
    await expect(
      firstProcess.executeExactlyOnce({
        idempotencyKey: 'email:report-1',
        execute: provider,
      }),
    ).rejects.toThrow('simulated SIGKILL');

    const replacementProcess = new DurableWorkRuntime(
      new LocalWorkStateStore(path),
    );
    expect(replacementProcess.receipts.get('email:report-1')).toMatchObject({
      state: 'started',
    });
    crash = false;
    const receipt = await replacementProcess.executeExactlyOnce({
      idempotencyKey: 'email:report-1',
      execute: provider,
    });

    expect(receipt).toMatchObject({
      state: 'completed',
      providerReceiptId: 'mail-provider-1',
      result: { messageId: 'message-1' },
    });
    expect(actualEffects).toBe(1);
    const finalProcess = new DurableWorkRuntime(new LocalWorkStateStore(path));
    expect(finalProcess.receipts.get('email:report-1')).toEqual(receipt);
  });
});
