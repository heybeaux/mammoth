import type { WorkflowSnapshot, WorkflowStore } from './types.js';

export class MemoryWorkflowStore implements WorkflowStore {
  #snapshot: WorkflowSnapshot = { executions: {}, schedules: {} };

  public load(): Promise<WorkflowSnapshot> {
    return Promise.resolve(structuredClone(this.#snapshot));
  }

  public save(snapshot: WorkflowSnapshot): Promise<void> {
    this.#snapshot = structuredClone(snapshot);
    return Promise.resolve();
  }
}
