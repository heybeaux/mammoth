import { mkdir, open, readFile, rename } from 'node:fs/promises';
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
    const operation = this.#queue.then(async () => {
      const current = await this.read();
      const draft = structuredClone(current) as LedgerState;
      mutate(draft);
      draft.revision = current.revision + 1;
      result = validateLedgerState(draft);
      await this.#write(result);
    });
    this.#queue = operation.catch(() => undefined);
    await operation;
    if (!result)
      throw new Error('ledger transaction completed without a result');
    return result;
  }

  async #write(state: Readonly<LedgerState>): Promise<void> {
    const parent = dirname(this.#path);
    await mkdir(parent, { recursive: true });
    const temporary = `${this.#path}.${String(process.pid)}.tmp`;
    const file = await open(temporary, 'w', 0o600);
    try {
      await file.writeFile(`${canonicalJson(state)}\n`, 'utf8');
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, this.#path);
    const directory = await open(parent, 'r');
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}
