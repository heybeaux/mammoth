import { z } from 'zod';
import {
  ModelWorkBudgetSchema,
  ModelWorkRequestSchema,
  ProviderCapabilityManifestSchema,
  canonicalDigest,
} from '@mammoth/domain';

const DigestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const TimestampSchema = z.string().datetime();
const NonemptySchema = z.string().min(1);

export class P7PersistenceConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'P7PersistenceConflictError';
  }
}

export class P7PersistenceIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'P7PersistenceIntegrityError';
  }
}

export const P7ModelWorkRecordSchema = z
  .object({
    id: NonemptySchema,
    stableIdentity: DigestSchema,
    programId: NonemptySchema,
    topologyId: NonemptySchema,
    cellId: NonemptySchema,
    topologyAttemptId: NonemptySchema,
    reservationId: NonemptySchema,
    request: ModelWorkRequestSchema,
    state: z.enum([
      'planned',
      'in_flight',
      'ambiguous',
      'completed',
      'failed',
      'cancelled',
    ]),
    revision: z.number().int().nonnegative(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict()
  .superRefine((record, context) => {
    if (
      record.stableIdentity !== record.request.identity.identityDigest ||
      record.programId !== record.request.identity.programId ||
      record.topologyId !== record.request.identity.topologyId ||
      record.cellId !== record.request.identity.cellId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'model-work persistence identity does not match request',
      });
    }
  });

export const P7ProviderAttemptRecordSchema = z
  .object({
    id: NonemptySchema,
    stableIdentity: DigestSchema,
    modelWorkId: NonemptySchema,
    modelWorkIdentityDigest: DigestSchema,
    attemptOrdinal: z.number().int().positive(),
    provider: NonemptySchema,
    concreteModel: NonemptySchema,
    checkpoint: NonemptySchema,
    capabilityManifestDigest: DigestSchema,
    request: ModelWorkRequestSchema,
    predecessorAttemptId: NonemptySchema.optional(),
    predecessorReason: NonemptySchema.optional(),
    state: z.enum(['planned', 'in_flight', 'ambiguous', 'completed', 'failed']),
    revision: z.number().int().nonnegative(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict()
  .superRefine((record, context) => {
    if (
      record.stableIdentity !== record.request.attempt.attemptDigest ||
      record.modelWorkIdentityDigest !==
        record.request.identity.identityDigest ||
      record.attemptOrdinal !== record.request.attempt.attemptOrdinal ||
      record.provider !== record.request.attempt.provider ||
      record.concreteModel !== record.request.attempt.concreteModel ||
      record.checkpoint !== record.request.attempt.checkpoint ||
      record.capabilityManifestDigest !==
        record.request.capabilityManifestDigest
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'provider attempt does not match its authoritative request',
      });
    }
    if (
      (record.predecessorAttemptId !== undefined) !==
      record.attemptOrdinal > 1
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'provider retry predecessor does not match attempt ordinal',
      });
    }
    if (
      (record.predecessorAttemptId !== undefined) !==
      (record.predecessorReason !== undefined)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'provider retry predecessor and reason must appear together',
      });
    }
  });

export const P7CapabilityDecisionRecordSchema = digestRecord(
  'p7-capability-decision',
  z
    .object({
      id: NonemptySchema,
      stableIdentity: DigestSchema,
      modelWorkId: NonemptySchema,
      providerAttemptId: NonemptySchema,
      manifest: ProviderCapabilityManifestSchema,
      decision: z.enum(['allowed', 'denied']),
      reason: NonemptySchema,
      recordedAt: TimestampSchema,
      decisionDigest: DigestSchema,
    })
    .strict(),
  'decisionDigest',
);

