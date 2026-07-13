import assert from 'node:assert/strict';
import { assertAdapterCompatibility } from './capabilities.js';
import { TEMPORAL_WORKFLOW_RUNTIME_REQUIREMENT } from './descriptors.js';
import type { WorkflowRuntimeLifecycle } from './workflow-runtime.js';
import type { EpistemicLedger } from '@mammoth/persistence';
import { contentDigest, type ContentAddressedStore } from '@mammoth/retrieval';
import {
  InMemoryWorkQueue,
  type IdempotentExternalResult,
  type SideEffectReceipt,
  type WorkStateStore,
} from '@mammoth/work-queue';
import type { WorkflowExecution, WorkflowStore } from '@mammoth/workflow';

export interface DurableAdapterFactory<T> {
  open(): Promise<T> | T;
}

export interface SynchronousDurableAdapterFactory<T> {
  open(): T;
}

export async function verifyWorkflowRuntimeConformance(
  factory: DurableAdapterFactory<WorkflowRuntimeLifecycle>,
): Promise<void> {
  const adapter = await factory.open();
  await adapter.start();
  const descriptor = adapter.descriptor();
  assert.equal(descriptor.kind, 'workflow-runtime');
  assertAdapterCompatibility(
    [descriptor],
    [TEMPORAL_WORKFLOW_RUNTIME_REQUIREMENT],
  );
  const readiness = await adapter.readiness();
  assert.equal(readiness.ready, true);
  assert.deepEqual(readiness.failures, []);
  await adapter.shutdown();
  await adapter.shutdown();
}

export async function verifyWorkflowStoreConformance(
  factory: DurableAdapterFactory<WorkflowStore>,
): Promise<void> {
  const first = await factory.open();
  const second = await factory.open();
  assert.deepEqual(await first.load(), { executions: {}, schedules: {} });

  await first.transact((snapshot) => {
    snapshot.executions.conformance = executionFixture();
  });

  await Promise.all(
    Array.from({ length: 16 }, (_, index) =>
      (index % 2 === 0 ? first : second).transact((snapshot) => {
        const execution = snapshot.executions.conformance;
        assert.ok(execution);
        const count = Number(execution.state.conformanceCount ?? 0);
        execution.state.conformanceCount = count + 1;
        execution.revision += 1;
      }),
    ),
  );

  const reopened = await factory.open();
  const committed = await reopened.load();
  assert.equal(
    committed.executions.conformance?.state.conformanceCount,
    16,
    'concurrent transactions must not lose updates',
  );

  await assert.rejects(
    first.transact(() => {
      throw new Error('intentional rollback');
    }),
    /intentional rollback/,
  );
  assert.deepEqual(await reopened.load(), committed);
}

export async function verifyEpistemicLedgerConformance(
  factory: DurableAdapterFactory<EpistemicLedger>,
): Promise<void> {
  const first = await factory.open();
  const second = await factory.open();
  assert.equal((await first.read()).revision, 0);

  await Promise.all(
    Array.from({ length: 16 }, (_, index) =>
      (index % 2 === 0 ? first : second).transact(() => undefined),
    ),
  );

  const reopened = await factory.open();
  const committed = await reopened.read();
  assert.equal(
    committed.revision,
    16,
    'concurrent transactions must commit unique ordered revisions',
  );

  await assert.rejects(
    first.transact(() => {
      throw new Error('intentional rollback');
    }),
    /intentional rollback/,
  );
  assert.equal((await reopened.read()).revision, 16);
}

export function verifyWorkStateStoreConformance(
  factory: SynchronousDurableAdapterFactory<WorkStateStore>,
): void {
  const first = factory.open();
  const second = factory.open();
  assert.equal(first.load(), undefined);

  for (let index = 0; index < 16; index += 1) {
    const store = index % 2 === 0 ? first : second;
    store.update((saved) => ({
      result: undefined,
      state: {
        version: 1,
        queue: saved?.queue ?? new InMemoryWorkQueue().snapshot(),
        receipts: [
          ...(saved?.receipts ?? []),
          {
            idempotencyKey: `conformance:${String(index)}`,
            state: 'started',
            startedAt: index,
          },
        ],
      },
    }));
  }

  const reopened = factory.open();
  const committed = reopened.load();
  assert.ok(committed);
  assert.equal(committed.receipts.length, 16);
  assert.equal(new Set(committed.receipts.map(receiptKey)).size, 16);

  assert.throws(() =>
    first.update(() => {
      throw new Error('intentional rollback');
    }),
  );
  assert.deepEqual(reopened.load(), committed);
}

export interface ExactlyOnceEffectRuntime {
  executeExactlyOnce<TResult>(options: {
    readonly idempotencyKey: string;
    readonly execute: (
      idempotencyKey: string,
    ) => Promise<IdempotentExternalResult<TResult>>;
  }): Promise<SideEffectReceipt<TResult> & { readonly state: 'completed' }>;
}

export async function verifyEffectReceiptConformance(
  factory: DurableAdapterFactory<ExactlyOnceEffectRuntime>,
): Promise<void> {
  let effects = 0;
  const execute = (key: string) => {
    effects += 1;
    return Promise.resolve({
      providerReceiptId: `provider:${key}`,
      result: { accepted: true },
    });
  };
  const first = await factory.open();
  const initial = await first.executeExactlyOnce({
    idempotencyKey: 'effect:conformance',
    execute,
  });
  const restarted = await factory.open();
  const replayed = await restarted.executeExactlyOnce({
    idempotencyKey: 'effect:conformance',
    execute,
  });
  assert.deepEqual(replayed, initial);
  assert.equal(effects, 1, 'completed effects must not execute after restart');
}

export interface CorruptibleContentAddressedStoreFactory
  extends DurableAdapterFactory<ContentAddressedStore> {
  corrupt(digest: string): Promise<void> | void;
}

export async function verifyContentAddressedStoreConformance(
  factory: CorruptibleContentAddressedStoreFactory,
): Promise<void> {
  const bytes = new TextEncoder().encode('immutable conformance artifact');
  const expectedDigest = contentDigest(bytes);
  const first = await factory.open();
  const stored = await first.put(bytes);
  assert.equal(stored.digest, expectedDigest);
  assert.equal(stored.size, bytes.byteLength);
  assert.ok(stored.storageUri.length > 0);
  assert.deepEqual(
    await first.put(bytes),
    stored,
    'identical bytes must dedupe',
  );

  const reopened = await factory.open();
  assert.deepEqual([...(await reopened.get(expectedDigest))], [...bytes]);
  await assert.rejects(reopened.get('sha256:not-a-digest'), /INVALID_DIGEST/);
  await factory.corrupt(expectedDigest);
  await assert.rejects(
    reopened.get(expectedDigest),
    /INTEGRITY|DIGEST|CORRUPT|TAMPER/i,
  );
}

function receiptKey(receipt: SideEffectReceipt): string {
  return receipt.idempotencyKey;
}

function executionFixture(): WorkflowExecution {
  return {
    id: 'conformance',
    workflow: 'adapter-conformance',
    definitionVersion: 1,
    revision: 0,
    status: 'running',
    input: {},
    stepIndex: 0,
    state: {},
    attempt: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}
