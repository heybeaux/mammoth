import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  LocalWorkflowStore,
  MemoryWorkflowStore,
  WorkflowRuntime,
  type Clock,
  type WorkflowDefinition,
  type WorkflowSnapshot,
  type WorkflowStore,
} from '../src/index.js';

const directories: string[] = [];
afterEach(async () =>
  Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true })),
  ),
);

const definition: WorkflowDefinition<{ value: number }, number> = {
  name: 'research',
  version: 1,
  steps: [
    {
      id: 'collect',
      execute: ({ input }) => ({
        kind: 'advance',
        state: { collected: input.value * 2 },
      }),
    },
    {
      id: 'publish',
      execute: ({ state }) => ({
        kind: 'complete',
        output: state.collected as number,
      }),
    },
  ],
};

describe('WorkflowRuntime', () => {
  it('executes a typed multi-step workflow durably', async () => {
    const runtime = new WorkflowRuntime(new MemoryWorkflowStore()).register(
      definition,
    );
    await runtime.start('research', { value: 4 }, 'run-1');
    expect(await runtime.runUntilIdle()).toBe(2);
    expect(await runtime.get('run-1')).toMatchObject({
      status: 'completed',
      output: 8,
      stepIndex: 1,
      state: { collected: 8 },
    });
  });

  it('persists timers and respects pause, resume, and cancel', async () => {
    const clock = new MutableClock('2026-01-01T00:00:00.000Z');
    const sleepy: WorkflowDefinition = {
      name: 'sleepy',
      version: 1,
      steps: [
        {
          id: 'wait',
          execute: () => ({ kind: 'sleep', until: '2026-01-02T00:00:00.000Z' }),
        },
      ],
    };
    const runtime = new WorkflowRuntime(
      new MemoryWorkflowStore(),
      clock,
    ).register(sleepy);
    await runtime.start('sleepy', {}, 'sleep-1');
    await runtime.tick();
    expect((await runtime.get('sleep-1'))?.status).toBe('waiting');
    expect(await runtime.tick()).toBe(0);
    await runtime.pause('sleep-1');
    clock.set('2026-01-03T00:00:00.000Z');
    expect(await runtime.tick()).toBe(0);
    await runtime.resume('sleep-1');
    expect(await runtime.tick()).toBe(1);
    await runtime.cancel('sleep-1');
    expect((await runtime.get('sleep-1'))?.status).toBe('cancelled');
  });

  it('survives a fresh runtime without duplicating a provider-idempotent effect', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mammoth-workflow-'));
    directories.push(directory);
    const path = join(directory, 'state.json');
    const local = new LocalWorkflowStore(path);
    const crashing = new FailOnSaveStore(local, 3);
    const provider = new IdempotentProvider();
    let handlerCalls = 0;
    const single: WorkflowDefinition = {
      name: 'single',
      version: 1,
      steps: [
        {
          id: 'effect',
          execute: ({ idempotencyKey }) => {
            handlerCalls += 1;
            const receipt = provider.charge(idempotencyKey);
            return { kind: 'complete', output: receipt };
          },
        },
      ],
    };

    const firstProcess = new WorkflowRuntime(crashing).register(single);
    await firstProcess.start('single', {}, 'crash-1');
    await expect(firstProcess.tick()).rejects.toThrow('simulated process loss');
    expect((await local.load()).executions['crash-1']?.status).toBe('running');

    const restarted = new WorkflowRuntime(
      new LocalWorkflowStore(path),
    ).register(single);
    await restarted.runUntilIdle();
    expect(await restarted.get('crash-1')).toMatchObject({
      status: 'completed',
      output: 'receipt-1',
    });
    expect(handlerCalls).toBe(2);
    expect(provider.effectCount).toBe(1);
  });

  it('fires one-shot and recurring durable schedules without duplicate runs', async () => {
    const clock = new MutableClock('2026-01-01T00:00:00.000Z');
    const store = new MemoryWorkflowStore();
    const runtime = new WorkflowRuntime(store, clock).register(definition);
    await runtime.schedule({
      id: 'daily',
      workflow: 'research',
      input: { value: 2 },
      nextRunAt: clock.now().toISOString(),
      intervalMs: 86_400_000,
      enabled: true,
    });
    await runtime.runUntilIdle();
    expect(Object.values((await store.load()).executions)).toHaveLength(1);
    await runtime.runUntilIdle();
    expect(Object.values((await store.load()).executions)).toHaveLength(1);
    clock.set('2026-01-02T00:00:00.000Z');
    await runtime.runUntilIdle();
    expect(Object.values((await store.load()).executions)).toHaveLength(2);
  });
});

class MutableClock implements Clock {
  #date: Date;
  public constructor(value: string) {
    this.#date = new Date(value);
  }
  public now(): Date {
    return new Date(this.#date);
  }
  public set(value: string): void {
    this.#date = new Date(value);
  }
}

class FailOnSaveStore implements WorkflowStore {
  #count = 0;
  public constructor(
    private readonly delegate: WorkflowStore,
    private readonly failAt: number,
  ) {}
  public load(): Promise<WorkflowSnapshot> {
    return this.delegate.load();
  }
  public async save(snapshot: WorkflowSnapshot): Promise<void> {
    this.#count += 1;
    if (this.#count === this.failAt) throw new Error('simulated process loss');
    await this.delegate.save(snapshot);
  }
}

class IdempotentProvider {
  readonly #receipts = new Map<string, string>();
  public effectCount = 0;

  public charge(idempotencyKey: string): string {
    const existing = this.#receipts.get(idempotencyKey);
    if (existing) return existing;
    this.effectCount += 1;
    const receipt = `receipt-${String(this.effectCount)}`;
    this.#receipts.set(idempotencyKey, receipt);
    return receipt;
  }
}
