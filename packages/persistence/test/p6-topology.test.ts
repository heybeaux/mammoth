import { describe, expect, it } from 'vitest';
import { canonicalDigest } from '@mammoth/domain';
import {
  InMemoryTopologyRepository,
  TopologyPersistenceConflictError,
  TopologyPersistenceIntegrityError,
  parseTopologyState,
  type BudgetAmount,
  type TopologyBudgetReservationRecord,
  type TopologyCellAttemptRecord,
  type TopologyCellRecord,
  type TopologyPlanRecord,
} from '../src/index.js';

const now = '2026-07-14T00:00:00.000Z';
const digest =
  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const budget: BudgetAmount = { costUsd: 10, tokens: 1_000, durationMs: 60_000 };

describe('P6 topology persistence port', () => {
  it('records topology authority, idempotent duplicate delivery, and restart reconstruction', async () => {
    const repo = new InMemoryTopologyRepository();
    const plan = fixturePlan();
    const cell = fixtureCell();
    const attempt = fixtureAttempt();
    const reservation = fixtureReservation();

    await repo.recordPlan(plan);
    await repo.recordCell(cell);
    await repo.recordAttempt(attempt);
    const firstReservation = await repo.reserveBudget(reservation);
    const duplicateReservation = await repo.reserveBudget(reservation);
    await repo.recordReceipt({
      id: 'receipt-plan',
      stableIdentity: 'receipt:plan',
      topologyId: plan.id,
      programId: plan.programId,
      kind: 'plan_committed',
      payloadDigest: digest,
      recordedAt: now,
    });

    expect(duplicateReservation).toEqual(firstReservation);
    const reconstructed = await repo.reconstructProgram(plan.programId);
    expect(reconstructed).toMatchObject({
      programId: plan.programId,
      plans: [plan],
      cells: [cell],
      attempts: [attempt],
      reservations: [reservation],
      receipts: [
        expect.objectContaining({
          id: 'receipt-plan',
          kind: 'plan_committed',
        }),
      ],
    });
    expect(reconstructed.digest).toBe(
      canonicalDigest({ ...reconstructed, digest: undefined }),
    );
  });

  it('rejects duplicate stable identities with different payloads', async () => {
    const repo = new InMemoryTopologyRepository();
    await repo.recordPlan(fixturePlan());
    await expect(
      repo.recordPlan({ ...fixturePlan(), id: 'plan-other' }),
    ).rejects.toBeInstanceOf(TopologyPersistenceConflictError);
  });

  it('enforces bounded settlement and release-after-final-settlement rejection', async () => {
    const repo = new InMemoryTopologyRepository();
    await seedBudget(repo);
    await expect(
      repo.settleBudget({
        id: 'settlement-too-large',
        stableIdentity: 'settlement:too-large',
        reservationId: 'reservation-a',
        amount: { costUsd: 11, tokens: 1, durationMs: 1 },
        settledAt: now,
        receiptId: 'receipt-too-large',
      }),
    ).rejects.toBeInstanceOf(TopologyPersistenceIntegrityError);

    const settlement = await repo.settleBudget({
      id: 'settlement-a',
      stableIdentity: 'settlement:a',
      reservationId: 'reservation-a',
      amount: { costUsd: 5, tokens: 100, durationMs: 1_000 },
      settledAt: now,
      receiptId: 'receipt-settlement',
    });
    expect(await repo.settleBudget(settlement)).toEqual(settlement);
    await expect(
      repo.releaseBudget({
        id: 'release-after-settlement',
        stableIdentity: 'release:after-settlement',
        reservationId: 'reservation-a',
        releasedAt: now,
        receiptId: 'receipt-release',
      }),
    ).rejects.toBeInstanceOf(TopologyPersistenceConflictError);
  });

  it('records cancellation once and bounds combined consumed plus released accounting', async () => {
    const repo = new InMemoryTopologyRepository();
    await seedBudget(repo);

    await expect(
      repo.recordCancellation({
        id: 'cancel-too-large',
        stableIdentity: 'cancel:too-large',
        topologyId: 'topology-a',
        cellId: 'cell-a',
        attemptId: 'attempt-a',
        reservationId: 'reservation-a',
        programId: 'program-p6',
        reason: 'operator-cancel',
        consumed: { costUsd: 6, tokens: 500, durationMs: 1_000 },
        released: { costUsd: 5, tokens: 500, durationMs: 1_000 },
        cancelledAt: now,
      }),
    ).rejects.toBeInstanceOf(TopologyPersistenceIntegrityError);

    const receipt = await repo.recordCancellation({
      id: 'cancel-a',
      stableIdentity: 'cancel:a',
      topologyId: 'topology-a',
      cellId: 'cell-a',
      attemptId: 'attempt-a',
      reservationId: 'reservation-a',
      programId: 'program-p6',
      reason: 'operator-cancel',
      consumed: { costUsd: 2, tokens: 100, durationMs: 1_000 },
      released: { costUsd: 8, tokens: 900, durationMs: 59_000 },
      cancelledAt: now,
    });
    expect(await repo.recordCancellation(receipt)).toEqual(receipt);
    expect(
      (await repo.reconstructProgram('program-p6')).reservations[0],
    ).toMatchObject({
      state: 'cancelled',
      revision: 1,
    });
  });

  it('fails closed on restart reconstruction with broken references', () => {
    expect(() =>
      parseTopologyState({
        programId: 'program-p6',
        plans: [],
        cells: [fixtureCell()],
        dependencies: [],
        attempts: [],
        reservations: [],
        settlements: [],
        releases: [],
        cancellations: [],
        schedulerSnapshots: [],
        receipts: [],
      }),
    ).toThrow('topology cell references missing plan');
  });
});

