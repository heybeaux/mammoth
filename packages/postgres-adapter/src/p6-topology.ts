import {
  TopologyBudgetReleaseRecordSchema,
  TopologyBudgetReservationRecordSchema,
  TopologyBudgetSettlementRecordSchema,
  TopologyCancellationReceiptRecordSchema,
  TopologyCellAttemptRecordSchema,
  TopologyCellRecordSchema,
  TopologyDependencyRecordSchema,
  TopologyPlanRecordSchema,
  TopologyReceiptRecordSchema,
  TopologySchedulerSnapshotRecordSchema,
  parseTopologyState,
  type ReconstructedTopologyState,
  type TopologyBudgetReleaseRecord,
  type TopologyBudgetReservationRecord,
  type TopologyBudgetSettlementRecord,
  type TopologyCancellationReceiptRecord,
  type TopologyCellAttemptRecord,
  type TopologyCellRecord,
  type TopologyDependencyRecord,
  type TopologyPlanRecord,
  type TopologyReceiptRecord,
  type TopologyRepository,
  type TopologySchedulerSnapshotRecord,
} from '@mammoth/persistence';
import { canonicalDigest } from '@mammoth/work-queue';
import type { PostgresConnection, TransactionOptions } from './driver.js';
import { PostgresAdapterError } from './errors.js';

export interface PostgresTopologyOptions {
  readonly transaction: TransactionOptions;
}

export class PostgresTopologyRepository implements TopologyRepository {
  constructor(
    private readonly database: PostgresConnection,
    private readonly options: PostgresTopologyOptions,
  ) {}

  async recordPlan(input: TopologyPlanRecord): Promise<TopologyPlanRecord> {
    const record = TopologyPlanRecordSchema.parse(input);
    await this.insertStable(
      'mammoth_p6_topology_plans',
      record,
      [
        record.id,
        record.stableIdentity,
        record.programId,
        record.criterionId,
        record.criterionVersion,
        record.criterionDigest,
        record.topologyPlanVersion,
        record.plannerPolicyVersion,
        record.templateCatalogVersion,
        record.inputDigest,
        record.budgetPolicyVersion,
        record.concurrencyLimit,
        JSON.stringify(record.budgetCeiling),
        record.planDigest,
        record.state,
        record.revision,
        record.createdAt,
        record.updatedAt,
        JSON.stringify(record.contract),
      ],
      `insert into mammoth_p6_topology_plans
        (id, stable_identity, program_id, criterion_id, criterion_version, criterion_digest,
         topology_plan_version, planner_policy_version, template_catalog_version, input_digest,
         budget_policy_version, concurrency_limit, budget_ceiling, plan_digest, state, revision,
         created_at, updated_at, authoritative_contract)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16,$17::timestamptz,$18::timestamptz,$19::jsonb)`,
      toTopologyPlan,
    );
    return record;
  }

  async recordCell(input: TopologyCellRecord): Promise<TopologyCellRecord> {
    const record = TopologyCellRecordSchema.parse(input);
    await this.insertStable(
      'mammoth_p6_topology_cells',
      record,
      [
        record.id,
        record.stableIdentity,
        record.topologyId,
        record.programId,
        record.nodeId,
        record.templateId,
        record.templateVersion,
        record.dependencyDigest,
        record.workItemContractDigest,
        record.criterionId,
        record.criterionVersion,
        record.criterionDigest,
        record.role,
        record.state,
        record.revision,
        record.createdAt,
        record.updatedAt,
        JSON.stringify(record.contract),
      ],
      `insert into mammoth_p6_topology_cells
        (id, stable_identity, topology_id, program_id, node_id, template_id, template_version,
         dependency_digest, work_item_contract_digest, criterion_id, criterion_version,
         criterion_digest, role, state, revision, created_at, updated_at, authoritative_contract)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::timestamptz,$17::timestamptz,$18::jsonb)`,
      toTopologyCell,
    );
    return record;
  }

  async recordDependency(
    input: TopologyDependencyRecord,
  ): Promise<TopologyDependencyRecord> {
    const record = TopologyDependencyRecordSchema.parse(input);
    await this.database.query(
      `insert into mammoth_p6_topology_dependencies
        (id, topology_id, program_id, from_cell_id, to_cell_id, artifact_kind,
         dependency_digest, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz)
       on conflict (id) do nothing`,
      [
        record.id,
        record.topologyId,
        record.programId,
        record.fromCellId,
        record.toCellId,
        record.artifactKind,
        record.dependencyDigest,
        record.createdAt,
      ],
    );
    return record;
  }

