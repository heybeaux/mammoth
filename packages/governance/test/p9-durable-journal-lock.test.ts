import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileP9DurableJournalStore } from '../src/index.js';

describe('P9 durable journal run lock', () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('prevents concurrent processes from opening the same spending journal', () => {
    const directory = mkdtempSync(join(tmpdir(), 'mammoth-p9-lock-'));
    directories.push(directory);
    const path = join(directory, 'budget.jsonl');
    const first = new FileP9DurableJournalStore(path);
    const second = new FileP9DurableJournalStore(path);
    first.acquireExclusive();
    let lockError: unknown;
    try {
      second.acquireExclusive();
    } catch (error) {
      lockError = error;
    }
    expect(lockError).toMatchObject({ code: 'journal_locked' });
    first.releaseExclusive();
    expect(() => {
      second.acquireExclusive();
    }).not.toThrow();
    second.releaseExclusive();
  });

  it('recovers a stale lock left by a crashed process', () => {
    const directory = mkdtempSync(join(tmpdir(), 'mammoth-p9-stale-lock-'));
    directories.push(directory);
    const path = join(directory, 'budget.jsonl');
    writeFileSync(`${path}.lock`, '2147483647\n', { mode: 0o600 });
    const store = new FileP9DurableJournalStore(path);
    expect(() => {
      store.acquireExclusive();
    }).not.toThrow();
    store.releaseExclusive();
  });
});
