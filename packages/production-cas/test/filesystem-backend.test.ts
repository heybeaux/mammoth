import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { contentDigest } from '@mammoth/retrieval';
import { OwnerOnlyFilesystemCasBackend } from '../src/index.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'mammoth-p7-cas-'));
  roots.push(root);
  return { root, backend: new OwnerOnlyFilesystemCasBackend({ root }) };
}

describe('OwnerOnlyFilesystemCasBackend', () => {
  it('keeps root, temp, and immutable objects owner-only', async () => {
    const { root, backend } = await fixture();
    const bytes = new TextEncoder().encode('private provider output');
    const digest = contentDigest(bytes);
    const staged = await backend.stage(bytes);
    const stagePath = join(root, 'staging', staged.id);
    expect((await stat(stagePath)).mode & 0o777).toBe(0o600);
    expect(await backend.inspectPermissions()).toEqual({
      root: 0o700,
      objects: 0o700,
      staging: 0o700,
      quarantine: 0o700,
    });
    const published = await backend.publishIfAbsent(staged, digest);
    expect(published.storageUri).toMatch(/^file:/u);
    expect((await stat(join(root, 'objects', digest))).mode & 0o777).toBe(
      0o600,
    );
    expect(await readdir(join(root, 'staging'))).toEqual([]);
    expect(await backend.read(digest)).toEqual(bytes);
  });

  it('atomically reuses an existing digest and removes every staged file', async () => {
    const { root, backend } = await fixture();
    const original = new TextEncoder().encode('original');
    const digest = contentDigest(original);
    await backend.publishIfAbsent(await backend.stage(original), digest);
    await backend.publishIfAbsent(
      await backend.stage(new TextEncoder().encode('competing bytes')),
      digest,
    );
    expect(await readFile(join(root, 'objects', digest))).toEqual(
      Buffer.from(original),
    );
    expect(await readdir(join(root, 'staging'))).toEqual([]);
  });

  it('rejects traversal and quarantines only inside the CAS root', async () => {
    const { root, backend } = await fixture();
    await expect(backend.read('../escape')).rejects.toThrow(/INVALID_DIGEST/u);
    await expect(backend.readStaged({ id: '../../escape' })).rejects.toThrow(
      /invalid staging/u,
    );
    const bytes = new TextEncoder().encode('orphan');
    const digest = contentDigest(bytes);
    await backend.publishIfAbsent(await backend.stage(bytes), digest);
    await backend.quarantine(digest, 'unreferenced');
    expect(await readdir(join(root, 'objects'))).toEqual([]);
    expect(await readFile(join(root, 'quarantine', digest))).toEqual(
      Buffer.from(bytes),
    );
  });

  it('cleans a failed caller-owned stage without writing outside root', async () => {
    const { root, backend } = await fixture();
    const staged = await backend.stage(new TextEncoder().encode('discard'));
    await backend.discard(staged);
    await backend.discard(staged);
    expect(await readdir(join(root, 'staging'))).toEqual([]);
    await writeFile(join(root, 'sentinel'), 'inside only');
    expect(await readdir(root)).toContain('sentinel');
  });
});
