import type {
  ClaimedWork,
  CancelWork,
  EnqueueWork,
  RetryPolicy,
  WorkFailure,
  WorkItem,
  WorkQueueName,
  WorkQueueSnapshot,
} from './types.js';

const DEFAULT_RETRY: RetryPolicy = {
  maxAttempts: 5,
  initialDelayMs: 1_000,
  backoffCoefficient: 2,
  maxDelayMs: 60_000,
};

export class LeaseConflictError extends Error {}

export class InMemoryWorkQueue {
  readonly #items = new Map<string, WorkItem>();
  readonly #idempotencyIndex = new Map<string, string>();
  readonly #now: () => number;
  #leaseSequence = 0;

  public constructor(
    now: () => number = Date.now,
    snapshot?: WorkQueueSnapshot,
  ) {
    this.#now = now;
    if (snapshot) {
      this.#leaseSequence = snapshot.leaseSequence;
      for (const saved of snapshot.items) {
        const item = structuredClone(saved);
        this.#items.set(item.id, item);
        this.#idempotencyIndex.set(item.idempotencyKey, item.id);
      }
    }
  }

  public enqueue<TKind extends string, TInput>(
    request: EnqueueWork<TKind, TInput>,
  ): WorkItem<TKind, TInput> {
    const duplicateId = this.#idempotencyIndex.get(request.idempotencyKey);
    if (duplicateId) return this.get(duplicateId) as WorkItem<TKind, TInput>;
    if (this.#items.has(request.id))
      throw new Error(`work item already exists: ${request.id}`);

    const retry: RetryPolicy = { ...DEFAULT_RETRY, ...request.retry };
    if (retry.maxAttempts < 1)
      throw new Error('maxAttempts must be at least one');
    const item: WorkItem<TKind, TInput> = {
      id: request.id,
      programId: request.programId,
      kind: request.kind,
      queue: request.queue,
      input: request.input,
      idempotencyKey: request.idempotencyKey,
      priority: request.priority ?? 0,
      retry,
      state: 'queued',
      attemptCount: 0,
      availableAt: request.availableAt ?? this.#now(),
    };
    this.#items.set(item.id, item);
    this.#idempotencyIndex.set(item.idempotencyKey, item.id);
    return structuredClone(item);
  }

  public claim(
    queue: WorkQueueName,
    workerId: string,
    leaseDurationMs: number,
  ): ClaimedWork | undefined {
    if (leaseDurationMs <= 0)
      throw new Error('leaseDurationMs must be positive');
    const now = this.#now();
    const candidate = [...this.#items.values()]
      .filter(
        (item) =>
          item.queue === queue &&
          item.availableAt <= now &&
          (item.state === 'queued' ||
            (item.state === 'leased' &&
              item.lease !== undefined &&
              item.lease.expiresAt <= now)),
      )
      .sort(
        (left, right) =>
          right.priority - left.priority ||
          left.availableAt - right.availableAt ||
          left.id.localeCompare(right.id),
      )[0];
    if (!candidate) return undefined;

    candidate.attemptCount += 1;
    candidate.state = 'leased';
    const token = `${candidate.id}:lease:${String(++this.#leaseSequence)}`;
    candidate.lease = {
      token,
      workerId,
      acquiredAt: now,
      expiresAt: now + leaseDurationMs,
    };
    return { item: structuredClone(candidate), leaseToken: token };
  }

  public heartbeat(
    id: string,
    leaseToken: string,
    leaseDurationMs: number,
  ): void {
    if (leaseDurationMs <= 0)
      throw new Error('leaseDurationMs must be positive');
    const item = this.#requireLease(id, leaseToken);
    const lease = item.lease;
    if (!lease)
      throw new LeaseConflictError(
        `lease is no longer valid for work item: ${id}`,
      );
    lease.expiresAt = this.#now() + leaseDurationMs;
  }

  public complete<TOutput>(
    id: string,
    leaseToken: string,
    output: TOutput,
  ): WorkItem<string, unknown, TOutput> {
    const item = this.#requireLease(id, leaseToken) as WorkItem<
      string,
      unknown,
      TOutput
    >;
    item.state = 'succeeded';
    item.output = structuredClone(output);
    item.completedAt = this.#now();
    delete item.lease;
    return structuredClone(item);
  }

  public fail(
    id: string,
    leaseToken: string,
    message: string,
    retryable = true,
  ): WorkItem {
    const item = this.#requireLease(id, leaseToken);
    const now = this.#now();
    const failure: WorkFailure = { message, retryable, failedAt: now };
    item.lastError = failure;
    delete item.lease;
    if (!retryable || item.attemptCount >= item.retry.maxAttempts) {
      item.state = 'dead-lettered';
      item.completedAt = now;
    } else {
      item.state = 'queued';
      const exponent = Math.max(0, item.attemptCount - 1);
      item.availableAt =
        now +
        Math.min(
          item.retry.initialDelayMs * item.retry.backoffCoefficient ** exponent,
          item.retry.maxDelayMs,
        );
    }
    return structuredClone(item);
  }

  public cancel<TPartial>(
    id: string,
    cancellation: CancelWork<TPartial>,
  ): WorkItem {
    const item = this.#required(id);
    if (
      item.state === 'succeeded' ||
      item.state === 'dead-lettered' ||
      item.state === 'cancelled'
    )
      return structuredClone(item);
    if (cancellation.receiptId.trim().length === 0)
      throw new Error('cancellation receipt id is required');
    if (cancellation.reason.trim().length === 0)
      throw new Error('cancellation reason is required');
    item.state = 'cancelled';
    item.completedAt = this.#now();
    item.cancellation = {
      receiptId: cancellation.receiptId,
      reason: cancellation.reason,
      cancelledAt: item.completedAt,
      ...(cancellation.partialOutput === undefined
        ? {}
        : { partialOutput: structuredClone(cancellation.partialOutput) }),
    };
    delete item.lease;
    return structuredClone(item);
  }

  public get(id: string): WorkItem {
    return structuredClone(this.#required(id));
  }

  public list(): WorkItem[] {
    return [...this.#items.values()].map((item) => structuredClone(item));
  }

  public snapshot(): WorkQueueSnapshot {
    return { items: this.list(), leaseSequence: this.#leaseSequence };
  }

  #required(id: string): WorkItem {
    const item = this.#items.get(id);
    if (!item) throw new Error(`unknown work item: ${id}`);
    return item;
  }

  #requireLease(id: string, token: string): WorkItem {
    const item = this.#required(id);
    if (
      item.state !== 'leased' ||
      item.lease?.token !== token ||
      item.lease.expiresAt <= this.#now()
    ) {
      throw new LeaseConflictError(
        `lease is no longer valid for work item: ${id}`,
      );
    }
    return item;
  }
}