export const P7EgressDecisionRecordSchema = digestRecord(
  'p7-egress-decision',
  z
    .object({
      id: NonemptySchema,
      stableIdentity: DigestSchema,
      modelWorkId: NonemptySchema,
      providerAttemptId: NonemptySchema,
      reservationId: NonemptySchema,
      dataClassification: z.enum(['local_only', 'cloud_allowed']),
      provider: NonemptySchema,
      concreteModel: NonemptySchema,
      checkpoint: NonemptySchema,
      destinationOrigin: z.string().url(),
      allowedTools: z.array(z.never()).length(0),
      promptDigest: DigestSchema,
      policyVersion: z.literal('1.0.0'),
      policyDigest: DigestSchema,
      policyEvaluationDigest: DigestSchema,
      decision: z.enum(['allowed', 'denied']),
      reason: NonemptySchema,
      recordedAt: TimestampSchema,
      decisionDigest: DigestSchema,
    })
    .strict(),
  'decisionDigest',
);

export const P7ArtifactReferenceRecordSchema = z
  .object({
    id: NonemptySchema,
    stableIdentity: DigestSchema,
    modelWorkId: NonemptySchema,
    providerAttemptId: NonemptySchema,
    kind: z.enum([
      'canonical_prompt',
      'raw_provider_response',
      'typed_output',
      'validation_residue',
    ]),
    digest: DigestSchema,
    byteLength: z.number().int().nonnegative(),
    dataClassification: z.literal('local_only'),
    retention: z.enum(['retained', 'deleted_after_validation']),
    deletionReceiptDigest: DigestSchema.optional(),
    validationVerdict: z.enum(['pending', 'accepted', 'rejected']),
    createdAt: TimestampSchema,
  })
  .strict()
  .superRefine((record, context) => {
    if (
      (record.retention === 'deleted_after_validation') !==
      (record.deletionReceiptDigest !== undefined)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'artifact deletion retention requires exactly one receipt',
      });
    }
  });

export const P7ValidationResidueRecordSchema = digestRecord(
  'p7-validation-residue',
  z
    .object({
      id: NonemptySchema,
      stableIdentity: DigestSchema,
      modelWorkId: NonemptySchema,
      providerAttemptId: NonemptySchema,
      artifactId: NonemptySchema,
      verdict: z.enum(['accepted', 'rejected']),
      code: NonemptySchema,
      redactedSummary: NonemptySchema,
      recordedAt: TimestampSchema,
      residueDigest: DigestSchema,
    })
    .strict(),
  'residueDigest',
);

export const P7ProviderChargeRecordSchema = digestRecord(
  'p7-provider-charge',
  z
    .object({
      id: NonemptySchema,
      stableIdentity: DigestSchema,
      modelWorkId: NonemptySchema,
      providerAttemptId: NonemptySchema,
      reservationId: NonemptySchema,
      providerEffectIdempotencyKey: DigestSchema,
      provider: NonemptySchema,
      providerOperationId: NonemptySchema,
      usage: ModelWorkBudgetSchema,
      priceVersion: NonemptySchema,
      currencyConversionPolicy: NonemptySchema,
      chargedAt: TimestampSchema,
      receiptDigest: DigestSchema,
    })
    .strict(),
  'receiptDigest',
);

export const P7BudgetSettlementRecordSchema = digestRecord(
  'p7-budget-settlement',
  z
    .object({
      id: NonemptySchema,
      stableIdentity: DigestSchema,
      modelWorkId: NonemptySchema,
      reservationId: NonemptySchema,
      providerChargeId: NonemptySchema,
      amount: ModelWorkBudgetSchema,
      settledAt: TimestampSchema,
      receiptDigest: DigestSchema,
    })
    .strict(),
  'receiptDigest',
);

export const P7BudgetReleaseRecordSchema = digestRecord(
  'p7-budget-release',
  z
    .object({
      id: NonemptySchema,
      stableIdentity: DigestSchema,
      modelWorkId: NonemptySchema,
      reservationId: NonemptySchema,
      reason: NonemptySchema,
      releasedAt: TimestampSchema,
      receiptDigest: DigestSchema,
    })
    .strict(),
  'receiptDigest',
);

