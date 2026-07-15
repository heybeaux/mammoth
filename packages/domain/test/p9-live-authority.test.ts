import { describe, expect, it } from 'vitest';
import {
  canonicalDigest,
  P9LiveAuthorityReceiptSchema,
  P9ProviderProfileCatalogSchema,
} from '../src/index.js';

const digest = (seed: string): string => canonicalDigest({ seed });

function requestCeiling(role: string) {
  return {
    requests: 1,
    inputTokens: role.startsWith('model_') ? 1_000 : 0,
    outputTokens: role.startsWith('model_') ? 500 : 0,
    bytes: role === 'retrieval' || role === 'parser' ? 10_000 : 0,
    durationMs: 30_000,
    attempts: 1,
    parserClass: role === 'parser' ? 'html/v1' : null,
  };
}

function profile(overrides: Record<string, unknown> = {}) {
  const role = (overrides.role ?? 'model_proposer') as string;
  const isModel = role.startsWith('model_');
  return {
    profileId: `profile:${role}`,
    profileFamilyId: `family:${role}`,
    provider: isModel ? 'models' : role,
    role,
    effectKind: isModel ? 'model' : role,
    modelId: isModel ? `model:${role}` : null,
    checkpoint: isModel ? `checkpoint:${role}` : null,
    capabilityManifestDigest: isModel ? digest(`capability:${role}`) : null,
    promptTemplateDigest: isModel ? digest(`prompt:${role}`) : null,
    outputSchemaDigest: isModel ? digest(`output:${role}`) : null,
    configurationDigest: digest(`configuration:${role}`),
    destinationOrigin: `https://${isModel ? 'models' : role}.example/`,
    credentialEnvVar: isModel ? 'TEST_MODEL_KEY' : null,
    billingAuthorized: true as const,
    billingAccountId: `billing:${role}`,
    catalogEntryIds: [`price:${isModel ? 'model' : role}`],
    requestCeiling: requestCeiling(role),
    ...overrides,
  };
}

function profileCatalog() {
  const identity = {
    schemaVersion: '1.0.0' as const,
    contractFamily: 'p9.v1' as const,
    catalogId: 'profiles:test',
    version: 'v1',
    profiles: [profile()],
  };
  return { ...identity, catalogDigest: canonicalDigest(identity) };
}

function authorityReceipt(overrides: Record<string, unknown> = {}) {
  const question = 'Can Mammoth produce an independently verified report?';
  const planDigest = digest('plan');
  const executionId = 'execution:test';
  const consumptionNonce = 'nonce:single-use:0001';
  const identity = {
    schemaVersion: '1.0.0' as const,
    contractFamily: 'p9.v1' as const,
    authorityId: 'authority:test',
    issuerId: 'issuer:trusted',
    decision: 'authorized' as const,
    reason: 'Operator approved this exact bounded exhibition.',
    executionId,
    executionDigest: canonicalDigest({
      executionId,
      planDigest,
      questionDigest: canonicalDigest(question),
      consumptionNonce,
    }),
    consumptionNonce,
    maximumExecutions: 1 as const,
    planScope: {
      proposalId: 'proposal:test',
      proposalDigest: digest('proposal'),
      planId: 'plan:test',
      planDigest,
      acceptanceReceiptDigest: digest('acceptance'),
      question,
      questionDigest: canonicalDigest(question),
      domainPackId: 'technical-due-diligence/v1' as const,
      packDigest: digest('pack'),
      budgetAllocation: {
        currencyUsd: 5,
        searchUsd: 0.5,
        retrievalParsingUsd: 0.5,
        modelsUsd: 4,
      },
    },
    priceCatalogId: 'prices:test',
    priceCatalogVersion: 'v1',
    priceCatalogDigest: digest('prices'),
    providerProfileCatalogId: 'profiles:test',
    providerProfileCatalogVersion: 'v1',
    providerProfileCatalogDigest: profileCatalog().catalogDigest,
    sourceClassificationPolicyDigest: digest('source-policy'),
    authorizedProfileIds: ['profile:model_proposer'],
    proposerProfileId: 'profile:model_proposer',
    evaluatorProfileId: 'profile:model_proposer',
    budgetLimit: {
      currencyUsd: 5,
      requests: 1,
      inputTokens: 1_000,
      outputTokens: 500,
      bytes: 0,
      durationMs: 30_000,
    },
    authorizedEffectKinds: ['model'] as const,
    authorizedDestinationOrigins: ['https://models.example/'],
    authorizedBillingAccountIds: ['billing:model_proposer'],
    actorId: 'operator:test',
    authorizedAt: '2026-07-15T17:00:00.000Z',
    notBeforeAt: '2026-07-15T17:00:00.000Z',
    expiresAt: '2026-07-16T17:00:00.000Z',
    ...overrides,
  };
  return { ...identity, receiptDigest: canonicalDigest(identity) };
}

