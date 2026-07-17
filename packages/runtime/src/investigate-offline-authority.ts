import {
  canonicalDigest,
  P9LiveAuthorityReceiptSchema,
  type P9LiveAuthorityReceipt,
} from '@mammoth/domain';

/**
 * Identity of the OFFLINE FIXTURE issuer. This issuer exists only so that
 * governed execution can be exercised end to end without any network,
 * provider, or paid effect. Nothing in the product trusts this issuer by
 * default: a release only accepts a receipt from it when the operator
 * explicitly pins this exact identifier as the trusted issuer.
 */
export const OFFLINE_FIXTURE_ISSUER_ID = 'offline-fixture-issuer/v1' as const;

/**
 * The fixture never touches these origins; they use the reserved `.invalid`
 * TLD so any accidental attempt to contact them fails at name resolution.
 */
const OFFLINE_FIXTURE_ORIGIN = 'https://offline.fixture.invalid';

export interface OfflineFixtureAuthorityInput {
  /** Immutable plan the authority is scoped to. */
  readonly planId: string;
  readonly planDigest: string;
  readonly question: string;
  /** Human operator on whose behalf the fixture receipt is minted. */
  readonly actorId: string;
  /** Injected clock; the receipt is valid from this instant. */
  readonly authorizedAt: string;
  /** Validity window length in minutes (default 60). */
  readonly validityMinutes?: number;
  /** Deterministic single-use nonce (>= 16 chars); derived from the plan digest when omitted. */
  readonly consumptionNonce?: string;
}

/**
 * OFFLINE FIXTURE ONLY. Deterministically mints a schema-valid scoped
 * `P9LiveAuthorityReceipt` bound to the exact plan digest and question, so
 * governed execution of released acquisition intents can be proven strictly
 * offline. Every digest is computed, never invented; no network, secret, or
 * billing identity is involved. The receipt only becomes usable when the
 * caller separately and explicitly pins `OFFLINE_FIXTURE_ISSUER_ID` as the
 * trusted issuer; this module never installs itself as a default.
 */
export function mintOfflineFixtureAuthorityReceipt(
  input: OfflineFixtureAuthorityInput,
): P9LiveAuthorityReceipt {
  const questionDigest = canonicalDigest(input.question);
  const scopeSeed = input.planDigest.slice(7, 23);
  const executionId = `offline-fixture-execution:${scopeSeed}`;
  const consumptionNonce =
    input.consumptionNonce ?? `offline-nonce-${input.planDigest.slice(7, 39)}`;
  const consumptionStoreId = `offline-fixture-consumption:${scopeSeed}`;
  const validityMinutes = input.validityMinutes ?? 60;
  if (!Number.isFinite(validityMinutes) || validityMinutes <= 0) {
    throw new Error(
      'offline fixture authority requires a positive validity window',
    );
  }
  const notBeforeAt = new Date(input.authorizedAt).toISOString();
  const expiresAt = new Date(
    Date.parse(notBeforeAt) + validityMinutes * 60_000,
  ).toISOString();
  const identity = {
    schemaVersion: '1.0.0' as const,
    contractFamily: 'p9.v1' as const,
    authorityId: `offline-fixture-authority:${scopeSeed}`,
    issuerId: OFFLINE_FIXTURE_ISSUER_ID,
    decision: 'authorized' as const,
    reason:
      'offline fixture authority: governed no-effect execution of released acquisition intents',
    executionId,
    executionDigest: canonicalDigest({
      executionId,
      planDigest: input.planDigest,
      questionDigest,
      consumptionNonce,
    }),
    consumptionNonce,
    consumptionStoreId,
    consumptionStoreDigest: canonicalDigest({
      kind: 'p9-consumption-store/v1',
      id: consumptionStoreId,
    }),
    maximumExecutions: 1 as const,
    planScope: {
      proposalId: `offline-fixture-proposal:${scopeSeed}`,
      proposalDigest: canonicalDigest({
        kind: 'offline-fixture-proposal/v1',
        planDigest: input.planDigest,
      }),
      planId: input.planId,
      planDigest: input.planDigest,
      acceptanceReceiptDigest: canonicalDigest({
        kind: 'offline-fixture-acceptance/v1',
        planDigest: input.planDigest,
      }),
      question: input.question,
      questionDigest,
      domainPackId: 'general-web/v1' as const,
      packDigest: canonicalDigest({
        kind: 'offline-fixture-pack/v1',
        packId: 'general-web/v1',
      }),
      budgetAllocation: {
        currencyUsd: 1,
        searchUsd: 0.25,
        retrievalParsingUsd: 0.25,
        modelsUsd: 0.5,
      },
    },
    priceCatalogId: 'offline-fixture-price-catalog',
    priceCatalogVersion: '1.0.0',
    priceCatalogDigest: canonicalDigest({
      kind: 'offline-fixture-price-catalog/v1',
    }),
    providerProfileCatalogId: 'offline-fixture-provider-profiles',
    providerProfileCatalogVersion: '1.0.0',
    providerProfileCatalogDigest: canonicalDigest({
      kind: 'offline-fixture-provider-profiles/v1',
    }),
    sourceClassificationPolicyDigest: canonicalDigest({
      kind: 'offline-fixture-source-classification/v1',
    }),
    authorizedProfileIds: [
      'offline-fixture-search/v1',
      'offline-fixture-retrieval/v1',
      'offline-fixture-parser/v1',
      'offline-extractive-proposer/v1',
      'offline-independent-evaluator/v1',
    ],
    proposerProfileId: 'offline-extractive-proposer/v1',
    evaluatorProfileId: 'offline-independent-evaluator/v1',
    budgetLimit: {
      currencyUsd: 1,
      requests: 256,
      inputTokens: 0,
      outputTokens: 0,
      bytes: 64 * 1024 * 1024,
      durationMs: 10 * 60_000,
    },
    authorizedEffectKinds: ['search', 'retrieval', 'parser'] as const,
    authorizedDestinationOrigins: [OFFLINE_FIXTURE_ORIGIN],
    authorizedRetrievalOrigins: [OFFLINE_FIXTURE_ORIGIN],
    authorizedBillingAccountIds: ['offline-fixture-billing'],
    actorId: input.actorId,
    authorizedAt: notBeforeAt,
    notBeforeAt,
    expiresAt,
  };
  return P9LiveAuthorityReceiptSchema.parse({
    ...identity,
    receiptDigest: canonicalDigest(identity),
  });
}
