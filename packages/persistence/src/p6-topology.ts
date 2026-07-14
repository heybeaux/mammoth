import { z } from 'zod';
import { canonicalDigest } from '@mammoth/domain';

export const P6_TOPOLOGY_PLAN_SCHEMA_VERSION = '1.0.0';
export const P6_TOPOLOGY_BUDGET_POLICY_VERSION = '1.0.0';

const DigestSchema = z
  .string()
  .regex(/^sha256:[0-9a-f]{64}$/u, 'expected canonical sha256 digest');

const BudgetAmountSchema = z
  .object({
    costUsd: z.number().finite().nonnegative(),
    tokens: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative(),
  })
  .strict();

const StableIdentitySchema = z.string().min(1);

export const TopologySchedulerStateSchema = z.enum([
  'idle_no_ready_work',
  'blocked_dependency',
  'budget_starved',
  'concurrency_saturated',
  'failed_policy',
  'cancelled',
  'complete',
]);

export const TopologyPlanRecordSchema = z
  .object({
    id: z.string().min(1),
    stableIdentity: StableIdentitySchema,
    programId: z.string().min(1),
    criterionId: z.string().min(1),
    criterionVersion: z.number().int().positive(),
    criterionDigest: DigestSchema,
    topologyPlanVersion: z.literal(P6_TOPOLOGY_PLAN_SCHEMA_VERSION),
    plannerPolicyVersion: z.literal('1.0.0'),
    templateCatalogVersion: z.literal('1.0.0'),
    inputDigest: DigestSchema,
    budgetPolicyVersion: z.literal(P6_TOPOLOGY_BUDGET_POLICY_VERSION),
    concurrencyLimit: z.number().int().positive(),
    budgetCeiling: BudgetAmountSchema,
    planDigest: DigestSchema,
    state: TopologySchedulerStateSchema,
    revision: z.number().int().nonnegative(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    contract: z.unknown(),
  })
  .strict();

export const TopologyCellRecordSchema = z
  .object({
    id: z.string().min(1),
    stableIdentity: StableIdentitySchema,
    topologyId: z.string().min(1),
    programId: z.string().min(1),
    nodeId: z.string().min(1),
    templateId: z.string().min(1),
    templateVersion: z.literal('1.0.0'),
    dependencyDigest: DigestSchema,
    workItemContractDigest: DigestSchema,
    criterionId: z.string().min(1),
    criterionVersion: z.number().int().positive(),
    criterionDigest: DigestSchema,
    role: z.string().min(1),
    state: z.enum([
      'planned',
      'ready',
      'running',
      'succeeded',
      'failed',
      'cancelled',
      'blocked',
    ]),
    revision: z.number().int().nonnegative(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    contract: z.unknown(),
  })
  .strict();

export const TopologyDependencyRecordSchema = z
  .object({
    id: z.string().min(1),
    topologyId: z.string().min(1),
    programId: z.string().min(1),
    fromCellId: z.string().min(1),
    toCellId: z.string().min(1),
    artifactKind: z.enum([
      'claim_set',
      'evidence_snapshot',
      'hypothesis_set',
      'position_set',
      'prior_art_record',
      'falsification_result',
      'experiment_receipt',
      'synthesis_input',
    ]),
    dependencyDigest: DigestSchema,
    createdAt: z.string().datetime(),
  })
  .strict()
  .superRefine((record, context) => {
    if (record.fromCellId === record.toCellId)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['toCellId'],
        message: 'topology dependency cannot point to itself',
      });
  });

export const TopologyCellAttemptRecordSchema = z
  .object({
    id: z.string().min(1),
    stableIdentity: StableIdentitySchema,
    topologyId: z.string().min(1),
    cellId: z.string().min(1),
    programId: z.string().min(1),
    attempt: z.number().int().positive(),
    childWorkflowId: z.string().min(1),
    runPartition: z.string().min(1),
    state: z.enum(['started', 'succeeded', 'failed', 'cancelled']),
    startedAt: z.string().datetime(),
    completedAt: z.string().datetime().optional(),
    partialResultDigest: DigestSchema.optional(),
    receiptIds: z.array(z.string().min(1)),
  })
  .strict();