  async recordAttempt(
    input: TopologyCellAttemptRecord,
  ): Promise<TopologyCellAttemptRecord> {
    const record = TopologyCellAttemptRecordSchema.parse(input);
    await this.insertStable(
      'mammoth_p6_topology_attempts',
      record,
      [
        record.id,
        record.stableIdentity,
        record.topologyId,
        record.cellId,
        record.programId,
        record.attempt,
        record.childWorkflowId,
        record.runPartition,
        record.state,
        record.startedAt,
        record.completedAt ?? null,
        record.partialResultDigest ?? null,
        JSON.stringify(record.receiptIds),
      ],
      `insert into mammoth_p6_topology_attempts
        (id, stable_identity, topology_id, cell_id, program_id, attempt, child_workflow_id,
         run_partition, state, started_at, completed_at, partial_result_digest, receipt_ids)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::timestamptz,$11::timestamptz,$12,$13::jsonb)`,
      toTopologyAttempt,
    );
    return record;
  }

  async reserveBudget(
    input: TopologyBudgetReservationRecord,
  ): Promise<TopologyBudgetReservationRecord> {
    const record = TopologyBudgetReservationRecordSchema.parse(input);
    await this.insertStable(
      'mammoth_p6_topology_budget_reservations',
      record,
      [
        record.id,
        record.stableIdentity,
        record.topologyId,
        record.cellId,
        record.attemptId,
        record.programId,
        JSON.stringify(record.ceiling),
        record.state,
        record.revision,
        record.createdAt,
        record.updatedAt,
      ],
      `insert into mammoth_p6_topology_budget_reservations
        (id, stable_identity, topology_id, cell_id, attempt_id, program_id, ceiling, state,
         revision, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10::timestamptz,$11::timestamptz)`,
      toTopologyReservation,
    );
    return record;
  }

  async settleBudget(
    input: TopologyBudgetSettlementRecord,
  ): Promise<TopologyBudgetSettlementRecord> {
    const record = TopologyBudgetSettlementRecordSchema.parse(input);
    await this.database.transaction(this.options.transaction, async (tx) => {
      const inserted = await tx.query(
        `insert into mammoth_p6_topology_budget_settlements
          (id, stable_identity, reservation_id, amount, settled_at, receipt_id)
         values ($1,$2,$3,$4::jsonb,$5::timestamptz,$6)
         on conflict (stable_identity) do nothing
         returning *`,
        [
          record.id,
          record.stableIdentity,
          record.reservationId,
          JSON.stringify(record.amount),
          record.settledAt,
          record.receiptId,
        ],
      );
      if (inserted.rowCount === 0) {
        await assertExistingStable(
          tx,
          'mammoth_p6_topology_budget_settlements',
          record,
          toTopologySettlement,
        );
        return;
      }
      const updated = await tx.query(
        `update mammoth_p6_topology_budget_reservations
            set state = 'settled', revision = revision + 1, updated_at = $2::timestamptz
          where id = $1 and state = 'reserved'`,
        [record.reservationId, record.settledAt],
      );
      if (updated.rowCount !== 1)
        throw new PostgresAdapterError(
          'invalid_migration_set',
          'P6 topology settlement did not close exactly one reservation',
          { retryable: false },
        );
    });
    return record;
  }

  async releaseBudget(
    input: TopologyBudgetReleaseRecord,
  ): Promise<TopologyBudgetReleaseRecord> {
    const record = TopologyBudgetReleaseRecordSchema.parse(input);
    await this.database.transaction(this.options.transaction, async (tx) => {
      const inserted = await tx.query(
        `insert into mammoth_p6_topology_budget_releases
          (id, stable_identity, reservation_id, released_at, receipt_id)
         values ($1,$2,$3,$4::timestamptz,$5)
         on conflict (stable_identity) do nothing
         returning *`,
        [
          record.id,
          record.stableIdentity,
          record.reservationId,
          record.releasedAt,
          record.receiptId,
        ],
      );
      if (inserted.rowCount === 0) {
        await assertExistingStable(
          tx,
          'mammoth_p6_topology_budget_releases',
          record,
          toTopologyRelease,
        );
        return;
      }
      const updated = await tx.query(
        `update mammoth_p6_topology_budget_reservations
            set state = 'released', revision = revision + 1, updated_at = $2::timestamptz
          where id = $1 and state = 'reserved'`,
        [record.reservationId, record.releasedAt],
      );
      if (updated.rowCount !== 1)
        throw new PostgresAdapterError(
          'invalid_migration_set',
          'P6 topology release did not close exactly one reservation',
          { retryable: false },
        );
    });
    return record;
  }

