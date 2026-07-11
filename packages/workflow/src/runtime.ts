import { randomUUID } from 'node:crypto';
import type {
  Clock,
  StepResult,
  WorkflowCancellation,
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
  readonly #definitions = new Map<string, Map<number, WorkflowDefinition>>();
  readonly #latestVersions = new Map<string, number>();
  readonly #controllers = new Map<string, AbortController>();
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
    const versions =
      this.#definitions.get(definition.name) ??
      new Map<number, WorkflowDefinition>();
    if (versions.has(definition.version)) {
      throw new Error(
        `workflow definition already registered: ${definition.name}@${String(definition.version)}`,
      );
    }
    versions.set(definition.version, definition as WorkflowDefinition);
    this.#definitions.set(definition.name, versions);
    this.#latestVersions.set(
      definition.name,
      Math.max(
        this.#latestVersions.get(definition.name) ?? 0,
        definition.version,
      ),
    );
    return this;
  }

  public start<Input>(
    workflow: string,
    input: Input,
    id: string = randomUUID(),
  ): Promise<WorkflowExecution<Input>> {
    return this.#serialized(async () => {
      const definition = this.#definition(workflow);
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
      await this.#store.transact((snapshot) => {
        if (snapshot.executions[id])
          throw new Error(`execution already exists: ${id}`);
        snapshot.executions[id] = execution as WorkflowExecution;
      });
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

  public cancel(id: string, reason?: string): Promise<WorkflowCancellation> {
    this.#controllers.get(id)?.abort();
    return this.#serialized(() =>
      this.#store.transact((snapshot) => {
        const execution = requiredExecution(snapshot, id);
        if (execution.status === 'cancelled' && execution.cancellation) {
          return structuredClone(execution.cancellation);
        }
        if (terminal.has(execution.status))
          throw new Error(`cannot cancel ${execution.status} execution`);
        const now = this.#now();
        const cancellation: WorkflowCancellation = {
          requestedAt: now,
          completedAt: now,
          ...(reason === undefined ? {} : { reason }),
          partialState: structuredClone(execution.state),
        };
        execution.status = 'cancelled';
        execution.cancellation = cancellation;
        delete execution.wakeAt;
        delete execution.runToken;
        bump(execution, now);
        return structuredClone(cancellation);
      }),
    );
  }

  public schedule<Input>(schedule: WorkflowSchedule<Input>): Promise<void> {
    return this.#serialized(async () => {
      this.#definition(schedule.workflow);
      if (schedule.intervalMs !== undefined && schedule.intervalMs <= 0) {
        throw new Error('schedule interval must be positive');
      }
      requireTimestamp(schedule.nextRunAt);
      await this.#store.transact((snapshot) => {
        snapshot.schedules[schedule.id] = structuredClone(
          schedule,
        ) as WorkflowSchedule;
      });
    });
  }

  /** Starts due schedules and runs every runnable execution by one durable step. */
  public async tick(): Promise<number> {
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
    const token = randomUUID();
    const claimed = await this.#store.transact((snapshot) => {
      const execution = requiredExecution(snapshot, id);
      if (terminal.has(execution.status) || execution.status === 'paused')
        return;
      const definition = this.#definition(
        execution.workflow,
        execution.definitionVersion,
      );
      const step = definition.steps[execution.stepIndex];
      if (!step)
        throw new Error(
          `missing step ${String(execution.stepIndex)} for ${execution.workflow}`,
        );
      // A new token fences a process that returns after another runtime replayed it.
      execution.status = 'running';
      execution.runToken = token;
      execution.stepId = step.id;
      execution.attempt += 1;
      bump(execution, this.#now());
      return {
        step,
        input: structuredClone(execution.input),
        state: structuredClone(execution.state),
      };
    });
    if (!claimed) return;
    const controller = new AbortController();
    this.#controllers.set(id, controller);

    let result: StepResult;
    try {
      result = await claimed.step.execute({
        executionId: id,
        input: claimed.input,
        state: claimed.state,
        idempotencyKey: `${id}:${claimed.step.id}`,
        now: this.#now(),
        signal: controller.signal,
      });
    } catch (error: unknown) {
      await this.#store.transact((snapshot) => {
        const execution = requiredExecution(snapshot, id);
        if (execution.runToken !== token) return;
        execution.status = controller.signal.aborted ? 'cancelled' : 'failed';
        if (controller.signal.aborted) {
          const now = this.#now();
          execution.cancellation ??= {
            requestedAt: now,
            completedAt: now,
            partialState: structuredClone(execution.state),
          };
        } else {
          execution.error =
            error instanceof Error ? error.message : String(error);
        }
        delete execution.runToken;
        bump(execution, this.#now());
      });
      this.#controllers.delete(id);
      return;
    }

    await this.#store.transact((snapshot) => {
      const execution = requiredExecution(snapshot, id);
      if (execution.runToken !== token || execution.status === 'cancelled')
        return;
      execution.state = { ...execution.state, ...(result.state ?? {}) };
      delete execution.error;
      delete execution.runToken;
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
    });
    this.#controllers.delete(id);
  }

  async #fireSchedules(): Promise<void> {
    const now = this.#clock.now().getTime();
    const current = await this.#store.load();
    if (
      !Object.values(current.schedules).some(
        (schedule) => schedule.enabled && Date.parse(schedule.nextRunAt) <= now,
      )
    ) {
      return;
    }
    await this.#store.transact((snapshot) => {
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
      }
    });
  }

  #mutate(
    id: string,
    mutate: (execution: WorkflowExecution) => void,
  ): Promise<void> {
    return this.#serialized(async () => {
      await this.#store.transact((snapshot) => {
        const execution = requiredExecution(snapshot, id);
        mutate(execution);
        bump(execution, this.#now());
      });
    });
  }

  #definition(name: string, version?: number): WorkflowDefinition {
    const selected = version ?? this.#latestVersions.get(name);
    const definition = selected
      ? this.#definitions.get(name)?.get(selected)
      : undefined;
    if (!definition) {
      throw new Error(
        version === undefined
          ? `workflow is not registered: ${name}`
          : `workflow definition version unavailable: ${name}@${String(version)}`,
      );
    }
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