export const TopologyBudgetReservationRecordSchema = z
  .object({
    id: z.string().min(1),
    stableIdentity: StableIdentitySchema,
    topologyId: z.string().min(1),
    cellId: z.string().min(1),
    attemptId: z.string().min(1),
    programId: z.string().min(1),
    ceiling: BudgetAmountSchema,
    state: z.enum(['reserved', 'settled', 'released', 'cancelled']),
    revision: z.number().int().nonnegative(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const TopologyBudgetSettlementRecordSchema = z
  .object({
    id: z.string().min(1),
    stableIdentity: StableIdentitySchema,
    reservationId: z.string().min(1),
    amount: BudgetAmountSchema,
    settledAt: z.string().datetime(),
    receiptId: z.string().min(1),
  })
  .strict();

export const TopologyBudgetReleaseRecordSchema = z
  .object({
    id: z.string().min(1),
    stableIdentity: StableIdentitySchema,
    reservationId: z.string().min(1),
    releasedAt: z.string().datetime(),
    receiptId: z.string().min(1),
  })
  .strict();

export const TopologyCancellationReceiptRecordSchema = z
  .object({
    id: z.string().min(1),
    stableIdentity: StableIdentitySchema,
    topologyId: z.string().min(1),
    cellId: z.string().min(1).optional(),
    attemptId: z.string().min(1).optional(),
    reservationId: z.string().min(1).optional(),
    programId: z.string().min(1),
    reason: z.string().min(1),
    consumed: BudgetAmountSchema,
    released: BudgetAmountSchema,
    partialResultDigest: DigestSchema.optional(),
    cancelledAt: z.string().datetime(),
  })
  .strict();

export const TopologySchedulerSnapshotRecordSchema = z
  .object({
    id: z.string().min(1),
    topologyId: z.string().min(1),
    programId: z.string().min(1),
    state: TopologySchedulerStateSchema,
    readyCellIds: z.array(z.string().min(1)),
    runningCellIds: z.array(z.string().min(1)),
    blockedCellIds: z.array(z.string().min(1)),
    budgetStarvedCellIds: z.array(z.string().min(1)),
    concurrencyLimit: z.number().int().positive(),
    recordedAt: z.string().datetime(),
    digest: DigestSchema,
  })
  .strict();

export const TopologyReceiptRecordSchema = z
  .object({
    id: z.string().min(1),
    stableIdentity: StableIdentitySchema,
    topologyId: z.string().min(1),
    programId: z.string().min(1),
    kind: z.enum([
      'plan_committed',
      'cell_dispatched',
      'cell_completed',
      'cell_failed',
      'budget_reserved',
      'budget_settled',
      'budget_released',
      'cancelled',
      'reconstructed',
    ]),
    payloadDigest: DigestSchema,
    recordedAt: z.string().datetime(),
  })
  .strict();

export type BudgetAmount = z.infer<typeof BudgetAmountSchema>;
export type TopologyPlanRecord = z.infer<typeof TopologyPlanRecordSchema>;
export type TopologyCellRecord = z.infer<typeof TopologyCellRecordSchema>;
export type TopologyDependencyRecord = z.infer<
  typeof TopologyDependencyRecordSchema
>;
export type TopologyCellAttemptRecord = z.infer<
  typeof TopologyCellAttemptRecordSchema
>;
export type TopologyBudgetReservationRecord = z.infer<
  typeof TopologyBudgetReservationRecordSchema
>;
export type TopologyBudgetSettlementRecord = z.infer<
  typeof TopologyBudgetSettlementRecordSchema
>;
export type TopologyBudgetReleaseRecord = z.infer<
  typeof TopologyBudgetReleaseRecordSchema
>;
export type TopologyCancellationReceiptRecord = z.infer<
  typeof TopologyCancellationReceiptRecordSchema
>;
export type TopologySchedulerSnapshotRecord = z.infer<
  typeof TopologySchedulerSnapshotRecordSchema
>;
export type TopologyReceiptRecord = z.infer<typeof TopologyReceiptRecordSchema>;

export interface ReconstructedTopologyState {
  readonly programId: string;
  readonly plans: readonly TopologyPlanRecord[];
  readonly cells: readonly TopologyCellRecord[];
  readonly dependencies: readonly TopologyDependencyRecord[];
  readonly attempts: readonly TopologyCellAttemptRecord[];
  readonly reservations: readonly TopologyBudgetReservationRecord[];
  readonly settlements: readonly TopologyBudgetSettlementRecord[];
  readonly releases: readonly TopologyBudgetReleaseRecord[];
  readonly cancellations: readonly TopologyCancellationReceiptRecord[];
  readonly schedulerSnapshots: readonly TopologySchedulerSnapshotRecord[];
  readonly receipts: readonly TopologyReceiptRecord[];
  readonly digest: string;
}

export interface TopologyRepository {
  recordPlan(input: TopologyPlanRecord): Promise<TopologyPlanRecord>;
  recordCell(input: TopologyCellRecord): Promise<TopologyCellRecord>;
  recordDependency(
    input: TopologyDependencyRecord,
  ): Promise<TopologyDependencyRecord>;
  recordAttempt(
    input: TopologyCellAttemptRecord,
  ): Promise<TopologyCellAttemptRecord>;
  reserveBudget(
    input: TopologyBudgetReservationRecord,
  ): Promise<TopologyBudgetReservationRecord>;
  settleBudget(
    input: TopologyBudgetSettlementRecord,
  ): Promise<TopologyBudgetSettlementRecord>;
  releaseBudget(
    input: TopologyBudgetReleaseRecord,
  ): Promise<TopologyBudgetReleaseRecord>;
  recordCancellation(
    input: TopologyCancellationReceiptRecord,
  ): Promise<TopologyCancellationReceiptRecord>;
  recordSchedulerSnapshot(
    input: TopologySchedulerSnapshotRecord,
  ): Promise<TopologySchedulerSnapshotRecord>;
  recordReceipt(input: TopologyReceiptRecord): Promise<TopologyReceiptRecord>;
  reconstructProgram(programId: string): Promise<ReconstructedTopologyState>;
}

export class TopologyPersistenceConflictError extends Error {
  override readonly name = 'TopologyPersistenceConflictError';
}

export class TopologyPersistenceIntegrityError extends Error {
  override readonly name = 'TopologyPersistenceIntegrityError';
}

export class InMemoryTopologyRepository implements TopologyRepository {
  readonly #plans = new Map<string, TopologyPlanRecord>();
  readonly #cells = new Map<string, TopologyCellRecord>();
  readonly #dependencies = new Map<string, TopologyDependencyRecord>();
  readonly #attempts = new Map<string, TopologyCellAttemptRecord>();
  readonly #reservations = new Map<string, TopologyBudgetReservationRecord>();
  readonly #settlements = new Map<string, TopologyBudgetSettlementRecord>();
  readonly #releases = new Map<string, TopologyBudgetReleaseRecord>();
  readonly #cancellations = new Map<
    string,
    TopologyCancellationReceiptRecord
  >();
  readonly #snapshots = new Map<string, TopologySchedulerSnapshotRecord>();
  readonly #receipts = new Map<string, TopologyReceiptRecord>();

  async recordPlan(input: TopologyPlanRecord) {
    await asyncBoundary();
    const record = TopologyPlanRecordSchema.parse(input);
    return this.#insertStable(this.#plans, record, 'topology plan');
  }

  async recordCell(input: TopologyCellRecord) {
    await asyncBoundary();
    const record = TopologyCellRecordSchema.parse(input);
    this.#require(this.#plans, record.topologyId, 'topology plan');
    return this.#insertStable(this.#cells, record, 'topology cell');
  }

  async recordDependency(input: TopologyDependencyRecord) {
    await asyncBoundary();
    const record = TopologyDependencyRecordSchema.parse(input);
    this.#require(this.#cells, record.fromCellId, 'dependency source cell');
    this.#require(this.#cells, record.toCellId, 'dependency target cell');
    return this.#insert(this.#dependencies, record, 'topology dependency');
  }

  async recordAttempt(input: TopologyCellAttemptRecord) {
    await asyncBoundary();
    const record = TopologyCellAttemptRecordSchema.parse(input);
    this.#require(this.#cells, record.cellId, 'topology cell');
    return this.#insertStable(this.#attempts, record, 'topology attempt');
  }

  async reserveBudget(input: TopologyBudgetReservationRecord) {
    await asyncBoundary();
    const record = TopologyBudgetReservationRecordSchema.parse(input);
    this.#require(this.#attempts, record.attemptId, 'topology attempt');
    if (record.state !== 'reserved' || record.revision !== 0)
      throw new TopologyPersistenceIntegrityError(
        'topology budget reservation must start reserved at revision zero',
      );
    return this.#insertStable(
      this.#reservations,
      record,
      'topology reservation',
    );
  }

  async settleBudget(input: TopologyBudgetSettlementRecord) {
    await asyncBoundary();
    const record = TopologyBudgetSettlementRecordSchema.parse(input);
    const existing = this.#findStable(this.#settlements, record);
    if (existing) return copy(existing);
    const reservation = this.#require(
      this.#reservations,
      record.reservationId,
      'topology reservation',
    );
    if (reservation.state !== 'reserved')
      throw new TopologyPersistenceConflictError(
        'topology reservation is already closed',
      );
    if (!withinBudget(record.amount, reservation.ceiling))
      throw new TopologyPersistenceIntegrityError(
        'topology settlement exceeds reservation ceiling',
      );
    this.#reservations.set(reservation.id, {
      ...reservation,
      state: 'settled',
      revision: reservation.revision + 1,
      updatedAt: record.settledAt,
    });
    return this.#insertStable(this.#settlements, record, 'topology settlement');
  }

  async releaseBudget(input: TopologyBudgetReleaseRecord) {
    await asyncBoundary();
    const record = TopologyBudgetReleaseRecordSchema.parse(input);
    const existing = this.#findStable(this.#releases, record);
    if (existing) return copy(existing);
    const reservation = this.#require(
      this.#reservations,
      record.reservationId,
      'topology reservation',
    );
    if (reservation.state !== 'reserved')
      throw new TopologyPersistenceConflictError(
        'topology reservation is already closed',
      );
    this.#reservations.set(reservation.id, {
      ...reservation,
      state: 'released',
      revision: reservation.revision + 1,
      updatedAt: record.releasedAt,
    });
    return this.#insertStable(this.#releases, record, 'topology release');
  }

  async recordCancellation(input: TopologyCancellationReceiptRecord) {
    await asyncBoundary();
    const record = TopologyCancellationReceiptRecordSchema.parse(input);
    const existing = this.#findStable(this.#cancellations, record);
    if (existing) return copy(existing);
    if (record.attemptId)
      this.#require(this.#attempts, record.attemptId, 'topology attempt');
    if (record.reservationId) {
      const reservation = this.#require(
        this.#reservations,
        record.reservationId,
        'topology reservation',
      );
      if (
        !withinCombinedBudget(
          record.consumed,
          record.released,
          reservation.ceiling,
        )
      )
        throw new TopologyPersistenceIntegrityError(
          'topology cancellation accounting exceeds reservation ceiling',
        );
      if (reservation.state === 'reserved') {
        this.#reservations.set(reservation.id, {
          ...reservation,
          state: 'cancelled',
          revision: reservation.revision + 1,
          updatedAt: record.cancelledAt,
        });
      }
    }
    return this.#insertStable(
      this.#cancellations,
      record,
      'topology cancellation',
    );
  }

  async recordSchedulerSnapshot(input: TopologySchedulerSnapshotRecord) {
    await asyncBoundary();
    const record = TopologySchedulerSnapshotRecordSchema.parse(input);
    this.#require(this.#plans, record.topologyId, 'topology plan');
    return this.#insert(this.#snapshots, record, 'topology scheduler snapshot');
  }

  async recordReceipt(input: TopologyReceiptRecord) {
    await asyncBoundary();
    const record = TopologyReceiptRecordSchema.parse(input);
    this.#require(this.#plans, record.topologyId, 'topology plan');
    return this.#insertStable(this.#receipts, record, 'topology receipt');
  }

  async reconstructProgram(
    programId: string,
  ): Promise<ReconstructedTopologyState> {
    await asyncBoundary();
    return parseTopologyState({
      programId,
      plans: this.#forProgram(this.#plans, programId),
      cells: this.#forProgram(this.#cells, programId),
      dependencies: this.#forProgram(this.#dependencies, programId),
      attempts: this.#forProgram(this.#attempts, programId),
      reservations: this.#forProgram(this.#reservations, programId),
      settlements: [...this.#settlements.values()]
        .filter(
          (row) =>
            this.#reservations.get(row.reservationId)?.programId === programId,
        )
        .map(copy),
      releases: [...this.#releases.values()]
        .filter(
          (row) =>
            this.#reservations.get(row.reservationId)?.programId === programId,
        )
        .map(copy),
      cancellations: this.#forProgram(this.#cancellations, programId),
      schedulerSnapshots: this.#forProgram(this.#snapshots, programId),
      receipts: this.#forProgram(this.#receipts, programId),
    });
  }

  #insertStable<T extends { id: string; stableIdentity: string }>(
    map: Map<string, T>,
    record: T,
    subject: string,
  ): T {
    const existing = this.#findStable(map, record);
    if (existing) return copy(existing);
    return this.#insert(map, record, subject);
  }

  #insert<T extends { id: string }>(
    map: Map<string, T>,
    record: T,
    subject: string,
  ): T {
    const existing = map.get(record.id);
    if (existing) {
      if (sameJson(existing, record)) return copy(existing);
      throw new TopologyPersistenceConflictError(`duplicate ${subject} id`);
    }
    map.set(record.id, copy(record));
    return copy(record);
  }

  #findStable<T extends { stableIdentity: string }>(
    map: Map<string, T>,
    record: T,
  ): T | undefined {
    const existing = [...map.values()].find(
      (row) => row.stableIdentity === record.stableIdentity,
    );
    if (existing && !sameJson(existing, record))
      throw new TopologyPersistenceConflictError(
        'stable topology identity reused with different payload',
      );
    return existing;
  }

  #require<T>(map: Map<string, T>, id: string, subject: string): T {
    const record = map.get(id);
    if (!record)
      throw new TopologyPersistenceIntegrityError(`${subject} not found`);
    return copy(record);
  }

  #forProgram<T extends { programId: string }>(
    map: Map<string, T>,
    programId: string,
  ): T[] {
    return [...map.values()]
      .filter((row) => row.programId === programId)
      .map(copy);
  }
}