describe('P9 live authority contracts', () => {
  it('accepts immutable provider and single-execution authority contracts', () => {
    expect(P9ProviderProfileCatalogSchema.parse(profileCatalog())).toEqual(
      profileCatalog(),
    );
    expect(P9LiveAuthorityReceiptSchema.parse(authorityReceipt())).toEqual(
      authorityReceipt(),
    );
  });

  it('rejects profile content or authority content changed without resealing', () => {
    expect(() =>
      P9ProviderProfileCatalogSchema.parse({
        ...profileCatalog(),
        version: 'forged',
      }),
    ).toThrow(/catalog digest/u);
    expect(() =>
      P9LiveAuthorityReceiptSchema.parse({
        ...authorityReceipt(),
        actorId: 'operator:attacker',
      }),
    ).toThrow(/receipt digest/u);
  });

  it('accepts credential-free provider path prefixes', () => {
    const changed = profile({
      destinationOrigin: 'https://openrouter.ai/api/v1',
    });
    const identity = {
      schemaVersion: '1.0.0' as const,
      contractFamily: 'p9.v1' as const,
      catalogId: 'profiles:path-prefix',
      version: 'v1',
      profiles: [changed],
    };
    expect(
      P9ProviderProfileCatalogSchema.parse({
        ...identity,
        catalogDigest: canonicalDigest(identity),
      }).profiles[0]?.destinationOrigin,
    ).toBe('https://openrouter.ai/api/v1');
  });

  it('rejects role/effect drift and credential-bearing or query-bearing destinations', () => {
    for (const changed of [
      profile({ effectKind: 'search' }),
      profile({ destinationOrigin: 'https://user:secret@models.example/' }),
      profile({ destinationOrigin: 'https://models.example/v1?token=secret' }),
    ]) {
      const identity = {
        schemaVersion: '1.0.0' as const,
        contractFamily: 'p9.v1' as const,
        catalogId: 'profiles:attack',
        version: 'v1',
        profiles: [changed],
      };
      expect(() =>
        P9ProviderProfileCatalogSchema.parse({
          ...identity,
          catalogDigest: canonicalDigest(identity),
        }),
      ).toThrow();
    }
  });

  it('requires complete model lineage and forbids model lineage on non-model profiles', () => {
    for (const changed of [
      profile({ checkpoint: null }),
      profile({
        role: 'search',
        effectKind: 'search',
        modelId: 'forged-model',
      }),
    ]) {
      const identity = {
        schemaVersion: '1.0.0' as const,
        contractFamily: 'p9.v1' as const,
        catalogId: 'profiles:lineage-attack',
        version: 'v1',
        profiles: [changed],
      };
      expect(() =>
        P9ProviderProfileCatalogSchema.parse({
          ...identity,
          catalogDigest: canonicalDigest(identity),
        }),
      ).toThrow();
    }
  });

  it('rejects a replay digest for a different execution, question, or nonce', () => {
    const original = authorityReceipt();
    for (const changed of [
      { executionId: 'execution:other' },
      {
        planScope: {
          ...original.planScope,
          question: 'A different question',
          questionDigest: canonicalDigest('A different question'),
        },
      },
      { consumptionNonce: 'nonce:single-use:9999' },
    ]) {
      const identity = { ...original, ...changed, receiptDigest: undefined };
      expect(() =>
        P9LiveAuthorityReceiptSchema.parse({
          ...identity,
          receiptDigest: canonicalDigest(identity),
        }),
      ).toThrow(/execution digest/u);
    }
  });

  it('rejects invalid validity windows and duplicate authorization identities', () => {
    for (const changed of [
      { notBeforeAt: '2026-07-15T16:59:59.000Z' },
      { expiresAt: '2026-07-15T17:00:00.000Z' },
      {
        authorizedDestinationOrigins: [
          'https://models.example/',
          'https://models.example/',
        ],
      },
    ]) {
      const identity = {
        ...authorityReceipt(),
        ...changed,
        receiptDigest: undefined,
      };
      expect(() =>
        P9LiveAuthorityReceiptSchema.parse({
          ...identity,
          receiptDigest: canonicalDigest(identity),
        }),
      ).toThrow();
    }
  });
});
