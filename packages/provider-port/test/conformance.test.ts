import { describe, expect, it } from 'vitest';
import {
  MODEL_WORK_POLICY_VERSION,
  MODEL_WORK_REQUEST_SCHEMA_VERSION,
  MODEL_WORK_RESULT_SCHEMA_VERSION,
  canonicalDigest,
  modelWorkIdentityDigest,
  modelWorkPolicyDigest,
  providerAttemptIdentityDigest,
  providerEffectIdentityDigest,
  type ModelWorkIdentity,
  type ModelWorkPolicy,
  type ModelWorkRequest,
  type ProviderAttemptIdentity,
  type ProviderEffectIdentity,
  type TypedModelOutput,
} from '@mammoth/domain';
import {
  DeterministicModelProvider,
  verifyProviderPortConformance,
} from '../src/index.js';

const digestA = `sha256:${'a'.repeat(64)}`;
const digestB = `sha256:${'b'.repeat(64)}`;

const output: TypedModelOutput = {
  observations: ['deterministic observation'],
  claimProposals: [],
  evidenceReferences: [],
  assumptions: [],
  dissent: [],
  proposedFalsifiers: ['change the request'],
};

function fixture() {
  const provider = new DeterministicModelProvider({ typedOutput: output });
  const canonicalRequestBytes = new TextEncoder().encode(
    JSON.stringify({ prompt: 'fixture prompt' }),
  );
  return provider.discoverCapabilities().then((manifest) => {
    const policyBase: ModelWorkPolicy = {
      version: MODEL_WORK_POLICY_VERSION,
      digest: digestA,
      dataClassification: 'local_only',
      retainRawOutput: true,
      maximumAttempts: 1,
      budget: {
        inputTokens: 1024,
        outputTokens: 1024,
        currencyMicros: 0,
        wallClockMs: 10_000,
        toolCalls: 0,
      },
    };
    const policy = {
      ...policyBase,
      digest: modelWorkPolicyDigest(policyBase),
    };
    const identityBase: ModelWorkIdentity = {
      programId: 'program-1',
      topologyId: 'topology-1',
      topologyDigest: digestA,
      cellId: 'cell-1',
      criterionId: 'criterion-1',
      criterionVersion: 1,
      criterionDigest: digestB,
      workItemContractDigest: digestA,
      promptTemplateDigest: digestB,
      canonicalInputDigest: digestA,
      modelProfileVersionId: 'profile-version-1',
      modelProfileVersionDigest: digestB,
      policyVersion: MODEL_WORK_POLICY_VERSION,
      policyDigest: policy.digest,
      toolContractDigest: digestA,
      outputSchemaDigest: digestB,
      identityDigest: digestA,
    };
    const identity = {
      ...identityBase,
      identityDigest: modelWorkIdentityDigest(identityBase),
    };
    const attemptBase: ProviderAttemptIdentity = {
      modelWorkIdentityDigest: identity.identityDigest,
      attemptOrdinal: 1,
      provider: manifest.provider,
      concreteModel: manifest.concreteModel,
      checkpoint: manifest.checkpoint,
      attemptDigest: digestA,
    };
    const attempt = {
      ...attemptBase,
      attemptDigest: providerAttemptIdentityDigest(attemptBase),
    };
    const effectBase: ProviderEffectIdentity = {
      providerAttemptDigest: attempt.attemptDigest,
      modelWorkIdentityDigest: identity.identityDigest,
      operationKind: 'chat_completion',
      canonicalRequestDigest: canonicalDigest({ prompt: 'fixture prompt' }),
      idempotencyKey: digestA,
    };
    const effect = {
      ...effectBase,
      idempotencyKey: providerEffectIdentityDigest(effectBase),
    };
    const request: ModelWorkRequest = {
      schemaVersion: MODEL_WORK_REQUEST_SCHEMA_VERSION,
      identity,
      attempt,
      effect,
      capabilityManifestDigest: manifest.manifestDigest,
      canonicalPromptDigest: digestB,
      budget: policy.budget,
      outputSchemaVersion: MODEL_WORK_RESULT_SCHEMA_VERSION,
    };
    return { provider, canonicalRequestBytes, request };
  });
}

describe('provider port conformance', () => {
  it('proves capability pinning, duplicate suppression, and reconciliation', async () => {
    await expect(
      verifyProviderPortConformance(await fixture()),
    ).resolves.toBeUndefined();
  });

  it('fails closed when the requested checkpoint drifts', async () => {
    const value = await fixture();
    const result = await value.provider.dispatch({
      modelWork: {
        ...value.request,
        attempt: { ...value.request.attempt, checkpoint: 'changed' },
      },
      canonicalRequestBytes: value.canonicalRequestBytes,
      limits: value.request.budget,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected profile drift');
    expect(result.error.code).toBe('profile_drift');
  });

  it('fails closed on cancellation before acceptance', async () => {
    const value = await fixture();
    const controller = new AbortController();
    controller.abort();
    const result = await value.provider.dispatch({
      modelWork: value.request,
      canonicalRequestBytes: value.canonicalRequestBytes,
      limits: value.request.budget,
      abortSignal: controller.signal,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected cancelled dispatch');
    expect(result.error.code).toBe('late_response');
  });
});
