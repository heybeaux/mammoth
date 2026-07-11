import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
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

/** Atomic JSON persistence with file and parent-directory fsync. */
export class LocalWorkStateStore {
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
    const directory = dirname(this.#path);
    mkdirSync(directory, { recursive: true });
    const temporaryPath = `${this.#path}.tmp`;
    const descriptor = openSync(temporaryPath, 'w', 0o600);
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
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}
