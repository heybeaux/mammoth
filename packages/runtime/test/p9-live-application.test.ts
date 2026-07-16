import { canonicalDigest, P9LiveAuthorityReceiptSchema } from '@mammoth/domain';
import {
  GovernanceError,
  isClaimRelevantToSubquestion,
  MemoryP9DurableJournalStore,
  P9DurableBudgetAuthority,
  type P9DurableJournalStore,
  type PlanCoverageThresholds,
} from '@mammoth/governance';
import type { retrieveSource } from '@mammoth/retrieval';
import { describe, expect, it } from 'vitest';
import {
  P9_LIVE_EXHIBITION_QUESTION,
  P9_LIVE_SOURCE_CLASSIFICATION_POLICY_DIGEST,
  BraveP9LiveSearchAdapter,
  boundedP9SentenceContext,
  buildAcceptedP9LivePlan,
  canonicalP9CandidateSelectionUrl,
  assertP9LiveBundleReleaseable,
  resealP9LiveArtifacts,
  runP9LiveApplication,
  verifyP9LiveBundle,
  type P9LiveApplicationInput,
  type P9LiveClaimSeed,
  type P9LiveModelAdapter,
  type P9LiveSearchAdapter,
} from '../src/index.js';

const now = () => new Date('2026-07-15T18:00:00.000Z');

const SOURCE_BODY =
  'Colibri caches mmap-backed experts on Apple silicon. Upstream Colibri documentation states the router reuses cached experts between decode steps.';
const QUOTE =
  'Upstream Colibri documentation states the router reuses cached experts between decode steps.';
const CANDIDATE_ID = 'cand-colibri-readme';

function makeCatalog() {
  const entry = (
    id: string,
    provider: string,
    effectKind: 'search' | 'retrieval' | 'parser' | 'model',
    parserClass: string | null,
    costPerRequestUsd: number,
  ) => ({
    id,
    provider,
    effectKind,
    parserClass,
    flatCostUsd: 0,
    costPerRequestUsd,
    costPerInputTokenUsd: 1e-9,
    costPerOutputTokenUsd: 1e-9,
    costPerByteUsd: 1e-10,
  });
  const identity = {
    schemaVersion: '1.0.0' as const,
    contractFamily: 'p9.v1' as const,
    catalogId: 'p9-live-test-catalog',
    version: '1',
    entries: [
      entry('brave-search', 'brave/web-search', 'search', null, 0.005),
      entry('public-retrieval', 'public-web', 'retrieval', null, 0.0005),
      entry(
        'bounded-parser',
        'local-parser',
        'parser',
        'mammoth-deterministic-text',
        0.0001,
      ),
      entry('model-proposer-live', 'openrouter', 'model', null, 0.001),
      entry('model-evaluator-live', 'openrouter', 'model', null, 0.001),
    ],
  };
  return { ...identity, catalogDigest: canonicalDigest(identity) };
}

function makeProfileCatalog() {
  const requestCeiling = (
    requests: number,
    bytes: number,
    durationMs: number,
    inputTokens = 0,
    outputTokens = 0,
    parserClass: string | null = null,
  ) => ({
    requests,
    inputTokens,
    outputTokens,
    bytes,
    durationMs,
    attempts: 1,
    parserClass,
  });
  const profile = (
    profileId: string,
    profileFamilyId: string,
    provider: string,
    role:
      | 'search'
      | 'retrieval'
      | 'parser'
      | 'model_proposer'
      | 'model_evaluator',
    catalogEntryId: string,
    ceiling: ReturnType<typeof requestCeiling>,
    modelId: string | null = null,
  ) => ({
    profileId,
    profileFamilyId,
    provider,
    role,
    effectKind:
      role === 'model_proposer' || role === 'model_evaluator'
        ? ('model' as const)
        : role,
    modelId,
    checkpoint: modelId ? `${modelId}:checkpoint` : null,
    capabilityManifestDigest: modelId
      ? canonicalDigest({ modelId, capability: 'test' })
      : null,
    promptTemplateDigest: modelId
      ? canonicalDigest({ modelId, prompt: 'test' })
      : null,
    outputSchemaDigest: modelId
      ? canonicalDigest({ modelId, output: 'test' })
      : null,
    configurationDigest: canonicalDigest({ profileId, provider, role }),
    destinationOrigin:
      role === 'search'
        ? 'https://api.search.brave.com/'
        : role === 'retrieval'
          ? 'https://public-web.example/'
          : role === 'parser'
            ? 'https://local-parser.example/'
            : 'https://provider.example/',
    credentialEnvVar:
      role === 'retrieval' || role === 'parser' ? null : 'TEST_SECRET',
    billingAuthorized: true as const,
    billingAccountId: `${provider}:billing`,
    catalogEntryIds: [catalogEntryId],
    requestCeiling: ceiling,
  });
  const identity = {
    schemaVersion: '1.0.0' as const,
    contractFamily: 'p9.v1' as const,
    catalogId: 'p9-live-test-profile-catalog',
    version: '1',
    profiles: [
      profile(
        'profile-search',
        'search-family',
        'brave/web-search',
        'search',
        'brave-search',
        requestCeiling(5, 10_000_000, 150_000),
      ),
      profile(
        'profile-retrieval',
        'retrieval-family',
        'public-web',
        'retrieval',
        'public-retrieval',
        requestCeiling(8, 16_000_000, 480_000),
      ),
      profile(
        'profile-parser',
        'parser-family',
        'local-parser',
        'parser',
        'bounded-parser',
        requestCeiling(
          8,
          16_000_000,
          240_000,
          0,
          0,
          'mammoth-deterministic-text',
        ),
      ),
      profile(
        'fixture-proposer-profile',
        'fixture-proposer-family',
        'openrouter',
        'model_proposer',
        'model-proposer-live',
        requestCeiling(1, 2_000_000, 120_000, 120_000, 24_000),
        'fixture/proposer',
      ),
      profile(
        'fixture-evaluator-profile',
        'fixture-evaluator-family',
        'openrouter',
        'model_evaluator',
        'model-evaluator-live',
        requestCeiling(1, 2_000_000, 120_000, 120_000, 24_000),
        'fixture/evaluator',
      ),
    ],
  };
  return { ...identity, catalogDigest: canonicalDigest(identity) };
}

