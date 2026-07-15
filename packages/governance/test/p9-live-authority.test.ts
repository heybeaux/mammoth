import {
  canonicalDigest,
  type P9LiveAuthorityReceipt,
  type P9ProviderProfile,
  type P9ProviderProfileCatalog,
  type ProviderPriceCatalog,
  type ResearchPlanProposal,
} from '@mammoth/domain';
import { describe, expect, it } from 'vitest';
import {
  acceptResearchPlan,
  assertP9LiveAuthorityLineage,
  P9_DOMAIN_POLICY_PACKS,
} from '../src/index.js';
import type { GovernanceError } from '../src/index.js';

const NOW = '2026-07-15T18:00:00.000Z';
const QUESTION =
  'Which colibri runtime memory experiments distinguish measured improvement from noise?';
const SOURCE_POLICY_DIGEST = canonicalDigest({
  policy: 'source-classification/v1',
});
const digest = (seed: string): string => canonicalDigest({ seed });

function acceptedPlan() {
  const subquestions = ['runtime', 'memory', 'experiments', 'noise'].map(
    (term, index) => ({
      subquestionId: `sq-${String(index + 1)}`,
      question: `Which ${term} evidence answers the colibri question?`,
      mandatory: true,
    }),
  );
  const identity = {
    schemaVersion: '1.0.0' as const,
    contractFamily: 'p9.v1' as const,
    proposalId: 'proposal:test',
    question: QUESTION,
    domainPackId: 'technical-due-diligence/v1' as const,
    packDigest: P9_DOMAIN_POLICY_PACKS['technical-due-diligence/v1'].packDigest,
    scope: {
      include: ['colibri runtime memory experiments and measurement noise'],
      exclusions: [{ exclusionId: 'no-run', statement: 'No execution.' }],
    },
    subquestions,
    coverageRequirements: subquestions.map((entry, index) => ({
      coverageId: `coverage-${String(index + 1)}`,
      subquestionId: entry.subquestionId,
      description: `Evidence for ${entry.question}`,
      mandatory: true,
    })),
    sourceClassTargets: [
      'repository_code',
      'repository_docs',
      'security_advisory',
      'hardware_vendor_docs',
      'peer_reviewed_or_primary_technical',
    ].map((sourceClass) => ({
      sourceClass,
      minimumIndependentSources: 1,
      mandatory: true,
    })),
    searchQueries: subquestions.map((entry, index) => ({
      queryId: `query-${String(index + 1)}`,
      query: `${QUESTION} ${entry.question}`,
      subquestionIds: [entry.subquestionId],
    })),
    contradictionRequirements: [
      { contradictionId: 'c1', description: 'Measured versus claimed.' },
      { contradictionId: 'c2', description: 'Signal versus noise.' },
    ],
    freshnessRequirements: [
      {
        freshnessId: 'fresh',
        appliesTo: 'repository_code',
        maxAgeDays: 180,
        asOfDateRequired: false,
      },
    ],
    stopCriteria: [{ stopId: 'done', description: 'Coverage complete.' }],
    reportOutline: {
      sections: [
        { sectionId: 'summary', title: 'Summary' },
        { sectionId: 'evidence', title: 'Evidence' },
        { sectionId: 'limits', title: 'Limits' },
      ],
    },
    budget: {
      currencyUsd: 5,
      searchUsd: 0.5,
      retrievalParsingUsd: 0.5,
      modelsUsd: 4,
    },
    criticalClaimPolicy:
      'independent_entailment_distinct_profile_family' as const,
    derivations: {
      scope: { source: 'question' as const, questionTerms: ['colibri'] },
      subquestions: { source: 'question' as const, questionTerms: ['memory'] },
      coverage: { source: 'domain_pack' as const, questionTerms: [] },
      source_classes: { source: 'domain_pack' as const, questionTerms: [] },
      search_queries: {
        source: 'question' as const,
        questionTerms: ['runtime', 'experiments', 'noise'],
      },
      contradictions: { source: 'domain_pack' as const, questionTerms: [] },
      freshness: { source: 'domain_pack' as const, questionTerms: [] },
      stop_criteria: { source: 'domain_pack' as const, questionTerms: [] },
      outline: { source: 'domain_pack' as const, questionTerms: [] },
      budget: { source: 'operator' as const, questionTerms: [] },
    },
    proposerWork: {
      workId: 'work:test',
      workDigest: digest('work'),
      rawResponseDigest: digest('raw'),
      role: 'plan_proposer' as const,
      profileVersionId: 'planner/v1',
      profileFamilyId: 'planner-family',
    },
    proposedAt: '2026-07-15T17:00:00.000Z',
  };
  const proposal = {
    ...identity,
    proposalDigest: canonicalDigest(identity),
  } as ResearchPlanProposal;
  const result = acceptResearchPlan({
    proposal,
    thresholds: {
      minSubquestions: 4,
      minSourceClasses: 5,
      minContradictionRequirements: 2,
      maxAuthorizedUsd: 5,
      minQuestionDerivedTerms: 3,
    },
    decidedAt: '2026-07-15T17:30:00.000Z',
    actorId: 'operator:test',
  });
  if (!result.plan) throw new Error('test proposal was not accepted');
  return { plan: result.plan, acceptanceReceipt: result.receipt };
}

