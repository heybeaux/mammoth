import { z } from 'zod';
import { canonicalDigest } from './digest.js';
import {
  P9BudgetVectorSchema,
  P9EffectKindSchema,
  P9_CONTRACT_FAMILY,
} from './p9.js';
import { ResearchDomainPackIdSchema } from './p9-planning.js';

const DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);

export const P9ProviderProfileRoleSchema = z.enum([
  'search',
  'retrieval',
  'parser',
  'model_proposer',
  'model_evaluator',
]);
export type P9ProviderProfileRole = z.infer<typeof P9ProviderProfileRoleSchema>;

export const P9ProviderProfileSchema = z
  .object({
    profileId: z.string().min(1),
    profileFamilyId: z.string().min(1),
    provider: z.string().min(1),
    role: P9ProviderProfileRoleSchema,
    effectKind: P9EffectKindSchema,
    modelId: z.string().min(1).nullable(),
    baseUrl: z.string().url().nullable(),
    credentialEnvVar: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]*$/u)
      .nullable(),
    catalogEntryIds: z.array(z.string().min(1)).min(1),
  })
  .strict()
  .superRefine((profile, context) => {
    const isModel = profile.role.startsWith('model_');
    if ((profile.effectKind === 'model') !== isModel) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['effectKind'],
        message: 'model roles must use the model effect kind and vice versa',
      });
    }
    if (isModel && (!profile.modelId || !profile.baseUrl)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'model profiles require an exact model identity and base URL',
      });
    }
    if (!isModel && profile.modelId !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['modelId'],
        message: 'non-model profiles cannot claim a model identity',
      });
    }
  });
export type P9ProviderProfile = z.infer<typeof P9ProviderProfileSchema>;

export const P9ProviderProfileCatalogSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    contractFamily: z.literal(P9_CONTRACT_FAMILY),
    catalogId: z.string().min(1),
    version: z.string().min(1),
    profiles: z.array(P9ProviderProfileSchema).min(1),
    catalogDigest: DigestSchema,
  })
  .strict()
  .superRefine((catalog, context) => {
    const identity = { ...catalog, catalogDigest: undefined };
    if (catalog.catalogDigest !== canonicalDigest(identity)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['catalogDigest'],
        message: 'catalog digest must bind the exact provider profile catalog',
      });
    }
    const ids = new Set<string>();
    for (const [index, profile] of catalog.profiles.entries()) {
      if (ids.has(profile.profileId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['profiles', index, 'profileId'],
          message: 'provider profile identities must be unique',
        });
      }
      ids.add(profile.profileId);
    }
  });
export type P9ProviderProfileCatalog = z.infer<
  typeof P9ProviderProfileCatalogSchema
>;

export const P9LivePlanScopeSchema = z
  .object({
    proposalId: z.string().min(1),
    proposalDigest: DigestSchema,
    planId: z.string().min(1),
    planDigest: DigestSchema,
    acceptanceReceiptDigest: DigestSchema,
    domainPackId: ResearchDomainPackIdSchema,
    packDigest: DigestSchema,
  })
  .strict();
export type P9LivePlanScope = z.infer<typeof P9LivePlanScopeSchema>;

export const P9LiveAuthorityReceiptSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    contractFamily: z.literal(P9_CONTRACT_FAMILY),
    authorityId: z.string().min(1),
    planScope: P9LivePlanScopeSchema,
    priceCatalogId: z.string().min(1),
    priceCatalogVersion: z.string().min(1),
    priceCatalogDigest: DigestSchema,
    providerProfileCatalogId: z.string().min(1),
    providerProfileCatalogVersion: z.string().min(1),
    providerProfileCatalogDigest: DigestSchema,
    authorizedProfileIds: z.array(z.string().min(1)).min(1),
    proposerProfileId: z.string().min(1),
    evaluatorProfileId: z.string().min(1),
    budgetLimit: P9BudgetVectorSchema,
    authorizedEffectKinds: z.array(P9EffectKindSchema).min(1),
    actorId: z.string().min(1),
    authorizedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    receiptDigest: DigestSchema,
  })
  .strict()
  .superRefine((receipt, context) => {
    const identity = { ...receipt, receiptDigest: undefined };
    if (receipt.receiptDigest !== canonicalDigest(identity)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['receiptDigest'],
        message: 'receipt digest must bind the exact scoped live authority',
      });
    }
    if (Date.parse(receipt.expiresAt) <= Date.parse(receipt.authorizedAt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expiresAt'],
        message: 'live authority must expire after it is authorized',
      });
    }
    const profileIds = new Set(receipt.authorizedProfileIds);
    if (profileIds.size !== receipt.authorizedProfileIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['authorizedProfileIds'],
        message: 'authorized provider profile identities must be unique',
      });
    }
    for (const profileId of [
      receipt.proposerProfileId,
      receipt.evaluatorProfileId,
    ]) {
      if (!profileIds.has(profileId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['authorizedProfileIds'],
          message:
            'proposer and evaluator profiles must be explicitly authorized',
        });
      }
    }
  });
export type P9LiveAuthorityReceipt = z.infer<
  typeof P9LiveAuthorityReceiptSchema
>;
