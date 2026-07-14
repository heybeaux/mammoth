import {
  P7ArtifactReferenceRecordSchema,
  P7BudgetReleaseRecordSchema,
  P7BudgetSettlementRecordSchema,
  P7CancellationFenceRecordSchema,
  P7CapabilityDecisionRecordSchema,
  P7EgressDecisionRecordSchema,
  P7ModelWorkRecordSchema,
  P7ProviderAttemptRecordSchema,
  P7ProviderChargeRecordSchema,
  P7ReconstructionLinkRecordSchema,
  P7ValidationResidueRecordSchema,
  type P7ArtifactReferenceRecord,
  type P7BudgetReleaseRecord,
  type P7BudgetSettlementRecord,
  type P7CancellationFenceRecord,
  type P7CapabilityDecisionRecord,
  type P7ChargeSettlementInput,
  type P7EgressDecisionRecord,
  type P7ModelWorkRecord,
  type P7ModelWorkRepository,
  type P7ProviderAttemptRecord,
  type P7ProviderChargeRecord,
  type P7ReconstructedState,
  type P7ReconstructionLinkRecord,
  type P7ValidationResidueRecord,
} from '@mammoth/persistence';
import { canonicalDigest } from '@mammoth/work-queue';
import type { PostgresConnection, TransactionOptions } from './driver.js';
import { PostgresAdapterError } from './errors.js';

export interface PostgresP7ModelWorkOptions {
  readonly transaction: TransactionOptions;
}

export class PostgresP7ModelWorkRepository implements P7ModelWorkRepository {
  constructor(
    private readonly database: PostgresConnection,
    private readonly options: PostgresP7ModelWorkOptions,
  ) {}

  async recordModelWork(input: P7ModelWorkRecord) {
    const record = P7ModelWorkRecordSchema.parse(input);
    requireInitial(record.state, record.revision, 'model work');
    await this.insertStable(
      'mammoth_p7_model_work',
      record,
      `insert into mammoth_p7_model_work
        (id,stable_identity,program_id,topology_id,cell_id,topology_attempt_id,
         reservation_id,provider_effect_key,authoritative_request,state,revision,
         created_at,updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12::timestamptz,$13::timestamptz)`,
      [
        record.id,
        record.stableIdentity,
        record.programId,
        record.topologyId,
        record.cellId,
        record.topologyAttemptId,
        record.reservationId,
        record.request.effect.idempotencyKey,
        JSON.stringify(record.request),
        record.state,
        record.revision,
        record.createdAt,
        record.updatedAt,
      ],
      toModelWork,
    );
    return record;
  }

  async recordProviderAttempt(input: P7ProviderAttemptRecord) {
    const record = P7ProviderAttemptRecordSchema.parse(input);
    requireInitial(record.state, record.revision, 'provider attempt');
    await this.insertStable(
      'mammoth_p7_provider_attempts',
      record,
      `insert into mammoth_p7_provider_attempts
        (id,stable_identity,model_work_id,model_work_identity_digest,attempt_ordinal,
         provider,concrete_model,checkpoint,capability_manifest_digest,authoritative_request,
         predecessor_attempt_id,predecessor_reason,state,revision,created_at,updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15::timestamptz,$16::timestamptz)`,
      [
        record.id,
        record.stableIdentity,
        record.modelWorkId,
        record.modelWorkIdentityDigest,
        record.attemptOrdinal,
        record.provider,
        record.concreteModel,
        record.checkpoint,
        record.capabilityManifestDigest,
        JSON.stringify(record.request),
        record.predecessorAttemptId ?? null,
        record.predecessorReason ?? null,
        record.state,
        record.revision,
        record.createdAt,
        record.updatedAt,
      ],
      toProviderAttempt,
    );
    return record;
  }

  async recordCapabilityDecision(input: P7CapabilityDecisionRecord) {
    const record = P7CapabilityDecisionRecordSchema.parse(input);
    return this.insertAndReturn(
      'mammoth_p7_capability_decisions',
      record,
      `insert into mammoth_p7_capability_decisions
        (id,stable_identity,model_work_id,provider_attempt_id,manifest,decision,reason,
         recorded_at,decision_digest)
       values ($1,$2,$3,$4,$5::jsonb,$6,$7,$8::timestamptz,$9)`,
      [
        record.id,
        record.stableIdentity,
        record.modelWorkId,
        record.providerAttemptId,
        JSON.stringify(record.manifest),
        record.decision,
        record.reason,
        record.recordedAt,
        record.decisionDigest,
      ],
      toCapability,
    );
  }