function priceCatalog(): ProviderPriceCatalog {
  const rows: readonly (readonly [
    string,
    string,
    'search' | 'retrieval' | 'parser' | 'model',
  ])[] = [
    ['search', 'brave', 'search'],
    ['retrieval', 'mammoth', 'retrieval'],
    ['parser', 'mammoth', 'parser'],
    ['model', 'models', 'model'],
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

function makeProfile(
  role: P9ProviderProfile['role'],
  provider: string,
  family: string,
): P9ProviderProfile {
  const isModel = role.startsWith('model_');
  const effectKind: P9ProviderProfile['effectKind'] = isModel
    ? 'model'
    : (role as 'search' | 'retrieval' | 'parser');
  return {
    profileId: `profile:${role}`,
    profileFamilyId: family,
    provider,
    role,
    effectKind,
    modelId: isModel ? `model:${role}` : null,
    checkpoint: isModel ? `checkpoint:${role}` : null,
    capabilityManifestDigest: isModel ? digest(`capability:${role}`) : null,
    promptTemplateDigest: isModel ? digest(`prompt:${role}`) : null,
    outputSchemaDigest: isModel ? digest(`output:${role}`) : null,
    configurationDigest: digest(`config:${role}`),
    destinationOrigin: `https://${provider}.example/`,
    credentialEnvVar: isModel ? 'TEST_MODEL_KEY' : null,
    billingAuthorized: true,
    billingAccountId: `billing:${role}`,
    catalogEntryIds: [`price:${effectKind}`],
    requestCeiling: {
      requests: 1,
      inputTokens: isModel ? 1_000 : 0,
      outputTokens: isModel ? 500 : 0,
      bytes: role === 'retrieval' || role === 'parser' ? 10_000 : 0,
      durationMs: 30_000,
      attempts: 1,
      parserClass: role === 'parser' ? 'html/v1' : null,
    },
  };
}

function profileCatalog(
  mutate: (profiles: P9ProviderProfile[]) => P9ProviderProfile[] = (value) =>
    value,
): P9ProviderProfileCatalog {
  const profiles = mutate([
    makeProfile('search', 'brave', 'brave/search'),
    makeProfile('retrieval', 'mammoth', 'mammoth/retrieval'),
    makeProfile('parser', 'mammoth', 'mammoth/parser'),
    makeProfile('model_proposer', 'models', 'models/a'),
    makeProfile('model_evaluator', 'models', 'models/b'),
  ]);
  const identity = {
    schemaVersion: '1.0.0' as const,
    contractFamily: 'p9.v1' as const,
    catalogId: 'profiles:p9-live',
    version: '2026-07-15',
    profiles,
  };
  return { ...identity, catalogDigest: canonicalDigest(identity) };
}

function authority(
  prices = priceCatalog(),
  profiles = profileCatalog(),
  mutate: (identity: Record<string, unknown>) => Record<string, unknown> = (
    value,
  ) => value,
): P9LiveAuthorityReceipt {
  const { plan, acceptanceReceipt } = acceptedPlan();
  const executionId = 'execution:p9-live-test';
  const consumptionNonce = 'nonce:single-use:0001';
  const requestBudget = profiles.profiles.reduce(
    (total, profile) => ({
      requests:
        total.requests +
        profile.requestCeiling.requests * profile.requestCeiling.attempts,
      inputTokens:
        total.inputTokens +
        profile.requestCeiling.inputTokens * profile.requestCeiling.attempts,
      outputTokens:
        total.outputTokens +
        profile.requestCeiling.outputTokens * profile.requestCeiling.attempts,
      bytes:
        total.bytes +
        profile.requestCeiling.bytes * profile.requestCeiling.attempts,
      durationMs:
        total.durationMs +
        profile.requestCeiling.durationMs * profile.requestCeiling.attempts,
    }),
    { requests: 0, inputTokens: 0, outputTokens: 0, bytes: 0, durationMs: 0 },
  );
  const identity = mutate({
    schemaVersion: '1.0.0',
    contractFamily: 'p9.v1',
    authorityId: 'authority:p9-live-test',
    issuerId: 'issuer:trusted',
    decision: 'authorized',
    reason: 'Approved exact bounded live exhibition.',
    executionId,
    executionDigest: canonicalDigest({
      executionId,
      planDigest: plan.planDigest,
      questionDigest: canonicalDigest(plan.question),
      consumptionNonce,
    }),
    consumptionNonce,
    maximumExecutions: 1,
    planScope: {
      proposalId: plan.proposalId,
      proposalDigest: plan.proposalDigest,
      planId: plan.planId,
      planDigest: plan.planDigest,
      acceptanceReceiptDigest: acceptanceReceipt.receiptDigest,
      question: plan.question,
      questionDigest: canonicalDigest(plan.question),
      domainPackId: plan.domainPackId,
      packDigest: plan.packDigest,
      budgetAllocation: plan.budget,
    },
    priceCatalogId: prices.catalogId,
    priceCatalogVersion: prices.version,
    priceCatalogDigest: prices.catalogDigest,
    providerProfileCatalogId: profiles.catalogId,
    providerProfileCatalogVersion: profiles.version,
    providerProfileCatalogDigest: profiles.catalogDigest,
    sourceClassificationPolicyDigest: SOURCE_POLICY_DIGEST,
    authorizedProfileIds: profiles.profiles.map((entry) => entry.profileId),
    proposerProfileId: 'profile:model_proposer',
    evaluatorProfileId: 'profile:model_evaluator',
    budgetLimit: { currencyUsd: plan.budget.currencyUsd, ...requestBudget },
    authorizedEffectKinds: ['search', 'retrieval', 'parser', 'model'],
    authorizedDestinationOrigins: [
      ...new Set(profiles.profiles.map((p) => p.destinationOrigin)),
    ],
    authorizedBillingAccountIds: [
      ...new Set(profiles.profiles.map((p) => p.billingAccountId)),
    ],
    actorId: 'operator:test',
    authorizedAt: '2026-07-15T17:00:00.000Z',
    notBeforeAt: '2026-07-15T17:00:00.000Z',
    expiresAt: '2026-07-16T17:00:00.000Z',
  });
  return {
    ...identity,
    receiptDigest: canonicalDigest(identity),
  } as P9LiveAuthorityReceipt;
}

function input(
  receipt = authority(),
  profiles = profileCatalog(),
  prices = priceCatalog(),
) {
  const { plan, acceptanceReceipt } = acceptedPlan();
  return {
    receipt,
    profileCatalog: profiles,
    priceCatalog: prices,
    plan,
    acceptanceReceipt,
    expectedAuthorityDigest: receipt.receiptDigest,
    trustedIssuerId: 'issuer:trusted',
    executionId: 'execution:p9-live-test',
    question: QUESTION,
    sourceClassificationPolicyDigest: SOURCE_POLICY_DIGEST,
    now: NOW,
  };
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

function reseal(
  receipt: P9LiveAuthorityReceipt,
  changed: Record<string, unknown>,
) {
  const identity = { ...receipt, ...changed, receiptDigest: undefined };
  return {
    ...identity,
    receiptDigest: canonicalDigest(identity),
  } as P9LiveAuthorityReceipt;
}

describe('P9 scoped live authority lineage', () => {
  it('resolves only a pinned receipt, trusted issuer, exact plan, and distinct model families', () => {
    const values = input();
    const lineage = assertP9LiveAuthorityLineage(values);
    expect(lineage.proposerProfile.profileFamilyId).toBe('models/a');
    expect(lineage.evaluatorProfile.profileFamilyId).toBe('models/b');
  });

  it('rejects fully resealed authority without the out-of-band digest or trusted issuer', () => {
    const values = input();
    const forged = reseal(values.receipt, {
      reason: 'Attacker resealed all local files.',
    });
    expectCode(
      () => assertP9LiveAuthorityLineage({ ...values, receipt: forged }),
      'live_authority_trust_anchor_mismatch',
    );
    expectCode(
      () =>
        assertP9LiveAuthorityLineage({
          ...values,
          trustedIssuerId: 'issuer:attacker',
        }),
      'live_authority_untrusted_issuer',
    );
  });

  it('rejects authority replay for a different execution or question', () => {
    const values = input();
    expectCode(
      () =>
        assertP9LiveAuthorityLineage({
          ...values,
          executionId: 'execution:other',
        }),
      'live_authority_execution_mismatch',
    );
    expectCode(
      () =>
        assertP9LiveAuthorityLineage({
          ...values,
          question: 'A different question',
        }),
      'live_authority_question_mismatch',
    );
  });

  it('rejects not-before and expiry boundaries', () => {
    const values = input();
    expectCode(
      () =>
        assertP9LiveAuthorityLineage({
          ...values,
          now: '2026-07-15T16:59:59.999Z',
        }),
      'live_authority_not_yet_valid',
    );
    expectCode(
      () =>
        assertP9LiveAuthorityLineage({
          ...values,
          now: values.receipt.expiresAt,
        }),
      'live_authority_expired',
    );
  });

  it('rejects full-vector ceiling and accepted plan budget drift', () => {
    const values = input();
    expectCode(
      () =>
        assertP9LiveAuthorityLineage({
          ...values,
          receipt: reseal(values.receipt, {
            budgetLimit: {
              ...values.receipt.budgetLimit,
              requests: values.receipt.budgetLimit.requests + 1,
            },
          }),
          expectedAuthorityDigest: reseal(values.receipt, {
            budgetLimit: {
              ...values.receipt.budgetLimit,
              requests: values.receipt.budgetLimit.requests + 1,
            },
          }).receiptDigest,
        }),
      'live_authority_budget_vector_mismatch',
    );
    const changedBudget = { ...values.receipt.budgetLimit, currencyUsd: 4 };
    const changed = reseal(values.receipt, { budgetLimit: changedBudget });
    expectCode(
      () =>
        assertP9LiveAuthorityLineage({
          ...values,
          receipt: changed,
          expectedAuthorityDigest: changed.receiptDigest,
        }),
      'live_authority_exceeds_accepted_plan_budget',
    );
  });

  it('prices every authorized attempt and rejects category-allocation overspend', () => {
    const expensiveIdentity = {
      ...priceCatalog(),
      entries: priceCatalog().entries.map((entry) =>
        entry.effectKind === 'search'
          ? { ...entry, costPerRequestUsd: 100 }
          : entry,
      ),
      catalogDigest: undefined,
    };
    const expensivePrices = {
      ...expensiveIdentity,
      catalogDigest: canonicalDigest(expensiveIdentity),
    } as ProviderPriceCatalog;
    const profiles = profileCatalog();
    const expensiveReceipt = authority(expensivePrices, profiles);
    expectCode(
      () =>
        assertP9LiveAuthorityLineage(
          input(expensiveReceipt, profiles, expensivePrices),
        ),
      'live_authority_category_budget_exceeded',
    );

    const flatRetryIdentity = {
      ...priceCatalog(),
      entries: priceCatalog().entries.map((entry) =>
        entry.effectKind === 'search'
          ? {
              ...entry,
              flatCostUsd: 1,
              costPerRequestUsd: 0,
            }
          : entry,
      ),
      catalogDigest: undefined,
    };
    const flatRetryPrices = {
      ...flatRetryIdentity,
      catalogDigest: canonicalDigest(flatRetryIdentity),
    } as ProviderPriceCatalog;
    const flatRetryProfiles = profileCatalog((entries) =>
      entries.map((profile) =>
        profile.role === 'search'
          ? {
              ...profile,
              requestCeiling: { ...profile.requestCeiling, attempts: 3 },
            }
          : profile,
      ),
    );
    const flatRetryReceipt = authority(flatRetryPrices, flatRetryProfiles);
    expectCode(
      () =>
        assertP9LiveAuthorityLineage(
          input(flatRetryReceipt, flatRetryProfiles, flatRetryPrices),
        ),
      'live_authority_category_budget_exceeded',
    );

    const retryProfiles = profileCatalog((entries) =>
      entries.map((profile) =>
        profile.role === 'search'
          ? {
              ...profile,
              requestCeiling: { ...profile.requestCeiling, attempts: 3 },
            }
          : profile,
      ),
    );
    const retryReceipt = authority(priceCatalog(), retryProfiles);
    expect(() =>
      assertP9LiveAuthorityLineage(
        input(retryReceipt, retryProfiles, priceCatalog()),
      ),
    ).not.toThrow();
    const undercounted = reseal(retryReceipt, {
      budgetLimit: {
        ...retryReceipt.budgetLimit,
        requests: retryReceipt.budgetLimit.requests - 2,
      },
    });
    expectCode(
      () =>
        assertP9LiveAuthorityLineage({
          ...input(undercounted, retryProfiles, priceCatalog()),
          expectedAuthorityDigest: undercounted.receiptDigest,
        }),
      'live_authority_budget_vector_mismatch',
    );
  });

  it('rejects source-policy, destination, and billing-account drift', () => {
    const values = input();
    expectCode(
      () =>
        assertP9LiveAuthorityLineage({
          ...values,
          sourceClassificationPolicyDigest: digest('other-policy'),
        }),
      'live_authority_source_policy_mismatch',
    );
    for (const [field, code] of [
      ['authorizedDestinationOrigins', 'authorized_destination_set_mismatch'],
      [
        'authorizedBillingAccountIds',
        'authorized_billing_account_set_mismatch',
      ],
    ] as const) {
      const changed = reseal(values.receipt, {
        [field]: ['https://attacker.example/'],
      });
      expectCode(
        () =>
          assertP9LiveAuthorityLineage({
            ...values,
            receipt: changed,
            expectedAuthorityDigest: changed.receiptDigest,
          }),
        code,
      );
    }
  });

  it('rejects resealed model lineage drift through the pinned catalog lineage', () => {
    const prices = priceCatalog();
    const originalProfiles = profileCatalog();
    const driftedProfiles = profileCatalog((profiles) =>
      profiles.map((profile) =>
        profile.role === 'model_proposer'
          ? {
              ...profile,
              checkpoint: 'checkpoint:attacker',
              capabilityManifestDigest: digest('attacker-capability'),
              promptTemplateDigest: digest('attacker-prompt'),
              outputSchemaDigest: digest('attacker-output'),
              configurationDigest: digest('attacker-config'),
            }
          : profile,
      ),
    );
    const receipt = authority(prices, originalProfiles);
    expectCode(
      () =>
        assertP9LiveAuthorityLineage(input(receipt, driftedProfiles, prices)),
      'live_authority_profile_catalog_lineage_mismatch',
    );
  });
});

export {
  acceptedPlan,
  authority,
  priceCatalog,
  profileCatalog,
  SOURCE_POLICY_DIGEST,
};