export const P7CancellationFenceRecordSchema = digestRecord(
  'p7-cancellation-fence',
  z
    .object({
      id: NonemptySchema,
      stableIdentity: DigestSchema,
      modelWorkId: NonemptySchema,
      reservationId: NonemptySchema,
      phase: z.enum([
        'before_call',
        'during_call',
        'after_response_before_cas',
        'after_cas_before_admission',
        'during_settlement',
        'during_synthesis',
      ]),
      reason: NonemptySchema,
      requestedAt: TimestampSchema,
      fenceDigest: DigestSchema,
    })
    .strict(),
  'fenceDigest',
);

export const P7ReconstructionLinkRecordSchema = digestRecord(
  'p7-reconstruction-link',
  z
    .object({
      id: NonemptySchema,
      stableIdentity: DigestSchema,
      modelWorkId: NonemptySchema,
      activityEffectId: NonemptySchema,
      topologyAttemptId: NonemptySchema,
      reservationId: NonemptySchema,
      artifactIds: z.array(NonemptySchema),
      providerChargeId: NonemptySchema.optional(),
      settlementId: NonemptySchema.optional(),
      cancellationFenceId: NonemptySchema.optional(),
      completedReceiptDigest: DigestSchema.optional(),
      recordedAt: TimestampSchema,
      linkDigest: DigestSchema,
    })
    .strict(),
  'linkDigest',
);

export type P7ModelWorkRecord = z.infer<typeof P7ModelWorkRecordSchema>;
export type P7ProviderAttemptRecord = z.infer<
  typeof P7ProviderAttemptRecordSchema
>;
export type P7CapabilityDecisionRecord = z.infer<
  typeof P7CapabilityDecisionRecordSchema
>;
export type P7EgressDecisionRecord = z.infer<
  typeof P7EgressDecisionRecordSchema
>;
export type P7ArtifactReferenceRecord = z.infer<
  typeof P7ArtifactReferenceRecordSchema
>;
export type P7ValidationResidueRecord = z.infer<
  typeof P7ValidationResidueRecordSchema
>;
export type P7ProviderChargeRecord = z.infer<
  typeof P7ProviderChargeRecordSchema
>;
export type P7BudgetSettlementRecord = z.infer<
  typeof P7BudgetSettlementRecordSchema
>;
export type P7BudgetReleaseRecord = z.infer<typeof P7BudgetReleaseRecordSchema>;
export type P7CancellationFenceRecord = z.infer<
  typeof P7CancellationFenceRecordSchema
>;
export type P7ReconstructionLinkRecord = z.infer<
  typeof P7ReconstructionLinkRecordSchema
>;

export interface P7ChargeSettlementInput {
  readonly charge: P7ProviderChargeRecord;
  readonly settlement: P7BudgetSettlementRecord;
}

export interface P7ReconstructedState {
  readonly modelWorks: readonly P7ModelWorkRecord[];
  readonly providerAttempts: readonly P7ProviderAttemptRecord[];
  readonly capabilityDecisions: readonly P7CapabilityDecisionRecord[];
  readonly egressDecisions: readonly P7EgressDecisionRecord[];
  readonly artifacts: readonly P7ArtifactReferenceRecord[];
  readonly validationResidue: readonly P7ValidationResidueRecord[];
  readonly providerCharges: readonly P7ProviderChargeRecord[];
  readonly settlements: readonly P7BudgetSettlementRecord[];
  readonly releases: readonly P7BudgetReleaseRecord[];
  readonly cancellationFences: readonly P7CancellationFenceRecord[];
  readonly reconstructionLinks: readonly P7ReconstructionLinkRecord[];
}

