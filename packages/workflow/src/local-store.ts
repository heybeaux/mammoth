import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { WorkflowSnapshot, WorkflowStore } from './types.js';

const emptySnapshot = (): WorkflowSnapshot => ({
  executions: {},
  schedules: {},
});

/** Atomic, fsync-backed zero-service store for local development and the MVP. */
export class LocalWorkflowStore implements WorkflowStore {
  readonly #path: string;
  #queue: Promise<void> = Promise.resolve();

  public constructor(path: string) {
    this.#path = path;
  }

  public async load(): Promise<WorkflowSnapshot> {
    try {
      return validateSnapshot(JSON.parse(await readFile(this.#path, 'utf8')));
    } catch (error: unknown) {
      if (isMissing(error)) return emptySnapshot();
      throw error;
    }
  }

  public async save(snapshot: WorkflowSnapshot): Promise<void> {
    const operation = this.#queue.then(() => this.#write(snapshot));
    this.#queue = operation.catch(() => undefined);
    await operation;
  }

  async #write(snapshot: WorkflowSnapshot): Promise<void> {
    const parent = dirname(this.#path);
    await mkdir(parent, { recursive: true });
    // A UUID avoids two store instances in one process sharing the same temp
    // path. `wx` also prevents an unlikely collision from truncating a writer.
    const temporary = `${this.#path}.${String(process.pid)}.${randomUUID()}.tmp`;
    const file = await open(temporary, 'wx', 0o600);
    try {
      await file.writeFile(`${JSON.stringify(snapshot)}\n`, 'utf8');
      await file.sync();
      await file.close();
      await rename(temporary, this.#path);
    } catch (error: unknown) {
      await file.close().catch(() => undefined);
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
    const directory = await open(parent, 'r');
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }
}

const statuses = new Set([
  'pending',
  'running',
  'waiting',
  'paused',
  'completed',
  'failed',
  'cancelled',
]);

function validateSnapshot(value: unknown): WorkflowSnapshot {
  if (
    !isRecord(value) ||
    !isRecord(value.executions) ||
    !isRecord(value.schedules)
  ) {
    throw new Error(
      'invalid workflow snapshot: expected executions and schedules records',
    );
  }
  for (const [id, execution] of Object.entries(value.executions)) {
    if (
      !isRecord(execution) ||
      execution.id !== id ||
      typeof execution.workflow !== 'string' ||
      typeof execution.definitionVersion !== 'number' ||
      typeof execution.revision !== 'number' ||
      typeof execution.status !== 'string' ||
      !statuses.has(execution.status) ||
      typeof execution.stepIndex !== 'number' ||
      !isRecord(execution.state) ||
      typeof execution.attempt !== 'number' ||
      typeof execution.createdAt !== 'string' ||
      typeof execution.updatedAt !== 'string'
    ) {
      throw new Error(`invalid workflow snapshot execution: ${id}`);
    }
  }
  for (const [id, schedule] of Object.entries(value.schedules)) {
    if (
      !isRecord(schedule) ||
      schedule.id !== id ||
      typeof schedule.workflow !== 'string' ||
      typeof schedule.nextRunAt !== 'string' ||
      typeof schedule.enabled !== 'boolean' ||
      (schedule.intervalMs !== undefined &&
        typeof schedule.intervalMs !== 'number')
    ) {
      throw new Error(`invalid workflow snapshot schedule: ${id}`);
    }
  }
  return value as unknown as WorkflowSnapshot;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}
