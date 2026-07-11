import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalWorkflowStore } from '../src/index.js';

const directories: string[] = [];
afterEach(async () =>
  Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true })),
  ),
);

describe('LocalWorkflowStore', () => {
  it('rejects structurally corrupt snapshots instead of silently running them', async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'mammoth-workflow-corrupt-'),
    );
    directories.push(directory);
    const path = join(directory, 'state.json');
    await writeFile(path, '{"executions":[],"schedules":{}}\n', 'utf8');

    await expect(new LocalWorkflowStore(path).load()).rejects.toThrow(
      'invalid workflow snapshot',
    );
  });

  it('does not lose updates from independent store instances', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mammoth-workflow-race-'));
    directories.push(directory);
    const path = join(directory, 'state.json');
    const first = new LocalWorkflowStore(path);
    const second = new LocalWorkflowStore(path);

    await Promise.all([
      first.transact((snapshot) => {
        snapshot.schedules.first = schedule('first');
      }),
      second.transact((snapshot) => {
        snapshot.schedules.second = schedule('second');
      }),
    ]);

    expect(Object.keys((await first.load()).schedules).sort()).toEqual([
      'first',
      'second',
    ]);
  });
});

function schedule(id: string) {
  return {
    id,
    workflow: 'research',
    input: {},
    nextRunAt: '2026-01-01T00:00:00.000Z',
    enabled: true,
  };
}
