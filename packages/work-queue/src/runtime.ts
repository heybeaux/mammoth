import { InMemoryWorkQueue } from './queue.js';
import {
  InMemoryReceiptStore,
  type IdempotentExternalResult,
  type SideEffectReceipt,
} from './receipts.js';
import type { LocalWorkStateStore } from './local-state.js';
import type {
  CancelWork,
  ClaimedWork,
  EnqueueWork,
  WorkItem,
  WorkQueueName,
} from './types.js';

/**
 * Persists queue and receipt transitions as one authoritative state image.
 * A remote side effect still requires provider-side idempotency because no
 * local transaction can atomically commit with an external system.
 */
export class DurableWorkRuntime {
  readonly #store: LocalWorkStateStore;
  readonly #now: () => number;

  public constructor(store: LocalWorkStateStore, now: () => number = Date.now) {
    this.#store = store;
    this.#now = now;
  }

  public get queue(): InMemoryWorkQueue {
    return new InMemoryWorkQueue(this.#now, this.#store.load()?.queue);
  }

  public get receipts(): InMemoryReceiptStore {
    return new InMemoryReceiptStore(this.#store.load()?.receipts);
  }

  public enqueue<TKind extends string, TInput>(
    request: EnqueueWork<TKind, TInput>,
  ): WorkItem<TKind, TInput> {
    return this.#transition((queue) => queue.enqueue(request));
  }

  public claim(
    queue: WorkQueueName,
    workerId: string,
    leaseDurationMs: number,
  ): ClaimedWork | undefined {
    return this.#transition((state) =>
      state.claim(queue, workerId, leaseDurationMs),
    );
  }

  public heartbeat(
    id: string,
    leaseToken: string,
    leaseDurationMs: number,
  ): void {
    this.#transition((queue) => {
      queue.heartbeat(id, leaseToken, leaseDurationMs);
    });
  }

  public complete<TOutput>(
    id: string,
    leaseToken: string,
    output: TOutput,
  ): WorkItem<string, unknown, TOutput> {
    return this.#transition((queue) => queue.complete(id, leaseToken, output));
  }

  public fail(
    id: string,
    leaseToken: string,
    message: string,
    retryable = true,
  ): WorkItem {
    return this.#transition((queue) =>
      queue.fail(id, leaseToken, message, retryable),
    );
  }

  public cancel<TPartial>(
    id: string,
    cancellation: CancelWork<TPartial>,
  ): WorkItem {
    return this.#transition((queue) => queue.cancel(id, cancellation));
  }

  public async executeExactlyOnce<TResult>(options: {
    readonly idempotencyKey: string;
    readonly execute: (
      idempotencyKey: string,
    ) => Promise<IdempotentExternalResult<TResult>>;
  }): Promise<SideEffectReceipt<TResult> & { readonly state: 'completed' }> {
    const existing = this.receipts.get<TResult>(options.idempotencyKey);
    if (existing?.state === 'completed') return existing;
    this.#receiptTransition((receipts) =>
      receipts.begin(options.idempotencyKey, this.#now()),
    );
    const external = await options.execute(options.idempotencyKey);
    return this.#receiptTransition((receipts) =>
      receipts.complete(
        options.idempotencyKey,
        external.providerReceiptId,
        external.result,
        this.#now(),
      ),
    ) as SideEffectReceipt<TResult> & { readonly state: 'completed' };
  }

  #transition<T>(operation: (queue: InMemoryWorkQueue) => T): T {
    return this.#store.update((saved) => {
      const queue = new InMemoryWorkQueue(this.#now, saved?.queue);
      const result = operation(queue);
      return {
        result,
        state: {
          version: 1,
          queue: queue.snapshot(),
          receipts: saved?.receipts ?? [],
        },
      };
    });
  }

  #receiptTransition<T>(operation: (receipts: InMemoryReceiptStore) => T): T {
    return this.#store.update((saved) => {
      const receipts = new InMemoryReceiptStore(saved?.receipts);
      const result = operation(receipts);
      return {
        result,
        state: {
          version: 1,
          queue: saved?.queue ?? new InMemoryWorkQueue(this.#now).snapshot(),
          receipts: receipts.snapshot(),
        },
      };
    });
  }
}
