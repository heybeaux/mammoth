import { describe, expect, it } from 'vitest';
import {
  MODEL_WORK_POLICY_VERSION,
  MODEL_WORK_REQUEST_SCHEMA_VERSION,
  MODEL_WORK_RESULT_SCHEMA_VERSION,
  PROVIDER_CAPABILITY_MANIFEST_VERSION,
  canonicalDigest,
  modelWorkIdentityDigest,
  providerAttemptIdentityDigest,
  providerCapabilityManifestDigest,
  providerEffectIdentityDigest,
  type ModelWorkIdentity,
  type ModelWorkRequest,
  type ProviderAttemptIdentity,
  type ProviderCapabilityManifest,
  type ProviderEffectIdentity,
} from '@mammoth/domain';
import {
  InMemoryP7ModelWorkRepository,
  P7PersistenceConflictError,
  P7PersistenceIntegrityError,
  P7ProviderUsageSchema,
  type P7ArtifactReferenceRecord,
  type P7BudgetSettlementRecord,
  type P7CancellationFenceRecord,
  type P7CapabilityDecisionRecord,
  type P7EgressDecisionRecord,
  type P7ModelWorkRecord,
  type P7ProviderAttemptRecord,
  type P7ProviderChargeRecord,
  type P7ReconstructionLinkRecord,
} from '../src/index.js';

const now = '2026-07-14T07:00:00.000Z';
const later = '2026-07-14T07:01:00.000Z';
const digestA = canonicalDigest({ fixture: 'a' });
const digestB = canonicalDigest({ fixture: 'b' });
const digestC = canonicalDigest({ fixture: 'c' });

function identity(): ModelWorkIdentity {
  const base: ModelWorkIdentity = {
    programId: 'program-1',
    topologyId: 'topology-1',
    topologyDigest: digestA,
    cellId: 'cell-1',
    criterionId: 'criterion-1',
    criterionVersion: 1,
    criterionDigest: digestB,
    workItemContractDigest: digestA,
    promptTemplateDigest: digestB,
    canonicalInputDigest: digestC,
    modelProfileVersionId: 'profile-1',
    modelProfileVersionDigest: digestA,
    policyVersion: MODEL_WORK_POLICY_VERSION,
    policyDigest: digestB,
    toolContractDigest: digestC,
    outputSchemaDigest: digestA,
    identityDigest: digestA,
  };
  return { ...base, identityDigest: modelWorkIdentityDigest(base) };
}

function manifest(): ProviderCapabilityManifest {
  const base: ProviderCapabilityManifest = {
    schemaVersion: PROVIDER_CAPABILITY_MANIFEST_VERSION,
    provider: 'fixture-provider',
    concreteModel: 'fixture-model',
    checkpoint: 'fixture-checkpoint',
    modalities: ['text'],
    contextWindowTokens: 8192,
    supportsJsonOutput: true,
    supportsSeed: true,
    manifestDigest: digestA,
  };
  return {
    ...base,
    manifestDigest: providerCapabilityManifestDigest(base),
  };
}

function request(
  modelIdentity = identity(),
  ordinal = 1,
  predecessorAttemptDigest?: string,
): ModelWorkRequest {
  const attemptBase: ProviderAttemptIdentity = {
    modelWorkIdentityDigest: modelIdentity.identityDigest,
    attemptOrdinal: ordinal,
    provider: 'fixture-provider',
    concreteModel: 'fixture-model',
    checkpoint: 'fixture-checkpoint',
    ...(predecessorAttemptDigest ? { predecessorAttemptDigest } : {}),
    attemptDigest: digestA,
  };
  const attempt = {
    ...attemptBase,
    attemptDigest: providerAttemptIdentityDigest(attemptBase),
  };
  const effectBase: ProviderEffectIdentity = {
    providerAttemptDigest: attempt.attemptDigest,
    modelWorkIdentityDigest: modelIdentity.identityDigest,
    operationKind: 'chat_completion',
    canonicalRequestDigest: canonicalDigest({ ordinal }),
    idempotencyKey: digestA,
  };
  const effect = {
    ...effectBase,
    idempotencyKey: providerEffectIdentityDigest(effectBase),
  };
  return {
    schemaVersion: MODEL_WORK_REQUEST_SCHEMA_VERSION,
    identity: modelIdentity,
    attempt,
    effect,
    capabilityManifestDigest: manifest().manifestDigest,
    canonicalPromptDigest: digestB,
    budget: {
      inputTokens: 100,
      outputTokens: 50,
      currencyMicros: 1_000,
      wallClockMs: 30_000,
      toolCalls: 0,
    },
    outputSchemaVersion: MODEL_WORK_RESULT_SCHEMA_VERSION,
  };
}

