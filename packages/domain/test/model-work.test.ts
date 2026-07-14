import { describe, expect, it } from 'vitest';
import {
  MODEL_WORK_POLICY_VERSION,
  MODEL_WORK_REQUEST_SCHEMA_VERSION,
  MODEL_WORK_RESULT_SCHEMA_VERSION,
  PROVIDER_CAPABILITY_MANIFEST_VERSION,
  ModelWorkRequestSchema,
  ModelWorkResultSchema,
  ProviderAttemptIdentitySchema,
  ProviderCapabilityManifestSchema,
  ProviderErrorSchema,
  isRetryableProviderError,
  modelWorkIdentityDigest,
  modelWorkPolicyDigest,
  providerAttemptIdentityDigest,
  providerCapabilityManifestDigest,
  providerEffectIdentityDigest,
  requiresProviderReconciliation,
  typedModelOutputDigest,
  type ModelWorkIdentity,
  type ModelWorkPolicy,
  type ProviderAttemptIdentity,
  type ProviderCapabilityManifest,
  type ProviderEffectIdentity,
  type TypedModelOutput,
} from '../src/index.js';

const digestA = `sha256:${'a'.repeat(64)}`;
const digestB = `sha256:${'b'.repeat(64)}`;
const digestC = `sha256:${'c'.repeat(64)}`;

function policy(): ModelWorkPolicy {
  const base: ModelWorkPolicy = {
    version: MODEL_WORK_POLICY_VERSION,
    digest: digestA,
    dataClassification: 'local_only',
    retainRawOutput: true,
    maximumAttempts: 2,
    budget: {
      inputTokens: 4096,
      outputTokens: 1024,
      currencyMicros: 0,
      wallClockMs: 30_000,
      toolCalls: 0,
    },
  };
  return { ...base, digest: modelWorkPolicyDigest(base) };
}

function identity(): ModelWorkIdentity {
  const activePolicy = policy();
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
    modelProfileVersionId: 'profile-version-1',
    modelProfileVersionDigest: digestA,
    policyVersion: MODEL_WORK_POLICY_VERSION,
    policyDigest: activePolicy.digest,
    toolContractDigest: digestB,
    outputSchemaDigest: digestC,
    identityDigest: digestA,
  };
  return { ...base, identityDigest: modelWorkIdentityDigest(base) };
}

function attempt(modelWork: ModelWorkIdentity): ProviderAttemptIdentity {
  const base: ProviderAttemptIdentity = {
    modelWorkIdentityDigest: modelWork.identityDigest,
    attemptOrdinal: 1,
    provider: 'deterministic',
    concreteModel: 'fixture-v1',
    checkpoint: 'sha256:fixture-v1',
    attemptDigest: digestA,
  };
  return { ...base, attemptDigest: providerAttemptIdentityDigest(base) };
}

function effect(
  modelWork: ModelWorkIdentity,
  providerAttempt: ProviderAttemptIdentity,
): ProviderEffectIdentity {
  const base: ProviderEffectIdentity = {
    providerAttemptDigest: providerAttempt.attemptDigest,
    modelWorkIdentityDigest: modelWork.identityDigest,
    operationKind: 'chat_completion',
    canonicalRequestDigest: digestC,
    idempotencyKey: digestA,
  };
  return { ...base, idempotencyKey: providerEffectIdentityDigest(base) };
}