  async recordEgressDecision(input: P7EgressDecisionRecord) {
    const record = P7EgressDecisionRecordSchema.parse(input);
    return this.insertAndReturn(
      'mammoth_p7_egress_decisions',
      record,
      `insert into mammoth_p7_egress_decisions
        (id,stable_identity,model_work_id,provider_attempt_id,reservation_id,
         data_classification,provider,concrete_model,checkpoint,destination_origin,
         allowed_tools,prompt_digest,policy_version,policy_digest,policy_evaluation_digest,
         decision,reason,recorded_at,decision_digest)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16,$17,$18::timestamptz,$19)`,
      [
        record.id,
        record.stableIdentity,
        record.modelWorkId,
        record.providerAttemptId,
        record.reservationId,
        record.dataClassification,
        record.provider,
        record.concreteModel,
        record.checkpoint,
        record.destinationOrigin,
        JSON.stringify(record.allowedTools),
        record.promptDigest,
        record.policyVersion,
        record.policyDigest,
        record.policyEvaluationDigest,
        record.decision,
        record.reason,
        record.recordedAt,
        record.decisionDigest,
      ],
      toEgress,
    );
  }

  async recordArtifact(input: P7ArtifactReferenceRecord) {
    const record = P7ArtifactReferenceRecordSchema.parse(input);
    return this.insertAndReturn(
      'mammoth_p7_artifact_references',
      record,
      `insert into mammoth_p7_artifact_references
        (id,stable_identity,model_work_id,provider_attempt_id,kind,digest,byte_length,
         data_classification,retention,deletion_receipt_digest,validation_verdict,created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::timestamptz)`,
      [
        record.id,
        record.stableIdentity,
        record.modelWorkId,
        record.providerAttemptId,
        record.kind,
        record.digest,
        record.byteLength,
        record.dataClassification,
        record.retention,
        record.deletionReceiptDigest ?? null,
        record.validationVerdict,
        record.createdAt,
      ],
      toArtifact,
    );
  }

  async recordValidationResidue(input: P7ValidationResidueRecord) {
    const record = P7ValidationResidueRecordSchema.parse(input);
    return this.insertAndReturn(
      'mammoth_p7_validation_residue',
      record,
      `insert into mammoth_p7_validation_residue
        (id,stable_identity,model_work_id,provider_attempt_id,artifact_id,verdict,code,
         redacted_summary,recorded_at,residue_digest)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz,$10)`,
      [
        record.id,
        record.stableIdentity,
        record.modelWorkId,
        record.providerAttemptId,
        record.artifactId,
        record.verdict,
        record.code,
        record.redactedSummary,
        record.recordedAt,
        record.residueDigest,
      ],
      toResidue,
    );
  }