function modelWork(authoritativeRequest = request()): P7ModelWorkRecord {
  return {
    id: 'model-work-1',
    stableIdentity: authoritativeRequest.identity.identityDigest,
    programId: authoritativeRequest.identity.programId,
    topologyId: authoritativeRequest.identity.topologyId,
    cellId: authoritativeRequest.identity.cellId,
    topologyAttemptId: 'topology-attempt-1',
    reservationId: 'reservation-1',
    request: authoritativeRequest,
    state: 'planned',
    revision: 0,
    createdAt: now,
    updatedAt: now,
  };
}

function attemptRecord(
  authoritativeRequest: ModelWorkRequest,
  options: {
    readonly id?: string;
    readonly predecessorAttemptId?: string;
    readonly predecessorReason?: string;
  } = {},
): P7ProviderAttemptRecord {
  return {
    id: options.id ?? 'provider-attempt-1',
    stableIdentity: authoritativeRequest.attempt.attemptDigest,
    modelWorkId: 'model-work-1',
    modelWorkIdentityDigest:
      authoritativeRequest.attempt.modelWorkIdentityDigest,
    attemptOrdinal: authoritativeRequest.attempt.attemptOrdinal,
    provider: authoritativeRequest.attempt.provider,
    concreteModel: authoritativeRequest.attempt.concreteModel,
    checkpoint: authoritativeRequest.attempt.checkpoint,
    capabilityManifestDigest: authoritativeRequest.capabilityManifestDigest,
    request: authoritativeRequest,
    ...(options.predecessorAttemptId
      ? { predecessorAttemptId: options.predecessorAttemptId }
      : {}),
    ...(options.predecessorReason
      ? { predecessorReason: options.predecessorReason }
      : {}),
    state: 'planned',
    revision: 0,
    createdAt: now,
    updatedAt: now,
  };
}

function signed<T extends Record<string, unknown>, F extends string>(
  kind: string,
  field: F,
  value: T,
): T & Record<F, string> {
  return {
    ...value,
    [field]: canonicalDigest({ kind, ...value }),
  };
}

function chargeSettlement(authoritativeRequest: ModelWorkRequest) {
  const usage = {
    inputTokens: 20,
    outputTokens: 10,
    currencyMicros: 400,
    wallClockMs: 500,
    toolCalls: 0 as const,
  };
  const charge = signed('p7-provider-charge', 'receiptDigest', {
    id: 'charge-1',
    stableIdentity: canonicalDigest({ charge: 1 }),
    modelWorkId: 'model-work-1',
    providerAttemptId: 'provider-attempt-1',
    reservationId: 'reservation-1',
    providerEffectIdempotencyKey: authoritativeRequest.effect.idempotencyKey,
    provider: authoritativeRequest.attempt.provider,
    providerOperationId: 'operation-1',
    usage,
    priceVersion: 'fixture-v1',
    currencyConversionPolicy: 'none-local-zero-fx',
    chargedAt: later,
  }) as P7ProviderChargeRecord;
  const settlement = signed('p7-budget-settlement', 'receiptDigest', {
    id: 'settlement-1',
    stableIdentity: canonicalDigest({ settlement: 1 }),
    modelWorkId: 'model-work-1',
    reservationId: 'reservation-1',
    providerChargeId: charge.id,
    amount: usage,
    settledAt: later,
  }) as P7BudgetSettlementRecord;
  return { charge, settlement };
}