export interface P7ModelWorkRepository {
  recordModelWork(input: P7ModelWorkRecord): Promise<P7ModelWorkRecord>;
  recordProviderAttempt(
    input: P7ProviderAttemptRecord,
  ): Promise<P7ProviderAttemptRecord>;
  recordCapabilityDecision(
    input: P7CapabilityDecisionRecord,
  ): Promise<P7CapabilityDecisionRecord>;
  recordEgressDecision(
    input: P7EgressDecisionRecord,
  ): Promise<P7EgressDecisionRecord>;
  recordArtifact(
    input: P7ArtifactReferenceRecord,
  ): Promise<P7ArtifactReferenceRecord>;
  recordValidationResidue(
    input: P7ValidationResidueRecord,
  ): Promise<P7ValidationResidueRecord>;
  recordChargeAndSettlement(
    input: P7ChargeSettlementInput,
  ): Promise<P7ChargeSettlementInput>;
  recordRelease(input: P7BudgetReleaseRecord): Promise<P7BudgetReleaseRecord>;
  recordCancellationFence(
    input: P7CancellationFenceRecord,
  ): Promise<P7CancellationFenceRecord>;
  recordReconstructionLink(
    input: P7ReconstructionLinkRecord,
  ): Promise<P7ReconstructionLinkRecord>;
  transitionModelWork(input: {
    readonly id: string;
    readonly expectedRevision: number;
    readonly state: P7ModelWorkRecord['state'];
    readonly updatedAt: string;
  }): Promise<P7ModelWorkRecord>;
  transitionProviderAttempt(input: {
    readonly id: string;
    readonly expectedRevision: number;
    readonly state: P7ProviderAttemptRecord['state'];
    readonly updatedAt: string;
  }): Promise<P7ProviderAttemptRecord>;
  reconstructProgram(programId: string): Promise<P7ReconstructedState>;
}

export class InMemoryP7ModelWorkRepository implements P7ModelWorkRepository {
  readonly #modelWorks = new Map<string, P7ModelWorkRecord>();
  readonly #attempts = new Map<string, P7ProviderAttemptRecord>();
  readonly #capabilities = new Map<string, P7CapabilityDecisionRecord>();
  readonly #egress = new Map<string, P7EgressDecisionRecord>();
  readonly #artifacts = new Map<string, P7ArtifactReferenceRecord>();
  readonly #residue = new Map<string, P7ValidationResidueRecord>();
  readonly #charges = new Map<string, P7ProviderChargeRecord>();
  readonly #settlements = new Map<string, P7BudgetSettlementRecord>();
  readonly #releases = new Map<string, P7BudgetReleaseRecord>();
  readonly #cancellations = new Map<string, P7CancellationFenceRecord>();
  readonly #links = new Map<string, P7ReconstructionLinkRecord>();

  async recordModelWork(input: P7ModelWorkRecord) {
    await boundary();
    const record = P7ModelWorkRecordSchema.parse(input);
    requireInitial(record.state, record.revision, 'model work');
    return this.#insert(this.#modelWorks, record);
  }