  async recordChargeAndSettlement(input: P7ChargeSettlementInput) {
    const charge = P7ProviderChargeRecordSchema.parse(input.charge);
    const settlement = P7BudgetSettlementRecordSchema.parse(input.settlement);
    await this.database.transaction(this.options.transaction, async (tx) => {
      await insertStable(
        tx,
        'mammoth_p7_provider_charges',
        charge,
        `insert into mammoth_p7_provider_charges
          (id,stable_identity,model_work_id,provider_attempt_id,reservation_id,
           provider_effect_key,provider,provider_operation_id,usage,price_version,
           currency_conversion_policy,charged_at,receipt_digest)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12::timestamptz,$13)`,
        [
          charge.id,
          charge.stableIdentity,
          charge.modelWorkId,
          charge.providerAttemptId,
          charge.reservationId,
          charge.providerEffectIdempotencyKey,
          charge.provider,
          charge.providerOperationId,
          JSON.stringify(charge.usage),
          charge.priceVersion,
          charge.currencyConversionPolicy,
          charge.chargedAt,
          charge.receiptDigest,
        ],
        toCharge,
      );
      const p6Amount = {
        costUsd: settlement.amount.currencyMicros / 1_000_000,
        tokens: settlement.amount.inputTokens + settlement.amount.outputTokens,
        durationMs: settlement.amount.wallClockMs,
      };
      await tx.query(
        `insert into mammoth_p6_topology_budget_settlements
          (id,stable_identity,reservation_id,amount,settled_at,receipt_id)
         values ($1,$2,$3,$4::jsonb,$5::timestamptz,$6)
         on conflict (stable_identity) do nothing`,
        [
          settlement.id,
          settlement.stableIdentity,
          settlement.reservationId,
          JSON.stringify(p6Amount),
          settlement.settledAt,
          settlement.receiptDigest,
        ],
      );
      await insertStable(
        tx,
        'mammoth_p7_budget_settlements',
        settlement,
        `insert into mammoth_p7_budget_settlements
          (id,stable_identity,model_work_id,reservation_id,provider_charge_id,amount,
           settled_at,receipt_digest)
         values ($1,$2,$3,$4,$5,$6::jsonb,$7::timestamptz,$8)`,
        [
          settlement.id,
          settlement.stableIdentity,
          settlement.modelWorkId,
          settlement.reservationId,
          settlement.providerChargeId,
          JSON.stringify(settlement.amount),
          settlement.settledAt,
          settlement.receiptDigest,
        ],
        toSettlement,
      );
    });
    return { charge, settlement };
  }

  async recordRelease(input: P7BudgetReleaseRecord) {
    const record = P7BudgetReleaseRecordSchema.parse(input);
    await this.database.transaction(this.options.transaction, async (tx) => {
      await tx.query(
        `insert into mammoth_p6_topology_budget_releases
          (id,stable_identity,reservation_id,released_at,receipt_id)
         values ($1,$2,$3,$4::timestamptz,$5)
         on conflict (stable_identity) do nothing`,
        [
          record.id,
          record.stableIdentity,
          record.reservationId,
          record.releasedAt,
          record.receiptDigest,
        ],
      );
      await insertStable(
        tx,
        'mammoth_p7_budget_releases',
        record,
        `insert into mammoth_p7_budget_releases
          (id,stable_identity,model_work_id,reservation_id,reason,released_at,receipt_digest)
         values ($1,$2,$3,$4,$5,$6::timestamptz,$7)`,
        [
          record.id,
          record.stableIdentity,
          record.modelWorkId,
          record.reservationId,
          record.reason,
          record.releasedAt,
          record.receiptDigest,
        ],
        toRelease,
      );
    });
    return record;
  }

  async recordCancellationFence(input: P7CancellationFenceRecord) {
    const record = P7CancellationFenceRecordSchema.parse(input);
    return this.insertAndReturn(
      'mammoth_p7_cancellation_fences',
      record,
      `insert into mammoth_p7_cancellation_fences
        (id,stable_identity,model_work_id,reservation_id,phase,reason,requested_at,fence_digest)
       values ($1,$2,$3,$4,$5,$6,$7::timestamptz,$8)`,
      [
        record.id,
        record.stableIdentity,
        record.modelWorkId,
        record.reservationId,
        record.phase,
        record.reason,
        record.requestedAt,
        record.fenceDigest,
      ],
      toCancellation,
    );
  }

  async recordReconstructionLink(input: P7ReconstructionLinkRecord) {
    const record = P7ReconstructionLinkRecordSchema.parse(input);
    return this.insertAndReturn(
      'mammoth_p7_reconstruction_links',
      record,
      `insert into mammoth_p7_reconstruction_links
        (id,stable_identity,model_work_id,activity_effect_id,topology_attempt_id,
         reservation_id,artifact_ids,provider_charge_id,settlement_id,cancellation_fence_id,
         completed_receipt_digest,recorded_at,link_digest)
       values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12::timestamptz,$13)`,
      [
        record.id,
        record.stableIdentity,
        record.modelWorkId,
        record.activityEffectId,
        record.topologyAttemptId,
        record.reservationId,
        JSON.stringify(record.artifactIds),
        record.providerChargeId ?? null,
        record.settlementId ?? null,
        record.cancellationFenceId ?? null,
        record.completedReceiptDigest ?? null,
        record.recordedAt,
        record.linkDigest,
      ],
      toLink,
    );
  }

