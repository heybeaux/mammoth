import assert from 'node:assert/strict';
import type { EpistemicLedger } from '@mammoth/persistence';
import type { WorkflowExecution, WorkflowStore } from '@mammoth/workflow';

export interface DurableAdapterFactory<T> {
  open(): Promise<T> | T;
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