  async recordProviderAttempt(input: P7ProviderAttemptRecord) {
    await boundary();
    const record = P7ProviderAttemptRecordSchema.parse(input);
    requireInitial(record.state, record.revision, 'provider attempt');
    const work = this.#require(
      this.#modelWorks,
      record.modelWorkId,
      'model work',
    );
    if (
      record.modelWorkIdentityDigest !== work.stableIdentity ||
      record.request.identity.identityDigest !== work.stableIdentity
    ) {
      throw new P7PersistenceIntegrityError(
        'provider attempt identity mismatch',
      );
    }
    if (record.predecessorAttemptId) {
      const predecessor = this.#require(
        this.#attempts,
        record.predecessorAttemptId,
        'provider predecessor attempt',
      );
      if (
        predecessor.modelWorkId !== record.modelWorkId ||
        predecessor.state !== 'failed' ||
        record.request.attempt.predecessorAttemptDigest !==
          predecessor.stableIdentity
      ) {
        throw new P7PersistenceConflictError(
          'provider predecessor is not terminal',
        );
      }
    } else if (
      record.attemptOrdinal !== 1 ||
      record.stableIdentity !== work.request.attempt.attemptDigest
    ) {
      throw new P7PersistenceIntegrityError(
        'initial provider attempt does not match model-work request',
      );
    }
    if (this.#hasCancellation(record.modelWorkId)) {
      throw new P7PersistenceConflictError(
        'cancelled model work cannot start a provider attempt',
      );
    }
    return this.#insert(this.#attempts, record);
  }

  async recordCapabilityDecision(input: P7CapabilityDecisionRecord) {
    await boundary();
    const record = P7CapabilityDecisionRecordSchema.parse(input);
    const { attempt } = this.#requireAttempt(
      record.modelWorkId,
      record.providerAttemptId,
    );
    if (
      record.manifest.manifestDigest !== attempt.capabilityManifestDigest ||
      record.manifest.provider !== attempt.provider ||
      record.manifest.concreteModel !== attempt.concreteModel ||
      record.manifest.checkpoint !== attempt.checkpoint
    ) {
      throw new P7PersistenceIntegrityError(
        'capability decision manifest mismatch',
      );
    }
    return this.#insert(this.#capabilities, record);
  }

  async recordEgressDecision(input: P7EgressDecisionRecord) {
    await boundary();
    const record = P7EgressDecisionRecordSchema.parse(input);
    const { work, attempt } = this.#requireAttempt(
      record.modelWorkId,
      record.providerAttemptId,
    );
    if (
      record.reservationId !== work.reservationId ||
      record.provider !== attempt.provider ||
      record.concreteModel !== attempt.concreteModel ||
      record.checkpoint !== attempt.checkpoint ||
      record.promptDigest !== attempt.request.canonicalPromptDigest
    ) {
      throw new P7PersistenceIntegrityError(
        'egress decision identity mismatch',
      );
    }
    return this.#insert(this.#egress, record);
  }

  async recordArtifact(input: P7ArtifactReferenceRecord) {
    await boundary();
    const record = P7ArtifactReferenceRecordSchema.parse(input);
    this.#requireAttempt(record.modelWorkId, record.providerAttemptId);
    return this.#insert(this.#artifacts, record);
  }

  async recordValidationResidue(input: P7ValidationResidueRecord) {
    await boundary();
    const record = P7ValidationResidueRecordSchema.parse(input);
    this.#requireAttempt(record.modelWorkId, record.providerAttemptId);
    const artifact = this.#require(
      this.#artifacts,
      record.artifactId,
      'artifact',
    );
    if (
      artifact.modelWorkId !== record.modelWorkId ||
      artifact.providerAttemptId !== record.providerAttemptId
    ) {
      throw new P7PersistenceIntegrityError(
        'validation residue artifact mismatch',
      );
    }
    return this.#insert(this.#residue, record);
  }

  async recordChargeAndSettlement(input: P7ChargeSettlementInput) {
    await boundary();
    const charge = P7ProviderChargeRecordSchema.parse(input.charge);
    const settlement = P7BudgetSettlementRecordSchema.parse(input.settlement);
    const { work, attempt } = this.#requireAttempt(
      charge.modelWorkId,
      charge.providerAttemptId,
    );
    if (
      charge.reservationId !== work.reservationId ||
      charge.providerEffectIdempotencyKey !==
        attempt.request.effect.idempotencyKey ||
      charge.provider !== attempt.provider ||
      settlement.modelWorkId !== charge.modelWorkId ||
      settlement.reservationId !== charge.reservationId ||
      settlement.providerChargeId !== charge.id ||
      canonicalDigest(settlement.amount) !== canonicalDigest(charge.usage)
    ) {
      throw new P7PersistenceIntegrityError(
        'charge and settlement identity mismatch',
      );
    }
    if (
      charge.usage.inputTokens > attempt.request.budget.inputTokens ||
      charge.usage.outputTokens > attempt.request.budget.outputTokens ||
      charge.usage.currencyMicros > attempt.request.budget.currencyMicros ||
      charge.usage.wallClockMs > attempt.request.budget.wallClockMs
    ) {
      throw new P7PersistenceConflictError(
        'provider charge exceeds reserved budget',
      );
    }
    const existingCharge = this.#findStable(
      this.#charges,
      charge.stableIdentity,
    );
    const existingSettlement = this.#findStable(
      this.#settlements,
      settlement.stableIdentity,
    );
    if (existingCharge || existingSettlement) {
      if (!existingCharge || !existingSettlement) {
        throw new P7PersistenceIntegrityError(
          'partial charge settlement state',
        );
      }
      this.#assertSame(existingCharge, charge);
      this.#assertSame(existingSettlement, settlement);
      return copy({ charge: existingCharge, settlement: existingSettlement });
    }
    if (
      [...this.#charges.values()].some(
        (row) =>
          row.providerEffectIdempotencyKey ===
            charge.providerEffectIdempotencyKey ||
          (row.provider === charge.provider &&
            row.providerOperationId === charge.providerOperationId),
      ) ||
      [...this.#settlements.values()].some(
        (row) => row.reservationId === settlement.reservationId,
      )
    ) {
      throw new P7PersistenceConflictError(
        'provider effect or reservation already settled',
      );
    }
    this.#charges.set(charge.id, copy(charge));
    this.#settlements.set(settlement.id, copy(settlement));
    return copy({ charge, settlement });
  }

  async recordRelease(input: P7BudgetReleaseRecord) {
    await boundary();
    const record = P7BudgetReleaseRecordSchema.parse(input);
    const work = this.#require(
      this.#modelWorks,
      record.modelWorkId,
      'model work',
    );
    if (record.reservationId !== work.reservationId) {
      throw new P7PersistenceIntegrityError(
        'budget release reservation mismatch',
      );
    }
    if (
      [...this.#settlements.values()].some(
        (row) => row.reservationId === record.reservationId,
      )
    ) {
      throw new P7PersistenceConflictError(
        'settled reservation cannot be released',
      );
    }
    return this.#insert(this.#releases, record);
  }

  async recordCancellationFence(input: P7CancellationFenceRecord) {
    await boundary();
    const record = P7CancellationFenceRecordSchema.parse(input);
    const work = this.#require(
      this.#modelWorks,
      record.modelWorkId,
      'model work',
    );
    if (record.reservationId !== work.reservationId) {
      throw new P7PersistenceIntegrityError(
        'cancellation reservation mismatch',
      );
    }
    return this.#insert(this.#cancellations, record);
  }

  async recordReconstructionLink(input: P7ReconstructionLinkRecord) {
    await boundary();
    const record = P7ReconstructionLinkRecordSchema.parse(input);
    const work = this.#require(
      this.#modelWorks,
      record.modelWorkId,
      'model work',
    );
    if (
      record.topologyAttemptId !== work.topologyAttemptId ||
      record.reservationId !== work.reservationId ||
      record.artifactIds.some((id) => !this.#artifacts.has(id)) ||
      record.artifactIds.some(
        (id) => this.#artifacts.get(id)?.modelWorkId !== record.modelWorkId,
      ) ||
      (record.providerChargeId &&
        this.#charges.get(record.providerChargeId)?.modelWorkId !==
          record.modelWorkId) ||
      (record.settlementId &&
        this.#settlements.get(record.settlementId)?.modelWorkId !==
          record.modelWorkId) ||
      (record.settlementId !== undefined &&
        record.providerChargeId === undefined) ||
      (record.settlementId !== undefined &&
        this.#settlements.get(record.settlementId)?.providerChargeId !==
          record.providerChargeId) ||
      (record.cancellationFenceId &&
        this.#cancellations.get(record.cancellationFenceId)?.modelWorkId !==
          record.modelWorkId)
    ) {
      throw new P7PersistenceIntegrityError(
        'reconstruction link is incomplete',
      );
    }
    return this.#insert(this.#links, record);
  }

  async transitionModelWork(input: {
    readonly id: string;
    readonly expectedRevision: number;
    readonly state: P7ModelWorkRecord['state'];
    readonly updatedAt: string;
  }) {
    await boundary();
    const work = this.#require(this.#modelWorks, input.id, 'model work');
    TimestampSchema.parse(input.updatedAt);
    if (work.revision !== input.expectedRevision) {
      throw new P7PersistenceConflictError('stale model-work revision');
    }
    if (this.#hasCancellation(work.id) && input.state === 'completed') {
      throw new P7PersistenceConflictError(
        'cancelled model work cannot complete',
      );
    }
    if (input.state === 'completed' && !this.#canComplete(work.id)) {
      throw new P7PersistenceIntegrityError(
        'model work cannot complete without allowed decisions, accepted output, and settlement',
      );
    }
    if (!allowedTransition(work.state, input.state)) {
      throw new P7PersistenceConflictError('model-work transition is invalid');
    }
    const updated = {
      ...work,
      state: input.state,
      revision: work.revision + 1,
      updatedAt: input.updatedAt,
    };
    this.#modelWorks.set(work.id, copy(updated));
    return copy(updated);
  }

  async transitionProviderAttempt(input: {
    readonly id: string;
    readonly expectedRevision: number;
    readonly state: P7ProviderAttemptRecord['state'];
    readonly updatedAt: string;
  }) {
    await boundary();
    const attempt = this.#require(this.#attempts, input.id, 'provider attempt');
    TimestampSchema.parse(input.updatedAt);
    if (attempt.revision !== input.expectedRevision) {
      throw new P7PersistenceConflictError('stale provider-attempt revision');
    }
    if (!allowedAttemptTransition(attempt.state, input.state)) {
      throw new P7PersistenceConflictError(
        'provider-attempt transition is invalid',
      );
    }
    const updated = {
      ...attempt,
      state: input.state,
      revision: attempt.revision + 1,
      updatedAt: input.updatedAt,
    };
    this.#attempts.set(attempt.id, copy(updated));
    return copy(updated);
  }

  async reconstructProgram(programId: string): Promise<P7ReconstructedState> {
    await boundary();
    const works = [...this.#modelWorks.values()].filter(
      (row) => row.programId === programId,
    );
    const workIds = new Set(works.map((row) => row.id));
    const select = <T extends { readonly modelWorkId: string }>(
      map: ReadonlyMap<string, T>,
    ) =>
      [...map.values()].filter((row) => workIds.has(row.modelWorkId)).map(copy);
    return {
      modelWorks: works.map(copy),
      providerAttempts: select(this.#attempts),
      capabilityDecisions: select(this.#capabilities),
      egressDecisions: select(this.#egress),
      artifacts: select(this.#artifacts),
      validationResidue: select(this.#residue),
      providerCharges: select(this.#charges),
      settlements: select(this.#settlements),
      releases: select(this.#releases),
      cancellationFences: select(this.#cancellations),
      reconstructionLinks: select(this.#links),
    };
  }

  #requireAttempt(modelWorkId: string, attemptId: string) {
    const work = this.#require(this.#modelWorks, modelWorkId, 'model work');
    const attempt = this.#require(
      this.#attempts,
      attemptId,
      'provider attempt',
    );
    if (attempt.modelWorkId !== work.id) {
      throw new P7PersistenceIntegrityError(
        'provider attempt model-work mismatch',
      );
    }
    return { work, attempt };
  }

  #hasCancellation(modelWorkId: string) {
    return [...this.#cancellations.values()].some(
      (row) => row.modelWorkId === modelWorkId,
    );
  }

  #canComplete(modelWorkId: string): boolean {
    return [...this.#attempts.values()].some(
      (attempt) =>
        attempt.modelWorkId === modelWorkId &&
        attempt.state === 'completed' &&
        [...this.#capabilities.values()].some(
          (decision) =>
            decision.providerAttemptId === attempt.id &&
            decision.decision === 'allowed',
        ) &&
        [...this.#egress.values()].some(
          (decision) =>
            decision.providerAttemptId === attempt.id &&
            decision.decision === 'allowed',
        ) &&
        [...this.#artifacts.values()].some(
          (artifact) =>
            artifact.providerAttemptId === attempt.id &&
            artifact.kind === 'typed_output' &&
            artifact.validationVerdict === 'accepted',
        ) &&
        [...this.#charges.values()].some(
          (charge) =>
            charge.providerAttemptId === attempt.id &&
            [...this.#settlements.values()].some(
              (settlement) =>
                settlement.providerChargeId === charge.id &&
                settlement.modelWorkId === modelWorkId,
            ),
        ),
    );
  }

  #insert<T extends { readonly id: string; readonly stableIdentity: string }>(
    map: Map<string, T>,
    record: T,
  ): T {
    const stable = this.#findStable(map, record.stableIdentity);
    if (stable) {
      this.#assertSame(stable, record);
      return copy(stable);
    }
    const id = map.get(record.id);
    if (id) {
      this.#assertSame(id, record);
      return copy(id);
    }
    map.set(record.id, copy(record));
    return copy(record);
  }

  #findStable<T extends { readonly stableIdentity: string }>(
    map: ReadonlyMap<string, T>,
    stableIdentity: string,
  ): T | undefined {
    return [...map.values()].find(
      (record) => record.stableIdentity === stableIdentity,
    );
  }

  #assertSame(left: unknown, right: unknown): void {
    if (canonicalDigest(left) !== canonicalDigest(right)) {
      throw new P7PersistenceConflictError(
        'stable identity was reused for different data',
      );
    }
  }

  #require<T>(map: ReadonlyMap<string, T>, id: string, name: string): T {
    const value = map.get(id);
    if (!value) throw new P7PersistenceIntegrityError(`${name} is missing`);
    return value;
  }
}

function digestRecord<T extends z.ZodTypeAny>(
  kind: string,
  schema: T,
  field: string,
): z.ZodEffects<T, z.output<T>, z.input<T>> {
  return schema.superRefine((value, context) => {
    const record = value as Record<string, unknown>;
    const expected = canonicalDigest({
      kind,
      ...Object.fromEntries(
        Object.entries(record).filter(([key]) => key !== field),
      ),
    });
    if (record[field] !== expected) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [field],
        message: `${kind} digest is not canonical`,
      });
    }
  }) as z.ZodEffects<T, z.output<T>, z.input<T>>;
}