  async recordCancellation(
    input: TopologyCancellationReceiptRecord,
  ): Promise<TopologyCancellationReceiptRecord> {
    const record = TopologyCancellationReceiptRecordSchema.parse(input);
    await this.database.transaction(this.options.transaction, async (tx) => {
      const inserted = await tx.query(
        `insert into mammoth_p6_topology_cancellation_receipts
          (id, stable_identity, topology_id, cell_id, attempt_id, reservation_id, program_id,
           reason, consumed, released, partial_result_digest, cancelled_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12::timestamptz)
         on conflict (stable_identity) do nothing
         returning *`,
        [
          record.id,
          record.stableIdentity,
          record.topologyId,
          record.cellId ?? null,
          record.attemptId ?? null,
          record.reservationId ?? null,
          record.programId,
          record.reason,
          JSON.stringify(record.consumed),
          JSON.stringify(record.released),
          record.partialResultDigest ?? null,
          record.cancelledAt,
        ],
      );
      if (inserted.rowCount === 0) {
        await assertExistingStable(
          tx,
          'mammoth_p6_topology_cancellation_receipts',
          record,
          toTopologyCancellation,
        );
        return;
      }
      if (record.reservationId) {
        const updated = await tx.query(
          `update mammoth_p6_topology_budget_reservations
              set state = 'cancelled', revision = revision + 1, updated_at = $2::timestamptz
            where id = $1 and state = 'reserved'`,
          [record.reservationId, record.cancelledAt],
        );
        if (updated.rowCount !== 1)
          throw new PostgresAdapterError(
            'invalid_migration_set',
            'P6 topology cancellation did not close exactly one reservation',
            { retryable: false },
          );
      }
    });
    return record;
  }

  async recordSchedulerSnapshot(
    input: TopologySchedulerSnapshotRecord,
  ): Promise<TopologySchedulerSnapshotRecord> {
    const record = TopologySchedulerSnapshotRecordSchema.parse(input);
    await this.database.query(
      `insert into mammoth_p6_topology_scheduler_snapshots
        (id, topology_id, program_id, state, ready_cell_ids, running_cell_ids,
         blocked_cell_ids, budget_starved_cell_ids, concurrency_limit, recorded_at, digest)
       values ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10::timestamptz,$11)
       on conflict (id) do nothing`,
      [
        record.id,
        record.topologyId,
        record.programId,
        record.state,
        JSON.stringify(record.readyCellIds),
        JSON.stringify(record.runningCellIds),
        JSON.stringify(record.blockedCellIds),
        JSON.stringify(record.budgetStarvedCellIds),
        record.concurrencyLimit,
        record.recordedAt,
        record.digest,
      ],
    );
    return record;
  }

  async recordReceipt(
    input: TopologyReceiptRecord,
  ): Promise<TopologyReceiptRecord> {
    const record = TopologyReceiptRecordSchema.parse(input);
    await this.insertStable(
      'mammoth_p6_topology_receipts',
      record,
      [
        record.id,
        record.stableIdentity,
        record.topologyId,
        record.programId,
        record.kind,
        record.payloadDigest,
        record.recordedAt,
      ],
      `insert into mammoth_p6_topology_receipts
        (id, stable_identity, topology_id, program_id, kind, payload_digest, recorded_at)
       values ($1,$2,$3,$4,$5,$6,$7::timestamptz)`,
      toTopologyReceipt,
    );
    return record;
  }

  async reconstructProgram(
    programId: string,
  ): Promise<ReconstructedTopologyState> {
    const [
      plans,
      cells,
      dependencies,
      attempts,
      reservations,
      settlements,
      releases,
      cancellations,
      snapshots,
      receipts,
    ] = await Promise.all([
      this.database.query(
        'select * from mammoth_p6_topology_plans where program_id = $1',
        [programId],
      ),
      this.database.query(
        'select * from mammoth_p6_topology_cells where program_id = $1',
        [programId],
      ),
      this.database.query(
        'select * from mammoth_p6_topology_dependencies where program_id = $1',
        [programId],
      ),
      this.database.query(
        'select * from mammoth_p6_topology_attempts where program_id = $1',
        [programId],
      ),
      this.database.query(
        'select * from mammoth_p6_topology_budget_reservations where program_id = $1',
        [programId],
      ),
      this.database.query(
        `select settlement.* from mammoth_p6_topology_budget_settlements settlement
          join mammoth_p6_topology_budget_reservations reservation
            on reservation.id = settlement.reservation_id
         where reservation.program_id = $1`,
        [programId],
      ),
      this.database.query(
        `select release.* from mammoth_p6_topology_budget_releases release
          join mammoth_p6_topology_budget_reservations reservation
            on reservation.id = release.reservation_id
         where reservation.program_id = $1`,
        [programId],
      ),
      this.database.query(
        'select * from mammoth_p6_topology_cancellation_receipts where program_id = $1',
        [programId],
      ),
      this.database.query(
        'select * from mammoth_p6_topology_scheduler_snapshots where program_id = $1',
        [programId],
      ),
      this.database.query(
        'select * from mammoth_p6_topology_receipts where program_id = $1',
        [programId],
      ),
    ]);
    return parseTopologyState({
      programId,
      plans: plans.rows.map(toTopologyPlan),
      cells: cells.rows.map(toTopologyCell),
      dependencies: dependencies.rows.map(toTopologyDependency),
      attempts: attempts.rows.map(toTopologyAttempt),
      reservations: reservations.rows.map(toTopologyReservation),
      settlements: settlements.rows.map(toTopologySettlement),
      releases: releases.rows.map(toTopologyRelease),
      cancellations: cancellations.rows.map(toTopologyCancellation),
      schedulerSnapshots: snapshots.rows.map(toTopologySnapshot),
      receipts: receipts.rows.map(toTopologyReceipt),
    });
  }

