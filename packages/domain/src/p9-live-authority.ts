import { z } from 'zod';
import { canonicalDigest } from './digest.js';
import {
  EffectRequestCeilingSchema,
  P9BudgetVectorSchema,
  P9EffectKindSchema,
  P9_CONTRACT_FAMILY,
} from './p9.js';
import {
  PlanBudgetAllocationSchema,
  ResearchDomainPackIdSchema,
} from './p9-planning.js';

const DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);

export const P9ProviderProfileRoleSchema = z.enum([
  'search',
  'retrieval',
  'parser',
  'model_proposer',
  'model_evaluator',
]);
export type P9ProviderProfileRole = z.infer<typeof P9ProviderProfileRoleSchema>;

const ROLE_EFFECT_KIND = {
  search: 'search',
  retrieval: 'retrieval',
  parser: 'parser',
  model_proposer: 'model',
  model_evaluator: 'model',
} as const;

export const P9ProviderProfileSchema = z
  .object({
    profileId: z.string().min(1),
    profileFamilyId: z.string().min(1),
    provider: z.string().min(1),
    role: P9ProviderProfileRoleSchema,
    effectKind: P9EffectKindSchema,
    modelId: z.string().min(1).nullable(),
    checkpoint: z.string().min(1).nullable(),
    capabilityManifestDigest: DigestSchema.nullable(),
    promptTemplateDigest: DigestSchema.nullable(),
    outputSchemaDigest: DigestSchema.nullable(),
    configurationDigest: DigestSchema,
    destinationOrigin: z.string().url(),
    credentialEnvVar: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]*$/u)
      .nullable(),
    billingAuthorized: z.literal(true),
    billingAccountId: z.string().min(1),
    catalogEntryIds: z.array(z.string().min(1)).length(1),
    requestCeiling: EffectRequestCeilingSchema,
  })
  .strict()
  .superRefine((profile, context) => {
    if (profile.effectKind !== ROLE_EFFECT_KIND[profile.role]) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['effectKind'],
        message: 'provider role must use its exact effect kind',
      });
    }
    let destination: URL | null = null;
    try {
      destination = new URL(profile.destinationOrigin);
    } catch {
      // The URL schema reports the primary issue.
    }
    if (
      destination &&
      (destination.username ||
        destination.password ||
        destination.pathname !== '/' ||
        destination.search ||
        destination.hash)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['destinationOrigin'],
        message:
          'provider destination must be a credential-free origin without path, query, or fragment',
      });
    }
    const isModel = profile.role.startsWith('model_');
    const modelFields = [
      profile.modelId,
      profile.checkpoint,
      profile.capabilityManifestDigest,
      profile.promptTemplateDigest,
      profile.outputSchemaDigest,
    ];
    if (isModel && modelFields.some((value) => value === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'model profiles require exact model, checkpoint, capability, prompt, and output-schema identities',
      });
    }
    if (!isModel && modelFields.some((value) => value !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'non-model profiles cannot claim model identities',
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
    question: z.string().min(1),
    questionDigest: DigestSchema,
    domainPackId: ResearchDomainPackIdSchema,
    packDigest: DigestSchema,
    budgetAllocation: PlanBudgetAllocationSchema,
  })
  .strict()
  .superRefine((scope, context) => {
    if (scope.questionDigest !== canonicalDigest(scope.question)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['questionDigest'],
        message: 'question digest must bind the exact authorized question',
      });
    }
  });
export type P9LivePlanScope = z.infer<typeof P9LivePlanScopeSchema>;

export const P9LiveAuthorityReceiptSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    contractFamily: z.literal(P9_CONTRACT_FAMILY),
    authorityId: z.string().min(1),
    issuerId: z.string().min(1),
    decision: z.literal('authorized'),
    reason: z.string().min(1),
    executionId: z.string().min(1),
    executionDigest: DigestSchema,
    consumptionNonce: z.string().min(16),
    maximumExecutions: z.literal(1),
    planScope: P9LivePlanScopeSchema,
    priceCatalogId: z.string().min(1),
    priceCatalogVersion: z.string().min(1),
    priceCatalogDigest: DigestSchema,
    providerProfileCatalogId: z.string().min(1),
    providerProfileCatalogVersion: z.string().min(1),
    providerProfileCatalogDigest: DigestSchema,
    sourceClassificationPolicyDigest: DigestSchema,
    authorizedProfileIds: z.array(z.string().min(1)).min(1),
    proposerProfileId: z.string().min(1),
    evaluatorProfileId: z.string().min(1),
    budgetLimit: P9BudgetVectorSchema,
    authorizedEffectKinds: z.array(P9EffectKindSchema).min(1),
    authorizedDestinationOrigins: z.array(z.string().url()).min(1),
    authorizedBillingAccountIds: z.array(z.string().min(1)).min(1),
    actorId: z.string().min(1),
    authorizedAt: z.string().datetime(),
    notBeforeAt: z.string().datetime(),
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
    const expectedExecutionDigest = canonicalDigest({
      executionId: receipt.executionId,
      planDigest: receipt.planScope.planDigest,
      questionDigest: receipt.planScope.questionDigest,
      consumptionNonce: receipt.consumptionNonce,
    });
    if (receipt.executionDigest !== expectedExecutionDigest) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['executionDigest'],
        message:
          'execution digest must bind execution, plan, question, and nonce',
      });
    }
    if (
      Date.parse(receipt.notBeforeAt) < Date.parse(receipt.authorizedAt) ||
      Date.parse(receipt.expiresAt) <= Date.parse(receipt.notBeforeAt)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expiresAt'],
        message: 'live authority validity interval is invalid',
      });
    }
    for (const [path, values] of [
      ['authorizedProfileIds', receipt.authorizedProfileIds],
      ['authorizedEffectKinds', receipt.authorizedEffectKinds],
      ['authorizedDestinationOrigins', receipt.authorizedDestinationOrigins],
      ['authorizedBillingAccountIds', receipt.authorizedBillingAccountIds],
    ] as const) {
      if (new Set(values).size !== values.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [path],
          message: 'authorized identities must be unique',
        });
      }
    }
    const profileIds = new Set(receipt.authorizedProfileIds);
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