function manifest(): ProviderCapabilityManifest {
  const base: ProviderCapabilityManifest = {
    schemaVersion: PROVIDER_CAPABILITY_MANIFEST_VERSION,
    provider: 'deterministic',
    concreteModel: 'fixture-v1',
    checkpoint: 'sha256:fixture-v1',
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

const typedOutput: TypedModelOutput = {
  observations: ['The fixture produced a deterministic observation.'],
  claimProposals: [
    {
      proposalId: 'proposal-1',
      statement: 'A proposal is not an admitted fact.',
      evidenceReferences: [],
    },
  ],
  evidenceReferences: [],
  assumptions: ['The deterministic fixture is not a quality benchmark.'],
  dissent: [],
  proposedFalsifiers: ['Change the canonical prompt digest.'],
};

describe('P7 model-work domain contracts', () => {
  it('binds the complete model-work, attempt, and effect identity chain', () => {
    const modelWork = identity();
    const providerAttempt = attempt(modelWork);
    const providerEffect = effect(modelWork, providerAttempt);
    const capability = manifest();

    expect(
      ModelWorkRequestSchema.parse({
        schemaVersion: MODEL_WORK_REQUEST_SCHEMA_VERSION,
        identity: modelWork,
        attempt: providerAttempt,
        effect: providerEffect,
        capabilityManifestDigest: capability.manifestDigest,
        canonicalPromptDigest: digestB,
        budget: policy().budget,
        outputSchemaVersion: MODEL_WORK_RESULT_SCHEMA_VERSION,
      }),
    ).toMatchObject({ identity: modelWork, effect: providerEffect });

    expect(() =>
      ModelWorkRequestSchema.parse({
        schemaVersion: MODEL_WORK_REQUEST_SCHEMA_VERSION,
        identity: modelWork,
        attempt: providerAttempt,
        effect: { ...providerEffect, modelWorkIdentityDigest: digestA },
        capabilityManifestDigest: capability.manifestDigest,
        canonicalPromptDigest: digestB,
        budget: policy().budget,
        outputSchemaVersion: MODEL_WORK_RESULT_SCHEMA_VERSION,
      }),
    ).toThrow(/identity|canonical/);
  });

  it('rejects contract drift and noncanonical capability manifests', () => {
    const capability = manifest();
    expect(ProviderCapabilityManifestSchema.parse(capability)).toEqual(
      capability,
    );
    expect(() =>
      ProviderCapabilityManifestSchema.parse({
        ...capability,
        concreteModel: 'changed-alias-target',
      }),
    ).toThrow('provider capability manifest digest is not canonical');
    expect(() =>
      ProviderCapabilityManifestSchema.parse({
        ...capability,
        sdkSpecificField: true,
      }),
    ).toThrow();
  });

  it('requires every attributed retry to name its predecessor', () => {
    const modelWork = identity();
    const first = attempt(modelWork);
    const retryBase: ProviderAttemptIdentity = {
      ...first,
      attemptOrdinal: 2,
      attemptDigest: digestA,
    };
    const retry = {
      ...retryBase,
      attemptDigest: providerAttemptIdentityDigest(retryBase),
    };
    expect(() => ProviderAttemptIdentitySchema.parse(retry)).toThrow(
      'provider-attempt predecessor does not match attempt ordinal',
    );

    const attributedBase = {
      ...retryBase,
      predecessorAttemptDigest: first.attemptDigest,
    };
    const attributed = {
      ...attributedBase,
      attemptDigest: providerAttemptIdentityDigest(attributedBase),
    };
    expect(ProviderAttemptIdentitySchema.parse(attributed)).toEqual(attributed);
  });

  it('validates typed output and provider usage without promoting proposals', () => {
    const modelWork = identity();
    const providerAttempt = attempt(modelWork);
    const providerEffect = effect(modelWork, providerAttempt);
    const parsed = ModelWorkResultSchema.parse({
      schemaVersion: MODEL_WORK_RESULT_SCHEMA_VERSION,
      modelWorkIdentityDigest: modelWork.identityDigest,
      providerAttemptDigest: providerAttempt.attemptDigest,
      providerEffectIdempotencyKey: providerEffect.idempotencyKey,
      provider: 'deterministic',
      concreteModel: 'fixture-v1',
      checkpoint: 'sha256:fixture-v1',
      providerOperationId: 'fixture-operation-1',
      finishReason: 'stop',
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
        currencyMicros: 0,
        wallClockMs: 1,
        toolCalls: 0,
      },
      rawResponseDigest: digestC,
      typedOutput,
      typedOutputDigest: typedModelOutputDigest(typedOutput),
    });
    expect(parsed.typedOutput.claimProposals[0]?.statement).toContain(
      'not an admitted fact',
    );
    expect(() =>
      ModelWorkResultSchema.parse({
        ...parsed,
        usage: { ...parsed.usage, totalTokens: 31 },
      }),
    ).toThrow('provider usage total does not match token components');
  });

  it('classifies retries and reconciliation separately and exactly', () => {
    expect(isRetryableProviderError('rate_limited')).toBe(true);
    expect(isRetryableProviderError('policy_denied')).toBe(false);
    expect(requiresProviderReconciliation('ambiguous_delivery')).toBe(true);
    expect(requiresProviderReconciliation('late_response')).toBe(true);
    expect(requiresProviderReconciliation('provider_unavailable')).toBe(false);
    expect(() =>
      ProviderErrorSchema.parse({
        schemaVersion: '1.0.0',
        code: 'unknown_failure',
        message: 'unknown',
      }),
    ).toThrow();
  });
});
