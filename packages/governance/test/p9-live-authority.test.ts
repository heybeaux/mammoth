import {
  canonicalDigest,
  type P9LiveAuthorityReceipt,
  type P9ProviderProfileCatalog,
  type ProviderPriceCatalog,
} from '@mammoth/domain';
import { describe, expect, it } from 'vitest';
import { assertP9LiveAuthorityLineage } from '../src/index.js';
import type { GovernanceError } from '../src/index.js';

const NOW = '2026-07-15T18:00:00.000Z';

function priceCatalog(): ProviderPriceCatalog {
  const rows: readonly (readonly [
    string,
    string,
    'search' | 'retrieval' | 'parser' | 'model',
  ])[] = [
    ['search', 'brave', 'search'],
    ['retrieval', 'mammoth', 'retrieval'],
    ['parser', 'mammoth', 'parser'],
    ['model', 'openai-compatible', 'model'],
  ];
  const identity = {
    schemaVersion: '1.0.0' as const,
    contractFamily: 'p9.v1' as const,
    catalogId: 'prices:p9-live',
    version: '2026-07-15',
    entries: rows.map(([id, provider, effectKind]) => ({
      id: `price:${id}`,
      provider,
      effectKind,
      parserClass: effectKind === 'parser' ? 'html/v1' : null,
      flatCostUsd: 0,
      costPerRequestUsd: 0.001,
      costPerInputTokenUsd: 0,
      costPerOutputTokenUsd: 0,
      costPerByteUsd: 0,
    })),
  };
  return { ...identity, catalogDigest: canonicalDigest(identity) };
}

function profileCatalog(): P9ProviderProfileCatalog {
  const identity = {
    schemaVersion: '1.0.0' as const,
    contractFamily: 'p9.v1' as const,
    catalogId: 'profiles:p9-live',
    version: '2026-07-15',
    profiles: [
      {
        profileId: 'profile:search',
        profileFamilyId: 'brave/search',
        provider: 'brave',
        role: 'search' as const,
        effectKind: 'search' as const,
        modelId: null,
        baseUrl: 'https://api.search.brave.com/',
        credentialEnvVar: 'P9_TEST_SEARCH_KEY',
        catalogEntryIds: ['price:search'],
      },
      {
        profileId: 'profile:retrieval',
        profileFamilyId: 'mammoth/retrieval',
        provider: 'mammoth',
        role: 'retrieval' as const,
        effectKind: 'retrieval' as const,
        modelId: null,
        baseUrl: null,
        credentialEnvVar: null,
        catalogEntryIds: ['price:retrieval'],
      },
      {
        profileId: 'profile:parser',
        profileFamilyId: 'mammoth/parser',
        provider: 'mammoth',
        role: 'parser' as const,
        effectKind: 'parser' as const,
        modelId: null,
        baseUrl: null,
        credentialEnvVar: null,
        catalogEntryIds: ['price:parser'],
      },
      {
        profileId: 'profile:proposer',
        profileFamilyId: 'provider/family-a',
        provider: 'openai-compatible',
        role: 'model_proposer' as const,
        effectKind: 'model' as const,
        modelId: 'model-a',
        baseUrl: 'https://models.example/v1/',
        credentialEnvVar: 'P9_TEST_MODEL_KEY',
        catalogEntryIds: ['price:model'],
      },
      {
        profileId: 'profile:evaluator',
        profileFamilyId: 'provider/family-b',
        provider: 'openai-compatible',
        role: 'model_evaluator' as const,
        effectKind: 'model' as const,
        modelId: 'model-b',
        baseUrl: 'https://models.example/v1/',
        credentialEnvVar: 'P9_TEST_MODEL_KEY',
        catalogEntryIds: ['price:model'],
      },
    ],
  };
  return { ...identity, catalogDigest: canonicalDigest(identity) };
}