describe('P7 model-work persistence', () => {
  it('accepts zero-duration provider usage while request ceilings stay positive', () => {
    expect(
      P7ProviderUsageSchema.parse({
        inputTokens: 0,
        outputTokens: 0,
        currencyMicros: 0,
        wallClockMs: 0,
        toolCalls: 0,
      }),
    ).toMatchObject({ wallClockMs: 0 });
  });
  it('replays stable identities and rejects conflicting reuse', async () => {
    const repository = new InMemoryP7ModelWorkRepository();
    const work = modelWork();
    await expect(repository.recordModelWork(work)).resolves.toEqual(work);
    await expect(repository.recordModelWork(work)).resolves.toEqual(work);
    await expect(
      repository.recordModelWork({ ...work, reservationId: 'other' }),
    ).rejects.toBeInstanceOf(P7PersistenceConflictError);
  });

  it('requires terminal predecessor attribution for policy retries', async () => {
    const repository = new InMemoryP7ModelWorkRepository();
    const firstRequest = request();
    const firstAttempt = attemptRecord(firstRequest);
    await repository.recordModelWork(modelWork(firstRequest));
    await repository.recordProviderAttempt(firstAttempt);

    const secondRequest = request(
      firstRequest.identity,
      2,
      firstAttempt.stableIdentity,
    );
    const secondAttempt = attemptRecord(secondRequest, {
      id: 'provider-attempt-2',
      predecessorAttemptId: firstAttempt.id,
      predecessorReason: 'provider_unavailable',
    });
    await expect(
      repository.recordProviderAttempt(secondAttempt),
    ).rejects.toBeInstanceOf(P7PersistenceConflictError);

    await repository.transitionProviderAttempt({
      id: firstAttempt.id,
      expectedRevision: 0,
      state: 'in_flight',
      updatedAt: later,
    });
    await repository.transitionProviderAttempt({
      id: firstAttempt.id,
      expectedRevision: 1,
      state: 'failed',
      updatedAt: later,
    });
    await expect(
      repository.recordProviderAttempt(secondAttempt),
    ).resolves.toEqual(secondAttempt);
  });

  it('atomically deduplicates provider charge and budget settlement', async () => {
    const repository = new InMemoryP7ModelWorkRepository();
    const authoritativeRequest = request();
    await repository.recordModelWork(modelWork(authoritativeRequest));
    await repository.recordProviderAttempt(attemptRecord(authoritativeRequest));
    const pair = chargeSettlement(authoritativeRequest);

    await expect(repository.recordChargeAndSettlement(pair)).resolves.toEqual(
      pair,
    );
    await expect(repository.recordChargeAndSettlement(pair)).resolves.toEqual(
      pair,
    );
    await expect(
      repository.recordChargeAndSettlement({
        ...pair,
        charge: {
          ...pair.charge,
          usage: { ...pair.charge.usage, inputTokens: 101 },
        },
      }),
    ).rejects.toThrow();
    await repository.transitionModelWork({
      id: 'model-work-1',
      expectedRevision: 0,
      state: 'in_flight',
      updatedAt: later,
    });
    await repository.transitionProviderAttempt({
      id: 'provider-attempt-1',
      expectedRevision: 0,
      state: 'in_flight',
      updatedAt: later,
    });
    await repository.transitionProviderAttempt({
      id: 'provider-attempt-1',
      expectedRevision: 1,
      state: 'completed',
      updatedAt: later,
    });
    await expect(
      repository.transitionModelWork({
        id: 'model-work-1',
        expectedRevision: 1,
        state: 'completed',
        updatedAt: later,
      }),
    ).rejects.toThrow(/completion authority|allowed decisions/u);
  });

  it('keeps cost and CAS residue after cancellation but fences completion', async () => {
    const repository = new InMemoryP7ModelWorkRepository();
    const authoritativeRequest = request();
    await repository.recordModelWork(modelWork(authoritativeRequest));
    await repository.recordProviderAttempt(attemptRecord(authoritativeRequest));
    await repository.transitionModelWork({
      id: 'model-work-1',
      expectedRevision: 0,
      state: 'in_flight',
      updatedAt: later,
    });
    const fence = signed('p7-cancellation-fence', 'fenceDigest', {
      id: 'fence-1',
      stableIdentity: canonicalDigest({ fence: 1 }),
      modelWorkId: 'model-work-1',
      reservationId: 'reservation-1',
      phase: 'after_response_before_cas',
      reason: 'operator_cancelled',
      requestedAt: later,
    }) as P7CancellationFenceRecord;
    await repository.recordCancellationFence(fence);
    const artifact: P7ArtifactReferenceRecord = {
      id: 'artifact-1',
      stableIdentity: canonicalDigest({ artifact: 1 }),
      modelWorkId: 'model-work-1',
      providerAttemptId: 'provider-attempt-1',
      kind: 'raw_provider_response',
      digest: canonicalDigest({ raw: 'bytes' }),
      byteLength: 42,
      dataClassification: 'local_only',
      retention: 'retained',
      validationVerdict: 'rejected',
      createdAt: later,
    };
    await expect(repository.recordArtifact(artifact)).resolves.toEqual(
      artifact,
    );
    await expect(
      repository.recordChargeAndSettlement(
        chargeSettlement(authoritativeRequest),
      ),
    ).resolves.toBeDefined();
    await expect(
      repository.transitionModelWork({
        id: 'model-work-1',
        expectedRevision: 1,
        state: 'completed',
        updatedAt: later,
      }),
    ).rejects.toBeInstanceOf(P7PersistenceConflictError);
  });

  it('completes only after one attempt has the full governed authority chain', async () => {
    const repository = new InMemoryP7ModelWorkRepository();
    const authoritativeRequest = request();
    await repository.recordModelWork(modelWork(authoritativeRequest));
    await repository.recordProviderAttempt(attemptRecord(authoritativeRequest));
    const capability = signed('p7-capability-decision', 'decisionDigest', {
      id: 'capability-1',
      stableIdentity: canonicalDigest({ capability: 1 }),
      modelWorkId: 'model-work-1',
      providerAttemptId: 'provider-attempt-1',
      manifest: manifest(),
      decision: 'allowed',
      reason: 'manifest_matches_profile',
      recordedAt: now,
    }) as P7CapabilityDecisionRecord;
    const egress = signed('p7-egress-decision', 'decisionDigest', {
      id: 'egress-1',
      stableIdentity: canonicalDigest({ egress: 1 }),
      modelWorkId: 'model-work-1',
      providerAttemptId: 'provider-attempt-1',
      reservationId: 'reservation-1',
      dataClassification: 'local_only',
      provider: authoritativeRequest.attempt.provider,
      concreteModel: authoritativeRequest.attempt.concreteModel,
      checkpoint: authoritativeRequest.attempt.checkpoint,
      destinationOrigin: 'http://127.0.0.1:11434',
      allowedTools: [],
      promptDigest: authoritativeRequest.canonicalPromptDigest,
      policyVersion: '1.0.0',
      policyDigest: digestC,
      policyEvaluationDigest: digestA,
      decision: 'allowed',
      reason: 'local_loopback_allowed',
      recordedAt: now,
    }) as P7EgressDecisionRecord;
    await repository.recordCapabilityDecision(capability);
    await repository.recordEgressDecision(egress);
    await repository.recordArtifact({
      id: 'typed-output-1',
      stableIdentity: canonicalDigest({ artifact: 'typed' }),
      modelWorkId: 'model-work-1',
      providerAttemptId: 'provider-attempt-1',
      kind: 'typed_output',
      digest: canonicalDigest({ output: 'accepted' }),
      byteLength: 128,
      dataClassification: 'local_only',
      retention: 'retained',
      validationVerdict: 'accepted',
      createdAt: later,
    });
    await repository.recordChargeAndSettlement(
      chargeSettlement(authoritativeRequest),
    );
    await repository.transitionModelWork({
      id: 'model-work-1',
      expectedRevision: 0,
      state: 'in_flight',
      updatedAt: later,
    });
    await repository.transitionProviderAttempt({
      id: 'provider-attempt-1',
      expectedRevision: 0,
      state: 'in_flight',
      updatedAt: later,
    });
    await repository.transitionProviderAttempt({
      id: 'provider-attempt-1',
      expectedRevision: 1,
      state: 'completed',
      updatedAt: later,
    });
    await expect(
      repository.transitionModelWork({
        id: 'model-work-1',
        expectedRevision: 1,
        state: 'completed',
        updatedAt: later,
      }),
    ).resolves.toMatchObject({ state: 'completed', revision: 2 });
  });

  it('reconstructs only complete, same-program links', async () => {
    const repository = new InMemoryP7ModelWorkRepository();
    const authoritativeRequest = request();
    await repository.recordModelWork(modelWork(authoritativeRequest));
    await repository.recordProviderAttempt(attemptRecord(authoritativeRequest));
    const artifact: P7ArtifactReferenceRecord = {
      id: 'artifact-1',
      stableIdentity: canonicalDigest({ artifact: 1 }),
      modelWorkId: 'model-work-1',
      providerAttemptId: 'provider-attempt-1',
      kind: 'canonical_prompt',
      digest: authoritativeRequest.canonicalPromptDigest,
      byteLength: 12,
      dataClassification: 'local_only',
      retention: 'retained',
      validationVerdict: 'accepted',
      createdAt: now,
    };
    await repository.recordArtifact(artifact);
    const link = signed('p7-reconstruction-link', 'linkDigest', {
      id: 'link-1',
      stableIdentity: canonicalDigest({ link: 1 }),
      modelWorkId: 'model-work-1',
      activityEffectId: 'activity-effect-1',
      topologyAttemptId: 'topology-attempt-1',
      reservationId: 'reservation-1',
      artifactIds: [artifact.id],
      recordedAt: later,
    }) as P7ReconstructionLinkRecord;
    await repository.recordReconstructionLink(link);
    await expect(
      repository.reconstructProgram('program-1'),
    ).resolves.toMatchObject({
      modelWorks: [{ id: 'model-work-1' }],
      providerAttempts: [{ id: 'provider-attempt-1' }],
      artifacts: [{ id: 'artifact-1' }],
      reconstructionLinks: [{ id: 'link-1' }],
    });
    await expect(repository.reconstructProgram('other')).resolves.toMatchObject(
      {
        modelWorks: [],
        reconstructionLinks: [],
      },
    );

    const { linkDigest: _linkDigest, ...linkWithoutDigest } = link;
    void _linkDigest;
    const broken = signed('p7-reconstruction-link', 'linkDigest', {
      ...linkWithoutDigest,
      id: 'link-broken',
      stableIdentity: canonicalDigest({ link: 'broken' }),
      artifactIds: ['missing'],
    }) as P7ReconstructionLinkRecord;
    await expect(
      repository.recordReconstructionLink(broken),
    ).rejects.toBeInstanceOf(P7PersistenceIntegrityError);
  });
});
