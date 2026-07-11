import { randomUUID } from 'node:crypto';
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  unlink,
} from 'node:fs/promises';
import { dirname } from 'node:path';
import { canonicalJson } from '@mammoth/domain';
import {
  emptyLedgerState,
  validateLedgerState,
  type EpistemicLedger,
  type LedgerState,
} from './ledger.js';

/**
 * A zero-service durable adapter for the local MVP. Commits are serialized and
 * use fsync + atomic rename; the port can later be implemented by Postgres.
 */
export class LocalJsonLedger implements EpistemicLedger {
  readonly #path: string;
  #queue: Promise<void> = Promise.resolve();

  public constructor(path: string) {
    this.#path = path;
  }

  public async read(): Promise<Readonly<LedgerState>> {
    try {
      return validateLedgerState(
        JSON.parse(await readFile(this.#path, 'utf8')),
      );
    } catch (error: unknown) {
      if (isMissingFile(error)) return emptyLedgerState();
      throw error;
    }
  }

  public async transact(
    mutate: (draft: LedgerState) => void,
  ): Promise<Readonly<LedgerState>> {
    let result: Readonly<LedgerState> | undefined;
    const operation = this.#queue.then(() =>
      this.#withLock(async () => {
        const current = await this.read();
        const draft = structuredClone(current) as LedgerState;
        mutate(draft);
        draft.revision = current.revision + 1;
        result = validateLedgerState(draft);
        await this.#write(result);
      }),
    );
    this.#queue = operation.catch(() => undefined);
    await operation;
    if (!result)
      throw new Error('ledger transaction completed without a result');
    return result;
  }

  async #write(state: Readonly<LedgerState>): Promise<void> {
    const parent = dirname(this.#path);
    await mkdir(parent, { recursive: true });
    const temporary = `${this.#path}.${String(process.pid)}.${randomUUID()}.tmp`;
    const file = await open(temporary, 'wx', 0o600);
    try {
      await file.writeFile(`${canonicalJson(state)}\n`, 'utf8');
      await file.sync();
      await file.close();
      await rename(temporary, this.#path);
    } catch (error: unknown) {
      await file.close().catch(() => undefined);
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
    const directory = await open(parent, 'r');
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }

  async #withLock<T>(operation: () => Promise<T>): Promise<T> {
    const lock = `${this.#path}.lock`;
    await mkdir(dirname(lock), { recursive: true });
    for (let attempt = 0; ; attempt += 1) {
      try {
        await mkdir(lock);
        break;
      } catch (error: unknown) {
        if (!hasCode(error, 'EEXIST')) throw error;
        let age: number;
        try {
          age = Date.now() - (await stat(lock)).mtimeMs;
        } catch (statError: unknown) {
          if (hasCode(statError, 'ENOENT')) continue;
          throw statError;
        }
        if (age > 30_000) {
          await rm(lock, { recursive: true }).catch(() => undefined);
          continue;
        }
        if (attempt >= 1_000) throw new Error('ledger store lock timeout');
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }
    try {
      return await operation();
    } finally {
      await rm(lock, { recursive: true });
    }
  }
}

function isMissingFile(error: unknown): boolean {
  return hasCode(error, 'ENOENT');
}

function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  );
}
