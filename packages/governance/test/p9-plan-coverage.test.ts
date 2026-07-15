import {
  canonicalDigest,
  P9ClaimAdmissionSchema,
  P9ClaimProposalSchema,
  ResearchPlanSchema,
  RetrievalAttemptSchema,
  type P9ClaimAdmission,
  type P9ClaimProposal,
  type ResearchPlan,
  type RetrievalAttempt,
} from '@mammoth/domain';
import { describe, expect, it } from 'vitest';
import {
  assessPlanCoverage,
  GovernanceError,
  P9_DOMAIN_POLICY_PACKS,
  type P9ClaimEvidenceBinding,
  type PlanCoverageThresholds,
} from '../src/index.js';

const NOW = '2026-07-15T08:00:00.000Z';
const PACK = P9_DOMAIN_POLICY_PACKS['general-web/v1'];
const THRESHOLDS: PlanCoverageThresholds = {
  minAdmittedClaims: 1,
  minCriticalClaims: 0,
  minIndependentFamiliesPerCriticalClaim: 0,
  minMandatorySourceClassCoverageRatio: 1,
};

function buildPlan(asOfDateRequired = false): ResearchPlan {
  const identity = {
    schemaVersion: '1.0.0' as const,
    contractFamily: 'p9.v1' as const,
    planId: 'plan:coverage-test',
    revision: 1,
    previousPlanDigest: null,
    proposalId: 'plan-proposal:test',
    proposalDigest: canonicalDigest({ proposal: 'coverage-test' }),
    question: 'What evidence supports battery storage safety?',
    domainPackId: PACK.packId,
    packDigest: PACK.packDigest,
    scope: { include: ['battery storage safety'], exclusions: [] },
    subquestions: [
      {
        subquestionId: 'sq-safety',
        question: 'What evidence supports battery storage safety?',
        mandatory: true,
      },
    ],
    coverageRequirements: [
      {
        coverageId: 'coverage-safety',
        subquestionId: 'sq-safety',
        description: 'Battery storage safety evidence.',
        mandatory: true,
      },
    ],
    sourceClassTargets: [
      {
        sourceClass: 'primary_source',
        minimumIndependentSources: 1,
        mandatory: true,
      },
    ],
    searchQueries: [
      {
        queryId: 'query-safety',
        query: 'battery storage safety primary evidence',
        subquestionIds: ['sq-safety'],
      },
    ],
    contradictionRequirements: [],
    freshnessRequirements: [
      {
        freshnessId: 'freshness-safety',
        appliesTo: 'battery safety evidence',
        maxAgeDays: asOfDateRequired ? null : 30,
        asOfDateRequired,
      },
    ],
    stopCriteria: [
      { stopId: 'stop-safety', description: 'Safety evidence evaluated.' },
    ],
    reportOutline: {
      sections: [
        { sectionId: 'summary', title: 'Summary' },
        { sectionId: 'evidence', title: 'Evidence' },
        { sectionId: 'limitations', title: 'Limitations' },
      ],
    },
    budget: {
      currencyUsd: 1,
      searchUsd: 0.1,
      retrievalParsingUsd: 0.2,
      modelsUsd: 0.7,
    },
    criticalClaimPolicy:
      'independent_entailment_distinct_profile_family' as const,
    derivations: {
      scope: {
        source: 'question' as const,
        questionTerms: ['battery', 'safety'],
      },
      subquestions: {
        source: 'question' as const,
        questionTerms: ['battery', 'storage', 'safety'],
      },
      coverage: { source: 'domain_pack' as const, questionTerms: [] },
      source_classes: { source: 'domain_pack' as const, questionTerms: [] },
      search_queries: {
        source: 'question' as const,
        questionTerms: ['battery', 'storage', 'safety'],
      },
      contradictions: { source: 'domain_pack' as const, questionTerms: [] },
      freshness: { source: 'domain_pack' as const, questionTerms: [] },
      stop_criteria: { source: 'domain_pack' as const, questionTerms: [] },
      outline: { source: 'domain_pack' as const, questionTerms: [] },
      budget: { source: 'operator' as const, questionTerms: [] },
    },
    acceptancePolicyId: 'p9-plan-acceptance/v1',
    acceptedAt: NOW,
    acceptedBy: 'operator:test',
  };
  return ResearchPlanSchema.parse({
    ...identity,
    planDigest: canonicalDigest(identity),
  });
}