function makeReceipt(
  catalog: ReturnType<typeof makeCatalog>,
  profileCatalog: ReturnType<typeof makeProfileCatalog>,
  maxBudgetUsd = 5,
  journal: P9DurableJournalStore = new MemoryP9DurableJournalStore(),
) {
  const planBundle = buildAcceptedP9LivePlan({
    budgetUsd: maxBudgetUsd,
    now: '2026-07-15T17:00:00.000Z',
    proposerProfile: makeModel({ calls: 0 }).proposerProfile,
  });
  const planScope = {
    proposalId: planBundle.plan.proposalId,
    proposalDigest: planBundle.plan.proposalDigest,
    planId: planBundle.plan.planId,
    planDigest: planBundle.plan.planDigest,
    acceptanceReceiptDigest: planBundle.acceptanceReceipt.receiptDigest,
    question: planBundle.plan.question,
    questionDigest: canonicalDigest(planBundle.plan.question),
    domainPackId: planBundle.plan.domainPackId,
    packDigest: planBundle.plan.packDigest,
    budgetAllocation: planBundle.plan.budget,
  };
  const identity = {
    schemaVersion: '1.0.0' as const,
    contractFamily: 'p9.v1' as const,
    authorityId: 'auth-beaux-p9-live-test',
    issuerId: 'trusted-test-issuer',
    decision: 'authorized' as const,
    reason: 'test authority',
    executionId: 'p9-live-test',
    consumptionNonce: 'nonce-1234567890abcdef',
    consumptionStoreId: journal.identityId(),
    consumptionStoreDigest: journal.identityDigest(),
    maximumExecutions: 1 as const,
    planScope,
    priceCatalogId: catalog.catalogId,
    priceCatalogVersion: catalog.version,
    priceCatalogDigest: catalog.catalogDigest,
    providerProfileCatalogId: profileCatalog.catalogId,
    providerProfileCatalogVersion: profileCatalog.version,
    providerProfileCatalogDigest: profileCatalog.catalogDigest,
    sourceClassificationPolicyDigest:
      P9_LIVE_SOURCE_CLASSIFICATION_POLICY_DIGEST,
    authorizedProfileIds: profileCatalog.profiles.map(
      (profile) => profile.profileId,
    ),
    proposerProfileId: 'fixture-proposer-profile',
    evaluatorProfileId: 'fixture-evaluator-profile',
    budgetLimit: {
      currencyUsd: maxBudgetUsd,
      requests: 23,
      inputTokens: 240_000,
      outputTokens: 48_000,
      bytes: 46_000_000,
      durationMs: 1_110_000,
    },
    authorizedEffectKinds: ['search', 'retrieval', 'parser', 'model'],
    authorizedDestinationOrigins: [
      ...new Set(
        profileCatalog.profiles.map((profile) => profile.destinationOrigin),
      ),
    ],
    authorizedRetrievalOrigins: [
      'https://github.com/',
      'https://api.github.com/',
      'https://raw.githubusercontent.com/',
      'https://huggingface.co/',
      'https://www.apple.com/',
      'https://arxiv.org/',
      'https://www.cisa.gov/',
    ],
    authorizedBillingAccountIds: [
      ...new Set(
        profileCatalog.profiles.map((profile) => profile.billingAccountId),
      ),
    ],
    actorId: 'beaux',
    authorizedAt: '2026-07-15T17:00:00.000Z',
    notBeforeAt: '2026-07-15T17:00:00.000Z',
    expiresAt: '2026-07-16T17:00:00.000Z',
  };
  const withExecution = {
    ...identity,
    executionDigest: canonicalDigest({
      executionId: identity.executionId,
      planDigest: planScope.planDigest,
      questionDigest: planScope.questionDigest,
      consumptionNonce: identity.consumptionNonce,
    }),
  };
  return { ...withExecution, receiptDigest: canonicalDigest(withExecution) };
}

const thresholds: PlanCoverageThresholds = {
  minAdmittedClaims: 1,
  minCriticalClaims: 0,
  minIndependentFamiliesPerCriticalClaim: 1,
  minMandatorySourceClassCoverageRatio: 0,
};

function makeSearch(counter: { calls: number }): P9LiveSearchAdapter {
  return {
    destinationOrigin: 'https://api.search.brave.com',
    search: (query) => {
      counter.calls += 1;
      return Promise.resolve({
        candidates: query.includes('README')
          ? [
              {
                candidateId: CANDIDATE_ID,
                url: 'https://github.com/JustVugg/colibri',
                title: 'JustVugg/colibri',
                sourceClass: 'repository_docs',
                sourceFamilyId: 'github.com',
              },
            ]
          : [],
        usage: {
          requests: 1,
          inputTokens: 0,
          outputTokens: 0,
          bytes: 512,
          durationMs: 5,
        },
      });
    },
  };
}

const fakeRetrieve: typeof retrieveSource = (request) => {
  const currentCommit = request.url.startsWith('https://api.github.com/');
  const body = currentCommit
    ? JSON.stringify({
        sha: '12d3bd51405fc95e40686ce686b5e4ebeb12aa7b',
        commit: { committer: { date: '2026-07-10T12:00:00.000Z' } },
      })
    : SOURCE_BODY;
  return Promise.resolve({
    requestedUrl: request.url,
    finalUrl: request.url,
    redirectChain: [],
    retrievedAt: now().toISOString(),
    status: 200,
    headers: {
      'content-type': currentCommit ? 'application/json' : 'text/plain',
    },
    mediaType: currentCommit ? 'application/json' : 'text/plain',
    bytes: new TextEncoder().encode(body),
    networkReceipts: [],
  });
};

const seeds: readonly P9LiveClaimSeed[] = [
  {
    claimId: 'claim-router-reuse',
    candidateId: CANDIDATE_ID,
    quote: QUOTE,
    statement: QUOTE,
    subquestionIds: ['sq-upstream'],
    sectionId: 'first_bounded_change',
    claimGroupId: 'group-upstream',
    critical: false,
    contradictionIds: [],
  },
];

const modelUsage = {
  requests: 1,
  inputTokens: 2_000,
  outputTokens: 200,
  bytes: 1_024,
  durationMs: 50,
};

function makeModel(counter: { calls: number }): P9LiveModelAdapter {
  const seedTemplate = seeds[0];
  if (!seedTemplate) throw new Error('expected a claim seed fixture');
  return {
    proposerProfile: {
      profileVersionId: 'fixture-proposer-profile',
      profileFamilyId: 'fixture-proposer-family',
      modelId: 'fixture/proposer',
    },
    evaluatorProfile: {
      profileVersionId: 'fixture-evaluator-profile',
      profileFamilyId: 'fixture-evaluator-family',
      modelId: 'fixture/evaluator',
    },
    proposeClaims: ({ snapshots }) => {
      counter.calls += 1;
      return Promise.resolve({
        value: snapshots
          .filter((snapshot) => snapshot.body.includes(QUOTE))
          .map((snapshot, index) => ({
            ...seedTemplate,
            claimId:
              index === 0
                ? seedTemplate.claimId
                : `${seedTemplate.claimId}-${String(index + 1)}`,
            candidateId: snapshot.candidateId,
          })),
        usage: modelUsage,
      });
    },
    evaluateClaims: ({ claims }) => {
      counter.calls += 1;
      return Promise.resolve({
        value: claims.map((claim) => ({
          claimId: claim.claimId,
          verdict: 'entailed' as const,
        })),
        usage: modelUsage,
      });
    },
    synthesizeReport: ({ plan, claims }) => {
      counter.calls += 1;
      const leads: Record<string, string> = {
        executive_summary:
          'Test one bounded Metal decode-loop change first, then accept it only if repeated paired benchmarks beat the unchanged baseline beyond observed run-to-run noise.',
        upstream_colibri_facts:
          'The admitted upstream evidence establishes the current implementation boundary that the proposed experiment must preserve.',
        apple_silicon_constraints:
          'The machine constraint keeps the experiment focused on unified-memory Apple silicon rather than unrelated accelerator architectures.',
        first_bounded_change:
          'Add one proposed opt-in prefetch mode that loads the next admitted expert instead of waiting for the following decode step; the current state reuses cached experts between decode steps, so test the change while preserving outputs.',
        experiment_design:
          'After 5 warm-up runs, run 30 paired repetitions against the unchanged baseline with fixed model, prompt, temperature, and machine state. Reject and fail the change unless output parity holds; accept only a minimum 5% improvement with 95% bootstrap confidence.',
        risks_and_contradictions:
          'Reject the change if output parity breaks or if its apparent speedup disappears across repeated controlled runs.',
        references_provenance:
          'The exact admitted claims, source snapshots, model receipts, and budget lineage remain available in the bundle appendix.',
      };
      return Promise.resolve({
        value: [
          ...plan.reportOutline.sections,
          {
            sectionId: 'references_provenance',
            title: 'references and provenance',
          },
        ].map((section) => ({
          sectionId: section.sectionId,
          lead:
            leads[section.sectionId] ??
            'This section summarizes the admitted evidence in a concise and readable form.',
          claimIds: claims
            .filter((claim) => claim.sectionId === section.sectionId)
            .map((claim) => claim.claimId),
        })),
        usage: modelUsage,
      });
    },
  };
}

