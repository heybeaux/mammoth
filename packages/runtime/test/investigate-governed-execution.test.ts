import { createHash } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  P9LiveAuthorityReceiptSchema,
  canonicalDigest,
  type InvestigationPlan,
} from '@mammoth/domain';
import {
  bindApprovedInvestigationPlan,
  recordInvestigationApproval,
} from '@mammoth/governance';
import { describe, expect, it } from 'vitest';
import {
  buildOfflineNoEffectAdapters,
  composeGovernedInvestigationBundle,
  buildInvestigateLivePriceCatalog,
  deriveAcquisitionIntents,
  evaluateAcquisitionRelease,
  evaluateLiveAcceptanceReview,
  executeGovernedAcquisition,
  executeGovernedLiveAcquisition,
  GovernedExecutionError,
  mintOfflineFixtureAuthorityReceipt,
  OFFLINE_FIXTURE_ISSUER_ID,
  planInvestigation,
  type GovernedNoEffectAdapters,
} from '../src/index.js';

const NOW = '2026-07-16T12:00:00.000Z';
const QUESTION =
  'How can a small coastal museum extend the usable life of its climate control system with a limited maintenance budget?';

const CATALOG = {
  schemaVersion: '1.0.0',
  catalogId: 'runtime-test-catalog/v1',
  sourceClasses: [
    { sourceClass: 'primary', minimumIndependentSources: 1, mandatory: true },
    {
      sourceClass: 'secondary',
      minimumIndependentSources: 1,
      mandatory: false,
    },
  ],
  sources: [
    {
      url: 'https://facilities.example.org/reports/hvac-condition',
      sourceClass: 'primary',
      title: 'Facilities condition report',
      mediaType: 'text/plain' as const,
      body: 'The facilities assessment recorded that filter replacements were overdue in both gallery air handlers at the time of inspection. Technicians measured a fifteen percent efficiency loss attributable to fouled coils in the oldest unit. The assessment recommended quarterly coil cleaning as the highest-value low-cost intervention.',
    },
    {
      url: 'https://practice.example.org/guides/preventive-maintenance',
      sourceClass: 'secondary',
      title: 'Preventive maintenance guide',
      mediaType: 'text/plain' as const,
      body: 'Published maintenance guides state that scheduled inspection of belts and dampers extends compressor life in mid-sized institutional systems. Institutions that logged runtime hours before failures reported fewer emergency repairs in the following year.',
    },
  ],
};

function boundPlan(question: string, decidedAt = NOW): InvestigationPlan {
  const preview = planInvestigation(question);
  const approval = recordInvestigationApproval({
    approvalId: `approval:${preview.investigationId}`,
    investigationId: preview.investigationId,
    previewDigest: preview.previewDigest,
    decision: 'approve',
    actorId: 'operator:test',
    actorKind: 'human_operator',
    reason: 'test approval for governed execution',
    decidedAt,
  });
  const result = bindApprovedInvestigationPlan({ preview, approval });
  if (!result.plan) {
    throw new Error(
      `plan binding rejected: ${result.receipt.reasonCodes.join(',')}`,
    );
  }
  return result.plan;
}

interface Scenario {
  readonly plan: InvestigationPlan;
  readonly intentSet: ReturnType<typeof deriveAcquisitionIntents>;
  readonly authority: ReturnType<typeof mintOfflineFixtureAuthorityReceipt>;
  readonly release: ReturnType<typeof evaluateAcquisitionRelease>;
}

function authorizedScenario(question = QUESTION): Scenario {
  const plan = boundPlan(question);
  const intentSet = deriveAcquisitionIntents(plan);
  const authority = mintOfflineFixtureAuthorityReceipt({
    planId: plan.planId,
    planDigest: plan.planDigest,
    question: plan.question,
    actorId: 'operator:test',
    authorizedAt: NOW,
  });
  const release = evaluateAcquisitionRelease({
    intentSet,
    effectAuthority: authority,
    trustedIssuerId: OFFLINE_FIXTURE_ISSUER_ID,
    now: NOW,
  });
  return { plan, intentSet, authority, release };
}

