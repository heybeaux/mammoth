import {
  canonicalDigest,
  InvestigationApprovalSchema,
  InvestigationPlanBindingReceiptSchema,
  InvestigationPlanSchema,
  InvestigationPreviewSchema,
  INVESTIGATION_APPROVAL_CONTRACT_FAMILY,
  INVESTIGATION_PLAN_CONTRACT_FAMILY,
  type InvestigationApproval,
  type InvestigationPlan,
  type InvestigationPlanBindingReceipt,
} from '@mammoth/domain';

export const INVESTIGATION_PLAN_BINDING_POLICY_ID =
  'investigation-plan-binding/v1';

export interface InvestigationApprovalInput {
  readonly approvalId: string;
  readonly investigationId: string;
  readonly previewDigest: string;
  readonly decision: InvestigationApproval['decision'];
  readonly actorId: string;
  readonly actorKind: InvestigationApproval['actorKind'];
  readonly reason: string;
  readonly decidedAt: string;
}

/** Records an operator decision as a digest-bound approval. Recording a
 * decision grants nothing by itself; only `bindApprovedInvestigationPlan`
 * evaluates it, and effects still require a separate scoped authority. */
export function recordInvestigationApproval(
  input: InvestigationApprovalInput,
): InvestigationApproval {
  const identity = {
    schemaVersion: '1.0.0' as const,
    contractFamily: INVESTIGATION_APPROVAL_CONTRACT_FAMILY,
    approvalId: input.approvalId,
    investigationId: input.investigationId,
    previewDigest: input.previewDigest,
    decision: input.decision,
    actorId: input.actorId,
    actorKind: input.actorKind,
    reason: input.reason,
    decidedAt: input.decidedAt,
  };
  return InvestigationApprovalSchema.parse({
    ...identity,
    approvalDigest: canonicalDigest(identity),
  });
}

export interface InvestigationPlanBindingInput {
  readonly preview: unknown;
  readonly approval: unknown;
}

export interface InvestigationPlanBindingResult {
  readonly receipt: InvestigationPlanBindingReceipt;
  readonly plan: InvestigationPlan | null;
}

/**
 * Transitions an accepted preview into an immutable executable plan. This is
 * strictly no-effect: the bound plan carries `effectAuthority: 'none_granted'`
 * and its requested authority remains `not_granted`, so nothing downstream may
 * execute external effects until a separate valid scoped authority exists.
 */
export function bindApprovedInvestigationPlan(
  input: InvestigationPlanBindingInput,
): InvestigationPlanBindingResult {
  const preview = InvestigationPreviewSchema.parse(input.preview);
  const approval = InvestigationApprovalSchema.parse(input.approval);

  const reasons = new Set<string>();
  if (approval.investigationId !== preview.investigationId)
    reasons.add('approval_investigation_mismatch');
  if (approval.previewDigest !== preview.previewDigest)
    reasons.add('approval_preview_drift');
  if (approval.decision !== 'approve')
    reasons.add(`approval_decision_not_approve:${approval.decision}`);
  if (approval.actorKind !== 'human_operator')
    reasons.add(`approval_actor_not_human:${approval.actorKind}`);

  if (reasons.size > 0) {
    return {
      receipt: makeReceipt({
        approval,
        previewDigest: preview.previewDigest,
        investigationId: preview.investigationId,
        decision: 'rejected',
        planId: null,
        planDigest: null,
        reasonCodes: [...reasons].sort(),
      }),
      plan: null,
    };
  }

  const planIdentity = {
    schemaVersion: '1.0.0' as const,
    contractFamily: INVESTIGATION_PLAN_CONTRACT_FAMILY,
    planId: `plan:${preview.investigationId}`,
    investigationId: preview.investigationId,
    revision: 1,
    previousPlanDigest: null,
    sourcePreviewDigest: preview.previewDigest,
    approvalId: approval.approvalId,
    approvalDigest: approval.approvalDigest,
    question: preview.question,
    interpretation: preview.interpretation,
    team: preview.proposedTeam,
    plan: preview.plan,
    requestedAuthority: preview.requestedAuthority,
    effectAuthority: 'none_granted' as const,
    experiments: preview.experiments,
    bindingPolicyId: INVESTIGATION_PLAN_BINDING_POLICY_ID,
    acceptedAt: approval.decidedAt,
    acceptedBy: approval.actorId,
  };
  const plan = InvestigationPlanSchema.parse({
    ...planIdentity,
    planDigest: canonicalDigest(planIdentity),
  });
  return {
    receipt: makeReceipt({
      approval,
      previewDigest: preview.previewDigest,
      investigationId: preview.investigationId,
      decision: 'accepted',
      planId: plan.planId,
      planDigest: plan.planDigest,
      reasonCodes: ['plan_binding_policy_satisfied'],
    }),
    plan,
  };
}

function makeReceipt(input: {
  approval: InvestigationApproval;
  previewDigest: string;
  investigationId: string;
  decision: 'accepted' | 'rejected';
  planId: string | null;
  planDigest: string | null;
  reasonCodes: readonly string[];
}): InvestigationPlanBindingReceipt {
  const identity = {
    schemaVersion: '1.0.0' as const,
    contractFamily: INVESTIGATION_PLAN_CONTRACT_FAMILY,
    receiptId: `plan-binding:${input.approval.approvalId}:${input.approval.decidedAt}`,
    investigationId: input.investigationId,
    previewDigest: input.previewDigest,
    approvalId: input.approval.approvalId,
    approvalDigest: input.approval.approvalDigest,
    decision: input.decision,
    planId: input.planId,
    planDigest: input.planDigest,
    reasonCodes: [...input.reasonCodes],
    bindingPolicyId: INVESTIGATION_PLAN_BINDING_POLICY_ID,
    decidedAt: input.approval.decidedAt,
    actorId: input.approval.actorId,
  };
  return InvestigationPlanBindingReceiptSchema.parse({
    ...identity,
    receiptDigest: canonicalDigest(identity),
  });
}
