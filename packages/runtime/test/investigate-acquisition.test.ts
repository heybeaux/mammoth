import { canonicalDigest, type InvestigationPlan } from '@mammoth/domain';
import {
  bindApprovedInvestigationPlan,
  recordInvestigationApproval,
} from '@mammoth/governance';
import { describe, expect, it } from 'vitest';
import {
  deriveAcquisitionIntents,
  evaluateAcquisitionRelease,
  planInvestigation,
} from '../src/index.js';

const NOW = '2026-07-16T12:00:00.000Z';
const TRUSTED_ISSUER = 'issuer:trusted-test';

const questions = [
  'How can rural clinics keep vaccine cold chains reliable during extended power outages?',
  'What would it take for community land trusts to stabilize housing costs in mid-sized cities?',
  'Do seagrass restoration projects meaningfully offset coastal carbon emissions at scale?',
] as const;

function boundPlan(question: string): InvestigationPlan {
  const preview = planInvestigation(question);
  const approval = recordInvestigationApproval({
    approvalId: `approval:${preview.investigationId}`,
    investigationId: preview.investigationId,
    previewDigest: preview.previewDigest,
    decision: 'approve',
    actorId: 'operator:test',
    actorKind: 'human_operator',
    reason: 'test approval for acquisition composition',
    decidedAt: '2026-07-16T00:00:00.000Z',
  });
  const result = bindApprovedInvestigationPlan({ preview, approval });
  if (!result.plan) {
    throw new Error(
      `plan binding rejected: ${result.receipt.reasonCodes.join(',')}`,
    );
  }
  return result.plan;
}

function scopedAuthority(
  planDigest: string,
  question: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const consumptionNonce = 'nonce-0123456789abcdef';
  const executionId = 'execution:test';
  const questionDigest = canonicalDigest(question);
  const identity = {
    schemaVersion: '1.0.0',
    contractFamily: 'p9.v1',
    authorityId: 'authority:test',
    issuerId: TRUSTED_ISSUER,
    decision: 'authorized',
    reason: 'test scoped acquisition authority',
    executionId,
    executionDigest: canonicalDigest({
      executionId,
      planDigest,
      questionDigest,
      consumptionNonce,
    }),
    consumptionNonce,
    consumptionStoreId: 'store:test',
    consumptionStoreDigest: canonicalDigest({
      kind: 'p9-consumption-store/v1',
      id: 'store:test',
    }),
    maximumExecutions: 1,
    planScope: {
      proposalId: 'proposal:test',
      proposalDigest: canonicalDigest('proposal:test'),
      planId: 'plan:test',
      planDigest,
      acceptanceReceiptDigest: canonicalDigest('acceptance:test'),
      question,
      questionDigest,
      domainPackId: 'general-web/v1',
      packDigest: canonicalDigest('pack:test'),
      budgetAllocation: {
        currencyUsd: 5,
        searchUsd: 1,
        retrievalParsingUsd: 2,
        modelsUsd: 2,
      },
    },
    priceCatalogId: 'price-catalog:test',
    priceCatalogVersion: '1',
    priceCatalogDigest: canonicalDigest('price-catalog:test'),
    providerProfileCatalogId: 'profile-catalog:test',
    providerProfileCatalogVersion: '1',
    providerProfileCatalogDigest: canonicalDigest('profile-catalog:test'),
    sourceClassificationPolicyDigest: canonicalDigest('source-policy:test'),
    authorizedProfileIds: [
      'profile:search',
      'profile:retrieval',
      'profile:parser',
      'profile:proposer',
      'profile:evaluator',
    ],
    proposerProfileId: 'profile:proposer',
    evaluatorProfileId: 'profile:evaluator',
    budgetLimit: {
      currencyUsd: 5,
      requests: 10,
      inputTokens: 1_000,
      outputTokens: 1_000,
      bytes: 100_000,
      durationMs: 60_000,
    },
    authorizedEffectKinds: ['search', 'retrieval', 'parser', 'model'],
    authorizedDestinationOrigins: ['https://api.example.com'],
    authorizedRetrievalOrigins: ['https://example.org'],
    authorizedBillingAccountIds: ['billing:test'],
    actorId: 'operator:test',
    authorizedAt: '2026-07-16T00:00:00.000Z',
    notBeforeAt: '2026-07-16T00:00:00.000Z',
    expiresAt: '2026-07-18T00:00:00.000Z',
    ...overrides,
  };
  return { ...identity, receiptDigest: canonicalDigest(identity) };
}

