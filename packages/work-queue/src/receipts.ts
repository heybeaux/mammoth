export type SideEffectReceipt<TResult = unknown> =
  | {
      readonly idempotencyKey: string;
      readonly state: 'started';
      readonly startedAt: number;
    }
  | {
      readonly idempotencyKey: string;
      readonly state: 'completed';
      readonly startedAt: number;
      readonly completedAt: number;
      readonly providerReceiptId: string;
      readonly result: TResult;
    };

export class InMemoryReceiptStore {
  readonly #receipts = new Map<string, SideEffectReceipt>();

  public constructor(snapshot: readonly SideEffectReceipt[] = []) {
    for (const receipt of snapshot) {
      this.#receipts.set(receipt.idempotencyKey, structuredClone(receipt));
    }
  }

  public get<TResult>(
    idempotencyKey: string,
  ): SideEffectReceipt<TResult> | undefined {
    const receipt = this.#receipts.get(idempotencyKey);
    return receipt === undefined
      ? undefined
      : (structuredClone(receipt) as SideEffectReceipt<TResult>);
  }

  public begin(idempotencyKey: string, now: number): SideEffectReceipt {
    const existing = this.#receipts.get(idempotencyKey);
    if (existing) return structuredClone(existing);
    const receipt: SideEffectReceipt = {
      idempotencyKey,
      state: 'started',
      startedAt: now,
    };
    this.#receipts.set(idempotencyKey, receipt);
    return structuredClone(receipt);
  }

  public complete<TResult>(
    idempotencyKey: string,
    providerReceiptId: string,
    result: TResult,
    now: number,
  ): SideEffectReceipt<TResult> {
    const existing = this.#receipts.get(idempotencyKey);
    if (existing?.state === 'completed')
      return structuredClone(existing) as SideEffectReceipt<TResult>;
    if (!existing)
      throw new Error(`side effect was not started: ${idempotencyKey}`);
    const receipt: SideEffectReceipt<TResult> = {
      idempotencyKey,
      state: 'completed',
      startedAt: existing.startedAt,
      completedAt: now,
      providerReceiptId,
      result: structuredClone(result),
    };
    this.#receipts.set(idempotencyKey, receipt);
    return structuredClone(receipt);
  }

  public snapshot(): SideEffectReceipt[] {
    return [...this.#receipts.values()].map((receipt) =>
      structuredClone(receipt),
    );
  }
}

export interface IdempotentExternalResult<TResult> {
  readonly providerReceiptId: string;
  readonly result: TResult;
}

/**
 * Executes a side effect with a stable provider idempotency key. Exactly-once
 * effects require the provider callback to persist/deduplicate that key; a
 * local receipt alone cannot close the crash window after a remote commit.
 */
export async function executeExactlyOnce<TResult>(options: {
  readonly idempotencyKey: string;
  readonly receipts: InMemoryReceiptStore;
  readonly execute: (
    idempotencyKey: string,
  ) => Promise<IdempotentExternalResult<TResult>>;
  readonly now?: () => number;
}): Promise<SideEffectReceipt<TResult> & { readonly state: 'completed' }> {
  const existing = options.receipts.get<TResult>(options.idempotencyKey);
  if (existing?.state === 'completed') return existing;
  const now = options.now ?? Date.now;
  options.receipts.begin(options.idempotencyKey, now());
  const external = await options.execute(options.idempotencyKey);
  return options.receipts.complete(
    options.idempotencyKey,
    external.providerReceiptId,
    external.result,
    now(),
  ) as SideEffectReceipt<TResult> & {
    readonly state: 'completed';
  };
}