function makeInput(
  overrides: Partial<P9LiveApplicationInput> & {
    searchCounter?: { calls: number };
    modelCounter?: { calls: number };
  } = {},
): P9LiveApplicationInput {
  const catalog = makeCatalog();
  const providerProfileCatalog = makeProfileCatalog();
  const { searchCounter, modelCounter, ...rest } = overrides;
  const journal = rest.journal ?? new MemoryP9DurableJournalStore();
  const defaultAuthorizationReceipt = makeReceipt(
    catalog,
    providerProfileCatalog,
    5,
    journal,
  );
  const authorizationReceipt = Object.hasOwn(rest, 'authorizationReceipt')
    ? rest.authorizationReceipt
    : defaultAuthorizationReceipt;
  const parsedAuthorizationReceipt =
    P9LiveAuthorityReceiptSchema.safeParse(authorizationReceipt);
  return {
    executionId: 'p9-live-test',
    budgetUsd: 5,
    authorizationReceipt,
    catalog,
    providerProfileCatalog,
    expectedAuthorityDigest: parsedAuthorizationReceipt.success
      ? parsedAuthorizationReceipt.data.receiptDigest
      : defaultAuthorizationReceipt.receiptDigest,
    trustedIssuerId: parsedAuthorizationReceipt.success
      ? parsedAuthorizationReceipt.data.issuerId
      : defaultAuthorizationReceipt.issuerId,
    journal,
    search: makeSearch(searchCounter ?? { calls: 0 }),
    model: makeModel(modelCounter ?? { calls: 0 }),
    now,
    retrieve: fakeRetrieve,
    thresholds,
    ...rest,
  };
}

interface JournalRecord {
  sequence: number;
  entry: { kind: string; reservationId?: string } & Record<string, unknown>;
}

function records(journal: MemoryP9DurableJournalStore): JournalRecord[] {
  return journal.readLines().map((line) => JSON.parse(line) as JournalRecord);
}