  async transitionModelWork(input: {
    readonly id: string;
    readonly expectedRevision: number;
    readonly state: P7ModelWorkRecord['state'];
    readonly updatedAt: string;
  }) {
    const result = await this.database.query(
      `update mammoth_p7_model_work set state=$1,revision=revision+1,updated_at=$2::timestamptz
       where id=$3 and revision=$4 returning *`,
      [input.state, input.updatedAt, input.id, input.expectedRevision],
    );
    if (!result.rows[0]) throw casConflict('model work');
    return toModelWork(result.rows[0]);
  }

  async transitionProviderAttempt(input: {
    readonly id: string;
    readonly expectedRevision: number;
    readonly state: P7ProviderAttemptRecord['state'];
    readonly updatedAt: string;
  }) {
    const result = await this.database.query(
      `update mammoth_p7_provider_attempts set state=$1,revision=revision+1,updated_at=$2::timestamptz
       where id=$3 and revision=$4 returning *`,
      [input.state, input.updatedAt, input.id, input.expectedRevision],
    );
    if (!result.rows[0]) throw casConflict('provider attempt');
    return toProviderAttempt(result.rows[0]);
  }

  async reconstructProgram(programId: string): Promise<P7ReconstructedState> {
    const where = ` where model_work_id in (select id from mammoth_p7_model_work where program_id=$1)`;
    const [
      works,
      attempts,
      capabilities,
      egress,
      artifacts,
      residue,
      charges,
      settlements,
      releases,
      cancellations,
      links,
    ] = await Promise.all([
      this.database.query(
        'select * from mammoth_p7_model_work where program_id=$1',
        [programId],
      ),
      this.database.query(
        'select * from mammoth_p7_provider_attempts' + where,
        [programId],
      ),
      this.database.query(
        'select * from mammoth_p7_capability_decisions' + where,
        [programId],
      ),
      this.database.query('select * from mammoth_p7_egress_decisions' + where, [
        programId,
      ]),
      this.database.query(
        'select * from mammoth_p7_artifact_references' + where,
        [programId],
      ),
      this.database.query(
        'select * from mammoth_p7_validation_residue' + where,
        [programId],
      ),
      this.database.query('select * from mammoth_p7_provider_charges' + where, [
        programId,
      ]),
      this.database.query(
        'select * from mammoth_p7_budget_settlements' + where,
        [programId],
      ),
      this.database.query('select * from mammoth_p7_budget_releases' + where, [
        programId,
      ]),
      this.database.query(
        'select * from mammoth_p7_cancellation_fences' + where,
        [programId],
      ),
      this.database.query(
        'select * from mammoth_p7_reconstruction_links' + where,
        [programId],
      ),
    ]);
    return {
      modelWorks: works.rows.map(toModelWork),
      providerAttempts: attempts.rows.map(toProviderAttempt),
      capabilityDecisions: capabilities.rows.map(toCapability),
      egressDecisions: egress.rows.map(toEgress),
      artifacts: artifacts.rows.map(toArtifact),
      validationResidue: residue.rows.map(toResidue),
      providerCharges: charges.rows.map(toCharge),
      settlements: settlements.rows.map(toSettlement),
      releases: releases.rows.map(toRelease),
      cancellationFences: cancellations.rows.map(toCancellation),
      reconstructionLinks: links.rows.map(toLink),
    };
  }

  private async insertStable<T extends { id: string; stableIdentity: string }>(
    table: string,
    record: T,
    sql: string,
    parameters: readonly unknown[],
    map: (row: Record<string, unknown>) => T,
  ): Promise<void> {
    await this.database.transaction(this.options.transaction, (tx) =>
      insertStable(tx, table, record, sql, parameters, map),
    );
  }

  private async insertAndReturn<
    T extends { id: string; stableIdentity: string },
  >(
    table: string,
    record: T,
    sql: string,
    parameters: readonly unknown[],
    map: (row: Record<string, unknown>) => T,
  ): Promise<T> {
    await this.insertStable(table, record, sql, parameters, map);
    return record;
  }
}

