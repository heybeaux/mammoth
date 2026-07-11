export type WorkflowStatus =
  | 'pending'
  | 'running'
  | 'waiting'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface WorkflowExecution<Input = unknown, Output = unknown> {
  id: string;
  workflow: string;
  definitionVersion: number;
  revision: number;
  status: WorkflowStatus;
  input: Input;
  output?: Output;
  stepIndex: number;
  stepId?: string;
  state: Record<string, unknown>;
  attempt: number;
  wakeAt?: string;
  error?: string;
  /** Fences stale workers when an execution is replayed after interruption. */
  runToken?: string;
  cancellation?: WorkflowCancellation;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowCancellation {
  requestedAt: string;
  completedAt: string;
  reason?: string;
  /** Honest, inspectable progress captured before cancellation. */
  partialState: Record<string, unknown>;
}

export interface StepContext<Input> {
  executionId: string;
  input: Input;
  state: Readonly<Record<string, unknown>>;
  /** Stable across crash retries. Use this for downstream idempotency. */
  idempotencyKey: string;
  now: string;
  /** Cooperative cancellation for in-process activities. Durable fencing remains authoritative. */
  signal: AbortSignal;
}

export type StepResult<Output = unknown> =
  | { kind: 'advance'; state?: Record<string, unknown> }
  | { kind: 'sleep'; until: string; state?: Record<string, unknown> }
  | { kind: 'complete'; output: Output; state?: Record<string, unknown> };

export interface WorkflowStep<Input, Output> {
  id: string;
  execute(
    context: StepContext<Input>,
  ): Promise<StepResult<Output>> | StepResult<Output>;
}

export interface WorkflowDefinition<Input = unknown, Output = unknown> {
  name: string;
  version: number;
  steps: readonly WorkflowStep<Input, Output>[];
}

export interface WorkflowSchedule<Input = unknown> {
  id: string;
  workflow: string;
  input: Input;
  nextRunAt: string;
  intervalMs?: number;
  enabled: boolean;
}

export interface WorkflowSnapshot {
  executions: Record<string, WorkflowExecution>;
  schedules: Record<string, WorkflowSchedule>;
}

/** Persistence boundary intended for local, SQL, or Temporal-backed adapters. */
export interface WorkflowStore {
  load(): Promise<WorkflowSnapshot>;
  save(snapshot: WorkflowSnapshot): Promise<void>;
  /** Atomic read-modify-write boundary used by runtimes sharing one store. */
  transact<T>(mutate: (snapshot: WorkflowSnapshot) => T): Promise<T>;
}

export interface Clock {
  now(): Date;
}
