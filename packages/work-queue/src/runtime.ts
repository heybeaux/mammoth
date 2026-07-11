import { InMemoryWorkQueue } from './queue.js';
import {
  InMemoryReceiptStore,
  type IdempotentExternalResult,
  type SideEffectReceipt,
} from './receipts.js';
import type { LocalWorkStateStore } from './local-state.js';
import type {
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
  public readonly queue: InMemoryWorkQueue;
  public readonly receipts: InMemoryReceiptStore;
  readonly #store: LocalWorkStateStore;
  readonly #now: () => number;

  public constructor(store: LocalWorkStateStore, now: () => number = Date.now) {
    this.#store = store;
    this.#now = now;
    const saved = store.load();
    this.queue = new InMemoryWorkQueue(now, saved?.queue);
    this.receipts = new InMemoryReceiptStore(saved?.receipts);
  }

  public enqueue<TKind extends string, TInput>(
    request: EnqueueWork<TKind, TInput>,
  ): WorkItem<TKind, TInput> {
    const item = this.queue.enqueue(request);
    this.#persist();
    return item;
  }

  public claim(
    queue: WorkQueueName,
    workerId: string,
    leaseDurationMs: number,
  ): ClaimedWork | undefined {
    const claimed = this.queue.claim(queue, workerId, leaseDurationMs);
    if (claimed) this.#persist();
    return claimed;
  }

  public heartbeat(
    id: string,
    leaseToken: string,
    leaseDurationMs: number,
  ): void {
    this.queue.heartbeat(id, leaseToken, leaseDurationMs);
    this.#persist();
  }

  public complete<TOutput>(
    id: string,
    leaseToken: string,
    output: TOutput,
  ): WorkItem<string, unknown, TOutput> {
    const item = this.queue.complete(id, leaseToken, output);
    this.#persist();
    return item;
  }

  public fail(
    id: string,
    leaseToken: string,
    message: string,
    retryable = true,
  ): WorkItem {
    const item = this.queue.fail(id, leaseToken, message, retryable);
    this.#persist();
    return item;
  }

  public cancel(id: string): WorkItem {
    const item = this.queue.cancel(id);
    this.#persist();
    return item;
  }

  public async executeExactlyOnce<TResult>(options: {
    readonly idempotencyKey: string;
    readonly execute: (
      idempotencyKey: string,
    ) => Promise<IdempotentExternalResult<TResult>>;
  }): Promise<SideEffectReceipt<TResult> & { readonly state: 'completed' }> {
    const existing = this.receipts.get<TResult>(options.idempotencyKey);
    if (existing?.state === 'completed') return existing;
    this.receipts.begin(options.idempotencyKey, this.#now());
    this.#persist();
    const external = await options.execute(options.idempotencyKey);
    const receipt = this.receipts.complete(
      options.idempotencyKey,
      external.providerReceiptId,
      external.result,
      this.#now(),
    ) as SideEffectReceipt<TResult> & { readonly state: 'completed' };
    this.#persist();
    return receipt;
  }

  #persist(): void {
    this.#store.save({
      version: 1,
      queue: this.queue.snapshot(),
      receipts: this.receipts.snapshot(),
    });
  }
}
