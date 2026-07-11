import type { WorkflowSnapshot, WorkflowStore } from './types.js';

export class MemoryWorkflowStore implements WorkflowStore {
  #snapshot: WorkflowSnapshot = { executions: {}, schedules: {} };
  #queue: Promise<unknown> = Promise.resolve();

  public load(): Promise<WorkflowSnapshot> {
    return Promise.resolve(structuredClone(this.#snapshot));
  }

  public save(snapshot: WorkflowSnapshot): Promise<void> {
    return this.transact((current) => {
      current.executions = structuredClone(snapshot.executions);
      current.schedules = structuredClone(snapshot.schedules);
    });
  }

  public transact<T>(mutate: (snapshot: WorkflowSnapshot) => T): Promise<T> {
    const operation = this.#queue.then(() => {
      const draft = structuredClone(this.#snapshot);
      const result = mutate(draft);
      this.#snapshot = draft;
      return result;
    });
    this.#queue = operation.catch(() => undefined);
    return operation;
  }
}