export function parseTopologyState(
  input: Omit<ReconstructedTopologyState, 'digest'>,
): ReconstructedTopologyState {
  const state = {
    programId: input.programId,
    plans: input.plans.map((row) => TopologyPlanRecordSchema.parse(row)),
    cells: input.cells.map((row) => TopologyCellRecordSchema.parse(row)),
    dependencies: input.dependencies.map((row) =>
      TopologyDependencyRecordSchema.parse(row),
    ),
    attempts: input.attempts.map((row) =>
      TopologyCellAttemptRecordSchema.parse(row),
    ),
    reservations: input.reservations.map((row) =>
      TopologyBudgetReservationRecordSchema.parse(row),
    ),
    settlements: input.settlements.map((row) =>
      TopologyBudgetSettlementRecordSchema.parse(row),
    ),
    releases: input.releases.map((row) =>
      TopologyBudgetReleaseRecordSchema.parse(row),
    ),
    cancellations: input.cancellations.map((row) =>
      TopologyCancellationReceiptRecordSchema.parse(row),
    ),
    schedulerSnapshots: input.schedulerSnapshots.map((row) =>
      TopologySchedulerSnapshotRecordSchema.parse(row),
    ),
    receipts: input.receipts.map((row) =>
      TopologyReceiptRecordSchema.parse(row),
    ),
  };
  validateReferences(state);
  return { ...state, digest: canonicalDigest(state) };
}