function liveAuthority(input: {
  readonly plan: InvestigationPlan;
  readonly journalPath: string;
}) {
  const consumptionNonce = 'live-test-consumption-nonce';
  const executionId = `investigate-live:${canonicalDigest({
    planDigest: input.plan.planDigest,
    consumptionNonce,
  }).slice(7, 23)}`;
  const priceCatalog = buildInvestigateLivePriceCatalog();
  const planScope = {
    proposalId: `proposal:${input.plan.planId}`,
    proposalDigest: input.plan.sourcePreviewDigest,
    planId: input.plan.planId,
    planDigest: input.plan.planDigest,
    acceptanceReceiptDigest: input.plan.approvalDigest,
    question: input.plan.question,
    questionDigest: canonicalDigest(input.plan.question),
    domainPackId: 'general-web/v1' as const,
    packDigest: canonicalDigest({ kind: 'test-live-pack/v1' }),
    budgetAllocation: {
      currencyUsd: 15,
      searchUsd: 4,
      retrievalParsingUsd: 1,
      modelsUsd: 10,
    },
  };
  const identity = {
    schemaVersion: '1.0.0' as const,
    contractFamily: 'p9.v1' as const,
    authorityId: `authority:${executionId}`,
    issuerId: 'mammoth-core-loop-live-authority/v1',
    decision: 'authorized' as const,
    reason: 'test scoped live authority',
    executionId,
    executionDigest: canonicalDigest({
      executionId,
      planDigest: input.plan.planDigest,
      questionDigest: canonicalDigest(input.plan.question),
      consumptionNonce,
    }),
    consumptionNonce,
    consumptionStoreId: input.journalPath,
    consumptionStoreDigest: canonicalDigest({
      kind: 'p9-consumption-store/v1',
      id: input.journalPath,
    }),
    maximumExecutions: 1 as const,
    planScope,
    priceCatalogId: priceCatalog.catalogId,
    priceCatalogVersion: priceCatalog.version,
    priceCatalogDigest: priceCatalog.catalogDigest,
    providerProfileCatalogId: 'test-live-profiles',
    providerProfileCatalogVersion: '1.0.0',
    providerProfileCatalogDigest: canonicalDigest({
      kind: 'test-live-profiles',
    }),
    sourceClassificationPolicyDigest: canonicalDigest({
      kind: 'test-live-source-policy',
    }),
    authorizedProfileIds: ['search', 'retrieval', 'parser', 'model'],
    proposerProfileId: 'model',
    evaluatorProfileId: 'model',
    budgetLimit: {
      currencyUsd: 15,
      requests: 10_000,
      inputTokens: 2_000_000,
      outputTokens: 500_000,
      bytes: 2_000_000_000,
      durationMs: 7_200_000,
    },
    authorizedEffectKinds: ['search', 'retrieval', 'parser', 'model'] as const,
    authorizedDestinationOrigins: [
      'https://api.search.brave.com',
      'https://openrouter.ai',
    ],
    authorizedRetrievalOrigins: [
      'https://sources.example.test',
      'https://github.com',
      'https://docs.couchdb.org',
    ],
    authorizedBillingAccountIds: ['test'],
    actorId: 'operator:test',
    authorizedAt: NOW,
    notBeforeAt: NOW,
    expiresAt: '2026-07-17T12:00:00.000Z',
  };
  return P9LiveAuthorityReceiptSchema.parse({
    ...identity,
    receiptDigest: canonicalDigest(identity),
  });
}

function countedAdapters(): {
  readonly adapters: GovernedNoEffectAdapters;
  readonly counts: { searches: number; retrievals: number };
} {
  const inner = buildOfflineNoEffectAdapters(CATALOG);
  const counts = { searches: 0, retrievals: 0 };
  return {
    counts,
    adapters: {
      sourceClassTargets: inner.sourceClassTargets,
      search: (query) => {
        counts.searches += 1;
        return inner.search(query);
      },
      retrieve: (url) => {
        counts.retrievals += 1;
        return inner.retrieve(url);
      },
    },
  };
}

describe('offline fixture authority', () => {
  it('mints a deterministic schema-valid receipt bound to the exact plan and question', () => {
    const plan = boundPlan(QUESTION);
    const mint = () =>
      mintOfflineFixtureAuthorityReceipt({
        planId: plan.planId,
        planDigest: plan.planDigest,
        question: plan.question,
        actorId: 'operator:test',
        authorizedAt: NOW,
      });
    const receipt = mint();
    expect(P9LiveAuthorityReceiptSchema.parse(receipt)).toEqual(receipt);
    expect(receipt.issuerId).toBe(OFFLINE_FIXTURE_ISSUER_ID);
    expect(receipt.planScope.planDigest).toBe(plan.planDigest);
    expect(receipt.planScope.question).toBe(plan.question);
    expect(mint()).toEqual(receipt);
  });

  it('refuses a nonpositive validity window', () => {
    const plan = boundPlan(QUESTION);
    expect(() =>
      mintOfflineFixtureAuthorityReceipt({
        planId: plan.planId,
        planDigest: plan.planDigest,
        question: plan.question,
        actorId: 'operator:test',
        authorizedAt: NOW,
        validityMinutes: 0,
      }),
    ).toThrow(/positive validity window/u);
  });
});

describe('offline no-effect adapters', () => {
  it('serves only declared bytes and returns null for undeclared urls', () => {
    const adapters = buildOfflineNoEffectAdapters(CATALOG);
    const hit = adapters.retrieve(
      'https://facilities.example.org/reports/hvac-condition',
    );
    expect(hit).not.toBeNull();
    expect(new TextDecoder().decode(hit?.bytes)).toContain(
      'filter replacements were overdue',
    );
    expect(
      adapters.retrieve('https://facilities.example.org/reports/undeclared'),
    ).toBeNull();
    expect(adapters.search('any planned query')).toHaveLength(
      CATALOG.sources.length,
    );
  });

  it('rejects a malformed catalog', () => {
    expect(() =>
      buildOfflineNoEffectAdapters({ schemaVersion: '1.0.0' }),
    ).toThrow();
  });
});

