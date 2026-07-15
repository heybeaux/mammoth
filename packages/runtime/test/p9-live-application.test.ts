import { TextEncoder } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  P9_LIVE_EXHIBITION_QUESTION,
  buildAcceptedP9LivePlan,
  runP9LiveApplication,
  verifyP9ExactBundle,
  type P9LiveCandidate,
  type P9LiveClaimSeed,
  type P9LiveModelAdapter,
} from '../src/index.js';

const now = () => new Date('2026-07-15T18:00:00.000Z');

const candidates: readonly P9LiveCandidate[] = [
  {
    candidateId: 'repo-code',
    url: 'https://github.com/JustVugg/colibri/blob/main/src/infer.c',
    title: 'colibri source',
    sourceClass: 'repository_code',
    sourceFamilyId: 'github.com',
  },
  {
    candidateId: 'repo-docs',
    url: 'https://github.com/JustVugg/colibri',
    title: 'colibri README',
    sourceClass: 'repository_docs',
    sourceFamilyId: 'github.com',
  },
  {
    candidateId: 'apple-docs',
    url: 'https://developer.apple.com/metal/',
    title: 'Apple Metal',
    sourceClass: 'hardware_vendor_docs',
    sourceFamilyId: 'apple.com',
  },
  {
    candidateId: 'benchmark-docs',
    url: 'https://example.com/benchmark-noise',
    title: 'benchmark noise',
    sourceClass: 'peer_reviewed_or_primary_technical',
    sourceFamilyId: 'example.com',
  },
];

const bodies = new Map([
  [
    'repo-code',
    'Current upstream colibri code maps model expert weights and streams data through a cache path, so a bounded colibri change should be limited to cache placement instrumentation.',
  ],
  [
    'repo-docs',
    'The upstream repository documentation describes colibri as an inference runtime and warns that benchmark claims require controlled measurement.',
  ],
  [
    'apple-docs',
    'Apple silicon systems use unified memory, and a 128 GB Apple silicon machine changes the memory pressure for colibri experiments.',
  ],
  [
    'benchmark-docs',
    'A colibri experiment should compare baseline and changed builds with repeated warm and cold runs; improvements smaller than run to run measurement noise should not be treated as real.',
  ],
]);

function bodyFor(candidateId: string): string {
  const body = bodies.get(candidateId);
  if (!body) throw new Error(`missing body for ${candidateId}`);
  return body;
}

function model(
  overrides: Partial<P9LiveModelAdapter> = {},
): P9LiveModelAdapter {
  const seeds: readonly P9LiveClaimSeed[] = [
    {
      claimId: 'claim-upstream-code',
      candidateId: 'repo-code',
      quote: bodyFor('repo-code'),
      statement:
        'Current upstream colibri code maps model expert weights and streams data through a cache path, so a bounded colibri change should be limited to cache placement instrumentation.',
      subquestionIds: ['sq-upstream'],
      sectionId: 'upstream_colibri_facts',
      claimGroupId: 'bounded-change',
      critical: true,
      contradictionIds: [],
    },
    {
      claimId: 'claim-upstream-docs',
      candidateId: 'repo-docs',
      quote: bodyFor('repo-docs'),
      statement:
        'The upstream repository documentation describes colibri as an inference runtime and warns that benchmark claims require controlled measurement.',
      subquestionIds: ['sq-upstream', 'sq-experiment'],
      sectionId: 'first_bounded_change',
      claimGroupId: 'bounded-change',
      critical: true,
      contradictionIds: [],
    },
    {
      claimId: 'claim-apple-memory',
      candidateId: 'apple-docs',
      quote: bodyFor('apple-docs'),
      statement:
        'Apple silicon systems use unified memory, and a 128 GB Apple silicon machine changes the memory pressure for colibri experiments.',
      subquestionIds: ['sq-apple-silicon'],
      sectionId: 'apple_silicon_constraints',
      claimGroupId: 'apple-memory',
      critical: false,
      contradictionIds: [],
    },
    {
      claimId: 'claim-experiment-noise',
      candidateId: 'benchmark-docs',
      quote: bodyFor('benchmark-docs'),
      statement:
        'A colibri experiment should compare baseline and changed builds with repeated warm and cold runs; improvements smaller than run to run measurement noise should not be treated as real.',
      subquestionIds: ['sq-experiment', 'sq-risk'],
      sectionId: 'experiment_design',
      claimGroupId: 'noise-experiment',
      critical: false,
      contradictionIds: ['contradiction-noise-vs-improvement'],
    },
  ];
  return {
    proposerProfile: {
      profileVersionId: 'live-proposer-profile',
      profileFamilyId: 'live-proposer-family',
      modelId: 'fixture/proposer',
    },
    evaluatorProfile: {
      profileVersionId: 'live-evaluator-profile',
      profileFamilyId: 'live-evaluator-family',
      modelId: 'fixture/evaluator',
    },
    proposeClaims: () => Promise.resolve(seeds),
    evaluateClaims: () =>
      Promise.resolve(
        seeds.map((seed) => ({
          claimId: seed.claimId,
          verdict: 'entailed' as const,
          reasonCodes: ['fixture_independent_entailment'],
        })),
      ),
    ...overrides,
  };
}