function buildAttempt(): RetrievalAttempt {
  return RetrievalAttemptSchema.parse({
    schemaVersion: '1.0.0',
    contractFamily: 'p9.v1',
    attemptId: 'attempt:safety',
    candidateId: 'candidate:safety',
    effectId: 'effect:safety',
    requestedUrl: 'https://example.test/safety',
    finalUrl: 'https://example.test/safety',
    status: 'admitted',
    startedAt: NOW,
    finishedAt: NOW,
    retrievedAt: NOW,
    publishedAt: null,
    dateObservation: null,
    dateVerdict: null,
    robotsDecision: {
      schemaVersion: '1.0.0',
      contractFamily: 'p9.v1',
      status: 'not_checked',
      policyId: 'robots:test',
      userAgent: 'mammoth-test',
      requestedUrl: 'https://example.test/safety',
      finalUrl: 'https://example.test/safety',
      evaluatedAt: NOW,
      decisionPath: ['offline_fixture'],
    },
    rightsStatus: {
      schemaVersion: '1.0.0',
      contractFamily: 'p9.v1',
      status: 'unknown',
      observationMethod: 'not_observed',
      exactLocator: null,
      sourceValue: null,
      observedAt: NOW,
      policyId: 'rights:test',
    },
    bytes: 100,
    failure: null,
  });
}

function buildProposal(
  statement = 'Battery storage safety evidence supports safe operation.',
) {
  const snapshotDigest = canonicalDigest({
    body: 'battery storage safety evidence',
  });
  const locator = {
    evidenceSpanId: 'span:safety',
    snapshotDigest,
    quoteDigest: canonicalDigest('Battery storage safety evidence.'),
    contextDigest: canonicalDigest('Battery storage safety evidence.'),
    coordinateSpace: 'utf16-code-units/v1',
    startOffset: 0,
    endOffset: 32,
  };
  const identity = {
    schemaVersion: '1.0.0' as const,
    contractFamily: 'p9.v1' as const,
    proposalId: 'claim:safety',
    statement,
    critical: false,
    locator,
    proposerWork: {
      workId: 'work:proposer:safety',
      workDigest: canonicalDigest({ work: 'proposer' }),
      rawResponseDigest: canonicalDigest({ raw: 'proposer' }),
      role: 'claim_proposer' as const,
      profileVersionId: 'profile:proposer',
      profileFamilyId: 'family:proposer',
    },
  };
  return P9ClaimProposalSchema.parse({
    ...identity,
    proposalDigest: canonicalDigest(identity),
  });
}

function buildAdmission(proposal: P9ClaimProposal): P9ClaimAdmission {
  const identity = {
    schemaVersion: '1.0.0' as const,
    contractFamily: 'p9.v1' as const,
    admissionId: `admission:${proposal.proposalId}`,
    proposalId: proposal.proposalId,
    proposalDigest: proposal.proposalDigest,
    verdictId: `verdict:${proposal.proposalId}`,
    verdictDigest: canonicalDigest({ verdict: proposal.proposalId }),
    decision: 'admitted' as const,
    independentProfile: true,
    reasonCodes: ['entailed_and_independent'],
    policyId: 'p9-claim-admission/v1',
    decidedAt: NOW,
  };
  return P9ClaimAdmissionSchema.parse({
    ...identity,
    admissionDigest: canonicalDigest(identity),
  });
}

function buildBinding(statement?: string): P9ClaimEvidenceBinding {
  const proposal = buildProposal(statement);
  const attempt = buildAttempt();
  const evidenceIdentity = {
    candidateId: attempt.candidateId,
    attemptId: attempt.attemptId,
    attemptDigest: canonicalDigest(attempt),
    snapshotDigest: proposal.locator.snapshotDigest,
    subquestionIds: ['sq-safety'],
    sourceClass: 'primary_source',
    sourceFamilyId: 'family:safety',
    claimGroupId: 'group:safety',
    contradictionIds: [] as string[],
    reportSectionId: 'evidence',
  };
  return {
    proposal,
    admission: buildAdmission(proposal),
    evidence: {
      ...evidenceIdentity,
      evidenceDigest: canonicalDigest(evidenceIdentity),
    },
  };
}

