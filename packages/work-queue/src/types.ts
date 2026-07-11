export const WORK_QUEUES = [
  'research-control',
  'local-small',
  'local-large',
  'cloud-frontier',
  'retrieval',
  'experiment',
  'human-gate',
] as const;

export type WorkQueueName = (typeof WORK_QUEUES)[number];

export type WorkItemState =
  | 'queued'
  | 'leased'
  | 'succeeded'
  | 'dead-lettered'
  | 'cancelled';

export interface RetryPolicy {
  readonly maxAttempts: number;
  readonly initialDelayMs: number;
  readonly backoffCoefficient: number;
  readonly maxDelayMs: number;
}

export interface WorkItem<
  TKind extends string = string,
  TInput = unknown,
  TOutput = unknown,
> {
  readonly id: string;
  readonly programId: string;
  readonly kind: TKind;
  readonly queue: WorkQueueName;
  readonly input: TInput;
  readonly idempotencyKey: string;
  readonly priority: number;
  readonly retry: RetryPolicy;
  state: WorkItemState;
  attemptCount: number;
  availableAt: number;
  lease?: WorkLease;
  output?: TOutput;
  lastError?: WorkFailure;
  completedAt?: number;
}

export interface WorkLease {
  readonly token: string;
  readonly workerId: string;
  readonly acquiredAt: number;
  expiresAt: number;
}

export interface WorkFailure {
  readonly message: string;
  readonly retryable: boolean;
  readonly failedAt: number;
}

export interface EnqueueWork<TKind extends string, TInput> {
  readonly id: string;
  readonly programId: string;
  readonly kind: TKind;
  readonly queue: WorkQueueName;
  readonly input: TInput;
  readonly idempotencyKey: string;
  readonly priority?: number;
  readonly availableAt?: number;
  readonly retry?: Partial<RetryPolicy>;
}

export interface ClaimedWork<
  TKind extends string = string,
  TInput = unknown,
  TOutput = unknown,
> {
  readonly item: WorkItem<TKind, TInput, TOutput>;
  readonly leaseToken: string;
}

export interface WorkQueueSnapshot {
  readonly items: readonly WorkItem[];
  readonly leaseSequence: number;
}
