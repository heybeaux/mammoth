import { canonicalDigest, type ResearchPlanProposal } from '@mammoth/domain';
import { describe, expect, it } from 'vitest';
import {
  acceptResearchPlan,
  changedPlanFieldGroups,
  GovernanceError,
  materialQuestionTerms,
  P9_DOMAIN_POLICY_PACKS,
  P9_PLAN_ACCEPTANCE_POLICY_ID,
  previewResearchPlan,
  reviseResearchPlan,
  validateResearchPlanProposal,
  type PlanAcceptanceThresholds,
} from '../src/index.js';

const NOW = '2026-07-15T02:00:00.000Z';

const THRESHOLDS: PlanAcceptanceThresholds = {
  minSubquestions: 2,
  minSourceClasses: 3,
  minContradictionRequirements: 1,
  maxAuthorizedUsd: 5,
  minQuestionDerivedTerms: 4,
};

const digest = (seed: string): string => canonicalDigest({ seed });

type Identity = Record<string, unknown>;

function buildProposal(
  mutate: (identity: Identity) => Identity = (identity) => identity,
): ResearchPlanProposal {
  const identity = mutate({
    schemaVersion: '1.0.0',
    contractFamily: 'p9.v1',
    proposalId: 'proposal-technical-1',
    question:
      'Can the colibri runtime execute large models safely on limited memory hardware?',
    domainPackId: 'technical-due-diligence/v1',
    packDigest: P9_DOMAIN_POLICY_PACKS['technical-due-diligence/v1'].packDigest,
    scope: {
      include: ['colibri runtime memory behavior', 'model execution safety'],
      exclusions: [
        { exclusionId: 'ex-1', statement: 'No production deployment advice.' },
      ],
    },
    subquestions: [
      {
        subquestionId: 'sq-1',
        question: 'How does the colibri runtime manage memory?',
        mandatory: true,
      },
      {
        subquestionId: 'sq-2',
        question: 'Which models execute safely on limited hardware?',
        mandatory: true,
      },
    ],
    coverageRequirements: [
      {
        coverageId: 'cov-1',
        subquestionId: 'sq-1',
        description: 'Memory management evidence from code.',
        mandatory: true,
      },
      {
        coverageId: 'cov-2',
        subquestionId: 'sq-2',
        description: 'Execution safety evidence.',
        mandatory: true,
      },
    ],
    sourceClassTargets: [
      {
        sourceClass: 'repository_code',
        minimumIndependentSources: 2,
        mandatory: true,
      },
      {
        sourceClass: 'repository_docs',
        minimumIndependentSources: 1,
        mandatory: true,
      },
      {
        sourceClass: 'security_advisory',
        minimumIndependentSources: 1,
        mandatory: true,
      },
    ],
    searchQueries: [
      {
        queryId: 'q-1',
        query: 'colibri runtime memory management',
        subquestionIds: ['sq-1'],
      },
      {
        queryId: 'q-2',
        query: 'colibri models execute safely limited hardware',
        subquestionIds: ['sq-2'],
      },
    ],
    contradictionRequirements: [
      {
        contradictionId: 'con-1',
        description: 'Claimed versus measured memory usage.',
      },
    ],
    freshnessRequirements: [
      {
        freshnessId: 'fresh-1',
        appliesTo: 'repository_code',
        maxAgeDays: 180,
        asOfDateRequired: false,
      },
    ],
    stopCriteria: [
      { stopId: 'stop-1', description: 'Memory safety evidence assessed.' },
    ],
    reportOutline: {
      sections: [
        { sectionId: 'summary', title: 'Summary' },
        { sectionId: 'findings', title: 'Findings' },
        { sectionId: 'limitations', title: 'Limitations' },
      ],
    },
    budget: {
      currencyUsd: 5,
      searchUsd: 0.5,
      retrievalParsingUsd: 0.5,
      modelsUsd: 4,
    },
    criticalClaimPolicy: 'independent_entailment_distinct_profile_family',
    derivations: {
      scope: { source: 'question', questionTerms: ['colibri', 'memory'] },
      subquestions: {
        source: 'question',
        questionTerms: ['colibri', 'memory', 'models'],
      },
      coverage: { source: 'domain_pack', questionTerms: [] },
      source_classes: { source: 'domain_pack', questionTerms: [] },
      search_queries: {
        source: 'question',
        questionTerms: ['colibri', 'runtime', 'memory', 'hardware'],
      },
      contradictions: { source: 'domain_pack', questionTerms: [] },
      freshness: { source: 'domain_pack', questionTerms: [] },
      stop_criteria: { source: 'domain_pack', questionTerms: [] },
      outline: { source: 'domain_pack', questionTerms: [] },
      budget: { source: 'operator', questionTerms: [] },
    },
    proposerWork: {
      workId: 'work-planner-1',
      workDigest: digest('work'),
      rawResponseDigest: digest('raw'),
      role: 'plan_proposer',
      profileVersionId: 'profile-planner/1',
      profileFamilyId: 'family-a',
    },
    proposedAt: NOW,
  });
  return {
    ...identity,
    proposalDigest: canonicalDigest(identity),
  } as ResearchPlanProposal;
}

