import { describe, expect, it } from 'vitest';
import {
  canonicalDigest,
  P9LiveAuthorityReceiptSchema,
  P9ProviderProfileCatalogSchema,
} from '../src/index.js';

function profileCatalog() {
  const identity = {
    schemaVersion: '1.0.0' as const,
    contractFamily: 'p9.v1' as const,
    catalogId: 'profiles:test',
    version: 'v1',
    profiles: [
      {
        profileId: 'profile:proposer',
        profileFamilyId: 'family:a',
        provider: 'provider',
        role: 'model_proposer' as const,
        effectKind: 'model' as const,
        modelId: 'model-a',
        baseUrl: 'https://provider.example/v1/',
        credentialEnvVar: 'PROVIDER_TEST_KEY',
        catalogEntryIds: ['price:model'],
      },
    ],
  };
  return { ...identity, catalogDigest: canonicalDigest(identity) };
}

function authorityReceipt() {
  const identity = {
    schemaVersion: '1.0.0' as const,
    contractFamily: 'p9.v1' as const,
    authorityId: 'authority:test',
    planScope: {
      proposalId: 'proposal:test',
      proposalDigest: canonicalDigest('proposal'),
      planId: 'plan:test',
      planDigest: canonicalDigest('plan'),
      acceptanceReceiptDigest: canonicalDigest('acceptance'),
      domainPackId: 'technical-due-diligence/v1' as const,
      packDigest: canonicalDigest('pack'),
    },
    priceCatalogId: 'prices:test',
    priceCatalogVersion: 'v1',
    priceCatalogDigest: canonicalDigest('prices'),
    providerProfileCatalogId: 'profiles:test',
    providerProfileCatalogVersion: 'v1',
    providerProfileCatalogDigest: profileCatalog().catalogDigest,
    authorizedProfileIds: ['profile:proposer', 'profile:evaluator'],
    proposerProfileId: 'profile:proposer',
    evaluatorProfileId: 'profile:evaluator',
    budgetLimit: {
      currencyUsd: 5,
      requests: 100,
      inputTokens: 100_000,
      outputTokens: 20_000,
      bytes: 10_000_000,
      durationMs: 600_000,
    },
    authorizedEffectKinds: ['search', 'retrieval', 'parser', 'model'] as const,
    actorId: 'operator:test',
    authorizedAt: '2026-07-15T17:00:00.000Z',
    expiresAt: '2026-07-16T17:00:00.000Z',
  };
  return { ...identity, receiptDigest: canonicalDigest(identity) };
}

describe('P9 live authority contracts', () => {
  it('accepts an exact immutable provider profile catalog', () => {
    expect(P9ProviderProfileCatalogSchema.parse(profileCatalog())).toEqual(
      profileCatalog(),
    );
  });

  it('rejects profile content changed without recomputing its digest', () => {
    expect(() =>
      P9ProviderProfileCatalogSchema.parse({
        ...profileCatalog(),
        version: 'forged',
      }),
    ).toThrow(/catalog digest/u);
  });

  it('rejects receipt content changed without recomputing its digest', () => {
    expect(() =>
      P9LiveAuthorityReceiptSchema.parse({
        ...authorityReceipt(),
        actorId: 'operator:attacker',
      }),
    ).toThrow(/receipt digest/u);
  });
});
