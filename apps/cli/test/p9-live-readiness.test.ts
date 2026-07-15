import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalDigest } from '@mammoth/domain';
import { describe, expect, it } from 'vitest';
import { inspectP9LiveReadiness } from '../src/p9-operator.js';

const NOW = '2026-07-15T18:00:00.000Z';

async function artifacts() {
  const root = await mkdtemp(join(tmpdir(), 'mammoth-p9-authority-'));
  const priceRows: readonly (readonly [
    string,
    string,
    'search' | 'retrieval' | 'parser' | 'model',
  ])[] = [
    ['search', 'brave', 'search'],
    ['retrieval', 'mammoth', 'retrieval'],
    ['parser', 'mammoth', 'parser'],
    ['model', 'models', 'model'],
  ];
  const pricesIdentity = {
    schemaVersion: '1.0.0' as const,
    contractFamily: 'p9.v1' as const,
    catalogId: 'prices:test',
    version: 'v1',
    entries: priceRows.map(([id, provider, effectKind]) => ({
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
  const prices = {
    ...pricesIdentity,
    catalogDigest: canonicalDigest(pricesIdentity),
  };
  const profileRows: readonly (readonly [
    'search' | 'retrieval' | 'parser' | 'model_proposer' | 'model_evaluator',
    'search' | 'retrieval' | 'parser' | 'model',
    string,
    string,
    string | null,
    string,
  ])[] = [
    ['search', 'search', 'brave', 'brave/search', null, 'price:search'],
    [
      'retrieval',
      'retrieval',
      'mammoth',
      'mammoth/retrieval',
      null,
      'price:retrieval',
    ],
    ['parser', 'parser', 'mammoth', 'mammoth/parser', null, 'price:parser'],
    ['model_proposer', 'model', 'models', 'models/a', 'model-a', 'price:model'],
    [
      'model_evaluator',
      'model',
      'models',
      'models/b',
      'model-b',
      'price:model',
    ],
  ];
  const profilesIdentity = {
    schemaVersion: '1.0.0' as const,
    contractFamily: 'p9.v1' as const,
    catalogId: 'profiles:test',
    version: 'v1',
    profiles: profileRows.map(
      ([role, effectKind, provider, family, modelId, priceId]) => ({
        profileId: `profile:${role}`,
        profileFamilyId: family,
        provider,
        role,
        effectKind,
        modelId,
        baseUrl: modelId ? 'https://models.example/v1/' : null,
        credentialEnvVar:
          role === 'search'
            ? 'TEST_SEARCH_KEY'
            : modelId
              ? 'TEST_MODEL_KEY'
              : null,
        catalogEntryIds: [priceId],
      }),
    ),
  };
  const profiles = {
    ...profilesIdentity,
    catalogDigest: canonicalDigest(profilesIdentity),
  };
  const receiptIdentity = {
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
    priceCatalogId: prices.catalogId,
    priceCatalogVersion: prices.version,
    priceCatalogDigest: prices.catalogDigest,
    providerProfileCatalogId: profiles.catalogId,
    providerProfileCatalogVersion: profiles.version,
    providerProfileCatalogDigest: profiles.catalogDigest,
    authorizedProfileIds: profiles.profiles.map((profile) => profile.profileId),
    proposerProfileId: 'profile:model_proposer',
    evaluatorProfileId: 'profile:model_evaluator',
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
  const receipt = {
    ...receiptIdentity,
    receiptDigest: canonicalDigest(receiptIdentity),
  };
  const paths = {
    MAMMOTH_P9_PRICE_CATALOG_PATH: join(root, 'prices.json'),
    MAMMOTH_P9_PROVIDER_PROFILE_CATALOG_PATH: join(root, 'profiles.json'),
    MAMMOTH_P9_LIVE_AUTHORITY_RECEIPT_PATH: join(root, 'authority.json'),
  };
  await Promise.all([
    writeFile(paths.MAMMOTH_P9_PRICE_CATALOG_PATH, JSON.stringify(prices)),
    writeFile(
      paths.MAMMOTH_P9_PROVIDER_PROFILE_CATALOG_PATH,
      JSON.stringify(profiles),
    ),
    writeFile(
      paths.MAMMOTH_P9_LIVE_AUTHORITY_RECEIPT_PATH,
      JSON.stringify(receipt),
    ),
  ]);
  return { paths, receipt };
}

describe('P9 live readiness artifacts', () => {
  it('does not accept legacy environment assertions as live authority', async () => {
    const readiness = await inspectP9LiveReadiness({
      MAMMOTH_P9_LIVE_RESEARCH: 'authorized',
      MAMMOTH_P9_PROPOSER_MODEL: 'model-a',
      MAMMOTH_P9_EVALUATOR_MODEL: 'model-b',
    });
    expect(readiness.blockers).toContain(
      'scoped_live_authority_receipt_missing',
    );
    expect(readiness.blockers).toContain(
      'immutable_provider_profile_catalog_missing',
    );
  });

  it('loads exact artifacts, reports their digests, and remains effect-blocked', async () => {
    const { paths, receipt } = await artifacts();
    const readiness = await inspectP9LiveReadiness(
      { ...paths, TEST_SEARCH_KEY: 'test', TEST_MODEL_KEY: 'test' },
      { now: NOW },
    );
    expect(readiness).toMatchObject({
      ready: false,
      blockers: ['live_executor_unavailable'],
      proposerProfileFamily: 'models/a',
      evaluatorProfileFamily: 'models/b',
      liveAuthorityReceiptDigest: receipt.receiptDigest,
    });
  });

  it('fails closed when an authorized profile credential is absent', async () => {
    const { paths } = await artifacts();
    const readiness = await inspectP9LiveReadiness(
      { ...paths, TEST_MODEL_KEY: 'test' },
      { now: NOW },
    );
    expect(readiness.blockers).toContain(
      'provider_credential_missing:profile:search',
    );
    expect(readiness.blockers).toContain('live_executor_unavailable');
  });
});
