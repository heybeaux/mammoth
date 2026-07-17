import { z } from 'zod';
import { canonicalDigest } from './digest.js';
import { DigestSchema, NonEmptyStringSchema } from './primitives.js';

export const INVESTIGATION_PREVIEW_CONTRACT_FAMILY =
  'investigation.preview.v1' as const;

const StringListSchema = z.array(NonEmptyStringSchema).min(1);

export const ProposedResearchRoleSchema = z
  .object({
    roleId: NonEmptyStringSchema,
    title: NonEmptyStringSchema,
    mission: NonEmptyStringSchema,
    independence: NonEmptyStringSchema,
  })
  .strict();
export type ProposedResearchRole = z.infer<typeof ProposedResearchRoleSchema>;

export const InvestigationPlanPreviewSchema = z
  .object({
    subquestions: StringListSchema,
    searchQueries: StringListSchema,
    evidenceRequirements: StringListSchema,
    falsificationChecks: StringListSchema,
    contradictionChecks: StringListSchema,
    reportSections: StringListSchema,
    stopCriteria: StringListSchema,
  })
  .strict();
export type InvestigationPlanPreview = z.infer<
  typeof InvestigationPlanPreviewSchema
>;

export const InvestigationAuthorityPreviewSchema = z
  .object({
    status: z.literal('not_granted'),
    approvalRequired: z.literal(true),
    localProviders: StringListSchema,
    requestedCloudCapabilities: StringListSchema,
    requestedTools: StringListSchema,
    requestedNetworkAccess: StringListSchema,
    maxTimeMinutes: z.number().int().positive(),
    maxSpendUsd: z.number().finite().nonnegative(),
    externalEffectsExecuted: z.literal(false),
  })
  .strict();
export type InvestigationAuthorityPreview = z.infer<
  typeof InvestigationAuthorityPreviewSchema
>;

export const InvestigationPreviewSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    contractFamily: z.literal(INVESTIGATION_PREVIEW_CONTRACT_FAMILY),
    investigationId: NonEmptyStringSchema,
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
    proposedTeam: z.array(ProposedResearchRoleSchema).min(5),
    ambiguities: StringListSchema,
    assumptions: StringListSchema,
    plan: InvestigationPlanPreviewSchema,
    requestedAuthority: InvestigationAuthorityPreviewSchema,
    experiments: z
      .object({
        mode: z.literal('design_only'),
        executionAuthorized: z.literal(false),
        statement: NonEmptyStringSchema,
      })
      .strict(),
    approvalChoices: z
      .array(
        z
          .object({
            choice: z.enum(['approve', 'revise', 'cancel']),
            effect: NonEmptyStringSchema,
          })
          .strict(),
      )
      .length(3),
    planner: z
      .object({
        plannerId: z.literal('local-deterministic-question-planner/v1'),
        questionDerived: z.literal(true),
        networkUsed: z.literal(false),
        externalProviderUsed: z.literal(false),
      })
      .strict(),
    previewDigest: DigestSchema,
  })
  .strict()
  .superRefine((preview, context) => {
    const identity = { ...preview, previewDigest: undefined };
    if (preview.previewDigest !== canonicalDigest(identity)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['previewDigest'],
        message: 'preview digest must bind the exact preview content',
      });
    }
  });
export type InvestigationPreview = z.infer<typeof InvestigationPreviewSchema>;