async function insertStable<T extends { id: string; stableIdentity: string }>(
  database: PostgresConnection,
  table: string,
  record: T,
  sql: string,
  parameters: readonly unknown[],
  map: (row: Record<string, unknown>) => T,
): Promise<void> {
  await database.query(
    `${sql} on conflict (stable_identity) do nothing`,
    parameters,
  );
  const existing = await database.query(
    `select * from ${table} where stable_identity=$1`,
    [record.stableIdentity],
  );
  if (
    !existing.rows[0] ||
    canonicalDigest(map(existing.rows[0])) !== canonicalDigest(record)
  )
    throw new PostgresAdapterError(
      'invalid_migration_set',
      'P7 stable identity reused with different payload',
      { retryable: false },
    );
}

function casConflict(subject: string): PostgresAdapterError {
  return new PostgresAdapterError(
    'invalid_migration_set',
    `P7 ${subject} revision is stale`,
    { retryable: false },
  );
}

function requireInitial(
  state: string,
  revision: number,
  subject: string,
): void {
  if (state !== 'planned' || revision !== 0)
    throw new PostgresAdapterError(
      'invalid_migration_set',
      `new P7 ${subject} must start planned at revision zero`,
      { retryable: false },
    );
}

function json(value: unknown): unknown {
  return typeof value === 'string' ? JSON.parse(value) : value;
}
function iso(value: unknown): string {
  return new Date(String(value)).toISOString();
}
function optional<T>(
  value: T | null | undefined,
  key: string,
): Record<string, T> {
  return value == null ? {} : { [key]: value };
}

