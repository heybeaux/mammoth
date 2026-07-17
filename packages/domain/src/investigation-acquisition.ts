import { z } from 'zod';
import { canonicalDigest } from './digest.js';
import {
  DigestSchema,
  NonEmptyStringSchema,
  TimestampSchema,
} from './primitives.js';

export const INVESTIGATION_ACQUISITION_CONTRACT_FAMILY =
  'investigation.acquisition.v1' as const;
export const INVESTIGATION_ACQUISITION_POLICY_ID =
  'investigation-plan-acquisition/v1' as const;
export const INVESTIGATION_ACQUISITION_RELEASE_POLICY_ID =
  'investigation-acquisition-release/v1' as const;

export const AcquisitionIntentIdSchema = z
  .string()
  .regex(/^intent:[a-f0-9]{16}$/u);
const StringListSchema = z.array(NonEmptyStringSchema);

export const AcquisitionIntentSchema = z
  .object({
    intentId: AcquisitionIntentIdSchema,
    kind: z.enum(['discovery.search', 'acquisition.preserve']),
    subject: NonEmptyStringSchema,
    derivedFrom: NonEmptyStringSchema,
    dependsOn: z.array(AcquisitionIntentIdSchema),
    steps: z.array(NonEmptyStringSchema).min(1),
    constraints: StringListSchema,
  })
  .strict();
export type AcquisitionIntent = z.infer<typeof AcquisitionIntentSchema>;

export const InvestigationAcquisitionIntentSetSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    contractFamily: z.literal(INVESTIGATION_ACQUISITION_CONTRACT_FAMILY),
    intentSetId: NonEmptyStringSchema,
    investigationId: NonEmptyStringSchema,
    planId: NonEmptyStringSchema,
    planDigest: DigestSchema,
    sourcePreviewDigest: DigestSchema,
    approvalId: NonEmptyStringSchema,
    question: z.string().trim().min(12).max(8_000),
    derivationPolicyId: z.literal(INVESTIGATION_ACQUISITION_POLICY_ID),
    effectAuthority: z.literal('none_granted'),
    executionAuthorized: z.literal(false),
    externalEffectsExecuted: z.literal(false),
    coverage: z
      .object({
        subquestions: StringListSchema.min(1),
        evidenceRequirements: StringListSchema.min(1),
        falsificationChecks: StringListSchema.min(1),
        contradictionChecks: StringListSchema.min(1),
        stopCriteria: StringListSchema.min(1),
      })
      .strict(),
    intents: z.array(AcquisitionIntentSchema).min(2),
    intentSetDigest: DigestSchema,
  })
  .strict()
  .superRefine((intentSet, context) => {
    const identity = { ...intentSet, intentSetDigest: undefined };
    if (intentSet.intentSetDigest !== canonicalDigest(identity)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['intentSetDigest'],
        message: 'intent set digest must bind the exact derived intents',
      });
    }
    const ids = new Set<string>();
    for (const [index, intent] of intentSet.intents.entries()) {
      if (ids.has(intent.intentId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['intents', index, 'intentId'],
          message: 'intent identities must be unique',
        });
      }
      ids.add(intent.intentId);
    }
    for (const [index, intent] of intentSet.intents.entries()) {
      for (const dependency of intent.dependsOn) {
        if (!ids.has(dependency)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['intents', index, 'dependsOn'],
            message: 'intent dependencies must reference derived intents',
          });
        }
      }
    }
  });
export type InvestigationAcquisitionIntentSet = z.infer<
  typeof InvestigationAcquisitionIntentSetSchema
>;

export const AcquisitionReleaseSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    contractFamily: z.literal(INVESTIGATION_ACQUISITION_CONTRACT_FAMILY),
    releaseId: NonEmptyStringSchema,
    investigationId: NonEmptyStringSchema,
    planDigest: DigestSchema,
    intentSetDigest: DigestSchema,
    decision: z.enum(['refused', 'authorized']),
    reasonCodes: z.array(NonEmptyStringSchema).min(1),
    authorityReceiptDigest: DigestSchema.nullable(),
    releasePolicyId: z.literal(INVESTIGATION_ACQUISITION_RELEASE_POLICY_ID),
    evaluatedAt: TimestampSchema,
    externalEffectsExecuted: z.literal(false),
    releaseDigest: DigestSchema,
  })
  .strict()
  .superRefine((release, context) => {
    const identity = { ...release, releaseDigest: undefined };
    if (release.releaseDigest !== canonicalDigest(identity)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['releaseDigest'],
        message: 'release digest must bind the exact release decision',
      });
    }
    const authorized = release.decision === 'authorized';
    if (authorized && release.authorityReceiptDigest === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['authorityReceiptDigest'],
        message: 'an authorized release must bind its exact scoped authority',
      });
    }
    if (!authorized && release.authorityReceiptDigest !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['authorityReceiptDigest'],
        message: 'a refused release cannot claim a scoped authority',
      });
    }
  });
export type AcquisitionRelease = z.infer<typeof AcquisitionReleaseSchema>;