async function seedBudget(repo: InMemoryTopologyRepository): Promise<void> {
  await repo.recordPlan(fixturePlan());
  await repo.recordCell(fixtureCell());
  await repo.recordAttempt(fixtureAttempt());
  await repo.reserveBudget(fixtureReservation());
}

function fixturePlan(): TopologyPlanRecord {
  return {
    id: 'topology-a',
    stableIdentity: 'topology:stable',
    programId: 'program-p6',
    criterionId: 'criterion-a',
    criterionVersion: 1,
    criterionDigest: digest,
    topologyPlanVersion: '1.0.0',
    plannerPolicyVersion: '1.0.0',
    templateCatalogVersion: '1.0.0',
    inputDigest: digest,
    budgetPolicyVersion: '1.0.0',
    concurrencyLimit: 2,
    budgetCeiling: budget,
    planDigest: digest,
    state: 'idle_no_ready_work',
    revision: 0,
    createdAt: now,
    updatedAt: now,
    contract: { nodes: ['node-a'] },
  };
}

function fixtureCell(): TopologyCellRecord {
  return {
    id: 'cell-a',
    stableIdentity: 'cell:stable',
    topologyId: 'topology-a',
    programId: 'program-p6',
    nodeId: 'node-a',
    templateId: 'landscape',
    templateVersion: '1.0.0',
    dependencyDigest: digest,
    workItemContractDigest: digest,
    criterionId: 'criterion-a',
    criterionVersion: 1,
    criterionDigest: digest,
    role: 'retriever',
    state: 'ready',
    revision: 0,
    createdAt: now,
    updatedAt: now,
    contract: { cell: 'contract' },
  };
}

function fixtureAttempt(): TopologyCellAttemptRecord {
  return {
    id: 'attempt-a',
    stableIdentity: 'attempt:stable',
    topologyId: 'topology-a',
    cellId: 'cell-a',
    programId: 'program-p6',
    attempt: 1,
    childWorkflowId: 'mammoth:p6:topology-a:cell-a:1:main',
    runPartition: 'main',
    state: 'started',
    startedAt: now,
    receiptIds: [],
  };
}

function fixtureReservation(): TopologyBudgetReservationRecord {
  return {
    id: 'reservation-a',
    stableIdentity: 'reservation:stable',
    topologyId: 'topology-a',
    cellId: 'cell-a',
    attemptId: 'attempt-a',
    programId: 'program-p6',
    ceiling: budget,
    state: 'reserved',
    revision: 0,
    createdAt: now,
    updatedAt: now,
  };
}