describe('governed acquisition execution', () => {
  it('executes an authorized release end to end with inspectable receipts and residue', () => {
    const scenario = authorizedScenario();
    const { adapters } = countedAdapters();
    const execution = executeGovernedAcquisition({
      intentSet: scenario.intentSet,
      release: scenario.release,
      effectAuthority: scenario.authority,
      trustedIssuerId: OFFLINE_FIXTURE_ISSUER_ID,
      adapters,
      now: NOW,
    });
    expect(execution.planDigest).toBe(scenario.plan.planDigest);
    expect(execution.intentReceipts).toHaveLength(
      scenario.intentSet.intents.length,
    );
    expect(execution.snapshots.length).toBeGreaterThan(0);
    expect(execution.retrievalAttempts.length).toBeGreaterThan(0);
    expect(
      execution.retrievalAttempts.every(
        (attempt) => attempt.status === 'admitted',
      ),
    ).toBe(true);
    const admitted = execution.claims.filter(
      (claim) => claim.decision === 'admitted',
    );
    const rejected = execution.claims.filter(
      (claim) => claim.decision !== 'admitted',
    );
    expect(admitted.length).toBeGreaterThan(0);
    expect(rejected.length).toBeGreaterThan(0);
    // Duplicate hints across planned queries become inspectable residue.
    expect(
      execution.rejectedHints.some(
        (hint) => hint.reason === 'duplicate_source',
      ),
    ).toBe(true);
    // Proposer and evaluator are independent for every adjudicated claim.
    expect(execution.proposals).toHaveLength(execution.verdicts.length);
    for (const [index, proposal] of execution.proposals.entries()) {
      const verdict = execution.verdicts[index];
      expect(verdict?.proposalDigest).toBe(proposal.proposalDigest);
      expect(verdict?.evaluatorWork.profileFamilyId).not.toBe(
        proposal.proposerWork.profileFamilyId,
      );
    }
  });

  it('executes the governed live path through search, retrieval, parser, and model reservations', async () => {
    process.env.TEST_BRAVE_KEY = 'brave-test';
    process.env.TEST_MODEL_KEY = 'sk-test';
    const plan = boundPlan(
      'Which field data synchronization strategies help remote clinics operate offline during intermittent connectivity while resolving conflicting patient records?',
    );
    const journalPath = join(
      await mkdtemp(join(tmpdir(), 'mammoth-live-test-')),
      'budget.jsonl',
    );
    const authority = liveAuthority({ plan, journalPath });
    const intentSet = deriveAcquisitionIntents(plan);
    const release = evaluateAcquisitionRelease({
      intentSet,
      effectAuthority: authority,
      trustedIssuerId: 'mammoth-core-loop-live-authority/v1',
      now: NOW,
    });
    const sourceBodies = new Map([
      [
        'https://sources.example.test/clinic-sync-a',
        'Skip to main content. An official website of the United States government. Field data synchronization with local-first systems keeps offline writes available on devices while connectivity is intermittent. Conflict-free replicated data types can merge concurrent updates without a central coordinator.',
      ],
      [
        'https://www.reddit.com/r/healthit/comments/clinic_sync_b/',
        'Local-first replication guidance describes remote clinic offline synchronization during intermittent connectivity but does not address conflicting patient records.',
      ],
      [
        'https://github.com/openmrs/openmrs-core',
        'Remote clinic deployments need explicit conflict resolution workflows for ambiguous patient records. Offline systems should surface patient-record conflicts for review instead of silently merging every concurrent update.',
      ],
      [
        'https://docs.couchdb.org/en/stable/replication/conflicts.html',
        'Replication systems can create conflicting document revisions when disconnected peers update the same record independently. Applications must detect conflicts and choose a resolution policy before treating replicated data as final.',
      ],
    ]);
    const retrievedUrls: string[] = [];
    let searchCalls = 0;
    const fetchImpl: typeof fetch = (url) => {
      const href =
        typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      if (href.startsWith('https://api.search.brave.com/res/v1/web/search')) {
        searchCalls += 1;
        const results =
          searchCalls === 1
            ? [
                {
                  url: 'https://sources.example.test/unrelated',
                  title: 'Consumer privacy compliance overview',
                },
                {
                  url: 'https://sources.example.test/clinic-sync-a',
                  title:
                    'Official project documentation: remote clinic offline synchronization',
                  description:
                    'Implementation reference for local-first systems and conflict-free replicated data types.',
                },
                {
                  url: 'https://www.reddit.com/r/healthit/comments/clinic_sync_b/',
                  title: 'Blog: remote clinic offline replication explained',
                  description:
                    'Commentary about local-first replication for remote clinics.',
                },
              ]
            : [
                {
                  url: 'https://github.com/openmrs/openmrs-core',
                  title:
                    'Technical report: conflicting patient records resolution workflows',
                  description:
                    'Primary-source implementation evidence for explicit conflict resolution workflows.',
                },
                {
                  url: 'https://docs.couchdb.org/en/stable/replication/conflicts.html',
                  title:
                    'Official documentation: replication conflict handling',
                  description:
                    'Implementation documentation about disconnected replication conflicts and resolution policy.',
                },
              ];
        return Promise.resolve(
          new Response(
            JSON.stringify({
              web: {
                results,
              },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      }
      if (href.endsWith('/chat/completions')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      summary:
                        'Local-first systems keep writes available and conflict-free replicated data types merge concurrent updates.',
                      portfolio: [
                        {
                          rank: 1,
                          title: 'Exception-first offline synchronization',
                          statement:
                            'Adopt field data synchronization with local writes and explicit review for ambiguous patient-record conflicts in remote clinics operating offline.',
                          rationale:
                            'The admitted evidence supports both offline availability and a fail-safe path for ambiguous records.',
                          constraints: [
                            'Ambiguous patient-record conflicts require a documented human review path.',
                          ],
                          nextValidation:
                            'Replay a bounded set of concurrent record edits and require every ambiguous merge to surface for review.',
                          evidenceIndexes: [1, 2, 3, 4],
                        },
                        {
                          rank: 2,
                          title: 'Local write queue with later synchronization',
                          statement:
                            'Use a local write queue so clinic work can continue when connectivity drops.',
                          rationale:
                            'The admitted evidence supports local offline writes as the availability mechanism during intermittent connectivity.',
                          constraints: [
                            'Offline local writes require later synchronization when connectivity returns.',
                          ],
                          nextValidation:
                            'Compare queued offline encounters against always-online entry for completion rate and synchronization error rate.',
                          evidenceIndexes: [1, 2, 3, 4],
                        },
                        {
                          rank: 3,
                          title: 'Replication conflict policy check',
                          statement:
                            'Require a conflict policy before accepting replicated patient records as final.',
                          rationale:
                            'The admitted replication documentation supports conflict detection and resolution policy as a separate decision lever.',
                          constraints: [
                            'Disconnected replication can create conflicting document revisions.',
                          ],
                          nextValidation:
                            'Compare policy-assisted conflict handling with manual reconciliation on conflict detection rate and false merge rate.',
                          evidenceIndexes: [1, 2, 3, 4],
                        },
                      ],
                      unresolvedConstraints: [
                        'Portfolio breadth remains unresolved: the admitted evidence does not establish clinical outcome safety.',
                        'No admitted field trial establishes clinical outcome safety.',
                      ],
                      answerBullets: [
                        {
                          statement:
                            'Local-first systems can preserve clinic work during intermittent connectivity while explicit conflict workflows guard ambiguous patient records.',
                          evidenceIndexes: [1, 2, 3, 4],
                        },
                      ],
                      mechanisms: [
                        {
                          statement:
                            'The transferable mechanism is local write availability plus later conflict resolution.',
                          evidenceIndexes: [1, 2, 3, 4],
                        },
                      ],
                      dissent: [
                        {
                          statement:
                            'The available fixture evidence separates offline availability from conflict safety and does not prove clinical outcome safety.',
                          evidenceIndexes: [1, 2, 3, 4],
                        },
                      ],
                      boundaryConditions: [
                        {
                          statement:
                            'The strategy depends on explicit handling for ambiguous patient-record conflicts.',
                          evidenceIndexes: [1, 2, 3, 4],
                        },
                      ],
                      hypotheses: [
                        {
                          statement:
                            'Remote clinic sync will be safer when ambiguous patient-record conflicts are surfaced as workflow exceptions.',
                          falsifier:
                            'Field trials showing automated merges safely resolve ambiguous patient records would falsify the workflow-exception hypothesis.',
                          evidenceIndexes: [1, 2, 3, 4],
                        },
                      ],
                      experimentProposals: [
                        {
                          statement:
                            'Replay 100 concurrent offline patient-record edits against the current manual reconciliation workflow.',
                          resolvesUncertainty:
                            'Whether exception-first synchronization detects ambiguous record conflicts without blocking routine offline clinic work.',
                          threshold:
                            'Pass only if conflict detection reaches at least 95% while the false-merge rate is no worse than the manual baseline.',
                          safetyBoundary:
                            'Use synthetic records only and stop if any private patient data or production clinic system would be touched.',
                          evidenceIndexes: [1, 2, 3, 4],
                        },
                      ],
                      weaknesses: [
                        'Only one source was available in the fixture.',
                      ],
                      suggestedSearches: ['remote clinic conflict resolution'],
                    }),
                  },
                },
              ],
              usage: { prompt_tokens: 120, completion_tokens: 40 },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      }
      return Promise.reject(new Error(`unexpected fetch: ${href}`));
    };
    const execution = await executeGovernedLiveAcquisition({
      intentSet,
      release,
      effectAuthority: authority,
      trustedIssuerId: 'mammoth-core-loop-live-authority/v1',
      now: NOW,
      budgetJournalPath: journalPath,
      searchApiKeyEnvVar: 'TEST_BRAVE_KEY',
      modelApiKeyEnvVar: 'TEST_MODEL_KEY',
      modelBaseUrl: 'https://openrouter.ai/api/v1',
      modelId: 'test/model',
      fetchImpl,
      retrieve: (request) => {
        const body = sourceBodies.get(request.url);
        if (!body) {
          return Promise.reject(
            new Error(`unexpected retrieval: ${request.url}`),
          );
        }
        retrievedUrls.push(request.url);
        return Promise.resolve({
          requestedUrl: request.url,
          finalUrl: request.url,
          redirectChain: [],
          retrievedAt: NOW,
          status: 200,
          headers: { 'content-type': 'text/plain' },
          mediaType: 'text/plain',
          bytes: new TextEncoder().encode(body),
          networkReceipts: [],
        });
      },
      sourceClassTargets: [
        {
          sourceClass: 'public_web',
          minimumIndependentSources: 1,
          mandatory: true,
        },
      ],
      maxCandidates: 3,
      maxClaimsPerSnapshot: 2,
      minimumSearchIntervalMs: 0,
    });
    expect(execution.executionMode).toBe('governed_live');
    expect(execution.externalEffectsExecuted).toBe(true);
    expect(execution.effectReceipts.length).toBeGreaterThanOrEqual(4);
    expect(
      execution.claims.some((claim) => claim.decision === 'admitted'),
    ).toBe(true);
    expect(
      execution.claims
        .filter((claim) => claim.decision === 'admitted')
        .map((claim) => claim.statement),
    ).not.toEqual(
      expect.arrayContaining([
        'Skip to main content.',
        'An official website of the United States government.',
      ]),
    );
    expect(
      execution.modelWork.some((work) => work.workId.startsWith('live-')),
    ).toBe(true);
    expect(
      execution.rejectedHints.some(
        (hint) => hint.reason === 'low_relevance_hint',
      ),
    ).toBe(true);
    expect(retrievedUrls).toContain(
      'https://sources.example.test/clinic-sync-a',
    );
    expect(retrievedUrls).toContain('https://github.com/openmrs/openmrs-core');
    expect(retrievedUrls).toContain(
      'https://docs.couchdb.org/en/stable/replication/conflicts.html',
    );
    expect(retrievedUrls).not.toContain(
      'https://www.reddit.com/r/healthit/comments/clinic_sync_b/',
    );
    const bundle = composeGovernedInvestigationBundle({
      plan,
      intentSet,
      release,
      execution,
      now: NOW,
    });
    expect(bundle.files['reader/report.md']).toContain('## Direct answer');
    expect(bundle.files['reader/report.md']).toContain(
      '## Ranked decision portfolio',
    );
    expect(bundle.files['reader/report.md']).toContain(
      '## Unresolved constraints',
    );
    expect(bundle.files['reader/report.md']).toContain(
      '## Proposed experiments',
    );
    expect(bundle.files['reader/report.md']).toContain(
      'Question scope remains unresolved: the admitted evidence does not establish clinical outcome safety.',
    );
    expect(bundle.files['reader/report.md']).not.toContain(
      'Portfolio breadth remains unresolved: the admitted evidence does not establish clinical outcome safety.',
    );
    expect(bundle.files['audit/acceptance-review.json']).toContain(
      '"overall": "pass"',
    );
    expect(bundle.files['audit/acceptance-review.json']).toContain(
      'source-cluster-diversity',
    );
    expect(bundle.files['reader/report.md']).not.toMatch(/evidence\s*index/iu);
    expect(bundle.files['execution-receipt.json']).toContain(
      '"externalEffectsExecuted": true',
    );
    expect(bundle.files['audit/live-effect-receipts.jsonl']).toContain(
      'effect-receipt:',
    );
    const firstPortfolioItem = execution.liveReview?.portfolio?.[0];
    const firstMechanism = execution.liveReview?.mechanisms?.[0];
    const firstBoundary = execution.liveReview?.boundaryConditions?.[0];
    const firstHypothesis = execution.liveReview?.hypotheses?.[0];
    const acceptanceReview = execution.acceptanceReview;
    if (
      !firstPortfolioItem ||
      !firstMechanism ||
      !firstBoundary ||
      !firstHypothesis ||
      !acceptanceReview
    ) {
      throw new Error('live fixture did not produce review artifacts');
    }
    const qualifiedEvidenceGaps = [
      {
        assertionLabel: 'portfolio item 1',
        statement: firstPortfolioItem.statement,
        unsupportedTerms: ['consumer'],
        evidenceIndexes: firstPortfolioItem.evidenceIndexes,
      },
      {
        assertionLabel: 'mechanism 1',
        statement: firstMechanism.statement,
        unsupportedTerms: ['private'],
        evidenceIndexes: firstMechanism.evidenceIndexes,
      },
      {
        assertionLabel: 'boundary condition 1',
        statement: firstBoundary.statement,
        unsupportedTerms: ['private'],
        evidenceIndexes: firstBoundary.evidenceIndexes,
      },
      {
        assertionLabel: 'hypothesis 1',
        statement: firstHypothesis.statement,
        unsupportedTerms: ['private'],
        evidenceIndexes: firstHypothesis.evidenceIndexes,
      },
    ];
    const partialBundle = composeGovernedInvestigationBundle({
      plan,
      intentSet,
      release,
      now: NOW,
      execution: {
        ...execution,
        acceptanceReview: {
          ...acceptanceReview,
          overall: 'fail',
          evidenceGaps: qualifiedEvidenceGaps,
        },
      },
    });
    expect(partialBundle.files['reader/report.md']).toContain(
      '**Research status: partial.**',
    );
    expect(partialBundle.files['reader/report.md']).toContain(
      '## Evidence gaps',
    );
    expect(partialBundle.files['reader/report.md']).toContain(
      '**Suggestive, not established:**',
    );
    expect(partialBundle.files['reader/report.md']).toContain(
      '**Suggestive limitation:**',
    );
    expect(partialBundle.files['reader/report.md']).toContain(
      '**Suggestive mechanism:**',
    );
    expect(partialBundle.files['reader/report.md']).toContain(
      '**Suggestive boundary:**',
    );
    expect(partialBundle.files['reader/report.md']).toContain(
      '**Suggestive hypothesis:**',
    );
    const qualifiedBundle = composeGovernedInvestigationBundle({
      plan,
      intentSet,
      release,
      now: NOW,
      execution: {
        ...execution,
        acceptanceReview: {
          ...acceptanceReview,
          overall: 'pass',
          evidenceGaps: qualifiedEvidenceGaps,
        },
      },
    });
    expect(qualifiedBundle.files['reader/report.md']).toContain(
      '**Research status: accepted with qualifications.**',
    );
  });

  it('records a weak consumer-hardware inference as a partial evidence gap instead of throwing away the report', () => {
    const review = evaluateLiveAcceptanceReview({
      question:
        'Which local world-model opportunities fit on a single consumer GPU?',
      decisionConstraints: ['single consumer GPU'],
      now: NOW,
      reviewClaims: [
        {
          proposalId: 'claim:single-gpu',
          statement: 'The model runs on a single GPU.',
          candidateId: 'candidate:single-gpu',
          requestedUrl: 'https://example.test/model-card',
          sourceClass: 'public_web',
          decision: 'admitted',
          reasonCodes: [],
        },
      ],
      review: {
        summary: 'One implementation reports single-GPU operation.',
        portfolio: [
          {
            rank: 1,
            title: 'Consumer GPU deployment',
            statement:
              'Use this implementation as a consumer-GPU world-model baseline.',
            rationale:
              'The implementation documents operation on one GPU, but does not name a consumer card.',
            constraints: ['Consumer-card VRAM and latency remain unverified.'],
            nextValidation:
              'Measure peak VRAM and latency on a named consumer card before relying on this option.',
            evidenceIndexes: [1],
          },
        ],
        weaknesses: ['The cited source does not identify the GPU class.'],
        suggestedSearches: ['named consumer GPU world model benchmark'],
      },
    });

    expect(review.overall).toBe('fail');
    const gap = review.evidenceGaps.find(
      (item) => item.assertionLabel === 'portfolio item 1',
    );
    expect(gap?.unsupportedTerms).toContain('consumer');
    expect(gap?.evidenceIndexes).toEqual([1]);
  });

  it('accepts an honest qualified result without upgrading a suggestive claim', () => {
    const review = evaluateLiveAcceptanceReview({
      question: 'Can this world-model implementation run on a consumer GPU?',
      decisionConstraints: ['consumer GPU'],
      now: NOW,
      reviewClaims: [
        {
          proposalId: 'claim:single-gpu-qualified',
          statement: 'The implementation runs on a single GPU.',
          candidateId: 'candidate:single-gpu-qualified',
          requestedUrl: 'https://example.test/model-card-qualified',
          sourceClass: 'public_web',
          decision: 'admitted',
          reasonCodes: [],
        },
      ],
      review: {
        summary:
          'The implementation reports single-GPU operation, but the GPU class is not defined.',
        portfolio: [
          {
            rank: 1,
            title: 'Qualified single-GPU trial',
            statement:
              'Treat the implementation as a consumer-GPU candidate, not an established consumer-GPU deployment.',
            rationale:
              'The source establishes one-GPU operation while leaving consumer-grade hardware undefined.',
            constraints: [
              'Consumer-card identity, VRAM, latency, thermals, and power remain unverified.',
            ],
            nextValidation:
              'Run the implementation on a named consumer card and record peak VRAM, latency, thermals, and power.',
            evidenceIndexes: [1],
          },
        ],
        answerBullets: [
          {
            statement:
              'Single-GPU operation is established; consumer-GPU suitability is only suggestive.',
            evidenceIndexes: [1],
          },
        ],
        mechanisms: [
          {
            statement:
              'The directly observed mechanism is execution within one GPU boundary.',
            evidenceIndexes: [1],
          },
        ],
        dissent: [
          {
            statement:
              'A single-GPU statement does not identify card class, memory capacity, power, or sustained thermal limits.',
            evidenceIndexes: [1],
          },
        ],
        boundaryConditions: [
          {
            statement:
              'Consumer-GPU suitability remains conditional on a named card and measured resource use.',
            evidenceIndexes: [1],
          },
        ],
        hypotheses: [
          {
            statement:
              'The implementation may fit a named consumer GPU under a bounded workload.',
            falsifier:
              'Peak VRAM exceeds the named card or the workload fails its latency and thermal limits.',
            evidenceIndexes: [1],
          },
        ],
        experimentProposals: [
          {
            statement:
              'Compare the implementation on one named consumer card against the documented single-GPU baseline.',
            resolvesUncertainty:
              'Whether the unspecified single GPU can be replaced by an explicitly defined consumer card.',
            threshold:
              'Pass only if peak VRAM stays below 90% of capacity across 3 runs and latency is no more than 10% worse than baseline.',
            safetyBoundary:
              'Stop if thermal throttling occurs, power exceeds the card limit, or the workload touches private data.',
            evidenceIndexes: [1],
          },
        ],
        weaknesses: [
          'The admitted source omits the GPU model and measured resource envelope.',
        ],
        suggestedSearches: ['named consumer GPU measured benchmark'],
      },
    });

    expect(review.overall).toBe('pass');
    expect(
      review.criteria.find((item) => item.criterionId === 'evidence-binding'),
    ).toMatchObject({ passed: false, requiredForOverall: false });
    expect(
      review.criteria.find(
        (item) => item.criterionId === 'uncertainty-handling',
      ),
    ).toMatchObject({ passed: true, requiredForOverall: true });
    expect(review.evidenceGaps.length).toBeGreaterThan(0);
    expect(review.decisionConstraints[0]).toMatchObject({
      passed: true,
      evidence: 'explicitly qualified by a cited evidence gap: consumer GPU',
    });
  });

  it('is deterministic for a fixed clock and catalog', () => {
    const scenario = authorizedScenario();
    const run = () =>
      executeGovernedAcquisition({
        intentSet: scenario.intentSet,
        release: scenario.release,
        effectAuthority: scenario.authority,
        trustedIssuerId: OFFLINE_FIXTURE_ISSUER_ID,
        adapters: buildOfflineNoEffectAdapters(CATALOG),
        now: NOW,
      });
    expect(run()).toEqual(run());
  });

  it('refuses a refused release before touching any adapter', () => {
    const scenario = authorizedScenario();
    const refusedRelease = evaluateAcquisitionRelease({
      intentSet: scenario.intentSet,
      effectAuthority: scenario.authority,
      now: NOW,
    });
    expect(refusedRelease.decision).toBe('refused');
    const { adapters, counts } = countedAdapters();
    expect(() =>
      executeGovernedAcquisition({
        intentSet: scenario.intentSet,
        release: refusedRelease,
        effectAuthority: scenario.authority,
        trustedIssuerId: OFFLINE_FIXTURE_ISSUER_ID,
        adapters,
        now: NOW,
      }),
    ).toThrow(
      expect.objectContaining({ code: 'release_not_authorized' }) as Error,
    );
    expect(counts).toEqual({ searches: 0, retrievals: 0 });
  });

  it('refuses when no trusted issuer is pinned at the execution boundary', () => {
    const scenario = authorizedScenario();
    const { adapters, counts } = countedAdapters();
    expect(() =>
      executeGovernedAcquisition({
        intentSet: scenario.intentSet,
        release: scenario.release,
        effectAuthority: scenario.authority,
        trustedIssuerId: undefined,
        adapters,
        now: NOW,
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'no_trusted_authority_issuer',
      }) as Error,
    );
    expect(counts).toEqual({ searches: 0, retrievals: 0 });
  });

  it('refuses an issuer that differs from the pinned issuer', () => {
    const scenario = authorizedScenario();
    expect(() =>
      executeGovernedAcquisition({
        intentSet: scenario.intentSet,
        release: scenario.release,
        effectAuthority: scenario.authority,
        trustedIssuerId: 'some-other-issuer/v1',
        adapters: buildOfflineNoEffectAdapters(CATALOG),
        now: NOW,
      }),
    ).toThrow(
      expect.objectContaining({ code: 'untrusted_authority_issuer' }) as Error,
    );
  });

  it('refuses a digest-tampered intent set', () => {
    const scenario = authorizedScenario();
    const tampered = JSON.parse(JSON.stringify(scenario.intentSet)) as Record<
      string,
      unknown
    > & {
      intents: { subject: string }[];
    };
    const firstIntent = tampered.intents[0];
    if (!firstIntent) throw new Error('expected at least one intent');
    firstIntent.subject = `${firstIntent.subject} tampered`;
    expect(() =>
      executeGovernedAcquisition({
        intentSet: tampered,
        release: scenario.release,
        effectAuthority: scenario.authority,
        trustedIssuerId: OFFLINE_FIXTURE_ISSUER_ID,
        adapters: buildOfflineNoEffectAdapters(CATALOG),
        now: NOW,
      }),
    ).toThrow();
  });

  it('refuses an intent set the release never bound', () => {
    const scenario = authorizedScenario();
    const other = authorizedScenario(
      'Which watershed monitoring cadence best detects new contamination without exhausting volunteer capacity?',
    );
    expect(() =>
      executeGovernedAcquisition({
        intentSet: other.intentSet,
        release: scenario.release,
        effectAuthority: scenario.authority,
        trustedIssuerId: OFFLINE_FIXTURE_ISSUER_ID,
        adapters: buildOfflineNoEffectAdapters(CATALOG),
        now: NOW,
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'release_intent_set_mismatch',
      }) as Error,
    );
  });

  it('refuses an authority that is not the one the release bound', () => {
    const scenario = authorizedScenario();
    const swapped = mintOfflineFixtureAuthorityReceipt({
      planId: scenario.plan.planId,
      planDigest: scenario.plan.planDigest,
      question: scenario.plan.question,
      actorId: 'operator:test',
      authorizedAt: NOW,
      consumptionNonce: 'different-nonce-0123456789abcdef',
    });
    expect(() =>
      executeGovernedAcquisition({
        intentSet: scenario.intentSet,
        release: scenario.release,
        effectAuthority: swapped,
        trustedIssuerId: OFFLINE_FIXTURE_ISSUER_ID,
        adapters: buildOfflineNoEffectAdapters(CATALOG),
        now: NOW,
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'authority_release_binding_mismatch',
      }) as Error,
    );
  });

  it('refuses an expired authority at execution time', () => {
    const scenario = authorizedScenario();
    const { adapters, counts } = countedAdapters();
    expect(() =>
      executeGovernedAcquisition({
        intentSet: scenario.intentSet,
        release: scenario.release,
        effectAuthority: scenario.authority,
        trustedIssuerId: OFFLINE_FIXTURE_ISSUER_ID,
        adapters,
        now: '2026-07-16T14:00:00.000Z',
      }),
    ).toThrow(expect.objectContaining({ code: 'authority_expired' }) as Error);
    expect(counts).toEqual({ searches: 0, retrievals: 0 });
  });

  it('refuses an authority that is not yet valid', () => {
    const scenario = authorizedScenario();
    expect(() =>
      executeGovernedAcquisition({
        intentSet: scenario.intentSet,
        release: scenario.release,
        effectAuthority: scenario.authority,
        trustedIssuerId: OFFLINE_FIXTURE_ISSUER_ID,
        adapters: buildOfflineNoEffectAdapters(CATALOG),
        now: '2026-07-16T11:00:00.000Z',
      }),
    ).toThrow(
      expect.objectContaining({ code: 'authority_not_yet_valid' }) as Error,
    );
  });
});

