import { describe, expect, it } from 'vitest';
import {
  canonicalDigest,
  FreshnessRequirementSchema,
  PlanAcceptanceReceiptSchema,
  PlanBudgetAllocationSchema,
  PlanFieldDerivationSchema,
  PlanRevisionRecordSchema,
  ResearchPlanProposalSchema,
  ResearchPlanSchema,
} from '../src/index.js';

const NOW = '2026-07-15T02:00:00.000Z';

const digest = (seed: string): string => canonicalDigest({ seed });

function planContentFixture() {
  return {
    question:
      'Can the colibri runtime execute large models safely on limited memory hardware?',
    domainPackId: 'technical-due-diligence/v1' as const,
    packDigest: digest('pack'),
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
    criticalClaimPolicy:
      'independent_entailment_distinct_profile_family' as const,
    derivations: {
      scope: {
        source: 'question' as const,
        questionTerms: ['colibri', 'memory'],
      },
      subquestions: {
        source: 'question' as const,
        questionTerms: ['colibri', 'memory', 'models'],
      },
      coverage: { source: 'domain_pack' as const, questionTerms: [] },
      source_classes: { source: 'domain_pack' as const, questionTerms: [] },
      search_queries: {
        source: 'question' as const,
        questionTerms: ['colibri', 'runtime', 'memory', 'hardware'],
      },
      contradictions: { source: 'domain_pack' as const, questionTerms: [] },
      freshness: { source: 'domain_pack' as const, questionTerms: [] },
      stop_criteria: { source: 'domain_pack' as const, questionTerms: [] },
      outline: { source: 'domain_pack' as const, questionTerms: [] },
      budget: { source: 'operator' as const, questionTerms: [] },
    },
  };
}

type ProposalIdentity = Record<string, unknown>;