function allowedTransition(
  from: P7ModelWorkRecord['state'],
  to: P7ModelWorkRecord['state'],
): boolean {
  const allowed: Record<
    P7ModelWorkRecord['state'],
    readonly P7ModelWorkRecord['state'][]
  > = {
    planned: ['in_flight', 'cancelled', 'failed'],
    in_flight: ['ambiguous', 'completed', 'failed', 'cancelled'],
    ambiguous: ['completed', 'failed', 'cancelled'],
    completed: [],
    failed: [],
    cancelled: [],
  };
  return allowed[from].includes(to);
}

function allowedAttemptTransition(
  from: P7ProviderAttemptRecord['state'],
  to: P7ProviderAttemptRecord['state'],
): boolean {
  const allowed: Record<
    P7ProviderAttemptRecord['state'],
    readonly P7ProviderAttemptRecord['state'][]
  > = {
    planned: ['in_flight', 'failed'],
    in_flight: ['ambiguous', 'completed', 'failed'],
    ambiguous: ['completed', 'failed'],
    completed: [],
    failed: [],
  };
  return allowed[from].includes(to);
}

function requireInitial(
  state: string,
  revision: number,
  subject: string,
): void {
  if (state !== 'planned' || revision !== 0) {
    throw new P7PersistenceIntegrityError(
      `new ${subject} must start planned at revision zero`,
    );
  }
}

function copy<T>(value: T): T {
  return structuredClone(value);
}

function boundary(): Promise<void> {
  return Promise.resolve();
}