function authority(
  prices = priceCatalog(),
  profiles = profileCatalog(),
): P9LiveAuthorityReceipt {
  const identity = {
    schemaVersion: '1.0.0' as const,
    contractFamily: 'p9.v1' as const,
    authorityId: 'authority:p9-live-test',
    planScope: {
      proposalId: 'proposal:test',
      proposalDigest: canonicalDigest({ proposal: 'test' }),
      planId: 'plan:test',
      planDigest: canonicalDigest({ plan: 'test' }),
      acceptanceReceiptDigest: canonicalDigest({ acceptance: 'test' }),
      domainPackId: 'technical-due-diligence/v1' as const,
      packDigest: canonicalDigest({ pack: 'test' }),
    },
    priceCatalogId: prices.catalogId,
    priceCatalogVersion: prices.version,
    priceCatalogDigest: prices.catalogDigest,
    providerProfileCatalogId: profiles.catalogId,
    providerProfileCatalogVersion: profiles.version,
    providerProfileCatalogDigest: profiles.catalogDigest,
    authorizedProfileIds: profiles.profiles.map((entry) => entry.profileId),
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
    authorizedEffectKinds: ['search', 'retrieval', 'parser', 'model'] as (
      | 'search'
      | 'retrieval'
      | 'parser'
      | 'model'
    )[],
    actorId: 'operator:test',
    authorizedAt: '2026-07-15T17:00:00.000Z',
    expiresAt: '2026-07-16T17:00:00.000Z',
  };
  return { ...identity, receiptDigest: canonicalDigest(identity) };
}

function expectCode(run: () => unknown, code: string): void {
  try {
    run();
  } catch (error) {
    expect((error as GovernanceError).code).toBe(code);
    return;
  }
  throw new Error(`expected governance error ${code}`);
}

describe('P9 scoped live authority lineage', () => {
  it('resolves only the exact digest-bound catalogs and distinct model families', () => {
    const prices = priceCatalog();
    const profiles = profileCatalog();
    const lineage = assertP9LiveAuthorityLineage({
      receipt: authority(prices, profiles),
      profileCatalog: profiles,
      priceCatalog: prices,
      now: NOW,
    });
    expect(lineage.proposerProfile.profileFamilyId).toBe('provider/family-a');
    expect(lineage.evaluatorProfile.profileFamilyId).toBe('provider/family-b');
  });

  it('rejects expired authority and resealed catalog substitutions', () => {
    const prices = priceCatalog();
    const profiles = profileCatalog();
    const receipt = authority(prices, profiles);
    expectCode(
      () =>
        assertP9LiveAuthorityLineage({
          receipt,
          profileCatalog: profiles,
          priceCatalog: prices,
          now: receipt.expiresAt,
        }),
      'live_authority_expired',
    );
    const substitutedIdentity = {
      ...profiles,
      version: 'attacker-version',
      catalogDigest: undefined,
    };
    const substituted = {
      ...substitutedIdentity,
      catalogDigest: canonicalDigest(substitutedIdentity),
    };
    expectCode(
      () =>
        assertP9LiveAuthorityLineage({
          receipt,
          profileCatalog: substituted,
          priceCatalog: prices,
          now: NOW,
        }),
      'live_authority_profile_catalog_lineage_mismatch',
    );
  });

  it('rejects resealed correlated families and price-entry/provider drift', () => {
    const prices = priceCatalog();
    const profiles = profileCatalog();
    const correlatedIdentity = {
      ...profiles,
      profiles: profiles.profiles.map((profile) =>
        profile.profileId === 'profile:evaluator'
          ? { ...profile, profileFamilyId: 'provider/family-a' }
          : profile,
      ),
      catalogDigest: undefined,
    };
    const correlated = {
      ...correlatedIdentity,
      catalogDigest: canonicalDigest(correlatedIdentity),
    };
    expectCode(
      () =>
        assertP9LiveAuthorityLineage({
          receipt: authority(prices, correlated),
          profileCatalog: correlated,
          priceCatalog: prices,
          now: NOW,
        }),
      'model_profile_families_not_distinct',
    );

    const driftIdentity = {
      ...prices,
      entries: prices.entries.map((entry) =>
        entry.id === 'price:search'
          ? { ...entry, provider: 'attacker-provider' }
          : entry,
      ),
      catalogDigest: undefined,
    };
    const drift = {
      ...driftIdentity,
      catalogDigest: canonicalDigest(driftIdentity),
    };
    expectCode(
      () =>
        assertP9LiveAuthorityLineage({
          receipt: authority(drift, profiles),
          profileCatalog: profiles,
          priceCatalog: drift,
          now: NOW,
        }),
      'provider_profile_price_entry_lineage_mismatch',
    );
  });
});

export { authority, priceCatalog, profileCatalog };