function buildProposal(
  mutate: (identity: ProposalIdentity) => ProposalIdentity = (identity) =>
    identity,
) {
  const identity = mutate({
    schemaVersion: '1.0.0',
    contractFamily: 'p9.v1',
    proposalId: 'proposal-1',
    ...planContentFixture(),
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
  return { ...identity, proposalDigest: canonicalDigest(identity) };
}

function buildPlan(
  mutate: (identity: ProposalIdentity) => ProposalIdentity = (identity) =>
    identity,
) {
  const identity = mutate({
    schemaVersion: '1.0.0',
    contractFamily: 'p9.v1',
    planId: 'plan-1',
    revision: 1,
    previousPlanDigest: null,
    proposalId: 'proposal-1',
    proposalDigest: digest('proposal'),
    ...planContentFixture(),
    acceptancePolicyId: 'p9-plan-acceptance/v1',
    acceptedAt: NOW,
    acceptedBy: 'operator-1',
  });
  return { ...identity, planDigest: canonicalDigest(identity) };
}

function buildReceipt(
  mutate: (identity: ProposalIdentity) => ProposalIdentity = (identity) =>
    identity,
) {
  const identity = mutate({
    schemaVersion: '1.0.0',
    contractFamily: 'p9.v1',
    receiptId: 'receipt-1',
    proposalId: 'proposal-1',
    proposalDigest: digest('proposal'),
    packId: 'technical-due-diligence/v1',
    packDigest: digest('pack'),
    decision: 'rejected',
    planId: null,
    planDigest: null,
    reasonCodes: ['subquestions_below_minimum'],
    policyThresholds: {
      minSubquestions: 4,
      minSourceClasses: 3,
      minContradictionRequirements: 1,
      maxAuthorizedUsd: 5,
      minQuestionDerivedTerms: 4,
    },
    acceptancePolicyId: 'p9-plan-acceptance/v1',
    decidedAt: NOW,
    actorId: 'operator-1',
  });
  return { ...identity, receiptDigest: canonicalDigest(identity) };
}

describe('p9 planning contracts', () => {
  it('accepts a digest-bound proposal and rejects tampering', () => {
    const proposal = buildProposal();
    expect(() => ResearchPlanProposalSchema.parse(proposal)).not.toThrow();
    expect(() =>
      ResearchPlanProposalSchema.parse({
        ...proposal,
        question: 'A different question entirely about tampering?',
      }),
    ).toThrow(/proposal digest/u);
  });

  it('rejects unknown fields via closed schemas', () => {
    const proposal = buildProposal((identity) => ({
      ...identity,
      futureField: 'unexpected',
    }));
    expect(() => ResearchPlanProposalSchema.parse(proposal)).toThrow(
      /unrecognized key/iu,
    );
  });

  it('constrains derivation question terms by source', () => {
    expect(() =>
      PlanFieldDerivationSchema.parse({
        source: 'question',
        questionTerms: [],
      }),
    ).toThrow(/at least one question term/u);
    expect(() =>
      PlanFieldDerivationSchema.parse({
        source: 'operator',
        questionTerms: ['memory'],
      }),
    ).toThrow(/only question-derived/u);
    expect(() =>
      PlanFieldDerivationSchema.parse({
        source: 'question',
        questionTerms: ['memory'],
      }),
    ).not.toThrow();
  });

  it('requires freshness to bound age or require an as-of date', () => {
    const base = {
      freshnessId: 'fresh-x',
      appliesTo: 'statistics',
    };
    expect(() =>
      FreshnessRequirementSchema.parse({
        ...base,
        maxAgeDays: null,
        asOfDateRequired: false,
      }),
    ).toThrow(/bound age or require/u);
    expect(() =>
      FreshnessRequirementSchema.parse({
        ...base,
        maxAgeDays: null,
        asOfDateRequired: true,
      }),
    ).not.toThrow();
    expect(() =>
      FreshnessRequirementSchema.parse({
        ...base,
        maxAgeDays: 30,
        asOfDateRequired: false,
      }),
    ).not.toThrow();
  });

  it('rejects budget allocations exceeding the authorized total', () => {
    expect(() =>
      PlanBudgetAllocationSchema.parse({
        currencyUsd: 5,
        searchUsd: 2,
        retrievalParsingUsd: 2,
        modelsUsd: 2,
      }),
    ).toThrow(/cannot exceed/u);
  });

  it('enforces plan revision linkage', () => {
    expect(() => ResearchPlanSchema.parse(buildPlan())).not.toThrow();
    expect(() =>
      ResearchPlanSchema.parse(
        buildPlan((identity) => ({
          ...identity,
          previousPlanDigest: digest('previous'),
        })),
      ),
    ).toThrow(/first plan revision/u);
    expect(() =>
      ResearchPlanSchema.parse(
        buildPlan((identity) => ({ ...identity, revision: 2 })),
      ),
    ).toThrow(/must link the previous plan digest/u);
  });

  it('enforces referential integrity across plan structures', () => {
    expect(() =>
      ResearchPlanProposalSchema.parse(
        buildProposal((identity) => ({
          ...identity,
          coverageRequirements: [
            {
              coverageId: 'cov-x',
              subquestionId: 'sq-missing',
              description: 'Dangling coverage.',
              mandatory: true,
            },
          ],
        })),
      ),
    ).toThrow(/references unknown subquestion/u);
    expect(() =>
      ResearchPlanProposalSchema.parse(
        buildProposal((identity) => ({
          ...identity,
          searchQueries: [
            {
              queryId: 'q-x',
              query: 'colibri runtime memory',
              subquestionIds: ['sq-missing'],
            },
          ],
        })),
      ),
    ).toThrow(/references unknown subquestion/u);
    const duplicatedSubquestion = planContentFixture().subquestions[0];
    const duplicated = buildProposal((identity) => ({
      ...identity,
      subquestions: [duplicatedSubquestion, duplicatedSubquestion],
    }));
    expect(() => ResearchPlanProposalSchema.parse(duplicated)).toThrow(
      /subquestion ids must be unique/u,
    );
    for (const [field, message] of [
      ['coverageRequirements', /coverage ids must be unique/u],
      ['searchQueries', /query ids must be unique/u],
      ['contradictionRequirements', /contradiction ids must be unique/u],
      ['freshnessRequirements', /freshness ids must be unique/u],
      ['stopCriteria', /stop criterion ids must be unique/u],
    ] as const) {
      const values = planContentFixture()[field];
      expect(() =>
        ResearchPlanProposalSchema.parse(
          buildProposal((identity) => ({
            ...identity,
            [field]: [values[0], values[0]],
          })),
        ),
      ).toThrow(message);
    }
    const duplicatedExclusion = planContentFixture().scope.exclusions[0];
    expect(() =>
      ResearchPlanProposalSchema.parse(
        buildProposal((identity) => ({
          ...identity,
          scope: {
            ...(identity.scope as Record<string, unknown>),
            exclusions: [duplicatedExclusion, duplicatedExclusion],
          },
        })),
      ),
    ).toThrow(/exclusion ids must be unique/u);
    const duplicatedSection = planContentFixture().reportOutline.sections[0];
    expect(() =>
      ResearchPlanProposalSchema.parse(
        buildProposal((identity) => ({
          ...identity,
          reportOutline: {
            sections: [duplicatedSection, duplicatedSection],
          },
        })),
      ),
    ).toThrow(/report section ids must be unique/u);
  });

  it('binds acceptance receipts to the decision outcome', () => {
    expect(() =>
      PlanAcceptanceReceiptSchema.parse(buildReceipt()),
    ).not.toThrow();
    expect(() =>
      PlanAcceptanceReceiptSchema.parse(
        buildReceipt((identity) => ({
          ...identity,
          decision: 'accepted',
          reasonCodes: ['plan_policy_satisfied'],
        })),
      ),
    ).toThrow(/must bind the accepted plan identity/u);
    expect(() =>
      PlanAcceptanceReceiptSchema.parse(
        buildReceipt((identity) => ({
          ...identity,
          planDigest: digest('plan'),
        })),
      ),
    ).toThrow(/rejected plan receipt cannot claim/u);
    expect(() =>
      PlanAcceptanceReceiptSchema.parse(
        buildReceipt((identity) => ({
          ...identity,
          decision: 'accepted',
          planId: 'plan-1',
          planDigest: digest('plan'),
          reasonCodes: ['budget_exceeds_authorized'],
        })),
      ),
    ).toThrow(/only use acceptance reasons/u);
    expect(() =>
      PlanAcceptanceReceiptSchema.parse(
        buildReceipt((identity) => ({
          ...identity,
          reasonCodes: ['plan_policy_satisfied'],
        })),
      ),
    ).toThrow(/only use rejection reasons/u);
  });

  it('requires plan revisions to change the plan identity', () => {
    const identity = {
      schemaVersion: '1.0.0',
      contractFamily: 'p9.v1',
      revisionId: 'plan-revision:plan-1:2',
      previousPlanId: 'plan-1',
      previousPlanDigest: digest('same'),
      newPlanId: 'plan-1',
      newPlanDigest: digest('same'),
      changedFieldGroups: ['budget'],
      invalidatesDownstreamWork: true,
      revisedAt: NOW,
      actorId: 'operator-1',
    };
    expect(() =>
      PlanRevisionRecordSchema.parse({
        ...identity,
        revisionDigest: canonicalDigest(identity),
      }),
    ).toThrow(/must change the plan identity/u);
    const changed = {
      ...identity,
      newPlanDigest: digest('different'),
    };
    expect(() =>
      PlanRevisionRecordSchema.parse({
        ...changed,
        revisionDigest: canonicalDigest(changed),
      }),
    ).not.toThrow();
    expect(() =>
      PlanRevisionRecordSchema.parse({
        ...changed,
        changedFieldGroups: ['budget', 'budget'],
        revisionDigest: canonicalDigest({
          ...changed,
          changedFieldGroups: ['budget', 'budget'],
        }),
      }),
    ).toThrow(/changed field groups must be unique/u);
  });
});