describe('P9 live application', () => {
  it('freezes the exact Colibri question into an accepted technical due diligence plan', () => {
    const plan = buildAcceptedP9LivePlan({
      budgetUsd: 5,
      now: now().toISOString(),
      proposerProfile: model().proposerProfile,
    });

    expect(plan.plan.question).toBe(P9_LIVE_EXHIBITION_QUESTION);
    expect(plan.plan.domainPackId).toBe('technical-due-diligence/v1');
    expect(plan.plan.budget.currencyUsd).toBe(5);
    expect(
      plan.plan.sourceClassTargets.map((target) => target.sourceClass),
    ).toContain('hardware_vendor_docs');
    expect(plan.acceptanceReceipt.decision).toBe('accepted');
  });

  it('runs injected live effects through bounded authority and exact bundle replay', async () => {
    const run = await runP9LiveApplication({
      executionId: 'p9-live-test',
      budgetUsd: 5,
      now,
      search: { search: () => Promise.resolve(candidates) },
      retrieve: (request) => {
        const candidate = candidates.find((entry) => entry.url === request.url);
        const body = candidate ? bodies.get(candidate.candidateId) : undefined;
        if (!candidate || !body) throw new Error('missing fixture source');
        return Promise.resolve({
          requestedUrl: request.url,
          finalUrl: request.url,
          redirectChain: [],
          retrievedAt: now().toISOString(),
          status: 200,
          headers: { 'content-type': 'text/plain' },
          mediaType: 'text/plain',
          bytes: new TextEncoder().encode(body),
          networkReceipts: [],
        });
      },
      model: model(),
      maxCandidates: 4,
    });

    expect(run.exactBundleVerified).toBe(true);
    expect(run.receipt.question).toBe(P9_LIVE_EXHIBITION_QUESTION);
    expect(run.receipt.budget.authorizedUsd).toBe(5);
    expect(run.receipt.counts.terminalAttempts).toBe(4);
    expect(run.receipt.counts.admittedClaims).toBe(4);
    expect(verifyP9ExactBundle(run.artifacts).verifiedCitationCount).toBe(
      run.manifest.citations.length,
    );
  });

  it('fails before effects when the operator budget exceeds the P9 live cap', async () => {
    await expect(
      runP9LiveApplication({
        executionId: 'p9-live-over-budget',
        budgetUsd: 5.01,
        now,
        search: { search: () => Promise.resolve(candidates) },
        model: model(),
      }),
    ).rejects.toThrow(/no greater than 5/);
  });

  it('rejects correlated proposer and evaluator profile families', async () => {
    const correlated = model({
      evaluatorProfile: {
        profileVersionId: 'same-profile',
        profileFamilyId: 'live-proposer-family',
        modelId: 'fixture/evaluator',
      },
    });

    await expect(
      runP9LiveApplication({
        executionId: 'p9-live-correlated',
        budgetUsd: 5,
        now,
        search: { search: () => Promise.resolve(candidates) },
        model: correlated,
      }),
    ).rejects.toThrow(/profile families differ/);
  });

  it('records terminal retrieval residue instead of retrying a crashed acquisition', async () => {
    const run = await runP9LiveApplication({
      executionId: 'p9-live-terminal-failure',
      budgetUsd: 5,
      now,
      search: { search: () => Promise.resolve(candidates) },
      retrieve: (request) => {
        if (request.url.includes('benchmark-noise')) throw new Error('boom');
        const candidate = candidates.find((entry) => entry.url === request.url);
        const body = candidate ? bodies.get(candidate.candidateId) : undefined;
        if (!candidate || !body) throw new Error('missing fixture source');
        return Promise.resolve({
          requestedUrl: request.url,
          finalUrl: request.url,
          redirectChain: [],
          retrievedAt: now().toISOString(),
          status: 200,
          headers: { 'content-type': 'text/plain' },
          mediaType: 'text/plain',
          bytes: new TextEncoder().encode(body),
          networkReceipts: [],
        });
      },
      model: model({
        proposeClaims: (input) =>
          model()
            .proposeClaims(input)
            .then((claims) =>
              claims.filter((claim) => claim.candidateId !== 'benchmark-docs'),
            ),
      }),
      maxCandidates: 4,
    });

    expect(run.receipt.counts.terminalAttempts).toBe(4);
    expect(run.receipt.typedResidue.retrieval_failures).toEqual([
      'attempt:benchmark-docs',
    ]);
  });
});
