import { createHash } from 'node:crypto';
import { mkdir, open, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { CasObject } from './types.js';

export function contentDigest(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

export class FileContentStore {
  public constructor(private readonly root: string) {}

  public pathFor(digest: string): string {
    const match = /^sha256:([0-9a-f]{64})$/.exec(digest);
    if (!match?.[1]) throw new Error(`INVALID_DIGEST:${digest}`);
    return join(this.root, 'sha256', match[1].slice(0, 2), match[1].slice(2));
  }

  public async put(bytes: Uint8Array): Promise<CasObject> {
    const digest = contentDigest(bytes);
    const path = this.pathFor(digest);
    await mkdir(dirname(path), { recursive: true });
    try {
      const handle = await open(path, 'wx', 0o440);
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (
        !(error instanceof Error && 'code' in error && error.code === 'EEXIST')
      ) {
        throw error;
      }
      const existing = await readFile(path);
      if (contentDigest(existing) !== digest)
        throw new Error(`CAS_COLLISION:${digest}`);
    }
    return {
      digest,
      size: bytes.byteLength,
      storageUri: `file://${path}`,
      path,
    };
  }

  public async get(digest: string): Promise<Uint8Array> {
    const bytes = await readFile(this.pathFor(digest));
    if (contentDigest(bytes) !== digest)
      throw new Error(`CAS_INTEGRITY_FAILURE:${digest}`);
    return bytes;
  }
}
