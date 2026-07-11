import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

import type { SideEffectReceipt } from './receipts.js';
import type { WorkQueueSnapshot } from './types.js';

export interface DurableWorkState {
  readonly version: 1;
  readonly queue: WorkQueueSnapshot;
  readonly receipts: readonly SideEffectReceipt[];
}

/** Persistence boundary for local files or a transactional production adapter. */
export interface WorkStateStore {
  load(): DurableWorkState | undefined;
  save(state: DurableWorkState): void;
  update<T>(
    operation: (state: DurableWorkState | undefined) => {
      readonly state: DurableWorkState;
      readonly result: T;
    },
  ): T;
}

/** Atomic JSON persistence with file and parent-directory fsync. */
export class LocalWorkStateStore implements WorkStateStore {
  readonly #path: string;

  public constructor(path: string) {
    this.#path = path;
  }

  public load(): DurableWorkState | undefined {
    try {
      return JSON.parse(readFileSync(this.#path, 'utf8')) as DurableWorkState;
    } catch (error: unknown) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }

  public save(state: DurableWorkState): void {
    this.#withLock(() => {
      this.#saveUnlocked(state);
    });
  }

  /** Serializes a fresh read/modify/write transition across local processes. */
  public update<T>(
    operation: (state: DurableWorkState | undefined) => {
      readonly state: DurableWorkState;
      readonly result: T;
    },
  ): T {
    return this.#withLock(() => {
      const transition = operation(this.load());
      this.#saveUnlocked(transition.state);
      return transition.result;
    });
  }

  #saveUnlocked(state: DurableWorkState): void {
    const directory = dirname(this.#path);
    mkdirSync(directory, { recursive: true });
    const temporaryPath = `${this.#path}.${String(process.pid)}.${crypto.randomUUID()}.tmp`;
    const descriptor = openSync(temporaryPath, 'wx', 0o600);
    try {
      writeFileSync(descriptor, `${JSON.stringify(state)}\n`, 'utf8');
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    renameSync(temporaryPath, this.#path);
    const directoryDescriptor = openSync(directory, 'r');
    try {
      fsyncSync(directoryDescriptor);
    } finally {
      closeSync(directoryDescriptor);
    }
  }

  #withLock<T>(operation: () => T): T {
    const lockPath = `${this.#path}.lock`;
    const ownerPath = `${lockPath}/owner`;
    const ownerToken = `${String(process.pid)}:${crypto.randomUUID()}`;
    mkdirSync(dirname(this.#path), { recursive: true });
    const deadline = Date.now() + 10_000;
    for (;;) {
      try {
        mkdirSync(lockPath, { mode: 0o700 });
        const descriptor = openSync(ownerPath, 'wx', 0o600);
        try {
          writeFileSync(descriptor, `${ownerToken}\n`, 'utf8');
          fsyncSync(descriptor);
        } finally {
          closeSync(descriptor);
        }
        break;
      } catch (error: unknown) {
        if (!isAlreadyExists(error)) throw error;
        if (removeStaleLock(lockPath, ownerPath)) continue;
        if (Date.now() >= deadline) {
          throw new Error(`timed out acquiring work-state lock: ${lockPath}`);
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
    }
    try {
      return operation();
    } finally {
      if (readOwner(ownerPath) === ownerToken) {
        rmSync(lockPath, { recursive: true, force: true });
      }
    }
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

function isAlreadyExists(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'EEXIST'
  );
}

function removeStaleLock(path: string, ownerPath: string): boolean {
  let owner: number;
  let token: string;
  try {
    token = readFileSync(ownerPath, 'utf8').trim();
    owner = Number.parseInt(token.split(':', 1)[0] ?? '', 10);
  } catch (error: unknown) {
    // A newly-created lock directory may not have its owner record yet.
    if (isNotFound(error)) {
      try {
        if (Date.now() - statSync(path).mtimeMs <= 1_000) return false;
        return reclaimLock(path, ownerPath, undefined);
      } catch (statError: unknown) {
        return isNotFound(statError);
      }
    }
    return false;
  }
  if (Number.isInteger(owner) && owner > 0) {
    try {
      process.kill(owner, 0);
      return false;
    } catch (error: unknown) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? error.code
          : undefined;
      if (code === 'EPERM') return false;
      if (code !== 'ESRCH') return false;
    }
  }
  try {
    return reclaimLock(path, ownerPath, token);
  } catch (error: unknown) {
    return isNotFound(error);
  }
}

function reclaimLock(
  path: string,
  ownerPath: string,
  expectedOwner: string | undefined,
): boolean {
  if (readOwner(ownerPath) !== expectedOwner) return false;
  const quarantine = `${path}.stale.${String(process.pid)}.${crypto.randomUUID()}`;
  try {
    renameSync(path, quarantine);
  } catch (error: unknown) {
    if (isNotFound(error)) return true;
    return false;
  }
  rmSync(quarantine, { recursive: true, force: true });
  return true;
}

function readOwner(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8').trim();
  } catch (error: unknown) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}
