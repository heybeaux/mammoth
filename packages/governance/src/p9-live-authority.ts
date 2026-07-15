import {
  canonicalDigest,
  type P9LiveAuthorityReceipt,
  P9LiveAuthorityReceiptSchema,
  type P9ProviderProfile,
  type P9ProviderProfileCatalog,
  P9ProviderProfileCatalogSchema,
  type PlanAcceptanceReceipt,
  PlanAcceptanceReceiptSchema,
  type ProviderPriceCatalog,
  ProviderPriceCatalogSchema,
  type ResearchPlan,
  ResearchPlanSchema,
} from '@mammoth/domain';
import { GovernanceError } from './common.js';
import { calculateP9EffectCostBound } from './p9-budget-authority.js';

export interface P9LiveAuthorityLineage {
  readonly receipt: P9LiveAuthorityReceipt;
  readonly profileCatalog: P9ProviderProfileCatalog;
  readonly priceCatalog: ProviderPriceCatalog;
  readonly profiles: readonly P9ProviderProfile[];
  readonly proposerProfile: P9ProviderProfile;
  readonly evaluatorProfile: P9ProviderProfile;
}

export function assertP9LiveAuthorityLineage(input: {
  readonly receipt: P9LiveAuthorityReceipt;
  readonly profileCatalog: P9ProviderProfileCatalog;
  readonly priceCatalog: ProviderPriceCatalog;
  readonly plan: ResearchPlan;
  readonly acceptanceReceipt: PlanAcceptanceReceipt;
  readonly expectedAuthorityDigest: string;
  readonly trustedIssuerId: string;
  readonly executionId: string;
  readonly question: string;
  readonly sourceClassificationPolicyDigest: string;
  readonly now: string;
}): P9LiveAuthorityLineage {
  const receipt = parseOrThrow(
    P9LiveAuthorityReceiptSchema,
    input.receipt,
    'invalid_live_authority_receipt',
  );
  if (receipt.receiptDigest !== input.expectedAuthorityDigest) {
    fail('live_authority_trust_anchor_mismatch');
  }
  if (receipt.issuerId !== input.trustedIssuerId) {
    fail('live_authority_untrusted_issuer');
  }
  if (receipt.executionId !== input.executionId) {
    fail('live_authority_execution_mismatch');
  }
  if (
    receipt.planScope.question !== input.question ||
    receipt.planScope.questionDigest !== canonicalDigest(input.question)
  ) {
    fail('live_authority_question_mismatch');
  }
  if (
    receipt.sourceClassificationPolicyDigest !==
    input.sourceClassificationPolicyDigest
  ) {
    fail('live_authority_source_policy_mismatch');
  }
  const profileCatalog = parseOrThrow(
    P9ProviderProfileCatalogSchema,
    input.profileCatalog,
    'invalid_provider_profile_catalog',
  );
  const priceCatalog = parseOrThrow(
    ProviderPriceCatalogSchema,
    input.priceCatalog,
    'invalid_price_catalog',
  );
  const now = Date.parse(input.now);
  if (!Number.isFinite(now) || now < Date.parse(receipt.notBeforeAt)) {
    fail('live_authority_not_yet_valid');
  }
  if (now >= Date.parse(receipt.expiresAt)) fail('live_authority_expired');

  if (
    receipt.priceCatalogId !== priceCatalog.catalogId ||
    receipt.priceCatalogVersion !== priceCatalog.version ||
    receipt.priceCatalogDigest !== priceCatalog.catalogDigest
  ) {
    fail('live_authority_price_catalog_lineage_mismatch');
  }
  if (
    receipt.providerProfileCatalogId !== profileCatalog.catalogId ||
    receipt.providerProfileCatalogVersion !== profileCatalog.version ||
    receipt.providerProfileCatalogDigest !== profileCatalog.catalogDigest
  ) {
    fail('live_authority_profile_catalog_lineage_mismatch');
  }
  const plan = parseOrThrow(
    ResearchPlanSchema,
    input.plan,
    'invalid_research_plan',
  );
  const acceptanceReceipt = parseOrThrow(
    PlanAcceptanceReceiptSchema,
    input.acceptanceReceipt,
    'invalid_plan_acceptance_receipt',
  );
  assertPlanScope(receipt, plan, acceptanceReceipt);

  const profileById = new Map(
    profileCatalog.profiles.map((profile) => [profile.profileId, profile]),
  );
  const priceEntryById = new Map(
    priceCatalog.entries.map((entry) => [entry.id, entry]),
  );
  if (priceEntryById.size !== priceCatalog.entries.length) {
    fail('duplicate_price_catalog_entry');
  }
  const profiles = receipt.authorizedProfileIds.map((profileId) => {
    const profile = profileById.get(profileId);
    if (!profile) fail('authorized_provider_profile_missing');
    for (const entryId of profile.catalogEntryIds) {
      const entry = priceEntryById.get(entryId);
      if (!entry) fail('provider_profile_price_entry_missing');
      if (
        entry.provider !== profile.provider ||
        entry.effectKind !== profile.effectKind
      ) {
        fail('provider_profile_price_entry_lineage_mismatch');
      }
    }
    return profile;
  });
  if (
    new Set(receipt.authorizedProfileIds).size !==
    profileCatalog.profiles.length
  ) {
    fail('provider_profile_catalog_not_fully_authorized');
  }
  const proposerProfile = requiredProfile(
    profileById,
    receipt.proposerProfileId,
    'model_proposer',
  );
  const evaluatorProfile = requiredProfile(
    profileById,
    receipt.evaluatorProfileId,
    'model_evaluator',
  );
  if (
    proposerProfile.profileId === evaluatorProfile.profileId ||
    proposerProfile.profileFamilyId === evaluatorProfile.profileFamilyId
  ) {
    fail('model_profile_families_not_distinct');
  }
  const effectKinds = new Set(profiles.map((profile) => profile.effectKind));
  const authorizedEffectKinds = new Set(receipt.authorizedEffectKinds);
  for (const requiredEffectKind of [
    'search',
    'retrieval',
    'parser',
    'model',
  ] as const) {
    if (!authorizedEffectKinds.has(requiredEffectKind)) {
      fail('required_live_effect_not_authorized');
    }
  }
  for (const effectKind of receipt.authorizedEffectKinds) {
    if (!effectKinds.has(effectKind)) fail('authorized_effect_profile_missing');
  }
  if (effectKinds.size !== authorizedEffectKinds.size) {
    fail('authorized_effect_kind_set_mismatch');
  }
  const destinations = new Set(
    profiles.map((profile) => profile.destinationOrigin),
  );
  const billingAccounts = new Set(
    profiles.map((profile) => profile.billingAccountId),
  );
  if (!sameSet(destinations, new Set(receipt.authorizedDestinationOrigins))) {
    fail('authorized_destination_set_mismatch');
  }
  if (!sameSet(billingAccounts, new Set(receipt.authorizedBillingAccountIds))) {
    fail('authorized_billing_account_set_mismatch');
  }
  if (
    receipt.authorizedRetrievalOrigins.some(
      (value) => new URL(value).protocol !== 'https:',
    )
  ) {
    fail('authorized_retrieval_origin_insecure');
  }
  if (receipt.budgetLimit.currencyUsd !== plan.budget.currencyUsd) {
    fail('live_authority_exceeds_accepted_plan_budget');
  }
  const zeroBound = {
    currencyUsd: 0,
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    bytes: 0,
    durationMs: 0,
  };
  const aggregateCeiling = profiles.reduce((total, profile) => {
    const entryId = profile.catalogEntryIds[0];
    const entry = entryId ? priceEntryById.get(entryId) : undefined;
    if (!entry) fail('provider_profile_price_entry_missing');
    const bound = calculateP9EffectCostBound(entry, profile.requestCeiling);
    return addVector(total, bound);
  }, zeroBound);
  const categoryCosts = profiles.reduce(
    (costs, profile) => {
      const entryId = profile.catalogEntryIds[0];
      const entry = entryId ? priceEntryById.get(entryId) : undefined;
      if (!entry) fail('provider_profile_price_entry_missing');
      const cost = calculateP9EffectCostBound(
        entry,
        profile.requestCeiling,
      ).currencyUsd;
      if (profile.effectKind === 'search') costs.search += cost;
      else if (
        profile.effectKind === 'retrieval' ||
        profile.effectKind === 'parser'
      ) {
        costs.retrievalParsing += cost;
      } else costs.models += cost;
      return costs;
    },
    { search: 0, retrievalParsing: 0, models: 0 },
  );
  if (
    categoryCosts.search > plan.budget.searchUsd ||
    categoryCosts.retrievalParsing > plan.budget.retrievalParsingUsd ||
    categoryCosts.models > plan.budget.modelsUsd ||
    aggregateCeiling.currencyUsd > plan.budget.currencyUsd
  ) {
    fail('live_authority_category_budget_exceeded');
  }
  for (const key of [
    'requests',
    'inputTokens',
    'outputTokens',
    'bytes',
    'durationMs',
  ] as const) {
    if (receipt.budgetLimit[key] !== aggregateCeiling[key]) {
      fail('live_authority_budget_vector_mismatch');
    }
  }
  return {
    receipt,
    profileCatalog,
    priceCatalog,
    profiles,
    proposerProfile,
    evaluatorProfile,
  };
}