describe('investigation plan acquisition composition', () => {
  it('derives deterministic generic intents verbatim from the digest-bound plan', () => {
    const plan = boundPlan(questions[0]);
    const first = deriveAcquisitionIntents(plan);
    const second = deriveAcquisitionIntents(
      JSON.parse(JSON.stringify(plan)) as unknown,
    );
    expect(second).toEqual(first);
    expect(first.planDigest).toBe(plan.planDigest);
    expect(first.sourcePreviewDigest).toBe(plan.sourcePreviewDigest);
    expect(first.effectAuthority).toBe('none_granted');
    expect(first.executionAuthorized).toBe(false);
    expect(first.externalEffectsExecuted).toBe(false);
    const discovery = first.intents.filter(
      (intent) => intent.kind === 'discovery.search',
    );
    const acquisition = first.intents.filter(
      (intent) => intent.kind === 'acquisition.preserve',
    );
    expect(discovery.map((intent) => intent.subject)).toEqual([
      ...plan.plan.searchQueries,
    ]);
    expect(acquisition).toHaveLength(discovery.length);
    for (const [index, intent] of acquisition.entries()) {
      expect(intent.dependsOn).toEqual([discovery[index]?.intentId]);
      expect(intent.constraints).toEqual([...plan.plan.evidenceRequirements]);
    }
    expect(first.coverage.subquestions).toEqual([...plan.plan.subquestions]);
  });

  it('fails closed on any plan drift or forged plan digest', () => {
    const plan = boundPlan(questions[0]);
    expect(() =>
      deriveAcquisitionIntents({
        ...plan,
        question: `${plan.question} tampered`,
      }),
    ).toThrowError(/plan digest/u);
    expect(() =>
      deriveAcquisitionIntents({
        ...plan,
        planDigest: canonicalDigest('forged'),
      }),
    ).toThrowError(/plan digest/u);
    expect(() =>
      deriveAcquisitionIntents({
        ...plan,
        plan: {
          ...plan.plan,
          searchQueries: ['attacker-injected query', 'second injected query'],
        },
      }),
    ).toThrowError(/plan digest/u);
  });

  it('produces structurally valid but distinct intents for unrelated questions', () => {
    const intentSets = questions.map((question) =>
      deriveAcquisitionIntents(boundPlan(question)),
    );
    expect(new Set(intentSets.map((set) => set.intentSetDigest)).size).toBe(
      questions.length,
    );
    const allIds = intentSets.flatMap((set) =>
      set.intents.map((intent) => intent.intentId),
    );
    expect(new Set(allIds).size).toBe(allIds.length);
    expect(
      new Set(
        intentSets.map((set) =>
          set.intents.map((intent) => intent.subject).join('\n'),
        ),
      ).size,
    ).toBe(questions.length);
  });

  it('refuses release with no scoped effect authority', () => {
    const intentSet = deriveAcquisitionIntents(boundPlan(questions[1]));
    const release = evaluateAcquisitionRelease({ intentSet, now: NOW });
    expect(release.decision).toBe('refused');
    expect(release.reasonCodes).toEqual(['no_scoped_effect_authority']);
    expect(release.authorityReceiptDigest).toBeNull();
    expect(release.externalEffectsExecuted).toBe(false);
  });

  it('never grants implicit authority: wrong scope, forged, untrusted, and expired all refuse', () => {
    const intentSet = deriveAcquisitionIntents(boundPlan(questions[1]));
    const wrongPlan = evaluateAcquisitionRelease({
      intentSet,
      effectAuthority: scopedAuthority(
        canonicalDigest('some-other-plan'),
        intentSet.question,
      ),
      trustedIssuerId: TRUSTED_ISSUER,
      now: NOW,
    });
    expect(wrongPlan.decision).toBe('refused');
    expect(wrongPlan.reasonCodes).toContain('authority_plan_scope_mismatch');

    const wrongQuestion = evaluateAcquisitionRelease({
      intentSet,
      effectAuthority: scopedAuthority(
        intentSet.planDigest,
        'A completely different authorized question than the plan states.',
      ),
      trustedIssuerId: TRUSTED_ISSUER,
      now: NOW,
    });
    expect(wrongQuestion.decision).toBe('refused');
    expect(wrongQuestion.reasonCodes).toContain(
      'authority_question_scope_mismatch',
    );

    const valid = scopedAuthority(intentSet.planDigest, intentSet.question);
    const forged = evaluateAcquisitionRelease({
      intentSet,
      effectAuthority: { ...valid, receiptDigest: canonicalDigest('forged') },
      trustedIssuerId: TRUSTED_ISSUER,
      now: NOW,
    });
    expect(forged.decision).toBe('refused');
    expect(forged.reasonCodes).toEqual(['invalid_effect_authority_receipt']);

    const untrusted = evaluateAcquisitionRelease({
      intentSet,
      effectAuthority: valid,
      trustedIssuerId: 'issuer:someone-else',
      now: NOW,
    });
    expect(untrusted.decision).toBe('refused');
    expect(untrusted.reasonCodes).toEqual(['untrusted_authority_issuer']);

    const noIssuerPinned = evaluateAcquisitionRelease({
      intentSet,
      effectAuthority: valid,
      now: NOW,
    });
    expect(noIssuerPinned.decision).toBe('refused');
    expect(noIssuerPinned.reasonCodes).toEqual(['no_trusted_authority_issuer']);

    const expired = evaluateAcquisitionRelease({
      intentSet,
      effectAuthority: valid,
      trustedIssuerId: TRUSTED_ISSUER,
      now: '2026-07-19T00:00:00.000Z',
    });
    expect(expired.decision).toBe('refused');
    expect(expired.reasonCodes).toEqual(['authority_expired']);

    const missingEffectKind = evaluateAcquisitionRelease({
      intentSet,
      effectAuthority: scopedAuthority(
        intentSet.planDigest,
        intentSet.question,
        { authorizedEffectKinds: ['search', 'model'] },
      ),
      trustedIssuerId: TRUSTED_ISSUER,
      now: NOW,
    });
    expect(missingEffectKind.decision).toBe('refused');
    expect(missingEffectKind.reasonCodes).toEqual([
      'authority_missing_required_effect_kind',
    ]);
  });

  it('authorizes release only for an exactly scoped trusted authority and still executes nothing', () => {
    const intentSet = deriveAcquisitionIntents(boundPlan(questions[2]));
    const authority = scopedAuthority(intentSet.planDigest, intentSet.question);
    const release = evaluateAcquisitionRelease({
      intentSet,
      effectAuthority: authority,
      trustedIssuerId: TRUSTED_ISSUER,
      now: NOW,
    });
    expect(release.decision).toBe('authorized');
    expect(release.reasonCodes).toEqual([
      'acquisition_release_policy_satisfied',
    ]);
    expect(release.authorityReceiptDigest).toBe(authority.receiptDigest);
    expect(release.planDigest).toBe(intentSet.planDigest);
    expect(release.intentSetDigest).toBe(intentSet.intentSetDigest);
    expect(release.externalEffectsExecuted).toBe(false);
  });

  it('fails closed when the derived intent set itself is tampered', () => {
    const intentSet = deriveAcquisitionIntents(boundPlan(questions[2]));
    const tampered = {
      ...intentSet,
      intents: intentSet.intents.map((intent, index) =>
        index === 0 ? { ...intent, subject: 'attacker subject' } : intent,
      ),
    };
    expect(() =>
      evaluateAcquisitionRelease({ intentSet: tampered, now: NOW }),
    ).toThrowError(/intent set digest/u);
  });
});