describe('governed investigation bundle', () => {
  function sha256(value: string): string {
    return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
  }

  it('composes a digest-chained reader and audit bundle from admitted evidence only', () => {
    const scenario = authorizedScenario();
    const execution = executeGovernedAcquisition({
      intentSet: scenario.intentSet,
      release: scenario.release,
      effectAuthority: scenario.authority,
      trustedIssuerId: OFFLINE_FIXTURE_ISSUER_ID,
      adapters: buildOfflineNoEffectAdapters(CATALOG),
      now: NOW,
    });
    const bundle = composeGovernedInvestigationBundle({
      plan: scenario.plan,
      intentSet: scenario.intentSet,
      release: scenario.release,
      execution,
      now: NOW,
    });
    const report = bundle.files['reader/report.md'] ?? '';
    expect(report).toMatch(/^#\s+/u);
    expect(report).toContain('## Direct answer');
    expect(report).toMatch(/\[\d+\]/u);
    expect(report).not.toMatch(
      /sha256:|claim[_:-]|proposal[_:-]|plan digest|parser receipt|budget ledger|coverage verdict/iu,
    );
    expect(bundle.files['reader/references.md']).toMatch(
      /^\[\d+\]:\s+https:\/\//mu,
    );
    expect(
      (bundle.files['audit/rejected-claims.jsonl'] ?? '').trim().length,
    ).toBeGreaterThan(0);
    const receipt = JSON.parse(
      bundle.files['execution-receipt.json'] ?? '{}',
    ) as { artifactDigests: Record<string, string> };
    for (const [name, content] of Object.entries(bundle.files)) {
      if (name === 'execution-receipt.json') continue;
      expect(receipt.artifactDigests[name]).toBe(sha256(content));
    }
    const projection = JSON.parse(
      bundle.files['reader/projection.json'] ?? '{}',
    ) as {
      factualSentences: { claimIds: string[] }[];
    };
    const admittedIds = new Set(
      execution.claims
        .filter((claim) => claim.decision === 'admitted')
        .map((claim) => claim.proposalId),
    );
    expect(projection.factualSentences.length).toBeGreaterThan(0);
    for (const sentence of projection.factualSentences) {
      expect(sentence.claimIds.length).toBeGreaterThan(0);
      for (const id of sentence.claimIds) {
        expect(admittedIds.has(id)).toBe(true);
      }
    }
  });

  it('refuses to compose across mismatched lineage', () => {
    const scenario = authorizedScenario();
    const other = authorizedScenario(
      'Which watershed monitoring cadence best detects new contamination without exhausting volunteer capacity?',
    );
    const execution = executeGovernedAcquisition({
      intentSet: scenario.intentSet,
      release: scenario.release,
      effectAuthority: scenario.authority,
      trustedIssuerId: OFFLINE_FIXTURE_ISSUER_ID,
      adapters: buildOfflineNoEffectAdapters(CATALOG),
      now: NOW,
    });
    expect(() =>
      composeGovernedInvestigationBundle({
        plan: other.plan,
        intentSet: scenario.intentSet,
        release: scenario.release,
        execution,
        now: NOW,
      }),
    ).toThrow(GovernedExecutionError);
  });
});
