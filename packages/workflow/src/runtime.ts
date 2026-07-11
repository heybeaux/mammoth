import { randomUUID } from 'node:crypto';
import type {
  Clock,
  StepResult,
  WorkflowDefinition,
  WorkflowExecution,
  WorkflowSchedule,
  WorkflowSnapshot,
  WorkflowStatus,
  WorkflowStore,
} from './types.js';

const systemClock: Clock = { now: () => new Date() };
const terminal = new Set<WorkflowStatus>(['completed', 'failed', 'cancelled']);

export class WorkflowRuntime {
  readonly #store: WorkflowStore;
  readonly #clock: Clock;
  readonly #definitions = new Map<string, WorkflowDefinition>();
  #queue: Promise<unknown> = Promise.resolve();

  public constructor(store: WorkflowStore, clock: Clock = systemClock) {
    this.#store = store;
    this.#clock = clock;
  }

  public register<Input, Output>(
    definition: WorkflowDefinition<Input, Output>,
  ): this {
    if (definition.steps.length === 0)
      throw new Error('workflow requires at least one step');
    if (
      new Set(definition.steps.map((step) => step.id)).size !==
      definition.steps.length
    ) {
      throw new Error(`workflow ${definition.name} has duplicate step ids`);
    }
    this.#definitions.set(definition.name, definition as WorkflowDefinition);
    return this;
  }

