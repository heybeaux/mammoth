import { describe, expect, it } from 'vitest';
import {
  canonicalDigest,
  InvestigationApprovalSchema,
  InvestigationPlanBindingReceiptSchema,
  InvestigationPlanSchema,
} from '../src/index.js';

const approvalBody = {
  schemaVersion: '1.0.0' as const,
  contractFamily: 'investigation.approval.v1' as const,
  approvalId: 'approval:test',
  investigationId: 'investigation:test',
  previewDigest: `sha256:${'a'.repeat(64)}`,
  decision: 'approve' as const,
  actorId: 'operator:beaux',
  actorKind: 'human_operator' as const,
  reason: 'Scope and budget reviewed.',
  decidedAt: '2026-07-16T00:00:00.000Z',
};

function makePlanBody() {
  return {
    schemaVersion: '1.0.0' as const,
    contractFamily: 'investigation.plan.v1' as const,
    planId: 'plan:investigation:test',
    investigationId: 'investigation:test',
    revision: 1,
    previousPlanDigest: null,
    sourcePreviewDigest: `sha256:${'a'.repeat(64)}`,
    approvalId: 'approval:test',
    approvalDigest: `sha256:${'b'.repeat(64)}`,
    question: 'How should a complex unfamiliar problem be investigated?',
    interpretation: {
      objective: 'Produce a useful answer.',
      decisionCriterion: 'Prefer well-supported conclusions.',
      constraints: ['No external effects before approval.'],
      unknowns: ['Which evidence matters?'],
      falsifiers: ['A credible counterexample.'],
    },
    team: Array.from({ length: 5 }, (_, index) => ({
      roleId: `role-${String(index)}`,
      title: `Role ${String(index)}`,
      mission: 'Investigate independently.',
      independence: 'Cannot evaluate its own work.',
    })),
    plan: {
      subquestions: ['What is observed?'],
      searchQueries: ['question evidence'],
      evidenceRequirements: ['Capture source lineage.'],
      falsificationChecks: ['Seek counterexamples.'],
      contradictionChecks: ['Preserve disagreement.'],
      reportSections: ['Direct answer'],
      stopCriteria: ['Answer or mark blocked.'],
    },
    requestedAuthority: {
      status: 'not_granted' as const,
      approvalRequired: true as const,
      localProviders: ['local planner'],
      requestedCloudCapabilities: ['research'],
      requestedTools: ['search'],
      requestedNetworkAccess: ['read-only public access'],
      maxTimeMinutes: 30,
      maxSpendUsd: 1,
      externalEffectsExecuted: false as const,
    },
    effectAuthority: 'none_granted' as const,
    experiments: {
      mode: 'design_only' as const,
      executionAuthorized: false as const,
      statement: 'Experiment execution is not authorized.',
    },
    bindingPolicyId: 'investigation-plan-binding/v1',
    acceptedAt: '2026-07-16T00:00:00.000Z',
    acceptedBy: 'operator:beaux',
  };
}

describe('investigation approval contract', () => {
  it('accepts a digest-bound approval and rejects tampered content', () => {
    const approval = {
      ...approvalBody,
      approvalDigest: canonicalDigest(approvalBody),
    };
    expect(InvestigationApprovalSchema.parse(approval)).toEqual(approval);
    expect(() =>
      InvestigationApprovalSchema.parse({
        ...approval,
        decision: 'cancel',
      }),
    ).toThrow(/digest/u);
    expect(() =>
      InvestigationApprovalSchema.parse({
        ...approval,
        actorKind: 'model',
      }),
    ).toThrow(/digest/u);
  });
});

describe('investigation plan contract', () => {
  it('binds the plan digest to the exact executable content', () => {
    const body = makePlanBody();
    const plan = { ...body, planDigest: canonicalDigest(body) };
    expect(InvestigationPlanSchema.parse(plan)).toEqual(plan);
    expect(() =>
      InvestigationPlanSchema.parse({
        ...plan,
        question: `${plan.question} Changed.`,
      }),
    ).toThrow(/digest/u);
    expect(() =>
      InvestigationPlanSchema.parse({
        ...plan,
        sourcePreviewDigest: `sha256:${'c'.repeat(64)}`,
      }),
    ).toThrow(/digest/u);
  });

  it('rejects a plan that grants effect authority', () => {
    const body = { ...makePlanBody(), effectAuthority: 'granted' };
    expect(() =>
      InvestigationPlanSchema.parse({
        ...body,
        planDigest: canonicalDigest(body),
      }),
    ).toThrow(/none_granted/u);
  });

  it('enforces revision and previous-plan consistency', () => {
    const first = {
      ...makePlanBody(),
      previousPlanDigest: `sha256:${'d'.repeat(64)}`,
    };
    expect(() =>
      InvestigationPlanSchema.parse({
        ...first,
        planDigest: canonicalDigest(first),
      }),
    ).toThrow(/previous plan/u);
    const later = { ...makePlanBody(), revision: 2 };
    expect(() =>
      InvestigationPlanSchema.parse({
        ...later,
        planDigest: canonicalDigest(later),
      }),
    ).toThrow(/previous plan digest/u);
  });
});

describe('investigation plan binding receipt contract', () => {
  it('requires accepted receipts to identify the bound plan and rejected receipts to bind none', () => {
    const base = {
      schemaVersion: '1.0.0' as const,
      contractFamily: 'investigation.plan.v1' as const,
      receiptId: 'plan-binding:approval:test',
      investigationId: 'investigation:test',
      previewDigest: `sha256:${'a'.repeat(64)}`,
      approvalId: 'approval:test',
      approvalDigest: `sha256:${'b'.repeat(64)}`,
      bindingPolicyId: 'investigation-plan-binding/v1',
      decidedAt: '2026-07-16T00:00:00.000Z',
      actorId: 'operator:beaux',
    };
    const acceptedBody = {
      ...base,
      decision: 'accepted' as const,
      planId: 'plan:investigation:test',
      planDigest: `sha256:${'e'.repeat(64)}`,
      reasonCodes: ['plan_binding_policy_satisfied'],
    };
    const accepted = {
      ...acceptedBody,
      receiptDigest: canonicalDigest(acceptedBody),
    };
    expect(InvestigationPlanBindingReceiptSchema.parse(accepted)).toEqual(
      accepted,
    );
    expect(() =>
      InvestigationPlanBindingReceiptSchema.parse({
        ...accepted,
        decision: 'rejected',
      }),
    ).toThrow(/digest/u);

    const acceptedWithoutPlan = {
      ...acceptedBody,
      planId: null,
      planDigest: null,
    };
    expect(() =>
      InvestigationPlanBindingReceiptSchema.parse({
        ...acceptedWithoutPlan,
        receiptDigest: canonicalDigest(acceptedWithoutPlan),
      }),
    ).toThrow(/bound plan/u);

    const rejectedWithPlan = {
      ...acceptedBody,
      decision: 'rejected' as const,
      reasonCodes: ['approval_preview_drift'],
    };
    expect(() =>
      InvestigationPlanBindingReceiptSchema.parse({
        ...rejectedWithPlan,
        receiptDigest: canonicalDigest(rejectedWithPlan),
      }),
    ).toThrow(/bound plan/u);
  });
});
