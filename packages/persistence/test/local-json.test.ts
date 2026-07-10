import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalJsonLedger } from '../src/index.js';

const paths: string[] = [];

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(
    paths.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

async function ledgerPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'mammoth-ledger-'));
  paths.push(directory);
  return join(directory, 'ledger.json');
}

describe('LocalJsonLedger', () => {
  it('persists state durably across adapter instances', async () => {
    const path = await ledgerPath();
    const ledger = new LocalJsonLedger(path);
    await ledger.transact((draft) => {
      draft.sourceLineages.push({
        id: 'origin',
        lineageType: 'primary',
        parentLineageIds: [],
        independenceScore: 1,
      });
    });

    const reopened = await new LocalJsonLedger(path).read();
    expect(reopened.revision).toBe(1);
    expect(reopened.sourceLineages).toHaveLength(1);
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(reopened);
  });

  it('serializes concurrent in-process transactions without lost updates', async () => {
    const ledger = new LocalJsonLedger(await ledgerPath());
    await Promise.all([
      ledger.transact((draft) => {
        draft.sourceLineages.push({
          id: 'one',
          lineageType: 'primary',
          parentLineageIds: [],
          independenceScore: 1,
        });
      }),
      ledger.transact((draft) => {
        draft.sourceLineages.push({
          id: 'two',
          lineageType: 'independent_secondary',
          parentLineageIds: [],
          independenceScore: 0.8,
        });
      }),
    ]);
    expect(
      (await ledger.read()).sourceLineages.map(({ id }) => id).sort(),
    ).toEqual(['one', 'two']);
  });

  it('rejects invalid mutations before replacing durable state', async () => {
    const path = await ledgerPath();
    const ledger = new LocalJsonLedger(path);
    await ledger.transact(() => undefined);
    await expect(
      ledger.transact((draft) => {
        draft.sourceLineages.push({
          id: 'dangling',
          lineageType: 'syndicated',
          parentLineageIds: ['missing'],
          independenceScore: 0,
        });
      }),
    ).rejects.toThrow('unknown source lineage');
    expect((await ledger.read()).sourceLineages).toEqual([]);
  });
});