  public start<Input>(
    workflow: string,
    input: Input,
    id: string = randomUUID(),
  ): Promise<WorkflowExecution<Input>> {
    return this.#serialized(async () => {
      const definition = this.#definition(workflow);
      const snapshot = await this.#store.load();
      if (snapshot.executions[id])
        throw new Error(`execution already exists: ${id}`);
      const now = this.#now();
      const execution: WorkflowExecution<Input> = {
        id,
        workflow,
        definitionVersion: definition.version,
        revision: 0,
        status: 'pending',
        input,
        stepIndex: 0,
        state: {},
        attempt: 0,
        createdAt: now,
        updatedAt: now,
      };
      snapshot.executions[id] = execution as WorkflowExecution;
      await this.#store.save(snapshot);
      return structuredClone(execution);
    });
  }

  public get(id: string): Promise<WorkflowExecution | undefined> {
    return this.#serialized(async () => {
      const value = (await this.#store.load()).executions[id];
      return value ? structuredClone(value) : undefined;
    });
  }

  public pause(id: string): Promise<void> {
    return this.#mutate(id, (execution) => {
      if (terminal.has(execution.status))
        throw new Error(`cannot pause ${execution.status} execution`);
      execution.state.__pausedFrom = execution.status;
      execution.status = 'paused';
    });
  }

  public resume(id: string): Promise<void> {
    return this.#mutate(id, (execution) => {
      if (execution.status !== 'paused')
        throw new Error('only paused executions may resume');
      const previous = execution.state.__pausedFrom;
      delete execution.state.__pausedFrom;
      execution.status =
        previous === 'waiting' && execution.wakeAt ? 'waiting' : 'pending';
    });
  }

  public cancel(id: string): Promise<void> {
    return this.#mutate(id, (execution) => {
      if (terminal.has(execution.status))
        throw new Error(`cannot cancel ${execution.status} execution`);
      execution.status = 'cancelled';
      delete execution.wakeAt;
    });
  }

  public schedule<Input>(schedule: WorkflowSchedule<Input>): Promise<void> {
    return this.#serialized(async () => {
      this.#definition(schedule.workflow);
      if (schedule.intervalMs !== undefined && schedule.intervalMs <= 0) {
        throw new Error('schedule interval must be positive');
      }
      requireTimestamp(schedule.nextRunAt);
      const snapshot = await this.#store.load();
      snapshot.schedules[schedule.id] = structuredClone(
        schedule,
      ) as WorkflowSchedule;
      await this.#store.save(snapshot);
    });
  }

  /** Starts due schedules and runs every runnable execution by one durable step. */
  public tick(): Promise<number> {
    return this.#serialized(async () => {
      await this.#fireSchedules();
      const snapshot = await this.#store.load();
      const now = this.#clock.now().getTime();
      const ids = Object.values(snapshot.executions)
        .filter(
          (execution) =>
            execution.status === 'pending' ||
            execution.status === 'running' ||
            (execution.status === 'waiting' &&
              Date.parse(execution.wakeAt ?? '') <= now),
        )
        .map((execution) => execution.id);
      for (const id of ids) await this.#runStep(id);
      return ids.length;
    });
  }

  public async runUntilIdle(maxTicks = 1_000): Promise<number> {
    let total = 0;
    for (let index = 0; index < maxTicks; index += 1) {
      const count = await this.tick();
      total += count;
      if (count === 0) return total;
    }
    throw new Error(`workflow runtime exceeded ${String(maxTicks)} ticks`);
  }

  async #runStep(id: string): Promise<void> {
    let snapshot = await this.#store.load();
    let execution = requiredExecution(snapshot, id);
    const definition = this.#definition(execution.workflow);
    if (definition.version !== execution.definitionVersion) {
      throw new Error(
        `workflow definition version unavailable: ${execution.workflow}@${String(execution.definitionVersion)}`,
      );
    }
    const step = definition.steps[execution.stepIndex];
    if (!step)
      throw new Error(
        `missing step ${String(execution.stepIndex)} for ${execution.workflow}`,
      );

    // A persisted `running` state means the process crashed after dispatch. Replaying
    // with the same idempotency key gives adapters at-least-once, crash-safe semantics.
    execution.status = 'running';
    execution.stepId = step.id;
    execution.attempt += 1;
    bump(execution, this.#now());
    await this.#store.save(snapshot);

    let result: StepResult;
    try {
      result = await step.execute({
        executionId: execution.id,
        input: execution.input,
        state: structuredClone(execution.state),
        idempotencyKey: `${execution.id}:${step.id}`,
        now: this.#now(),
      });
    } catch (error: unknown) {
      snapshot = await this.#store.load();
      execution = requiredExecution(snapshot, id);
      execution.status = 'failed';
      execution.error = error instanceof Error ? error.message : String(error);
      bump(execution, this.#now());
      await this.#store.save(snapshot);
      return;
    }

    snapshot = await this.#store.load();
    execution = requiredExecution(snapshot, id);
    execution.state = { ...execution.state, ...(result.state ?? {}) };
    delete execution.error;
    if (result.kind === 'complete') {
      execution.status = 'completed';
      execution.output = result.output;
      delete execution.wakeAt;
    } else if (result.kind === 'sleep') {
      requireTimestamp(result.until);
      execution.status = 'waiting';
      execution.wakeAt = result.until;
    } else {
      execution.stepIndex += 1;
      execution.status = 'pending';
      delete execution.wakeAt;
    }
    bump(execution, this.#now());
    await this.#store.save(snapshot);
  }

  async #fireSchedules(): Promise<void> {
    const snapshot = await this.#store.load();
    const now = this.#clock.now().getTime();
    let changed = false;
    for (const schedule of Object.values(snapshot.schedules)) {
      if (!schedule.enabled || Date.parse(schedule.nextRunAt) > now) continue;
      const id = `${schedule.id}:${schedule.nextRunAt}`;
      if (!snapshot.executions[id]) {
        const definition = this.#definition(schedule.workflow);
        const timestamp = this.#now();
        snapshot.executions[id] = {
          id,
          workflow: schedule.workflow,
          definitionVersion: definition.version,
          revision: 0,
          status: 'pending',
          input: structuredClone(schedule.input),
          stepIndex: 0,
          state: {},
          attempt: 0,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
      }
      if (schedule.intervalMs) {
        let next = Date.parse(schedule.nextRunAt);
        while (next <= now) next += schedule.intervalMs;
        schedule.nextRunAt = new Date(next).toISOString();
      } else {
        schedule.enabled = false;
      }
      changed = true;
    }
    if (changed) await this.#store.save(snapshot);
  }

  #mutate(
    id: string,
    mutate: (execution: WorkflowExecution) => void,
  ): Promise<void> {
    return this.#serialized(async () => {
      const snapshot = await this.#store.load();
      const execution = requiredExecution(snapshot, id);
      mutate(execution);
      bump(execution, this.#now());
      await this.#store.save(snapshot);
    });
  }

  #definition(name: string): WorkflowDefinition {
    const definition = this.#definitions.get(name);
    if (!definition) throw new Error(`workflow is not registered: ${name}`);
    return definition;
  }

  #now(): string {
    return this.#clock.now().toISOString();
  }

  #serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(operation, operation);
    this.#queue = result.catch(() => undefined);
    return result;
  }
}

function requiredExecution(
  snapshot: WorkflowSnapshot,
  id: string,
): WorkflowExecution {
  const execution = snapshot.executions[id];
  if (!execution) throw new Error(`execution not found: ${id}`);
  return execution;
}

function bump(execution: WorkflowExecution, now: string): void {
  execution.revision += 1;
  execution.updatedAt = now;
}

function requireTimestamp(value: string): void {
  if (!Number.isFinite(Date.parse(value)))
    throw new Error(`invalid timestamp: ${value}`);
}
