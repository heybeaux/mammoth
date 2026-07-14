import { randomUUID } from 'node:crypto';
import {
  chmod,
  link,
  mkdir,
  open,
  readFile,
  readdir,
  stat,
  unlink,
} from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ProductionCasError } from './errors.js';
import type { CasByteBackend, PublishedObject, StagedObject } from './ports.js';

const DIGEST = /^sha256:[a-f0-9]{64}$/u;

export interface OwnerOnlyFilesystemCasOptions {
  readonly root: string;
}

/** Local CAS bytes with owner-only permissions and atomic create-if-absent. */
export class OwnerOnlyFilesystemCasBackend implements CasByteBackend {
  readonly #root: string;
  readonly #objects: string;
  readonly #staging: string;
  readonly #quarantine: string;

  constructor(options: OwnerOnlyFilesystemCasOptions) {
    this.#root = resolve(options.root);
    this.#objects = join(this.#root, 'objects');
    this.#staging = join(this.#root, 'staging');
    this.#quarantine = join(this.#root, 'quarantine');
  }

  async stage(bytes: Uint8Array): Promise<StagedObject> {
    await this.#ensureRoot();
    const id = randomUUID();
    const path = this.#stagePath(id);
    const handle = await open(path, 'wx', 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } catch (cause) {
      await handle.close().catch(() => undefined);
      await unlink(path).catch(() => undefined);
      throw cause;
    }
    await handle.close();
    await chmod(path, 0o600);
    return { id };
  }

  async readStaged(staged: StagedObject): Promise<Uint8Array> {
    return Uint8Array.from(await readFile(this.#stagePath(staged.id)));
  }

  async discard(staged: StagedObject): Promise<void> {
    await unlink(this.#stagePath(staged.id)).catch((cause: unknown) => {
      if (!hasCode(cause, 'ENOENT')) throw cause;
    });
  }

  async publishIfAbsent(
    staged: StagedObject,
    digest: string,
  ): Promise<PublishedObject> {
    this.#assertDigest(digest);
    await this.#ensureRoot();
    const source = this.#stagePath(staged.id);
    const target = this.#objectPath(digest);
    try {
      await link(source, target);
      await chmod(target, 0o600);
    } catch (cause) {
      if (!hasCode(cause, 'EEXIST')) throw cause;
    } finally {
      await unlink(source).catch((cause: unknown) => {
        if (!hasCode(cause, 'ENOENT')) throw cause;
      });
    }
    return { digest, storageUri: pathToFileURL(target).href };
  }

  async read(digest: string): Promise<Uint8Array> {
    this.#assertDigest(digest);
    return Uint8Array.from(await readFile(this.#objectPath(digest)));
  }

  async *listDigests(): AsyncIterable<string> {
    await this.#ensureRoot();
    const entries = await readdir(this.#objects, { withFileTypes: true });
    for (const entry of entries.sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      if (entry.isFile() && DIGEST.test(entry.name)) yield entry.name;
    }
  }

  async quarantine(digest: string, _reason: string): Promise<void> {
    void _reason;
    this.#assertDigest(digest);
    await this.#ensureRoot();
    const source = this.#objectPath(digest);
    const target = join(this.#quarantine, digest);
    try {
      await link(source, target);
      await chmod(target, 0o600);
    } catch (cause) {
      if (!hasCode(cause, 'EEXIST')) throw cause;
    }
    await unlink(source);
  }

  async inspectPermissions(): Promise<{
    readonly root: number;
    readonly objects: number;
    readonly staging: number;
    readonly quarantine: number;
  }> {
    await this.#ensureRoot();
    return {
      root: (await stat(this.#root)).mode & 0o777,
      objects: (await stat(this.#objects)).mode & 0o777,
      staging: (await stat(this.#staging)).mode & 0o777,
      quarantine: (await stat(this.#quarantine)).mode & 0o777,
    };
  }

  async #ensureRoot(): Promise<void> {
    await mkdir(this.#root, { recursive: true, mode: 0o700 });
    await chmod(this.#root, 0o700);
    for (const directory of [this.#objects, this.#staging, this.#quarantine]) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await chmod(directory, 0o700);
    }
  }

  #objectPath(digest: string): string {
    this.#assertDigest(digest);
    return join(this.#objects, digest);
  }

  #stagePath(id: string): string {
    if (!/^[0-9a-f-]{36}$/u.test(id)) {
      throw new ProductionCasError('INVALID_DIGEST', 'invalid staging id');
    }
    const path = resolve(this.#staging, id);
    if (!path.startsWith(`${this.#staging}${sep}`)) {
      throw new ProductionCasError('INVALID_DIGEST', 'invalid staging path');
    }
    return path;
  }

  #assertDigest(digest: string): void {
    if (!DIGEST.test(digest)) {
      throw new ProductionCasError('INVALID_DIGEST', digest);
    }
  }
}

function hasCode(value: unknown, code: string): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    value.code === code
  );
}