function toModelWork(row: Record<string, unknown>): P7ModelWorkRecord {
  return P7ModelWorkRecordSchema.parse({
    id: row.id,
    stableIdentity: row.stable_identity,
    programId: row.program_id,
    topologyId: row.topology_id,
    cellId: row.cell_id,
    topologyAttemptId: row.topology_attempt_id,
    reservationId: row.reservation_id,
    request: json(row.authoritative_request),
    state: row.state,
    revision: Number(row.revision),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });
}
function toProviderAttempt(
  row: Record<string, unknown>,
): P7ProviderAttemptRecord {
  return P7ProviderAttemptRecordSchema.parse({
    id: row.id,
    stableIdentity: row.stable_identity,
    modelWorkId: row.model_work_id,
    modelWorkIdentityDigest: row.model_work_identity_digest,
    attemptOrdinal: Number(row.attempt_ordinal),
    provider: row.provider,
    concreteModel: row.concrete_model,
    checkpoint: row.checkpoint,
    capabilityManifestDigest: row.capability_manifest_digest,
    request: json(row.authoritative_request),
    ...optional(row.predecessor_attempt_id, 'predecessorAttemptId'),
    ...optional(row.predecessor_reason, 'predecessorReason'),
    state: row.state,
    revision: Number(row.revision),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });
}
function toCapability(
  row: Record<string, unknown>,
): P7CapabilityDecisionRecord {
  return P7CapabilityDecisionRecordSchema.parse({
    id: row.id,
    stableIdentity: row.stable_identity,
    modelWorkId: row.model_work_id,
    providerAttemptId: row.provider_attempt_id,
    manifest: json(row.manifest),
    decision: row.decision,
    reason: row.reason,
    recordedAt: iso(row.recorded_at),
    decisionDigest: row.decision_digest,
  });
}
function toEgress(row: Record<string, unknown>): P7EgressDecisionRecord {
  return P7EgressDecisionRecordSchema.parse({
    id: row.id,
    stableIdentity: row.stable_identity,
    modelWorkId: row.model_work_id,
    providerAttemptId: row.provider_attempt_id,
    reservationId: row.reservation_id,
    dataClassification: row.data_classification,
    provider: row.provider,
    concreteModel: row.concrete_model,
    checkpoint: row.checkpoint,
    destinationOrigin: row.destination_origin,
    allowedTools: json(row.allowed_tools),
    promptDigest: row.prompt_digest,
    policyVersion: row.policy_version,
    policyDigest: row.policy_digest,
    policyEvaluationDigest: row.policy_evaluation_digest,
    decision: row.decision,
    reason: row.reason,
    recordedAt: iso(row.recorded_at),
    decisionDigest: row.decision_digest,
  });
}
function toArtifact(row: Record<string, unknown>): P7ArtifactReferenceRecord {
  return P7ArtifactReferenceRecordSchema.parse({
    id: row.id,
    stableIdentity: row.stable_identity,
    modelWorkId: row.model_work_id,
    providerAttemptId: row.provider_attempt_id,
    kind: row.kind,
    digest: row.digest,
    byteLength: Number(row.byte_length),
    dataClassification: row.data_classification,
    retention: row.retention,
    ...optional(row.deletion_receipt_digest, 'deletionReceiptDigest'),
    validationVerdict: row.validation_verdict,
    createdAt: iso(row.created_at),
  });
}
function toResidue(row: Record<string, unknown>): P7ValidationResidueRecord {
  return P7ValidationResidueRecordSchema.parse({
    id: row.id,
    stableIdentity: row.stable_identity,
    modelWorkId: row.model_work_id,
    providerAttemptId: row.provider_attempt_id,
    artifactId: row.artifact_id,
    verdict: row.verdict,
    code: row.code,
    redactedSummary: row.redacted_summary,
    recordedAt: iso(row.recorded_at),
    residueDigest: row.residue_digest,
  });
}
function toCharge(row: Record<string, unknown>): P7ProviderChargeRecord {
  return P7ProviderChargeRecordSchema.parse({
    id: row.id,
    stableIdentity: row.stable_identity,
    modelWorkId: row.model_work_id,
    providerAttemptId: row.provider_attempt_id,
    reservationId: row.reservation_id,
    providerEffectIdempotencyKey: row.provider_effect_key,
    provider: row.provider,
    providerOperationId: row.provider_operation_id,
    usage: json(row.usage),
    priceVersion: row.price_version,
    currencyConversionPolicy: row.currency_conversion_policy,
    chargedAt: iso(row.charged_at),
    receiptDigest: row.receipt_digest,
  });
}
function toSettlement(row: Record<string, unknown>): P7BudgetSettlementRecord {
  return P7BudgetSettlementRecordSchema.parse({
    id: row.id,
    stableIdentity: row.stable_identity,
    modelWorkId: row.model_work_id,
    reservationId: row.reservation_id,
    providerChargeId: row.provider_charge_id,
    amount: json(row.amount),
    settledAt: iso(row.settled_at),
    receiptDigest: row.receipt_digest,
  });
}
function toRelease(row: Record<string, unknown>): P7BudgetReleaseRecord {
  return P7BudgetReleaseRecordSchema.parse({
    id: row.id,
    stableIdentity: row.stable_identity,
    modelWorkId: row.model_work_id,
    reservationId: row.reservation_id,
    reason: row.reason,
    releasedAt: iso(row.released_at),
    receiptDigest: row.receipt_digest,
  });
}
function toCancellation(
  row: Record<string, unknown>,
): P7CancellationFenceRecord {
  return P7CancellationFenceRecordSchema.parse({
    id: row.id,
    stableIdentity: row.stable_identity,
    modelWorkId: row.model_work_id,
    reservationId: row.reservation_id,
    phase: row.phase,
    reason: row.reason,
    requestedAt: iso(row.requested_at),
    fenceDigest: row.fence_digest,
  });
}
function toLink(row: Record<string, unknown>): P7ReconstructionLinkRecord {
  return P7ReconstructionLinkRecordSchema.parse({
    id: row.id,
    stableIdentity: row.stable_identity,
    modelWorkId: row.model_work_id,
    activityEffectId: row.activity_effect_id,
    topologyAttemptId: row.topology_attempt_id,
    reservationId: row.reservation_id,
    artifactIds: json(row.artifact_ids),
    ...optional(row.provider_charge_id, 'providerChargeId'),
    ...optional(row.settlement_id, 'settlementId'),
    ...optional(row.cancellation_fence_id, 'cancellationFenceId'),
    ...optional(row.completed_receipt_digest, 'completedReceiptDigest'),
    recordedAt: iso(row.recorded_at),
    linkDigest: row.link_digest,
  });
}
