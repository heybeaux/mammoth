import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalDigest, type ResearchPlanProposal } from '@mammoth/domain';
import { P9_DOMAIN_POLICY_PACKS } from '@mammoth/governance';
import { describe, expect, it } from 'vitest';
import {
  executeP9ResearchCli,
  inspectP9LiveReadiness,
} from '../src/p9-operator.js';

const NOW = '2026-07-15T15:00:00.000Z';

function proposal(): ResearchPlanProposal {
  const question =
    'Which colibri runtime memory experiments distinguish measured improvement from noise?';
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
    proposalId: 'proposal:cli-test',
    question,
    domainPackId: 'technical-due-diligence/v1' as const,
    packDigest: P9_DOMAIN_POLICY_PACKS['technical-due-diligence/v1'].packDigest,
    scope: {
      include: ['colibri runtime memory experiments and measurement noise'],
      exclusions: [
        { exclusionId: 'no-execution', statement: 'No experiment execution.' },
      ],
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
      query: `${question} ${entry.question}`,
      subquestionIds: [entry.subquestionId],
    })),
    contradictionRequirements: [
      {
        contradictionId: 'measured-vs-claimed',
        description: 'Measured improvement versus claimed improvement.',
      },
      {
        contradictionId: 'signal-vs-noise',
        description: 'Experiment signal versus measurement noise.',
      },
    ],
    freshnessRequirements: [
      {
        freshnessId: 'repository-state',
        appliesTo: 'repository_code',
        maxAgeDays: 180,
        asOfDateRequired: false,
      },
    ],
    stopCriteria: [
      {
        stopId: 'coverage',
        description: 'Every subquestion is accounted for.',
      },
    ],
    reportOutline: {
      sections: [
        { sectionId: 'summary', title: 'Summary' },
        { sectionId: 'evidence', title: 'Evidence' },
        { sectionId: 'experiment', title: 'Experiment' },
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
      scope: {
        source: 'question' as const,
        questionTerms: ['colibri', 'runtime', 'memory', 'experiments', 'noise'],
      },
      subquestions: {
        source: 'question' as const,
        questionTerms: ['colibri', 'runtime', 'memory', 'experiments', 'noise'],
      },
      coverage: { source: 'domain_pack' as const, questionTerms: [] },
      source_classes: { source: 'domain_pack' as const, questionTerms: [] },
      search_queries: {
        source: 'question' as const,
        questionTerms: ['colibri', 'runtime', 'memory', 'experiments', 'noise'],
      },
      contradictions: { source: 'domain_pack' as const, questionTerms: [] },
      freshness: { source: 'domain_pack' as const, questionTerms: [] },
      stop_criteria: { source: 'domain_pack' as const, questionTerms: [] },
      outline: { source: 'domain_pack' as const, questionTerms: [] },
      budget: { source: 'operator' as const, questionTerms: [] },
    },
    proposerWork: {
      workId: 'work:planner:cli-test',
      workDigest: canonicalDigest({ work: 'planner' }),
      rawResponseDigest: canonicalDigest({ raw: 'planner' }),
      role: 'plan_proposer' as const,
      profileVersionId: 'planner-profile-v1',
      profileFamilyId: 'planner-family',
    },
    proposedAt: NOW,
  };
  return { ...identity, proposalDigest: canonicalDigest(identity) };
}

function io() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    value: {
      stdout: (entry: string) => stdout.push(entry),
      stderr: (entry: string) => stderr.push(entry),
    },
  };
}

describe('P9 application CLI', () => {
  it('persists a previewable proposal and an immutable accepted plan', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mammoth-p9-cli-'));
    const proposalPath = join(root, 'proposal.json');
    const output = join(root, 'plan');
    await writeFile(proposalPath, JSON.stringify(proposal()));
    const outputIo = io();
    expect(
      await executeP9ResearchCli(
        [
          'research',
          'plan',
          proposal().question,
          '--proposal',
          proposalPath,
          '--output',
          output,
        ],
        outputIo.value,
      ),
    ).toBe(0);
    expect(
      await executeP9ResearchCli(
        ['research', 'accept', output, '--actor', 'operator:test'],
        outputIo.value,
        { now: () => NOW },
      ),
    ).toBe(0);
    const plan = JSON.parse(
      await readFile(join(output, 'research-plan.json'), 'utf8'),
    ) as { readonly acceptedBy: string; readonly previousPlanDigest: null };
    expect(plan).toMatchObject({
      acceptedBy: 'operator:test',
      previousPlanDigest: null,
    });
    let effectCalls = 0;
    expect(
      await executeP9ResearchCli(
        ['research', 'run', join(output, 'research-plan.json')],
        outputIo.value,
        {
          now: () => NOW,
          env: {
            MAMMOTH_P9_LIVE_RESEARCH: 'authorized',
            MAMMOTH_P9_SEARCH_API_KEY: 'test-only',
            MAMMOTH_P9_SEARCH_BILLING_AUTHORIZATION: 'authorized',
            MAMMOTH_P9_PROVIDER_BASE_URL: 'https://provider.invalid/v1',
            MAMMOTH_P9_PROVIDER_API_KEY: 'test-only',
            MAMMOTH_P9_MODEL_BILLING_AUTHORIZATION: 'authorized',
            MAMMOTH_P9_PROPOSER_MODEL: 'proposer-model',
            MAMMOTH_P9_EVALUATOR_MODEL: 'evaluator-model',
            MAMMOTH_P9_PROPOSER_PROFILE_FAMILY: 'family-a',
            MAMMOTH_P9_EVALUATOR_PROFILE_FAMILY: 'family-b',
          },
          runLive: () => {
            effectCalls += 1;
            return Promise.resolve({});
          },
        },
      ),
    ).toBe(1);
    expect(effectCalls).toBe(0);
    expect(outputIo.stderr.at(-1)).toContain('immutable_price_catalog_missing');
  });

  it('reports every live authority blocker without invoking an effect adapter', async () => {
    let calls = 0;
    const readiness = await inspectP9LiveReadiness({}, true);
    expect(readiness.ready).toBe(false);
    expect(readiness.blockers).toContain('live_authorization_missing');
    expect(readiness.blockers).toContain('immutable_price_catalog_missing');
    expect(readiness.blockers).toContain('proposer_profile_missing');
    expect(readiness.blockers).toContain('evaluator_profile_missing');
    expect(calls).toBe(0);

    const outputIo = io();
    expect(
      await executeP9ResearchCli(
        ['research', 'doctor', '--p9'],
        outputIo.value,
        {
          env: {},
          runLive: () => {
            calls += 1;
            return Promise.resolve({});
          },
        },
      ),
    ).toBe(3);
    expect(calls).toBe(0);
    expect(JSON.parse(outputIo.stdout[0] ?? '{}')).toMatchObject({
      status: 'blocked_before_effects',
      ready: false,
    });
  });

  it('rejects correlated proposer/evaluator profile families before readiness', async () => {
    const readiness = await inspectP9LiveReadiness(
      {
        MAMMOTH_P9_PROPOSER_MODEL: 'proposer-model',
        MAMMOTH_P9_EVALUATOR_MODEL: 'evaluator-model',
        MAMMOTH_P9_PROPOSER_PROFILE_FAMILY: 'same-family',
        MAMMOTH_P9_EVALUATOR_PROFILE_FAMILY: 'same-family',
      },
      true,
    );
    expect(readiness.blockers).toContain('model_profile_families_not_distinct');
  });
});