function addVector(
  left: {
    currencyUsd: number;
    requests: number;
    inputTokens: number;
    outputTokens: number;
    bytes: number;
    durationMs: number;
  },
  right: typeof left,
): typeof left {
  return {
    currencyUsd: roundCurrency(left.currencyUsd + right.currencyUsd),
    requests: left.requests + right.requests,
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    bytes: left.bytes + right.bytes,
    durationMs: left.durationMs + right.durationMs,
  };
}

function roundCurrency(value: number): number {
  return Math.ceil(value * 1_000_000_000_000) / 1_000_000_000_000;
}

function assertPlanScope(
  receipt: P9LiveAuthorityReceipt,
  plan: ResearchPlan,
  acceptanceReceipt: PlanAcceptanceReceipt,
): void {
  const scope = receipt.planScope;
  if (
    scope.proposalId !== plan.proposalId ||
    scope.proposalDigest !== plan.proposalDigest ||
    scope.planId !== plan.planId ||
    scope.planDigest !== plan.planDigest ||
    scope.acceptanceReceiptDigest !== acceptanceReceipt.receiptDigest ||
    scope.domainPackId !== plan.domainPackId ||
    scope.packDigest !== plan.packDigest ||
    scope.question !== plan.question ||
    scope.questionDigest !== canonicalDigest(plan.question) ||
    canonicalDigest(scope.budgetAllocation) !== canonicalDigest(plan.budget)
  ) {
    fail('live_authority_plan_lineage_mismatch');
  }
  if (
    acceptanceReceipt.decision !== 'accepted' ||
    acceptanceReceipt.proposalId !== plan.proposalId ||
    acceptanceReceipt.proposalDigest !== plan.proposalDigest ||
    acceptanceReceipt.planId !== plan.planId ||
    acceptanceReceipt.planDigest !== plan.planDigest ||
    acceptanceReceipt.packId !== plan.domainPackId ||
    acceptanceReceipt.packDigest !== plan.packDigest ||
    acceptanceReceipt.acceptancePolicyId !== plan.acceptancePolicyId ||
    acceptanceReceipt.actorId !== plan.acceptedBy ||
    acceptanceReceipt.decidedAt !== plan.acceptedAt
  ) {
    fail('live_authority_plan_acceptance_lineage_mismatch');
  }
}

function sameSet<T>(left: ReadonlySet<T>, right: ReadonlySet<T>): boolean {
  return (
    left.size === right.size && [...left].every((value) => right.has(value))
  );
}

function requiredProfile(
  profiles: ReadonlyMap<string, P9ProviderProfile>,
  profileId: string,
  role: P9ProviderProfile['role'],
): P9ProviderProfile {
  const profile = profiles.get(profileId);
  if (!profile || profile.role !== role) fail(`${role}_profile_mismatch`);
  return profile;
}

function parseOrThrow<T>(
  schema: { safeParse: (value: unknown) => { success: boolean; data?: T } },
  value: unknown,
  code: string,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) fail(code);
  return parsed.data as T;
}

function fail(code: string): never {
  throw new GovernanceError(code, code);
}