describe('p9 plan authority', () => {
  it('publishes four digest-bound distinct domain policy packs', () => {
    const packs = Object.values(P9_DOMAIN_POLICY_PACKS);
    expect(packs).toHaveLength(4);
    expect(new Set(packs.map((pack) => pack.packDigest)).size).toBe(4);
    for (const pack of packs) {
      const identity = { ...pack, packDigest: undefined };
      expect(pack.packDigest).toBe(canonicalDigest(identity));
    }
  });

  it('extracts material question terms without stopwords', () => {
    const terms = materialQuestionTerms(
      'Which models could execute safely on limited memory hardware?',
    );
    expect(terms).toContain('models');
    expect(terms).toContain('memory');
    expect(terms).not.toContain('which');
    expect(terms).not.toContain('could');
    expect(terms).not.toContain('on');
  });

  it('accepts a fully question-derived proposal', () => {
    const result = acceptResearchPlan({
      proposal: buildProposal(),
      thresholds: THRESHOLDS,
      decidedAt: NOW,
      actorId: 'operator-1',
    });
    expect(result.receipt.decision).toBe('accepted');
    expect(result.receipt.reasonCodes).toEqual(['plan_policy_satisfied']);
    expect(result.receipt.acceptancePolicyId).toBe(
      P9_PLAN_ACCEPTANCE_POLICY_ID,
    );
    expect(result.plan).not.toBeNull();
    expect(result.plan?.revision).toBe(1);
    expect(result.plan?.previousPlanDigest).toBeNull();
    expect(result.receipt.planDigest).toBe(result.plan?.planDigest);
  });

  it('rejects proposals below structural thresholds', () => {
    const reasons = validateResearchPlanProposal(
      buildProposal(),
      P9_DOMAIN_POLICY_PACKS['technical-due-diligence/v1'],
      {
        ...THRESHOLDS,
        minSubquestions: 3,
        minSourceClasses: 4,
        minContradictionRequirements: 2,
      },
    );
    expect(reasons).toContain('subquestions_below_minimum');
    expect(reasons).toContain('source_classes_below_minimum');
    expect(reasons).toContain('contradictions_below_minimum');
  });

  it('rejects pack identity mismatches with fail-closed receipts', () => {
    const packIdMismatch = validateResearchPlanProposal(
      buildProposal((identity) => ({
        ...identity,
        domainPackId: 'public-policy/v1',
      })),
      P9_DOMAIN_POLICY_PACKS['technical-due-diligence/v1'],
      THRESHOLDS,
    );
    expect(packIdMismatch).toContain('pack_id_mismatch');

    const digestMismatch = acceptResearchPlan({
      proposal: buildProposal((identity) => ({
        ...identity,
        packDigest: digest('wrong-pack-digest'),
      })),
      thresholds: THRESHOLDS,
      decidedAt: NOW,
      actorId: 'operator-1',
    });
    expect(digestMismatch.plan).toBeNull();
    expect(digestMismatch.receipt.decision).toBe('rejected');
    expect(digestMismatch.receipt.reasonCodes).toContain(
      'pack_digest_mismatch',
    );
  });

  it('rejects budgets that exceed operator authorization or lack it', () => {
    const overBudget = validateResearchPlanProposal(
      buildProposal(),
      P9_DOMAIN_POLICY_PACKS['technical-due-diligence/v1'],
      { ...THRESHOLDS, maxAuthorizedUsd: 4 },
    );
    expect(overBudget).toContain('budget_exceeds_authorized');
    const unauthorized = validateResearchPlanProposal(
      buildProposal((identity) => ({
        ...identity,
        derivations: {
          ...(identity.derivations as Record<string, unknown>),
          budget: { source: 'domain_pack', questionTerms: [] },
        },
      })),
      P9_DOMAIN_POLICY_PACKS['technical-due-diligence/v1'],
      THRESHOLDS,
    );
    expect(unauthorized).toContain('budget_not_operator_authorized');
  });

  it('requires pack-mandated source classes', () => {
    const reasons = validateResearchPlanProposal(
      buildProposal((identity) => ({
        ...identity,
        sourceClassTargets: (
          identity.sourceClassTargets as readonly { sourceClass: string }[]
        ).filter((target) => target.sourceClass !== 'security_advisory'),
      })),
      P9_DOMAIN_POLICY_PACKS['technical-due-diligence/v1'],
      THRESHOLDS,
    );
    expect(reasons).toContain(
      'pack_required_source_class_missing:security_advisory',
    );
  });

  it('requires mandatory subquestions to be covered and queried', () => {
    const reasons = validateResearchPlanProposal(
      buildProposal((identity) => ({
        ...identity,
        coverageRequirements: (
          identity.coverageRequirements as readonly { coverageId: string }[]
        ).filter((coverage) => coverage.coverageId !== 'cov-2'),
        searchQueries: (
          identity.searchQueries as readonly { queryId: string }[]
        ).filter((query) => query.queryId !== 'q-2'),
      })),
      P9_DOMAIN_POLICY_PACKS['technical-due-diligence/v1'],
      THRESHOLDS,
    );
    expect(reasons).toContain('subquestion_uncovered:sq-2');
    expect(reasons).toContain('subquestion_unqueried:sq-2');
  });

  it('rejects template swaps where content ignores the question', () => {
    const reasons = validateResearchPlanProposal(
      buildProposal((identity) => ({
        ...identity,
        question:
          'What can current human evidence establish about health effects of microplastic exposure?',
      })),
      P9_DOMAIN_POLICY_PACKS['technical-due-diligence/v1'],
      THRESHOLDS,
    );
    expect(reasons).toContain('derivation_term_not_in_question:scope');
    expect(reasons).toContain('derivation_term_not_in_question:subquestions');
    expect(reasons).toContain('derivation_term_not_in_question:search_queries');
    expect(reasons).toContain('insufficient_question_derivation');
  });

  it('rejects forbidden template vocabulary unless the question uses it', () => {
    const injectQuery = (identity: Identity): Identity => ({
      ...identity,
      searchQueries: [
        ...(identity.searchQueries as readonly unknown[]),
        {
          queryId: 'q-3',
          query: 'data center cooling economics',
          subquestionIds: ['sq-1'],
        },
      ],
    });
    const rejected = validateResearchPlanProposal(
      buildProposal(injectQuery),
      P9_DOMAIN_POLICY_PACKS['technical-due-diligence/v1'],
      THRESHOLDS,
    );
    expect(rejected).toContain('template_vocabulary:data center');
    const exempted = validateResearchPlanProposal(
      buildProposal((identity) =>
        injectQuery({
          ...identity,
          question: `${identity.question as string} Consider running inside a data center.`,
        }),
      ),
      P9_DOMAIN_POLICY_PACKS['technical-due-diligence/v1'],
      THRESHOLDS,
    );
    expect(
      exempted.filter((reason) => reason.startsWith('template_vocabulary:')),
    ).toEqual([]);
  });

  it('requires question-derived groups to declare question derivation', () => {
    const reasons = validateResearchPlanProposal(
      buildProposal((identity) => ({
        ...identity,
        derivations: {
          ...(identity.derivations as Record<string, unknown>),
          scope: { source: 'domain_pack', questionTerms: [] },
        },
      })),
      P9_DOMAIN_POLICY_PACKS['technical-due-diligence/v1'],
      THRESHOLDS,
    );
    expect(reasons).toContain('group_not_question_derived:scope');
  });

  it('produces a rejected receipt (fail closed) for invalid proposals', () => {
    const result = acceptResearchPlan({
      proposal: buildProposal((identity) => ({
        ...identity,
        question:
          'What can current human evidence establish about health effects of microplastic exposure?',
      })),
      thresholds: THRESHOLDS,
      decidedAt: NOW,
      actorId: 'operator-1',
    });
    expect(result.plan).toBeNull();
    expect(result.receipt.decision).toBe('rejected');
    expect(result.receipt.planId).toBeNull();
    expect(result.receipt.reasonCodes).toContain(
      'insufficient_question_derivation',
    );
  });

  it('previews plans deterministically', () => {
    const proposal = buildProposal();
    const first = previewResearchPlan(proposal);
    const second = previewResearchPlan(proposal);
    expect(first.previewDigest).toBe(
      'sha256:d74160bc66bd975f45d295fd496c67d11a056f6aae52297639573ceb802540de',
    );
    expect(first.previewDigest).toBe(second.previewDigest);
    const different = previewResearchPlan(
      buildProposal((identity) => ({
        ...identity,
        budget: {
          currencyUsd: 5,
          searchUsd: 0.5,
          retrievalParsingUsd: 1,
          modelsUsd: 3.5,
        },
      })),
    );
    expect(different.previewDigest).not.toBe(first.previewDigest);
  });

  it('rejects revisions without material change', () => {
    const accepted = acceptResearchPlan({
      proposal: buildProposal(),
      thresholds: THRESHOLDS,
      decidedAt: NOW,
      actorId: 'operator-1',
    });
    expect(accepted.plan).not.toBeNull();
    if (accepted.plan === null) throw new Error('expected accepted plan');
    const result = reviseResearchPlan({
      currentPlan: accepted.plan,
      proposal: buildProposal((identity) => ({
        ...identity,
        proposalId: 'proposal-technical-2',
      })),
      thresholds: THRESHOLDS,
      decidedAt: NOW,
      actorId: 'operator-1',
    });
    expect(result.plan).toBeNull();
    expect(result.revisionRecord).toBeNull();
    expect(result.receipt.reasonCodes).toEqual([
      'revision_without_material_change',
    ]);
  });

  it('creates a linked revision that invalidates downstream work', () => {
    const accepted = acceptResearchPlan({
      proposal: buildProposal(),
      thresholds: THRESHOLDS,
      decidedAt: NOW,
      actorId: 'operator-1',
    });
    expect(accepted.plan).not.toBeNull();
    if (accepted.plan === null) throw new Error('expected accepted plan');
    const revisedProposal = buildProposal((identity) => ({
      ...identity,
      proposalId: 'proposal-technical-2',
      budget: {
        currencyUsd: 5,
        searchUsd: 0.5,
        retrievalParsingUsd: 1,
        modelsUsd: 3.5,
      },
    }));
    expect(changedPlanFieldGroups(accepted.plan, revisedProposal)).toEqual([
      'budget',
    ]);
    const result = reviseResearchPlan({
      currentPlan: accepted.plan,
      proposal: revisedProposal,
      thresholds: THRESHOLDS,
      decidedAt: NOW,
      actorId: 'operator-1',
    });
    expect(result.receipt.decision).toBe('accepted');
    expect(result.plan?.revision).toBe(2);
    expect(result.plan?.previousPlanDigest).toBe(accepted.plan.planDigest);
    expect(result.plan?.planDigest).not.toBe(accepted.plan.planDigest);
    expect(result.revisionRecord?.changedFieldGroups).toEqual(['budget']);
    expect(result.revisionRecord?.invalidatesDownstreamWork).toBe(true);
    expect(result.revisionRecord?.previousPlanDigest).toBe(
      accepted.plan.planDigest,
    );
    expect(result.revisionRecord?.newPlanDigest).toBe(result.plan?.planDigest);
  });

  it('refuses to treat a new question as a revision', () => {
    const accepted = acceptResearchPlan({
      proposal: buildProposal(),
      thresholds: THRESHOLDS,
      decidedAt: NOW,
      actorId: 'operator-1',
    });
    expect(accepted.plan).not.toBeNull();
    if (accepted.plan === null) throw new Error('expected accepted plan');
    const acceptedPlan = accepted.plan;
    expect(() =>
      reviseResearchPlan({
        currentPlan: acceptedPlan,
        proposal: buildProposal((identity) => ({
          ...identity,
          proposalId: 'proposal-technical-3',
          question: 'A completely new research question about colibri memory?',
        })),
        thresholds: THRESHOLDS,
        decidedAt: NOW,
        actorId: 'operator-1',
      }),
    ).toThrow(GovernanceError);
  });
});
