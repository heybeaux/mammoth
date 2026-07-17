import { z } from 'zod';
import { canonicalDigest } from './digest.js';
import {
  InvestigationAuthorityPreviewSchema,
  InvestigationPlanPreviewSchema,
  ProposedResearchRoleSchema,
} from './investigation.js';
import {
  DigestSchema,
  NonEmptyStringSchema,
  TimestampSchema,
} from './primitives.js';

export const INVESTIGATION_APPROVAL_CONTRACT_FAMILY =
  'investigation.approval.v1' as const;
export const INVESTIGATION_PLAN_CONTRACT_FAMILY =
  'investigation.plan.v1' as const;

const StringListSchema = z.array(NonEmptyStringSchema).min(1);

export const InvestigationApprovalDecisionSchema = z.enum([
  'approve',
  'revise',
  'cancel',
]);
export type InvestigationApprovalDecision = z.infer<
  typeof InvestigationApprovalDecisionSchema
>;

export const InvestigationApprovalActorKindSchema = z.enum([
  'human_operator',
  'model',
  'service',
]);
export type InvestigationApprovalActorKind = z.infer<
  typeof InvestigationApprovalActorKindSchema
>;

export const InvestigationApprovalSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    contractFamily: z.literal(INVESTIGATION_APPROVAL_CONTRACT_FAMILY),
    approvalId: NonEmptyStringSchema,
    investigationId: NonEmptyStringSchema,
    previewDigest: DigestSchema,
    decision: InvestigationApprovalDecisionSchema,
    actorId: NonEmptyStringSchema,
    actorKind: InvestigationApprovalActorKindSchema,
    reason: NonEmptyStringSchema,
    decidedAt: TimestampSchema,
    approvalDigest: DigestSchema,
  })
  .strict()
  .superRefine((approval, context) => {
    const identity = { ...approval, approvalDigest: undefined };
    if (approval.approvalDigest !== canonicalDigest(identity)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['approvalDigest'],
        message: 'approval digest must bind the exact approval decision',
      });
    }
  });
export type InvestigationApproval = z.infer<typeof InvestigationApprovalSchema>;

export const InvestigationPlanSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    contractFamily: z.literal(INVESTIGATION_PLAN_CONTRACT_FAMILY),
    planId: NonEmptyStringSchema,
    investigationId: NonEmptyStringSchema,
    revision: z.number().int().min(1),
    previousPlanDigest: DigestSchema.nullable(),
    sourcePreviewDigest: DigestSchema,
    approvalId: NonEmptyStringSchema,
    approvalDigest: DigestSchema,
    question: z.string().trim().min(12).max(8_000),
    interpretation: z
      .object({
        objective: NonEmptyStringSchema,
        decisionCriterion: NonEmptyStringSchema,
        constraints: StringListSchema,
        unknowns: StringListSchema,
        falsifiers: StringListSchema,
      })
      .strict(),
    team: z.array(ProposedResearchRoleSchema).min(5),
    plan: InvestigationPlanPreviewSchema,
    requestedAuthority: InvestigationAuthorityPreviewSchema,
    effectAuthority: z.literal('none_granted'),
    experiments: z
      .object({
        mode: z.literal('design_only'),
        executionAuthorized: z.literal(false),
        statement: NonEmptyStringSchema,
      })
      .strict(),
    bindingPolicyId: NonEmptyStringSchema,
    acceptedAt: TimestampSchema,
    acceptedBy: NonEmptyStringSchema,
    planDigest: DigestSchema,
  })
  .strict()
  .superRefine((plan, context) => {
    const identity = { ...plan, planDigest: undefined };
    if (plan.planDigest !== canonicalDigest(identity)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['planDigest'],
        message: 'plan digest must bind the exact executable plan content',
      });
    }
    if (plan.revision === 1 && plan.previousPlanDigest !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['previousPlanDigest'],
        message: 'a first plan revision cannot claim a previous plan',
      });
    }
    if (plan.revision > 1 && plan.previousPlanDigest === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['previousPlanDigest'],
        message: 'a later plan revision must bind its previous plan digest',
      });
    }
  });
export type InvestigationPlan = z.infer<typeof InvestigationPlanSchema>;

export const InvestigationPlanBindingReceiptSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    contractFamily: z.literal(INVESTIGATION_PLAN_CONTRACT_FAMILY),
    receiptId: NonEmptyStringSchema,
    investigationId: NonEmptyStringSchema,
    previewDigest: DigestSchema,
    approvalId: NonEmptyStringSchema,
    approvalDigest: DigestSchema,
    decision: z.enum(['accepted', 'rejected']),
    planId: NonEmptyStringSchema.nullable(),
    planDigest: DigestSchema.nullable(),
    reasonCodes: z.array(NonEmptyStringSchema).min(1),
    bindingPolicyId: NonEmptyStringSchema,
    decidedAt: TimestampSchema,
    actorId: NonEmptyStringSchema,
    receiptDigest: DigestSchema,
  })
  .strict()
  .superRefine((receipt, context) => {
    const identity = { ...receipt, receiptDigest: undefined };
    if (receipt.receiptDigest !== canonicalDigest(identity)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['receiptDigest'],
        message: 'receipt digest must bind the exact binding decision',
      });
    }
    const accepted = receipt.decision === 'accepted';
    if (accepted && (receipt.planId === null || receipt.planDigest === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['planDigest'],
        message: 'an accepted binding must identify the exact bound plan',
      });
    }
    if (!accepted && (receipt.planId !== null || receipt.planDigest !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['planDigest'],
        message: 'a rejected binding cannot claim a bound plan',
      });
    }
  });
export type InvestigationPlanBindingReceipt = z.infer<
  typeof InvestigationPlanBindingReceiptSchema
>;