  private async insertStable<T extends { id: string; stableIdentity: string }>(
    table: string,
    record: T,
    parameters: readonly unknown[],
    sql: string,
    mapRow: (row: Record<string, unknown>) => T,
  ): Promise<void> {
    await this.database.transaction(this.options.transaction, async (tx) => {
      await tx.query(
        `${sql} on conflict (stable_identity) do nothing`,
        parameters,
      );
      const existing = await tx.query(
        `select * from ${table} where stable_identity = $1`,
        [record.stableIdentity],
      );
      if (
        !existing.rows[0] ||
        canonicalDigest(mapRow(existing.rows[0])) !== canonicalDigest(record)
      )
        throw new PostgresAdapterError(
          'invalid_migration_set',
          'topology stable identity reused with different payload',
          { retryable: false },
        );
    });
  }
}

async function assertExistingStable<T>(
  database: PostgresConnection,
  table: string,
  expected: T & { readonly stableIdentity: string },
  mapRow: (row: Record<string, unknown>) => T,
): Promise<void> {
  const existing = await database.query(
    `select * from ${table} where stable_identity = $1`,
    [expected.stableIdentity],
  );
  if (
    !existing.rows[0] ||
    canonicalDigest(mapRow(existing.rows[0])) !== canonicalDigest(expected)
  )
    throw new PostgresAdapterError(
      'invalid_migration_set',
      'topology stable identity reused with different payload',
      { retryable: false },
    );
}

function jsonArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function jsonObject(value: unknown): unknown {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function toIsoTimestamp(value: unknown, field: string): string {
  if (typeof value === 'string' || value instanceof Date)
    return new Date(value).toISOString();
  throw new PostgresAdapterError(
    'invalid_migration_set',
    `P6 topology row field ${field} is not a timestamp`,
    { retryable: false },
  );
}

function toTopologyPlan(row: Record<string, unknown>): TopologyPlanRecord {
  return TopologyPlanRecordSchema.parse({
    id: row.id,
    stableIdentity: row.stable_identity,
    programId: row.program_id,
    criterionId: row.criterion_id,
    criterionVersion: Number(row.criterion_version),
    criterionDigest: row.criterion_digest,
    topologyPlanVersion: row.topology_plan_version,
    plannerPolicyVersion: row.planner_policy_version,
    templateCatalogVersion: row.template_catalog_version,
    inputDigest: row.input_digest,
    budgetPolicyVersion: row.budget_policy_version,
    concurrencyLimit: Number(row.concurrency_limit),
    budgetCeiling: jsonObject(row.budget_ceiling),
    planDigest: row.plan_digest,
    state: row.state,
    revision: Number(row.revision),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
    contract: jsonObject(row.authoritative_contract),
  });
}

function toTopologyCell(row: Record<string, unknown>): TopologyCellRecord {
  return TopologyCellRecordSchema.parse({
    id: row.id,
    stableIdentity: row.stable_identity,
    topologyId: row.topology_id,
    programId: row.program_id,
    nodeId: row.node_id,
    templateId: row.template_id,
    templateVersion: row.template_version,
    dependencyDigest: row.dependency_digest,
    workItemContractDigest: row.work_item_contract_digest,
    criterionId: row.criterion_id,
    criterionVersion: Number(row.criterion_version),
    criterionDigest: row.criterion_digest,
    role: row.role,
    state: row.state,
    revision: Number(row.revision),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
    contract: jsonObject(row.authoritative_contract),
  });
}

function toTopologyDependency(
  row: Record<string, unknown>,
): TopologyDependencyRecord {
  return TopologyDependencyRecordSchema.parse({
    id: row.id,
    topologyId: row.topology_id,
    programId: row.program_id,
    fromCellId: row.from_cell_id,
    toCellId: row.to_cell_id,
    artifactKind: row.artifact_kind,
    dependencyDigest: row.dependency_digest,
    createdAt: new Date(String(row.created_at)).toISOString(),
  });
}

function toTopologyAttempt(
  row: Record<string, unknown>,
): TopologyCellAttemptRecord {
  return TopologyCellAttemptRecordSchema.parse({
    id: row.id,
    stableIdentity: row.stable_identity,
    topologyId: row.topology_id,
    cellId: row.cell_id,
    programId: row.program_id,
    attempt: Number(row.attempt),
    childWorkflowId: row.child_workflow_id,
    runPartition: row.run_partition,
    state: row.state,
    startedAt: toIsoTimestamp(row.started_at, 'started_at'),
    ...(row.completed_at === null
      ? {}
      : { completedAt: toIsoTimestamp(row.completed_at, 'completed_at') }),
    ...(row.partial_result_digest === null
      ? {}
      : { partialResultDigest: row.partial_result_digest }),
    receiptIds: jsonArray(row.receipt_ids),
  });
}

function toTopologyReservation(
  row: Record<string, unknown>,
): TopologyBudgetReservationRecord {
  return TopologyBudgetReservationRecordSchema.parse({
    id: row.id,
    stableIdentity: row.stable_identity,
    topologyId: row.topology_id,
    cellId: row.cell_id,
    attemptId: row.attempt_id,
    programId: row.program_id,
    ceiling: jsonObject(row.ceiling),
    state: row.state,
    revision: Number(row.revision),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  });
}

function toTopologySettlement(
  row: Record<string, unknown>,
): TopologyBudgetSettlementRecord {
  return TopologyBudgetSettlementRecordSchema.parse({
    id: row.id,
    stableIdentity: row.stable_identity,
    reservationId: row.reservation_id,
    amount: jsonObject(row.amount),
    settledAt: new Date(String(row.settled_at)).toISOString(),
    receiptId: row.receipt_id,
  });
}

function toTopologyRelease(
  row: Record<string, unknown>,
): TopologyBudgetReleaseRecord {
  return TopologyBudgetReleaseRecordSchema.parse({
    id: row.id,
    stableIdentity: row.stable_identity,
    reservationId: row.reservation_id,
    releasedAt: new Date(String(row.released_at)).toISOString(),
    receiptId: row.receipt_id,
  });
}

function toTopologyCancellation(
  row: Record<string, unknown>,
): TopologyCancellationReceiptRecord {
  return TopologyCancellationReceiptRecordSchema.parse({
    id: row.id,
    stableIdentity: row.stable_identity,
    topologyId: row.topology_id,
    ...(row.cell_id === null ? {} : { cellId: row.cell_id }),
    ...(row.attempt_id === null ? {} : { attemptId: row.attempt_id }),
    ...(row.reservation_id === null
      ? {}
      : { reservationId: row.reservation_id }),
    programId: row.program_id,
    reason: row.reason,
    consumed: jsonObject(row.consumed),
    released: jsonObject(row.released),
    ...(row.partial_result_digest === null
      ? {}
      : { partialResultDigest: row.partial_result_digest }),
    cancelledAt: new Date(String(row.cancelled_at)).toISOString(),
  });
}

function toTopologySnapshot(
  row: Record<string, unknown>,
): TopologySchedulerSnapshotRecord {
  return TopologySchedulerSnapshotRecordSchema.parse({
    id: row.id,
    topologyId: row.topology_id,
    programId: row.program_id,
    state: row.state,
    readyCellIds: jsonArray(row.ready_cell_ids),
    runningCellIds: jsonArray(row.running_cell_ids),
    blockedCellIds: jsonArray(row.blocked_cell_ids),
    budgetStarvedCellIds: jsonArray(row.budget_starved_cell_ids),
    concurrencyLimit: Number(row.concurrency_limit),
    recordedAt: new Date(String(row.recorded_at)).toISOString(),
    digest: row.digest,
  });
}

function toTopologyReceipt(
  row: Record<string, unknown>,
): TopologyReceiptRecord {
  return TopologyReceiptRecordSchema.parse({
    id: row.id,
    stableIdentity: row.stable_identity,
    topologyId: row.topology_id,
    programId: row.program_id,
    kind: row.kind,
    payloadDigest: row.payload_digest,
    recordedAt: new Date(String(row.recorded_at)).toISOString(),
  });
}