function assess(
  options: {
    plan?: ResearchPlan;
    binding?: P9ClaimEvidenceBinding;
    attempts?: RetrievalAttempt[];
    thresholds?: PlanCoverageThresholds;
    stopMet?: boolean;
  } = {},
) {
  const plan = options.plan ?? buildPlan();
  return assessPlanCoverage({
    plan,
    pack: PACK,
    claims: [options.binding ?? buildBinding()],
    attempts: options.attempts ?? [buildAttempt()],
    reportSectionTexts: [
      { sectionId: 'evidence', text: 'Battery storage safety evidence.' },
    ],
    stopCriterionFindings: [
      {
        stopId: 'stop-safety',
        met: options.stopMet ?? true,
        reason:
          options.stopMet === false
            ? 'accepted stop condition failed'
            : 'accepted stop condition met',
      },
    ],
    thresholds: options.thresholds ?? THRESHOLDS,
    assessedAt: NOW,
  });
}

describe('P9 plan-relative coverage authority', () => {
  it('accepts only digest-bound evidence labels linked to the exact attempt', () => {
    expect(assess().verdict).toBe('covered');

    const original = buildBinding();
    const binding = {
      ...original,
      evidence: { ...original.evidence, sourceClass: 'independent_analysis' },
    };
    expect(() => assess({ binding })).toThrow(GovernanceError);

    const unknownClass = buildBinding();
    const identity = {
      ...unknownClass.evidence,
      sourceClass: 'invented_source_class',
      evidenceDigest: undefined,
    };
    const recomputedUnknownClass = {
      ...unknownClass,
      evidence: {
        ...identity,
        evidenceDigest: canonicalDigest(identity),
      } as P9ClaimEvidenceBinding['evidence'],
    };
    const result = assess({ binding: recomputedUnknownClass });
    expect(result.verdict).toBe('insufficient');
    expect(result.sourceClassStatuses[0]?.satisfied).toBe(false);
  });

  it('rejects duplicate claims, attempts, stop findings, and invalid thresholds', () => {
    const binding = buildBinding();
    expect(() =>
      assessPlanCoverage({
        plan: buildPlan(),
        pack: PACK,
        claims: [binding, binding],
        attempts: [buildAttempt()],
        reportSectionTexts: [{ sectionId: 'evidence', text: 'evidence' }],
        stopCriterionFindings: [
          { stopId: 'stop-safety', met: true, reason: 'met' },
        ],
        thresholds: THRESHOLDS,
        assessedAt: NOW,
      }),
    ).toThrow(GovernanceError);
    expect(() =>
      assess({ attempts: [buildAttempt(), buildAttempt()] }),
    ).toThrow(GovernanceError);
    expect(() =>
      assess({ thresholds: { ...THRESHOLDS, minAdmittedClaims: Number.NaN } }),
    ).toThrow(GovernanceError);
    expect(() =>
      assessPlanCoverage({
        plan: buildPlan(),
        pack: PACK,
        claims: [buildBinding()],
        attempts: [buildAttempt()],
        reportSectionTexts: [{ sectionId: 'evidence', text: 'evidence' }],
        stopCriterionFindings: [
          { stopId: 'stop-safety', met: true, reason: 'first' },
          { stopId: 'stop-safety', met: false, reason: 'duplicate' },
        ],
        thresholds: THRESHOLDS,
        assessedAt: NOW,
      }),
    ).toThrow(GovernanceError);
  });

  it('does not count dense but irrelevant admitted prose', () => {
    const result = assess({
      binding: buildBinding(
        'Data center water consumption affects communities.',
      ),
    });
    expect(result.verdict).toBe('insufficient');
    expect(result.admittedClaimCount).toBe(0);
    expect(result.gaps).toContain('coverage_unsupported:coverage-safety');
  });

  it('propagates freshness and failed stop requirements into authoritative gaps', () => {
    const result = assess({ plan: buildPlan(true), stopMet: false });
    expect(result.verdict).toBe('insufficient');
    expect(result.gaps).toContain('freshness_unmet:freshness-safety');
    expect(result.gaps).toContain('stop_criterion_not_met:stop-safety');
  });
});
