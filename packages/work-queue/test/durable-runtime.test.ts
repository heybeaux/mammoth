import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { execFile, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import { DurableWorkRuntime, LocalWorkStateStore } from '../src/index.js';

const directories: string[] = [];
const execFileAsync = promisify(execFile);
const fixture = fileURLToPath(
  new URL('./fixtures/work-process.ts', import.meta.url),
);

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

  it('serializes concurrent writers and fences leases across OS processes', async () => {
    const path = statePath();
    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        execFileAsync(process.execPath, [
          '--import',
          'tsx',
          fixture,
          'enqueue',
          path,
          `work-${String(index)}`,
        ]),
      ),
    );
    const runtime = new DurableWorkRuntime(new LocalWorkStateStore(path));
    expect(runtime.queue.list()).toHaveLength(8);

    const resultA = `${path}.claim-a`;
    const resultB = `${path}.claim-b`;
    await Promise.all([
      execFileAsync(process.execPath, [
        '--import',
        'tsx',
        fixture,
        'claim',
        path,
        'worker-a',
        resultA,
      ]),
      execFileAsync(process.execPath, [
        '--import',
        'tsx',
        fixture,
        'claim',
        path,
        'worker-b',
        resultB,
      ]),
    ]);
    const claimed = [
      readFileSync(resultA, 'utf8'),
      readFileSync(resultB, 'utf8'),
    ].filter((result) => result !== 'none');
    expect(claimed).toHaveLength(2);
    expect(new Set(claimed).size).toBe(2);
  });

  it('persists an attributable cancellation receipt and partial output', () => {
    const path = statePath();
    const runtime = new DurableWorkRuntime(new LocalWorkStateStore(path));
    runtime.enqueue({
      id: 'cancel-me',
      programId: 'program',
      kind: 'compile',
      queue: 'research-control',
      input: {},
      idempotencyKey: 'cancel-me',
    });
    runtime.cancel('cancel-me', {
      receiptId: 'receipt:cancel-me',
      reason: 'operator requested cancellation',
      partialOutput: { artifactIds: ['partial-1'] },
    });
    runtime.cancel('cancel-me', {
      receiptId: 'receipt:must-not-replace',
      reason: 'duplicate delivery',
    });
    const restarted = new DurableWorkRuntime(new LocalWorkStateStore(path));
    expect(restarted.queue.get('cancel-me')).toMatchObject({
      state: 'cancelled',
      cancellation: {
        receiptId: 'receipt:cancel-me',
        reason: 'operator requested cancellation',
        partialOutput: { artifactIds: ['partial-1'] },
      },
    });
  });

  it('recovers a process lock left behind by SIGKILL', async () => {
    const path = statePath();
    const ready = `${path}.ready`;
    const child = spawn(process.execPath, [
      '--import',
      'tsx',
      fixture,
      'hold-lock',
      path,
      ready,
    ]);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        if (readFileSync(ready, 'utf8') === 'ready') break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    expect(readFileSync(ready, 'utf8')).toBe('ready');
    child.kill('SIGKILL');
    await new Promise<void>((resolve, reject) => {
      child.once('exit', () => {
        resolve();
      });
      child.once('error', reject);
    });

    const runtime = new DurableWorkRuntime(new LocalWorkStateStore(path));
    expect(() =>
      runtime.enqueue({
        id: 'after-crash',
        programId: 'program',
        kind: 'recover',
        queue: 'retrieval',
        input: {},
        idempotencyKey: 'after-crash',
      }),
    ).not.toThrow();
  });
});