describe('P9 live application', () => {
  it('stops bounded context at punctuation selected by the quote', () => {
    const body = 'First sentence. Second sentence.';
    const quote = 'First sentence.';

    expect(boundedP9SentenceContext(body, 0, quote.length)).toBe(quote);
  });

  it('serializes concurrent Brave fetch starts across a rejected request', async () => {
    let monotonicMs = 10_000;
    const sleeps: number[] = [];
    const fetchTimes: number[] = [];
    const adapter = new BraveP9LiveSearchAdapter({
      apiKeyEnvironmentVariable: 'TEST_BRAVE_KEY',
      environment: { TEST_BRAVE_KEY: 'secret-value' },
      minimumIntervalMs: 1_100,
      monotonicNow: () => monotonicMs,
      sleep: (milliseconds) => {
        sleeps.push(milliseconds);
        monotonicMs += milliseconds;
        return Promise.resolve();
      },
      fetchImpl: (() => {
        fetchTimes.push(monotonicMs);
        return Promise.resolve(
          new Response(JSON.stringify({ web: { results: [] } }), {
            status: fetchTimes.length === 1 ? 429 : 200,
          }),
        );
      }) as typeof fetch,
    });

    const outcomes = await Promise.allSettled([
      adapter.search('first query'),
      adapter.search('second query'),
    ]);
    await adapter.search('third query');

    expect(outcomes.map((outcome) => outcome.status)).toEqual([
      'rejected',
      'fulfilled',
    ]);
    expect(fetchTimes).toEqual([10_000, 11_100, 12_200]);
    expect(sleeps).toEqual([1_100, 1_100]);
  });

  it('extends Brave pacing from an exhausted sliding-window header', async () => {
    let monotonicMs = 10_000;
    const sleeps: number[] = [];
    const fetchTimes: number[] = [];
    const adapter = new BraveP9LiveSearchAdapter({
      apiKeyEnvironmentVariable: 'TEST_BRAVE_KEY',
      environment: { TEST_BRAVE_KEY: 'secret-value' },
      minimumIntervalMs: 1_100,
      monotonicNow: () => monotonicMs,
      sleep: (milliseconds) => {
        sleeps.push(milliseconds);
        monotonicMs += milliseconds;
        return Promise.resolve();
      },
      fetchImpl: (() => {
        fetchTimes.push(monotonicMs);
        return Promise.resolve(
          new Response(JSON.stringify({ web: { results: [] } }), {
            status: 200,
            headers: {
              'x-ratelimit-remaining': '0, 1000',
              'x-ratelimit-reset': '1, 100000',
            },
          }),
        );
      }) as typeof fetch,
    });

    await adapter.search('first query');
    await adapter.search('second query');

    expect(fetchTimes).toEqual([10_000, 11_250]);
    expect(sleeps).toEqual([1_250]);
  });

  it('includes a validated Brave reset hint in rate-limit failures', async () => {
    const adapter = new BraveP9LiveSearchAdapter({
      apiKeyEnvironmentVariable: 'TEST_BRAVE_KEY',
      environment: { TEST_BRAVE_KEY: 'secret-value' },
      fetchImpl: (() =>
        Promise.resolve(
          new Response('', {
            status: 429,
            headers: { 'x-ratelimit-reset': '2, 99999' },
          }),
        )) as typeof fetch,
    });

    await expect(adapter.search('rate limited query')).rejects.toThrow(
      /HTTP 429; rate limit reset 2, 99999 seconds/u,
    );
  });

  it('canonicalizes candidate variants before diversity counting', () => {
    expect(
      canonicalP9CandidateSelectionUrl(
        'https://github.com/JustVugg/colibri/?utm_source=test#readme',
      ),
    ).toBe(
      canonicalP9CandidateSelectionUrl('https://github.com/JustVugg/colibri'),
    );
    expect(
      canonicalP9CandidateSelectionUrl(
        'https://example.test/resource?id=first&utm_source=test',
      ),
    ).toBe('https://example.test/resource?id=first');
    expect(
      canonicalP9CandidateSelectionUrl(
        'https://example.test/resource?id=first',
      ),
    ).not.toBe(
      canonicalP9CandidateSelectionUrl(
        'https://example.test/resource?id=second',
      ),
    );
  });

  it('only classifies allowlisted official Hugging Face model cards as upstream docs', async () => {
    const adapter = new BraveP9LiveSearchAdapter({
      apiKeyEnvironmentVariable: 'TEST_BRAVE_KEY',
      environment: { TEST_BRAVE_KEY: 'secret-value' },
      fetchImpl: (() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              web: {
                results: [
                  {
                    title: 'Official model card',
                    url: 'https://huggingface.co/zai-org/GLM-5',
                  },
                  {
                    title: 'Community copy',
                    url: 'https://huggingface.co/community/GLM-5',
                  },
                ],
              },
            }),
            { status: 200 },
          ),
        )) as typeof fetch,
    });

    const result = await adapter.search('official model card');

    expect(result.candidates.map((candidate) => candidate.sourceClass)).toEqual(
      ['upstream_model_docs', 'unclassified_public_source'],
    );
  });

  it('classifies only the CISA domain and its subdomains as security advisories', async () => {
    const adapter = new BraveP9LiveSearchAdapter({
      apiKeyEnvironmentVariable: 'TEST_BRAVE_KEY',
      environment: { TEST_BRAVE_KEY: 'secret-value' },
      fetchImpl: (() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              web: {
                results: [
                  { title: 'CISA', url: 'https://www.cisa.gov/advisory' },
                  { title: 'Impostor', url: 'https://fakecisa.gov/advisory' },
                  {
                    title: 'Nested impostor',
                    url: 'https://cisa.gov.example.com/advisory',
                  },
                ],
              },
            }),
            { status: 200 },
          ),
        )) as typeof fetch,
    });

    const result = await adapter.search('security advisory');

    expect(result.candidates.map((candidate) => candidate.sourceClass)).toEqual(
      [
        'security_advisory',
        'peer_reviewed_or_primary_technical',
        'peer_reviewed_or_primary_technical',
      ],
    );
  });

  it('freezes the exact Colibri question into an accepted technical due diligence plan', () => {
    const plan = buildAcceptedP9LivePlan({
      budgetUsd: 5,
      now: now().toISOString(),
      proposerProfile: makeModel({ calls: 0 }).proposerProfile,
    });

    expect(plan.plan.question).toBe(P9_LIVE_EXHIBITION_QUESTION);
    expect(plan.plan.domainPackId).toBe('technical-due-diligence/v1');
    expect(plan.plan.budget.currencyUsd).toBe(5);
    expect(plan.plan.budget.searchUsd).toBe(0.05);
    expect(plan.plan.budget.retrievalParsingUsd).toBe(0.02);
    expect(plan.plan.budget.modelsUsd).toBe(4.929999999);
    expect(
      plan.plan.sourceClassTargets.map((target) => target.sourceClass),
    ).toContain('hardware_vendor_docs');

    expect(
      buildAcceptedP9LivePlan({
        budgetUsd: 0.912465499997,
        now: '2026-07-15T18:00:00.000Z',
        proposerProfile: makeModel({ calls: 0 }).proposerProfile,
      }).plan.budget.currencyUsd,
    ).toBe(0.912465499997);
    expect(
      plan.plan.sourceClassTargets.find(
        (target) => target.sourceClass === 'security_advisory',
      )?.mandatory,
    ).toBe(true);
    expect(plan.plan.searchQueries.map((query) => query.query)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('site:apple.com'),
        expect.stringContaining('site:arxiv.org'),
        expect.stringContaining('site:cisa.gov'),
      ]),
    );
    expect(plan.acceptanceReceipt.decision).toBe('accepted');
  });

  it('searches every governed query before selecting candidates by rank across queries', async () => {
    const searched: string[] = [];
    const retrieved: string[] = [];
    let candidateSequence = 0;
    const search: P9LiveSearchAdapter = {
      destinationOrigin: 'https://api.search.brave.com',
      search: (query) => {
        searched.push(query);
        candidateSequence += 1;
        const id = String(candidateSequence);
        return Promise.resolve({
          candidates: [
            {
              candidateId: `candidate-${id}`,
              url: `https://github.com/JustVugg/colibri/blob/main/source-${id}.md`,
              title: `source ${id}`,
              sourceClass: 'repository_code',
              sourceFamilyId: 'github.com',
            },
          ],
          usage: {
            requests: 1,
            inputTokens: 0,
            outputTokens: 0,
            bytes: 100,
            durationMs: 1,
          },
        });
      },
    };
    const retrieve: typeof retrieveSource = (request) => {
      retrieved.push(request.url);
      return fakeRetrieve(request);
    };

    await runP9LiveApplication(
      makeInput({ search, retrieve, maxCandidates: 3 }),
    );

    expect(searched).toHaveLength(5);
    expect(retrieved).toEqual([
      'https://api.github.com/repos/JustVugg/colibri/commits/12d3bd51405fc95e40686ce686b5e4ebeb12aa7b',
      'https://github.com/JustVugg/colibri/blob/main/source-2.md',
      'https://github.com/JustVugg/colibri/blob/main/source-3.md',
    ]);
  });

  it('seeds every mandatory source class before volatile search results', async () => {
    const retrieved: string[] = [];
    const run = await runP9LiveApplication(
      makeInput({
        includeMandatorySourceTargets: true,
        maxCandidates: 6,
        retrieve: (request) => {
          retrieved.push(request.url);
          return fakeRetrieve(request);
        },
      }),
    );

    expect(retrieved).toEqual([
      'https://raw.githubusercontent.com/JustVugg/colibri/12d3bd51405fc95e40686ce686b5e4ebeb12aa7b/c/backend_metal.mm',
      'https://github.com/JustVugg/colibri/blob/12d3bd51405fc95e40686ce686b5e4ebeb12aa7b/README.md',
      'https://huggingface.co/zai-org/GLM-5',
      'https://www.apple.com/newsroom/2024/10/apple-introduces-m4-pro-and-m4-max/',
      'https://arxiv.org/html/2509.24086v1',
      'https://www.cisa.gov/resources-tools/resources/case-memory-safe-roadmaps',
    ]);
    expect(
      JSON.parse(run.artifacts['execution-receipt.json'] ?? '{}') as {
        counts?: { selectedCandidates?: number };
      },
    ).toMatchObject({ counts: { selectedCandidates: 6 } });
  });

  it('does not count an unrelated product advisory as a Colibri risk claim', () => {
    const plan = buildAcceptedP9LivePlan({
      budgetUsd: 5,
      now: now().toISOString(),
      proposerProfile: makeModel({ calls: 0 }).proposerProfile,
    }).plan;
    const risk = plan.subquestions.find(
      (subquestion) => subquestion.subquestionId === 'sq-risk',
    );
    if (!risk) throw new Error('missing risk subquestion');
    const unrelated = {
      proposal: {
        statement:
          'Improper Restriction of Operations within the Bounds of a Memory Buffer',
      },
      evidence: { subquestionIds: ['sq-risk'] },
    } as Parameters<typeof isClaimRelevantToSubquestion>[0];

    expect(
      isClaimRelevantToSubquestion(
        unrelated,
        risk.subquestionId,
        risk.question,
      ),
    ).toBe(false);
  });

  it('counts the captured Metal backend quote toward the upstream question', () => {
    const plan = buildAcceptedP9LivePlan({
      budgetUsd: 5,
      now: now().toISOString(),
      proposerProfile: makeModel({ calls: 0 }).proposerProfile,
    }).plan;
    const upstream = plan.subquestions.find(
      (subquestion) => subquestion.subquestionId === 'sq-upstream',
    );
    if (!upstream) throw new Error('missing upstream subquestion');
    const captured = {
      proposal: {
        statement:
          '// Apple-GPU (Metal) backend for colibrì. Runtime-compiled shader (no Xcode needed),\n// zero-copy over unified memory.',
      },
      evidence: { subquestionIds: ['sq-upstream'] },
    } as Parameters<typeof isClaimRelevantToSubquestion>[0];

    expect(
      isClaimRelevantToSubquestion(
        captured,
        upstream.subquestionId,
        upstream.question,
      ),
    ).toBe(true);
  });

  it('precedes every outbound effect with a durable journaled reservation and settles observed usage', async () => {
    const journal = new MemoryP9DurableJournalStore();
    const catalog = makeCatalog();
    const model = makeModel({ calls: 0 });
    let proposedSnapshotIds: readonly string[] = [];
    const run = await runP9LiveApplication(
      makeInput({
        journal,
        catalog,
        model: {
          ...model,
          proposeClaims: (input) => {
            proposedSnapshotIds = input.snapshots.map(
              (snapshot) => snapshot.candidateId,
            );
            return Promise.resolve({ value: seeds, usage: modelUsage });
          },
        },
      }),
    );

    expect(run.exactBundleVerified).toBe(true);
    expect(run.authorizationReceipt.actorId).toBe('beaux');

    const all = records(journal);
    expect(all[0]?.entry.kind).toBe('genesis');
    expect(all[0]?.entry.catalogDigest).toBe(catalog.catalogDigest);
    expect(all[0]?.entry.authorityReceiptDigest).toBe(
      makeReceipt(catalog, makeProfileCatalog()).receiptDigest,
    );

    const sequenceOf = (kind: string, reservationId: string) =>
      all.find(
        (record) =>
          record.entry.kind === kind &&
          record.entry.reservationId === reservationId,
      )?.sequence;
    for (const effectId of [
      'search:q-colibri-repo',
      `retrieval:${CANDIDATE_ID}`,
      `parser:${CANDIDATE_ID}`,
      'model:proposer',
      'model:evaluator',
    ]) {
      const reserved = sequenceOf('reserve', effectId);
      const started = sequenceOf('transport_started', effectId);
      const settled = sequenceOf('settle', effectId);
      expect(reserved).toBeTypeOf('number');
      expect(started).toBeTypeOf('number');
      expect(settled).toBeTypeOf('number');
      if (
        typeof reserved !== 'number' ||
        typeof started !== 'number' ||
        typeof settled !== 'number'
      ) {
        throw new Error(`missing journal sequence for ${effectId}`);
      }
      expect(reserved).toBeLessThan(started);
      expect(started).toBeLessThan(settled);
    }

    const observed = run.effectReceipts.filter(
      (receipt) => receipt.costState === 'observed',
    );
    expect(observed.length).toBeGreaterThanOrEqual(5);
    for (const receipt of observed) {
      expect(receipt.observedUsage).not.toBeNull();
      expect(receipt.catalogDigest).toBe(catalog.catalogDigest);
    }
    const proposerReceipt = run.effectReceipts.find(
      (receipt) => receipt.effectId === 'effect:model:proposer',
    );
    // observed charge = priced usage, never the reserved ceiling
    expect(proposerReceipt?.charged.inputTokens).toBe(modelUsage.inputTokens);
    expect(proposerReceipt?.charged.currencyUsd).toBeLessThan(0.0015);
    expect(run.manifest.citations.length).toBeGreaterThanOrEqual(1);
    expect(run.proposals[0]?.statement).toBe(QUOTE);
    const currentCommitAttempt = run.attempts.find(
      (attempt) => attempt.candidateId === 'github-api:justvugg-colibri:main',
    );
    expect(currentCommitAttempt?.publishedAt).toBe('2026-07-10T12:00:00.000Z');
    expect(currentCommitAttempt?.dateObservation?.exactLocator).toContain(
      'sha:12d3bd51405fc95e40686ce686b5e4ebeb12aa7b',
    );
    expect(currentCommitAttempt?.dateVerdict?.verdict).toBe('accepted');
    expect(proposedSnapshotIds).not.toContain(
      'github-api:justvugg-colibri:main',
    );

    const liveArtifacts = resealP9LiveArtifacts({
      ...run.artifacts,
      'live-authority-receipt.json': JSON.stringify(
        run.authorizationReceipt,
        null,
        2,
      ),
      'live-price-catalog.json': JSON.stringify(catalog, null, 2),
      'live-provider-profile-catalog.json': JSON.stringify(
        run.providerProfileCatalog,
        null,
        2,
      ),
      'live-effect-receipts.jsonl': `${run.effectReceipts.map((value) => JSON.stringify(value)).join('\n')}\n`,
      'live-recovered-reservations.jsonl': `${run.recoveredReservations.map((value) => JSON.stringify(value)).join('\n')}${run.recoveredReservations.length ? '\n' : ''}`,
      'live-budget-journal.jsonl': `${journal.readLines().join('\n')}\n`,
    });
    const insufficientVerification = verifyP9LiveBundle(liveArtifacts, {
      expectedAuthorityDigest: run.authorizationReceipt.receiptDigest,
      trustedIssuerId: run.authorizationReceipt.issuerId,
    });
    expect(() => {
      assertP9LiveBundleReleaseable(insufficientVerification);
    }).toThrow(/not releaseable/u);

    const forgedEffect = structuredClone(run.effectReceipts[0]);
    if (!forgedEffect) throw new Error('missing effect receipt to forge');
    const { receiptDigest: _forgedDigest, ...forgedIdentity } = forgedEffect;
    expect(_forgedDigest).toMatch(/^sha256:/u);
    const changedIdentity = {
      ...forgedIdentity,
      charged: {
        ...forgedIdentity.charged,
        currencyUsd: forgedIdentity.charged.currencyUsd + 0.001,
      },
    };
    const forgedArtifacts = resealP9LiveArtifacts({
      ...liveArtifacts,
      'live-effect-receipts.jsonl': `${JSON.stringify({
        ...changedIdentity,
        receiptDigest: canonicalDigest(changedIdentity),
      })}\n${run.effectReceipts
        .slice(1)
        .map((value) => JSON.stringify(value))
        .join('\n')}\n`,
    });
    expect(() =>
      verifyP9LiveBundle(forgedArtifacts, {
        expectedAuthorityDigest: run.authorizationReceipt.receiptDigest,
        trustedIssuerId: run.authorizationReceipt.issuerId,
      }),
    ).toThrow(/does not match journaled reservation/u);

    const observedEffect = run.effectReceipts.find(
      (receipt) => receipt.costState === 'observed',
    );
    if (!observedEffect?.observedUsage) {
      throw new Error('missing observed effect receipt to forge');
    }
    const observedUsage = observedEffect.observedUsage;
    const { receiptDigest: _observedDigest, ...observedIdentity } =
      observedEffect;
    expect(_observedDigest).toMatch(/^sha256:/u);
    const contradictoryIdentity = {
      ...observedIdentity,
      observedUsage: {
        ...observedUsage,
        bytes: observedUsage.bytes + 1,
      },
    };
    const contradictoryReceipts = run.effectReceipts.map((receipt) =>
      receipt.effectId === observedEffect.effectId
        ? {
            ...contradictoryIdentity,
            receiptDigest: canonicalDigest(contradictoryIdentity),
          }
        : receipt,
    );
    const contradictoryArtifacts = resealP9LiveArtifacts({
      ...liveArtifacts,
      'live-effect-receipts.jsonl': `${contradictoryReceipts
        .map((value) => JSON.stringify(value))
        .join('\n')}\n`,
    });
    expect(() =>
      verifyP9LiveBundle(contradictoryArtifacts, {
        expectedAuthorityDigest: run.authorizationReceipt.receiptDigest,
        trustedIssuerId: run.authorizationReceipt.issuerId,
      }),
    ).toThrow(/does not match journaled reservation/u);
  });

  it('does not satisfy the bounded-change stop with a critical upstream claim alone', async () => {
    const model = makeModel({ calls: 0 });
    const run = await runP9LiveApplication(
      makeInput({
        model: {
          ...model,
          proposeClaims: () =>
            Promise.resolve({
              value: seeds.map((seed) => ({ ...seed, critical: true })),
              usage: modelUsage,
            }),
        },
      }),
    );

    const criticalBinding = run.bindings.find(
      (binding) => binding.proposal.critical,
    );
    const plan = buildAcceptedP9LivePlan({
      budgetUsd: 5,
      now: now().toISOString(),
      proposerProfile: model.proposerProfile,
    }).plan;
    const upstream = plan.subquestions.find(
      (subquestion) => subquestion.subquestionId === 'sq-upstream',
    );
    if (!criticalBinding || !upstream) {
      throw new Error('missing critical upstream fixture binding');
    }
    expect(
      isClaimRelevantToSubquestion(
        criticalBinding,
        upstream.subquestionId,
        upstream.question,
      ),
    ).toBe(true);

    expect(
      run.assessment.stopCriterionStatuses.find(
        (criterion) => criterion.stopId === 'stop-bounded-change',
      ),
    ).toMatchObject({ status: 'not_met' });
  });

  it('treats environment-style flags as non-authority: a missing receipt blocks before any effect', async () => {
    const searchCounter = { calls: 0 };
    const modelCounter = { calls: 0 };
    await expect(
      runP9LiveApplication(
        makeInput({
          authorizationReceipt: undefined,
          searchCounter,
          modelCounter,
        }),
      ),
    ).rejects.toMatchObject({ code: 'authorization_receipt_invalid' });
    expect(searchCounter.calls).toBe(0);
    expect(modelCounter.calls).toBe(0);
  });

  it('rejects a digest-tampered authorization receipt before any effect', async () => {
    const catalog = makeCatalog();
    const receipt = makeReceipt(catalog, makeProfileCatalog());
    const searchCounter = { calls: 0 };
    await expect(
      runP9LiveApplication(
        makeInput({
          catalog,
          authorizationReceipt: { ...receipt, maxBudgetUsd: 4.99 },
          searchCounter,
        }),
      ),
    ).rejects.toMatchObject({ code: 'authorization_receipt_invalid' });
    expect(searchCounter.calls).toBe(0);
  });

  it('rejects an authorization bound to a different immutable price catalog', async () => {
    const catalog = makeCatalog();
    const profileCatalog = makeProfileCatalog();
    const otherDigest = canonicalDigest({ someOther: 'catalog' });
    const original = makeReceipt(catalog, profileCatalog);
    const { receiptDigest: _receiptDigest, ...receiptIdentity } = original;
    expect(_receiptDigest).toMatch(/^sha256:/u);
    const mismatchedIdentity = {
      ...receiptIdentity,
      priceCatalogDigest: otherDigest,
    };
    await expect(
      runP9LiveApplication(
        makeInput({
          catalog,
          authorizationReceipt: {
            ...mismatchedIdentity,
            receiptDigest: canonicalDigest(mismatchedIdentity),
          },
          expectedAuthorityDigest: canonicalDigest(mismatchedIdentity),
        }),
      ),
    ).rejects.toMatchObject({
      code: 'live_authority_price_catalog_lineage_mismatch',
    });
  });

  it('rejects budgets above the scoped human authorization and the hard 5 USD cap', async () => {
    await expect(
      runP9LiveApplication(makeInput({ budgetUsd: 6 })),
    ).rejects.toThrow(/no greater than 5 USD/);
    const catalog = makeCatalog();
    const profileCatalog = makeProfileCatalog();
    await expect(
      runP9LiveApplication(
        makeInput({
          catalog,
          authorizationReceipt: makeReceipt(catalog, profileCatalog, 3),
          budgetUsd: 5,
        }),
      ),
    ).rejects.toMatchObject({ code: 'authorization_budget_exceeded' });
  });

  it('cannot repeat an already-settled effect after restart against the same journal', async () => {
    const journal = new MemoryP9DurableJournalStore();
    const catalog = makeCatalog();
    await runP9LiveApplication(makeInput({ journal, catalog }));

    const searchCounter = { calls: 0 };
    const modelCounter = { calls: 0 };
    await expect(
      runP9LiveApplication(
        makeInput({ journal, catalog, searchCounter, modelCounter }),
      ),
    ).rejects.toMatchObject({ code: 'effect_already_terminal' });
    expect(searchCounter.calls).toBe(0);
    expect(modelCounter.calls).toBe(0);
  });

  it('rejects an authority receipt bound to a different durable journal store before effects continue', async () => {
    const authorizedJournal = new MemoryP9DurableJournalStore(
      'p9-memory-durable-budget-journal/authorized',
    );
    const runtimeJournal = new MemoryP9DurableJournalStore(
      'p9-memory-durable-budget-journal/runtime',
    );
    const catalog = makeCatalog();
    const receipt = makeReceipt(
      catalog,
      makeProfileCatalog(),
      5,
      authorizedJournal,
    );
    const searchCounter = { calls: 0 };
    await expect(
      runP9LiveApplication(
        makeInput({
          journal: runtimeJournal,
          catalog,
          authorizationReceipt: receipt,
          expectedAuthorityDigest: receipt.receiptDigest,
          searchCounter,
        }),
      ),
    ).rejects.toMatchObject({
      code: 'authorization_consumption_store_mismatch',
    });
    expect(searchCounter.calls).toBe(0);
  });

  it('rejects a search adapter whose concrete destination differs from the authorized profile before effects', async () => {
    const searchCounter = { calls: 0 };
    const search: P9LiveSearchAdapter = {
      destinationOrigin: 'https://unauthorized-search.example',
      search: () => {
        searchCounter.calls += 1;
        return Promise.resolve({ candidates: [], usage: null });
      },
    };
    await expect(
      runP9LiveApplication(makeInput({ search })),
    ).rejects.toMatchObject({ code: 'search_transport_destination_mismatch' });
    expect(searchCounter.calls).toBe(0);
  });

  it('skips retrieval candidates outside the scoped source-origin authorization before retrieval transport', async () => {
    const journal = new MemoryP9DurableJournalStore();
    const search: P9LiveSearchAdapter = {
      destinationOrigin: 'https://api.search.brave.com',
      search: () =>
        Promise.resolve({
          candidates: [
            {
              candidateId: 'blocked-evil-source',
              url: 'https://evil.example/research',
              title: 'Blocked source',
              sourceClass: 'repository_docs',
              sourceFamilyId: 'evil.example',
            },
          ],
          usage: null,
        }),
    };
    const blockedRetrievalCounter = { calls: 0 };
    await runP9LiveApplication(
      makeInput({
        journal,
        search,
        retrieve: (...args) => {
          if (args[0].url.startsWith('https://evil.example/')) {
            blockedRetrievalCounter.calls += 1;
          }
          return fakeRetrieve(...args);
        },
      }),
    );
    expect(blockedRetrievalCounter.calls).toBe(0);
  });

  it('recovers an interrupted post-transport reservation by charging its full reserved ceiling', async () => {
    const journal = new MemoryP9DurableJournalStore();
    const catalog = makeCatalog();
    const receipt = makeReceipt(catalog, makeProfileCatalog(), 5, journal);
    const limit = receipt.budgetLimit;
    const crashed = P9DurableBudgetAuthority.open(
      {
        accountId: 'p9-live:p9-live-test',
        programId: 'p9-live-test',
        catalog,
        limit,
        authorizationReceipt: receipt,
        store: journal,
        actorId: 'crashed-run',
      },
      () => now().toISOString(),
    );
    const interrupted = crashed.reserve({
      reservationId: 'interrupted-effect',
      workItemId: 'work:interrupted-effect',
      effectId: 'effect:interrupted-effect',
      idempotencyKey: 'idem:crash:interrupted-effect',
      catalogEntryId: 'brave-search',
      ceiling: {
        requests: 1,
        inputTokens: 0,
        outputTokens: 0,
        bytes: 2_000_000,
        durationMs: 30_000,
        attempts: 1,
        parserClass: null,
      },
      actorId: 'crashed-run',
    });
    crashed.markTransportStarted('interrupted-effect', 'crashed-run');
    // the crashed run stops here without settling

    const run = await runP9LiveApplication(makeInput({ journal, catalog }));
    expect(run.recoveredReservations).toHaveLength(1);
    const recovered = run.recoveredReservations[0];
    if (!recovered) throw new Error('missing recovered reservation');
    expect(recovered.id).toBe('interrupted-effect');
    expect(recovered.state).toBe('ambiguous');
    expect(recovered.settlementCostState).toBe('settlement_lost');
    expect(recovered.charged).toEqual(interrupted.bound.reserved);
    expect(run.exactBundleVerified).toBe(true);
  });

  it('releases an interrupted pre-transport reservation without charge on restart', async () => {
    const journal = new MemoryP9DurableJournalStore();
    const catalog = makeCatalog();
    const receipt = makeReceipt(catalog, makeProfileCatalog(), 5, journal);
    const crashed = P9DurableBudgetAuthority.open(
      {
        accountId: 'p9-live:p9-live-test',
        programId: 'p9-live-test',
        catalog,
        limit: receipt.budgetLimit,
        authorizationReceipt: receipt,
        store: journal,
        actorId: 'crashed-run',
      },
      () => now().toISOString(),
    );
    crashed.reserve({
      reservationId: 'never-started',
      workItemId: 'work:never-started',
      effectId: 'effect:never-started',
      idempotencyKey: 'idem:crash:never-started',
      catalogEntryId: 'brave-search',
      ceiling: {
        requests: 1,
        inputTokens: 0,
        outputTokens: 0,
        bytes: 2_000_000,
        durationMs: 30_000,
        attempts: 1,
        parserClass: null,
      },
      actorId: 'crashed-run',
    });

    const run = await runP9LiveApplication(makeInput({ journal, catalog }));
    const recovered = run.recoveredReservations[0];
    if (!recovered) throw new Error('missing recovered reservation');
    expect(recovered.state).toBe('released');
    expect(recovered.charged.currencyUsd).toBe(0);
  });

  it('settles an effect without trustworthy observed usage at the full reserved ceiling', async () => {
    const journal = new MemoryP9DurableJournalStore();
    const search: P9LiveSearchAdapter = {
      destinationOrigin: 'https://api.search.brave.com',
      search: () => Promise.resolve({ candidates: [], usage: null }),
    };
    const modelCounter = { calls: 0 };
    // no candidates -> no snapshots -> the run still compiles with gaps visible
    const run = await runP9LiveApplication(
      makeInput({ journal, search, modelCounter }),
    );
    const searchReceipts = run.effectReceipts.filter(
      (receipt) => receipt.effectKind === 'search',
    );
    expect(searchReceipts.length).toBeGreaterThan(0);
    for (const receipt of searchReceipts) {
      expect(receipt.costState).toBe('unknown');
      expect(receipt.usageSource).toBe('absent');
      expect(receipt.observedUsage).toBeNull();
      // ceiling charge, never zero and never an invented observation
      expect(receipt.charged.bytes).toBe(2_000_000);
      expect(receipt.charged.currencyUsd).toBeGreaterThan(0);
    }
  });

  it('journals a conservative cancellation when live transport fails after start', async () => {
    const journal = new MemoryP9DurableJournalStore();
    const model = makeModel({ calls: 0 });
    await expect(
      runP9LiveApplication(
        makeInput({
          journal,
          model: {
            ...model,
            proposeClaims: () => Promise.reject(new Error('provider down')),
          },
        }),
      ),
    ).rejects.toThrow(/provider down/);
    const cancel = records(journal).find(
      (record) =>
        record.entry.kind === 'cancel' &&
        record.entry.reservationId === 'model:proposer',
    );
    expect(cancel).toBeDefined();
  });

  it('rejects a provider claim whose statement is not the exact quoted evidence', async () => {
    const model = makeModel({ calls: 0 });
    await expect(
      runP9LiveApplication(
        makeInput({
          model: {
            ...model,
            proposeClaims: () =>
              Promise.resolve({
                value: seeds.map((seed) => ({
                  ...seed,
                  statement: `Paraphrase: ${seed.quote}`,
                })),
                usage: modelUsage,
              }),
          },
        }),
      ),
    ).rejects.toThrow(/extractive claim normalization failed/u);
  });

  it('fails closed when evaluator findings omit a proposed claim', async () => {
    const model = makeModel({ calls: 0 });
    await expect(
      runP9LiveApplication(
        makeInput({
          model: {
            ...model,
            evaluateClaims: () =>
              Promise.resolve({ value: [], usage: modelUsage }),
          },
        }),
      ),
    ).rejects.toThrow(/findings must match proposed claimIds exactly/u);
  });

  it('fails closed before evaluation when a claim quote is absent from its snapshot', async () => {
    const counter = { calls: 0 };
    const model = makeModel(counter);
    await expect(
      runP9LiveApplication(
        makeInput({
          model: {
            ...model,
            proposeClaims: () => {
              counter.calls += 1;
              return Promise.resolve({
                value: seeds.map((seed) => ({
                  ...seed,
                  quote: 'Quote absent from the observed snapshot.',
                  statement: 'Quote absent from the observed snapshot.',
                })),
                usage: modelUsage,
              });
            },
          },
        }),
      ),
    ).rejects.toThrow(/does not bind to an observed snapshot/u);
    expect(counter.calls).toBe(1);
  });

  it('deterministically binds an exact quote when the proposer returns the wrong candidateId', async () => {
    const counter = { calls: 0 };
    const model = makeModel(counter);
    const run = await runP9LiveApplication(
      makeInput({
        model: {
          ...model,
          proposeClaims: () => {
            counter.calls += 1;
            return Promise.resolve({
              value: seeds.map((seed) => ({
                ...seed,
                candidateId: 'model-invented-candidate',
              })),
              usage: modelUsage,
            });
          },
        },
      }),
    );

    const claims = (run.artifacts['claim-evidence.jsonl'] ?? '')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(
        (line) => JSON.parse(line) as { evidence?: { candidateId?: string } },
      );
    expect(claims).toHaveLength(1);
    expect(claims[0]?.evidence?.candidateId).toBe(CANDIDATE_ID);
    expect(counter.calls).toBe(3);
  });

  it('rejects placeholder narrative even when evidence and citations pass', async () => {
    const counter = { calls: 0 };
    const model = makeModel(counter);
    await expect(
      runP9LiveApplication(
        makeInput({
          model: {
            ...model,
            synthesizeReport: ({ plan, claims }) =>
              Promise.resolve({
                value: [
                  ...plan.reportOutline.sections,
                  {
                    sectionId: 'references_provenance',
                    title: 'references and provenance',
                  },
                ].map((section) => ({
                  sectionId: section.sectionId,
                  lead: `Interpretive synthesis for ${section.title}, grounded only in admitted claims below.`,
                  claimIds: claims
                    .filter((claim) => claim.sectionId === section.sectionId)
                    .map((claim) => claim.claimId),
                })),
                usage: modelUsage,
              }),
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'report_narrative_unreadable' });
  });

  it('rejects an uncited bounded recommendation when supporting evidence is available', async () => {
    const counter = { calls: 0 };
    const model = makeModel(counter);
    await expect(
      runP9LiveApplication(
        makeInput({
          model: {
            ...model,
            synthesizeReport: async (input) => {
              const result = await model.synthesizeReport(input);
              return {
                ...result,
                value: result.value.map((section) =>
                  section.sectionId === 'first_bounded_change'
                    ? { ...section, claimIds: [] }
                    : section.sectionId === 'executive_summary'
                      ? {
                          ...section,
                          claimIds: input.claims.map((claim) => claim.claimId),
                        }
                      : section,
                ),
              };
            },
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'exact_bundle_chain_invalid' });
  });

  it('rejects a non-executable experiment narrative', async () => {
    const counter = { calls: 0 };
    const model = makeModel(counter);
    await expect(
      runP9LiveApplication(
        makeInput({
          model: {
            ...model,
            synthesizeReport: async (input) => {
              const result = await model.synthesizeReport(input);
              return {
                ...result,
                value: result.value.map((section) =>
                  section.sectionId === 'experiment_design'
                    ? {
                        ...section,
                        lead: 'Benchmark the unchanged baseline against the candidate repeatedly under controlled conditions, then inspect latency and throughput for an apparent improvement beyond ordinary noise.',
                      }
                    : section,
                ),
              };
            },
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'report_synthesis_incomplete' });
  });

  it('rejects a vague bounded recommendation without a concrete delta', async () => {
    const counter = { calls: 0 };
    const model = makeModel(counter);
    await expect(
      runP9LiveApplication(
        makeInput({
          model: {
            ...model,
            synthesizeReport: async (input) => {
              const result = await model.synthesizeReport(input);
              return {
                ...result,
                value: result.value.map((section) =>
                  section.sectionId === 'first_bounded_change'
                    ? {
                        ...section,
                        lead: 'The current state is sensitive to kernel shape and rounding; implement one opt-in fixed-shape verification path first, then test it before interpreting any apparent performance improvement.',
                      }
                    : section,
                ),
              };
            },
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'report_synthesis_incomplete' });
  });

  it('fails closed when the durable journal cannot accept the pre-transport record', async () => {
    const journal = new MemoryP9DurableJournalStore();
    const searchCounter = { calls: 0 };
    const input = makeInput({ journal, searchCounter });
    // poison the first append after genesis: the search reservation
    journal.failNextAppend = true;
    await expect(runP9LiveApplication(input)).rejects.toMatchObject({
      code: 'journal_append_failed',
    });
    expect(searchCounter.calls).toBe(0);
  });

  it('rejects a tampered durable journal on restart', async () => {
    const journal = new MemoryP9DurableJournalStore();
    const catalog = makeCatalog();
    await runP9LiveApplication(makeInput({ journal, catalog }));
    const tampered = new MemoryP9DurableJournalStore();
    let flipped = false;
    for (const line of journal.readLines()) {
      if (!flipped && line.includes('"kind":"reserve"')) {
        tampered.appendDurable(
          line.replace('"kind":"reserve"', '"kind":"cancel"'),
        );
        flipped = true;
      } else {
        tampered.appendDurable(line);
      }
    }
    expect(flipped).toBe(true);
    await expect(
      runP9LiveApplication(makeInput({ journal: tampered, catalog })),
    ).rejects.toSatisfy(
      (error) =>
        error instanceof GovernanceError &&
        (error.code === 'journal_chain_broken' ||
          error.code === 'journal_corrupt'),
    );
  });

  it('rejects shared proposer and evaluator profile families before opening authority', async () => {
    const model = makeModel({ calls: 0 });
    await expect(
      runP9LiveApplication(
        makeInput({
          model: {
            ...model,
            evaluatorProfile: {
              ...model.evaluatorProfile,
              profileFamilyId: model.proposerProfile.profileFamilyId,
            },
          },
        }),
      ),
    ).rejects.toThrow(/profile families/);
  });
});
