import {
  canonicalDigest,
  InvestigationPlanSchema,
  InvestigationPreviewSchema,
  type InvestigationPreview,
} from '@mammoth/domain';
import { describe, expect, it } from 'vitest';
import {
  bindApprovedInvestigationPlan,
  INVESTIGATION_PLAN_BINDING_POLICY_ID,
  recordInvestigationApproval,
  type InvestigationApprovalInput,
} from '../src/index.js';

function makePreview(): InvestigationPreview {
  const body = {
    schemaVersion: '1.0.0' as const,
    contractFamily: 'investigation.preview.v1' as const,
    investigationId: 'investigation:test',
    question: 'How should a complex unfamiliar problem be investigated?',
    interpretation: {
      objective: 'Produce a useful answer.',
      decisionCriterion: 'Prefer well-supported conclusions.',
      constraints: ['No external effects before approval.'],
      unknowns: ['Which evidence matters?'],
      falsifiers: ['A credible counterexample.'],
    },
    proposedTeam: Array.from({ length: 5 }, (_, index) => ({
      roleId: `role-${String(index)}`,
      title: `Role ${String(index)}`,
      mission: 'Investigate independently.',
      independence: 'Cannot evaluate its own work.',
    })),
    ambiguities: ['The decision horizon is unknown.'],
    assumptions: ['Research-only completion is acceptable.'],
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
    experiments: {
      mode: 'design_only' as const,
      executionAuthorized: false as const,
      statement: 'Experiment execution is not authorized.',
    },
    approvalChoices: [
      { choice: 'approve' as const, effect: 'Mint scoped authority.' },
      { choice: 'revise' as const, effect: 'Revise without effects.' },
      { choice: 'cancel' as const, effect: 'End without effects.' },
    ],
    planner: {
      plannerId: 'local-deterministic-question-planner/v1' as const,
      questionDerived: true as const,
      networkUsed: false as const,
      externalProviderUsed: false as const,
    },
  };
  return InvestigationPreviewSchema.parse({
    ...body,
    previewDigest: canonicalDigest(body),
  });
}

function approvalInput(
  preview: InvestigationPreview,
  overrides: Partial<InvestigationApprovalInput> = {},
): InvestigationApprovalInput {
  return {
    approvalId: 'approval:test',
    investigationId: preview.investigationId,
    previewDigest: preview.previewDigest,
    decision: 'approve',
    actorId: 'operator:beaux',
    actorKind: 'human_operator',
    reason: 'Scope, budget, and effect boundary reviewed.',
    decidedAt: '2026-07-16T00:00:00.000Z',
    ...overrides,
  };
}

describe('investigation plan binding', () => {
  it('binds an explicitly approved preview to an immutable no-effect plan', () => {
    const preview = makePreview();
    const approval = recordInvestigationApproval(approvalInput(preview));
    const result = bindApprovedInvestigationPlan({ preview, approval });

    expect(result.receipt.decision).toBe('accepted');
    expect(result.receipt.reasonCodes).toEqual([
      'plan_binding_policy_satisfied',
    ]);
    expect(result.receipt.bindingPolicyId).toBe(
      INVESTIGATION_PLAN_BINDING_POLICY_ID,
    );
    const plan = result.plan;
    if (plan === null) throw new Error('expected a bound plan');
    expect(InvestigationPlanSchema.parse(plan)).toEqual(plan);
    expect(plan.sourcePreviewDigest).toBe(preview.previewDigest);
    expect(plan.approvalDigest).toBe(approval.approvalDigest);
    expect(plan.revision).toBe(1);
    expect(plan.previousPlanDigest).toBeNull();
    expect(plan.effectAuthority).toBe('none_granted');
    expect(plan.requestedAuthority.status).toBe('not_granted');
    expect(plan.experiments.executionAuthorized).toBe(false);
    expect(result.receipt.planDigest).toBe(plan.planDigest);
  });

  it('is deterministic for identical preview and approval', () => {
    const preview = makePreview();
    const approval = recordInvestigationApproval(approvalInput(preview));
    const first = bindApprovedInvestigationPlan({ preview, approval });
    const second = bindApprovedInvestigationPlan({ preview, approval });
    expect(first.plan?.planDigest).toBe(second.plan?.planDigest);
    expect(first.receipt.receiptDigest).toBe(second.receipt.receiptDigest);
  });

  it('rejects an approval that binds a drifted preview', () => {
    const preview = makePreview();
    const approval = recordInvestigationApproval(approvalInput(preview));
    const driftedBody = {
      ...preview,
      question: `${preview.question} Drifted after approval.`,
      previewDigest: undefined,
    };
    const drifted = InvestigationPreviewSchema.parse({
      ...driftedBody,
      previewDigest: canonicalDigest(driftedBody),
    });
    const result = bindApprovedInvestigationPlan({
      preview: drifted,
      approval,
    });
    expect(result.plan).toBeNull();
    expect(result.receipt.decision).toBe('rejected');
    expect(result.receipt.reasonCodes).toContain('approval_preview_drift');
  });

  it('fails closed on a forged approval digest', () => {
    const preview = makePreview();
    const approval = recordInvestigationApproval(
      approvalInput(preview, { decision: 'cancel' }),
    );
    const forged = { ...approval, decision: 'approve' };
    expect(() =>
      bindApprovedInvestigationPlan({ preview, approval: forged }),
    ).toThrow(/digest/u);
  });

  it('rejects revise and cancel decisions without minting a plan', () => {
    const preview = makePreview();
    for (const decision of ['revise', 'cancel'] as const) {
      const approval = recordInvestigationApproval(
        approvalInput(preview, { decision }),
      );
      const result = bindApprovedInvestigationPlan({ preview, approval });
      expect(result.plan).toBeNull();
      expect(result.receipt.decision).toBe('rejected');
      expect(result.receipt.reasonCodes).toContain(
        `approval_decision_not_approve:${decision}`,
      );
    }
  });

  it('rejects approvals not written by a human operator', () => {
    const preview = makePreview();
    for (const actorKind of ['model', 'service'] as const) {
      const approval = recordInvestigationApproval(
        approvalInput(preview, { actorKind }),
      );
      const result = bindApprovedInvestigationPlan({ preview, approval });
      expect(result.plan).toBeNull();
      expect(result.receipt.reasonCodes).toContain(
        `approval_actor_not_human:${actorKind}`,
      );
    }
  });

  it('rejects an approval for a different investigation', () => {
    const preview = makePreview();
    const approval = recordInvestigationApproval(
      approvalInput(preview, { investigationId: 'investigation:other' }),
    );
    const result = bindApprovedInvestigationPlan({ preview, approval });
    expect(result.plan).toBeNull();
    expect(result.receipt.reasonCodes).toContain(
      'approval_investigation_mismatch',
    );
  });
});
