import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalDigest, type ResearchPlanProposal } from '@mammoth/domain';
import { P9_DOMAIN_POLICY_PACKS } from '@mammoth/governance';
import { describe, expect, it } from 'vitest';
import {
  executeP9ResearchCli,
  inspectP9LiveReadiness,
  writeFreshP9Bundle,
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

async function prepareAcceptedPlan(root: string) {
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
  return { output, outputIo };
}

describe('P9 application CLI', () => {
  it('persists a previewable proposal and an immutable accepted plan', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mammoth-p9-cli-'));
    const { output, outputIo } = await prepareAcceptedPlan(root);
    const plan = JSON.parse(
      await readFile(join(output, 'research-plan.json'), 'utf8'),
    ) as { readonly acceptedBy: string; readonly previousPlanDigest: null };
    expect(plan).toMatchObject({
      acceptedBy: 'operator:test',
      previousPlanDigest: null,
    });
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
        },
      ),
    ).toBe(1);
    expect(outputIo.stderr.at(-1)).toContain('immutable_price_catalog_missing');
  });

  it('reports every missing live authority prerequisite before any effect', async () => {
    const readiness = await inspectP9LiveReadiness({});
    expect(readiness.ready).toBe(false);
    expect(readiness.blockers).toContain(
      'scoped_live_authority_receipt_missing',
    );
    expect(readiness.blockers).toContain('immutable_price_catalog_missing');
    expect(readiness.blockers).toContain(
      'immutable_provider_profile_catalog_missing',
    );
    const outputIo = io();
    expect(
      await executeP9ResearchCli(
        ['research', 'doctor', '--p9'],
        outputIo.value,
        { env: {} },
      ),
    ).toBe(3);
    expect(JSON.parse(outputIo.stdout[0] ?? '{}')).toMatchObject({
      status: 'blocked_before_effects',
      ready: false,
    });
  });

  it('does not trust environment strings for proposer/evaluator lineage', async () => {
    const readiness = await inspectP9LiveReadiness({
      MAMMOTH_P9_PROPOSER_MODEL: 'proposer-model',
      MAMMOTH_P9_EVALUATOR_MODEL: 'evaluator-model',
      MAMMOTH_P9_PROPOSER_PROFILE_FAMILY: 'same-family',
      MAMMOTH_P9_EVALUATOR_PROFILE_FAMILY: 'same-family',
    });
    expect(readiness.blockers).toContain(
      'immutable_provider_profile_catalog_missing',
    );
    expect(readiness.proposerProfileFamily).toBeNull();
    expect(readiness.evaluatorProfileFamily).toBeNull();
  });

  it('cross-binds plan content, pack, policy, actor, and time before live readiness', async () => {
    const tamperCases = [
      { actorId: 'operator:attacker' },
      { decidedAt: '2026-07-15T16:00:00.000Z' },
      { acceptancePolicyId: 'p9-plan-acceptance/forged' },
      { packId: 'general-web/v1' },
    ] as const;
    for (const tamper of tamperCases) {
      const root = await mkdtemp(join(tmpdir(), 'mammoth-p9-chain-'));
      const { output, outputIo } = await prepareAcceptedPlan(root);
      const receiptPath = join(output, 'plan-acceptance-receipt.json');
      const receipt = JSON.parse(await readFile(receiptPath, 'utf8')) as Record<
        string,
        unknown
      >;
      const identity: Record<string, unknown> = { ...receipt, ...tamper };
      delete identity.receiptDigest;
      await writeFile(
        receiptPath,
        JSON.stringify({
          ...identity,
          receiptDigest: canonicalDigest(identity),
        }),
      );
      expect(
        await executeP9ResearchCli(
          ['research', 'run', join(output, 'research-plan.json')],
          outputIo.value,
          { env: {} },
        ),
      ).toBe(1);
      expect(outputIo.stderr.at(-1)).toContain('exact accepted plan');
      expect(outputIo.stderr.at(-1)).not.toContain(
        'live_authorization_missing',
      );
    }

    const policyRoot = await mkdtemp(join(tmpdir(), 'mammoth-p9-policy-'));
    const policyRun = await prepareAcceptedPlan(policyRoot);
    const planPath = join(policyRun.output, 'research-plan.json');
    const receiptPath = join(policyRun.output, 'plan-acceptance-receipt.json');
    const acceptedPlan = JSON.parse(await readFile(planPath, 'utf8')) as Record<
      string,
      unknown
    >;
    const forgedPlan: Record<string, unknown> = {
      ...acceptedPlan,
      acceptancePolicyId: 'p9-plan-acceptance/forged',
    };
    delete forgedPlan.planDigest;
    const forgedPlanDigest = canonicalDigest(forgedPlan);
    await writeFile(
      planPath,
      JSON.stringify({ ...forgedPlan, planDigest: forgedPlanDigest }),
    );
    const acceptedReceipt = JSON.parse(
      await readFile(receiptPath, 'utf8'),
    ) as Record<string, unknown>;
    const forgedReceipt: Record<string, unknown> = {
      ...acceptedReceipt,
      acceptancePolicyId: 'p9-plan-acceptance/forged',
      planDigest: forgedPlanDigest,
    };
    delete forgedReceipt.receiptDigest;
    await writeFile(
      receiptPath,
      JSON.stringify({
        ...forgedReceipt,
        receiptDigest: canonicalDigest(forgedReceipt),
      }),
    );
    expect(
      await executeP9ResearchCli(
        ['research', 'run', planPath],
        policyRun.outputIo.value,
        { env: {} },
      ),
    ).toBe(1);
    expect(policyRun.outputIo.stderr.at(-1)).toContain('exact accepted plan');

    const root = await mkdtemp(join(tmpdir(), 'mammoth-p9-content-'));
    const { output, outputIo } = await prepareAcceptedPlan(root);
    const proposalPath = join(output, 'research-plan-proposal.json');
    const parsed = JSON.parse(await readFile(proposalPath, 'utf8')) as Record<
      string,
      unknown
    >;
    const changed: Record<string, unknown> = {
      ...parsed,
      scope: {
        include: ['forged proposal content'],
        exclusions: (parsed.scope as { exclusions: unknown }).exclusions,
      },
    };
    delete changed.proposalDigest;
    await writeFile(
      proposalPath,
      JSON.stringify({
        ...changed,
        proposalDigest: canonicalDigest(changed),
      }),
    );
    expect(
      await executeP9ResearchCli(
        ['research', 'run', join(output, 'research-plan.json')],
        outputIo.value,
        { env: {} },
      ),
    ).toBe(1);
    expect(outputIo.stderr.at(-1)).toContain('exact accepted plan');
  });

  it('preserves the accepted chain when a revision is rejected', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mammoth-p9-revision-'));
    const { output, outputIo } = await prepareAcceptedPlan(root);
    const canonicalPaths = [
      'research-plan-proposal.json',
      'research-plan.json',
      'plan-acceptance-receipt.json',
    ];
    const before = await Promise.all(
      canonicalPaths.map((name) => readFile(join(output, name), 'utf8')),
    );
    const unchangedProposal = join(root, 'unchanged-proposal.json');
    await writeFile(unchangedProposal, JSON.stringify(proposal()));
    expect(
      await executeP9ResearchCli(
        [
          'research',
          'revise',
          output,
          '--proposal',
          unchangedProposal,
          '--actor',
          'operator:test',
        ],
        outputIo.value,
        { now: () => '2026-07-15T16:00:00.000Z' },
      ),
    ).toBe(4);
    const after = await Promise.all(
      canonicalPaths.map((name) => readFile(join(output, name), 'utf8')),
    );
    expect(after).toEqual(before);
    const names = await readdir(output);
    expect(names.some((name) => name.startsWith('rejected-revision-'))).toBe(
      true,
    );
    expect(names.some((name) => name.startsWith('revision-attempt-'))).toBe(
      true,
    );
  });

  it('refuses a pre-existing symlink output without touching its target', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mammoth-p9-symlink-'));
    const target = join(root, 'victim.txt');
    const output = join(root, 'bundle');
    await writeFile(target, 'untouched');
    await symlink(target, output);
    await expect(
      writeFreshP9Bundle(output, { 'report.md': 'malicious overwrite' }),
    ).rejects.toThrow();
    expect(await readFile(target, 'utf8')).toBe('untouched');
  });

  it('seals a prepared live run directory without overwriting durable residue', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mammoth-p9-prepared-'));
    const output = join(root, 'bundle');
    const residue = '{"stage":"evaluated"}\n';
    await mkdir(output);
    await writeFile(join(output, 'live-claim-rejection-residue.json'), residue);

    await writeFreshP9Bundle(
      output,
      {
        'live-claim-rejection-residue.json': residue,
        'report.md': '# Verified report\n',
      },
      {
        preparedDirectory: true,
        preexistingArtifactNames: new Set([
          'live-claim-rejection-residue.json',
        ]),
      },
    );

    expect(
      await readFile(join(output, 'live-claim-rejection-residue.json'), 'utf8'),
    ).toBe(residue);
    expect(await readFile(join(output, 'report.md'), 'utf8')).toBe(
      '# Verified report\n',
    );
  });
});