function validateReferences(
  state: Omit<ReconstructedTopologyState, 'digest'>,
): void {
  const planIds = new Set(state.plans.map(({ id }) => id));
  const cellIds = new Set(state.cells.map(({ id }) => id));
  const attemptIds = new Set(state.attempts.map(({ id }) => id));
  const reservationIds = new Set(state.reservations.map(({ id }) => id));
  for (const cell of state.cells) {
    if (!planIds.has(cell.topologyId))
      throw new TopologyPersistenceIntegrityError(
        'topology cell references missing plan',
      );
  }
  for (const dependency of state.dependencies) {
    if (
      !cellIds.has(dependency.fromCellId) ||
      !cellIds.has(dependency.toCellId)
    )
      throw new TopologyPersistenceIntegrityError(
        'topology dependency references missing cell',
      );
  }
  for (const attempt of state.attempts) {
    if (!cellIds.has(attempt.cellId))
      throw new TopologyPersistenceIntegrityError(
        'topology attempt references missing cell',
      );
  }
  for (const reservation of state.reservations) {
    if (!attemptIds.has(reservation.attemptId))
      throw new TopologyPersistenceIntegrityError(
        'topology reservation references missing attempt',
      );
  }
  for (const settlement of state.settlements) {
    if (!reservationIds.has(settlement.reservationId))
      throw new TopologyPersistenceIntegrityError(
        'topology settlement references missing reservation',
      );
  }
  for (const release of state.releases) {
    if (!reservationIds.has(release.reservationId))
      throw new TopologyPersistenceIntegrityError(
        'topology release references missing reservation',
      );
  }
}

function withinBudget(value: BudgetAmount, ceiling: BudgetAmount): boolean {
  return (
    value.costUsd <= ceiling.costUsd &&
    value.tokens <= ceiling.tokens &&
    value.durationMs <= ceiling.durationMs
  );
}

function withinCombinedBudget(
  consumed: BudgetAmount,
  released: BudgetAmount,
  ceiling: BudgetAmount,
): boolean {
  return (
    consumed.costUsd + released.costUsd <= ceiling.costUsd &&
    consumed.tokens + released.tokens <= ceiling.tokens &&
    consumed.durationMs + released.durationMs <= ceiling.durationMs
  );
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalDigest(left) === canonicalDigest(right);
}

function copy<T>(value: T): T {
  return structuredClone(value);
}

function asyncBoundary(): Promise<void> {
  return Promise.resolve();
}
