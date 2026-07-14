import { z } from 'zod';
import { canonicalDigest } from './digest.js';
import {
  DigestSchema,
  EntityIdSchema,
  NonEmptyStringSchema,
  SchemaVersionSchema,
  type Digest,
} from './primitives.js';

export const MODEL_WORK_REQUEST_SCHEMA_VERSION = '1.0.0' as const;
export const MODEL_WORK_RESULT_SCHEMA_VERSION = '1.0.0' as const;
export const PROVIDER_ERROR_SCHEMA_VERSION = '1.0.0' as const;
export const MODEL_WORK_POLICY_VERSION = '1.0.0' as const;
export const PROVIDER_CAPABILITY_MANIFEST_VERSION = '1.0.0' as const;

const CurrencyMicrosSchema = z.number().int().nonnegative();

export const ModelWorkBudgetSchema = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    currencyMicros: CurrencyMicrosSchema,
    wallClockMs: z.number().int().positive(),
    toolCalls: z.literal(0),
  })
  .strict();

export const ModelWorkPolicySchema = z
  .object({
    version: z.literal(MODEL_WORK_POLICY_VERSION),
    digest: DigestSchema,
    dataClassification: z.enum(['local_only', 'cloud_allowed']),
    retainRawOutput: z.boolean(),
    maximumAttempts: z.number().int().positive(),
    budget: ModelWorkBudgetSchema,
  })
  .strict()
  .superRefine((policy, ctx) => {
    if (policy.digest !== modelWorkPolicyDigest(policy)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['digest'],
        message: 'model-work policy digest is not canonical',
      });
    }
  });

export const ProviderCapabilityManifestSchema = z
  .object({
    schemaVersion: z.literal(PROVIDER_CAPABILITY_MANIFEST_VERSION),
    provider: NonEmptyStringSchema,
    concreteModel: NonEmptyStringSchema,
    checkpoint: NonEmptyStringSchema,
    modalities: z.array(z.enum(['text'])).length(1),
    contextWindowTokens: z.number().int().positive(),
    supportsJsonOutput: z.boolean(),
    supportsSeed: z.boolean(),
    manifestDigest: DigestSchema,
  })
  .strict()
  .superRefine((manifest, ctx) => {
    if (
      manifest.manifestDigest !== providerCapabilityManifestDigest(manifest)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['manifestDigest'],
        message: 'provider capability manifest digest is not canonical',
      });
    }
  });

export const ModelWorkIdentitySchema = z
  .object({
    programId: EntityIdSchema,
    topologyId: EntityIdSchema,
    topologyDigest: DigestSchema,
    cellId: EntityIdSchema,
    criterionId: EntityIdSchema,
    criterionVersion: z.number().int().positive(),
    criterionDigest: DigestSchema,
    workItemContractDigest: DigestSchema,
    promptTemplateDigest: DigestSchema,
    canonicalInputDigest: DigestSchema,
    modelProfileVersionId: EntityIdSchema,
    modelProfileVersionDigest: DigestSchema,
    policyVersion: z.literal(MODEL_WORK_POLICY_VERSION),
    policyDigest: DigestSchema,
    toolContractDigest: DigestSchema,
    outputSchemaDigest: DigestSchema,
    identityDigest: DigestSchema,
  })
  .strict()
  .superRefine((identity, ctx) => {
    if (identity.identityDigest !== modelWorkIdentityDigest(identity)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['identityDigest'],
        message: 'model-work identity digest is not canonical',
      });
    }
  });

export const ProviderAttemptIdentitySchema = z
  .object({
    modelWorkIdentityDigest: DigestSchema,
    attemptOrdinal: z.number().int().positive(),
    provider: NonEmptyStringSchema,
    concreteModel: NonEmptyStringSchema,
    checkpoint: NonEmptyStringSchema,
    predecessorAttemptDigest: DigestSchema.optional(),
    attemptDigest: DigestSchema,
  })
  .strict()
  .superRefine((attempt, ctx) => {
    if (
      (attempt.attemptOrdinal === 1 && attempt.predecessorAttemptDigest) ||
      (attempt.attemptOrdinal > 1 && !attempt.predecessorAttemptDigest)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['predecessorAttemptDigest'],
        message: 'provider-attempt predecessor does not match attempt ordinal',
      });
    }
    if (attempt.attemptDigest !== providerAttemptIdentityDigest(attempt)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['attemptDigest'],
        message: 'provider-attempt identity digest is not canonical',
      });
    }
  });

export const ProviderEffectIdentitySchema = z
  .object({
    providerAttemptDigest: DigestSchema,
    modelWorkIdentityDigest: DigestSchema,
    operationKind: z.literal('chat_completion'),
    canonicalRequestDigest: DigestSchema,
    idempotencyKey: DigestSchema,
  })
  .strict()
  .superRefine((effect, ctx) => {
    if (effect.idempotencyKey !== providerEffectIdentityDigest(effect)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['idempotencyKey'],
        message: 'provider-effect idempotency key is not canonical',
      });
    }
  });

export const ModelEvidenceReferenceSchema = z
  .object({
    locator: NonEmptyStringSchema,
    snapshotDigest: DigestSchema,
  })
  .strict();

export const ModelClaimProposalSchema = z
  .object({
    proposalId: EntityIdSchema,
    statement: NonEmptyStringSchema,
    evidenceReferences: z.array(ModelEvidenceReferenceSchema),
  })
  .strict();

export const TypedModelOutputSchema = z
  .object({
    observations: z.array(NonEmptyStringSchema),
    claimProposals: z.array(ModelClaimProposalSchema),
    evidenceReferences: z.array(ModelEvidenceReferenceSchema),
    assumptions: z.array(NonEmptyStringSchema),
    dissent: z.array(NonEmptyStringSchema),
    proposedFalsifiers: z.array(NonEmptyStringSchema),
  })
  .strict();

export const ModelWorkRequestSchema = z
  .object({
    schemaVersion: z.literal(MODEL_WORK_REQUEST_SCHEMA_VERSION),
    identity: ModelWorkIdentitySchema,
    attempt: ProviderAttemptIdentitySchema,
    effect: ProviderEffectIdentitySchema,
    capabilityManifestDigest: DigestSchema,
    canonicalPromptDigest: DigestSchema,
    budget: ModelWorkBudgetSchema,
    outputSchemaVersion: SchemaVersionSchema,
  })
  .strict()
  .superRefine((request, ctx) => {
    if (
      request.attempt.modelWorkIdentityDigest !==
        request.identity.identityDigest ||
      request.effect.modelWorkIdentityDigest !==
        request.identity.identityDigest ||
      request.effect.providerAttemptDigest !== request.attempt.attemptDigest
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'model-work request identity chain does not match',
      });
    }
  });

export const ProviderUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
    currencyMicros: CurrencyMicrosSchema,
    wallClockMs: z.number().int().nonnegative(),
    toolCalls: z.literal(0),
  })
  .strict()
  .superRefine((usage, ctx) => {
    if (usage.totalTokens !== usage.inputTokens + usage.outputTokens) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['totalTokens'],
        message: 'provider usage total does not match token components',
      });
    }
  });

export const ModelWorkResultSchema = z
  .object({
    schemaVersion: z.literal(MODEL_WORK_RESULT_SCHEMA_VERSION),
    modelWorkIdentityDigest: DigestSchema,
    providerAttemptDigest: DigestSchema,
    providerEffectIdempotencyKey: DigestSchema,
    provider: NonEmptyStringSchema,
    concreteModel: NonEmptyStringSchema,
    checkpoint: NonEmptyStringSchema,
    providerOperationId: NonEmptyStringSchema.optional(),
    finishReason: z.enum(['stop', 'length', 'content_filter']),
    usage: ProviderUsageSchema,
    rawResponseDigest: DigestSchema,
    typedOutput: TypedModelOutputSchema,
    typedOutputDigest: DigestSchema,
  })
  .strict()
  .superRefine((result, ctx) => {
    if (
      result.typedOutputDigest !== typedModelOutputDigest(result.typedOutput)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['typedOutputDigest'],
        message: 'typed model output digest is not canonical',
      });
    }
  });

export const ProviderErrorCodeSchema = z.enum([
  'timeout_before_acceptance',
  'rate_limited',
  'provider_unavailable',
  'transport_interrupted_before_acceptance',
  'policy_denied',
  'secret_detected',
  'unsupported_capability',
  'profile_drift',
  'malformed_output',
  'schema_incompatible',
  'oversized_output',
  'content_rejected',
  'budget_exhausted',
  'ambiguous_delivery',
  'late_response',
]);

export const ProviderErrorSchema = z
  .object({
    schemaVersion: z.literal(PROVIDER_ERROR_SCHEMA_VERSION),
    code: ProviderErrorCodeSchema,
    message: NonEmptyStringSchema,
    providerOperationId: NonEmptyStringSchema.optional(),
    retryAfterMs: z.number().int().nonnegative().optional(),
  })
  .strict();

export type ModelWorkBudget = z.infer<typeof ModelWorkBudgetSchema>;
export type ModelWorkPolicy = z.infer<typeof ModelWorkPolicySchema>;
export type ProviderCapabilityManifest = z.infer<
  typeof ProviderCapabilityManifestSchema
>;
export type ModelWorkIdentity = z.infer<typeof ModelWorkIdentitySchema>;
export type ProviderAttemptIdentity = z.infer<
  typeof ProviderAttemptIdentitySchema
>;
export type ProviderEffectIdentity = z.infer<
  typeof ProviderEffectIdentitySchema
>;
export type TypedModelOutput = z.infer<typeof TypedModelOutputSchema>;
export type ModelWorkRequest = z.infer<typeof ModelWorkRequestSchema>;
export type ProviderUsage = z.infer<typeof ProviderUsageSchema>;
export type ModelWorkResult = z.infer<typeof ModelWorkResultSchema>;
export type ProviderError = z.infer<typeof ProviderErrorSchema>;
export type ProviderErrorCode = z.infer<typeof ProviderErrorCodeSchema>;

function digestWithoutField(
  kind: string,
  version: string,
  value: object,
  field: string,
): Digest {
  const record = Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      ([key]) => key !== field,
    ),
  );
  return canonicalDigest({ kind, schemaVersion: version, value: record });
}

export function modelWorkPolicyDigest(policy: ModelWorkPolicy): Digest {
  return digestWithoutField(
    'model-work-policy',
    MODEL_WORK_POLICY_VERSION,
    policy,
    'digest',
  );
}

export function providerCapabilityManifestDigest(
  manifest: ProviderCapabilityManifest,
): Digest {
  return digestWithoutField(
    'provider-capability-manifest',
    PROVIDER_CAPABILITY_MANIFEST_VERSION,
    manifest,
    'manifestDigest',
  );
}

export function modelWorkIdentityDigest(identity: ModelWorkIdentity): Digest {
  return digestWithoutField(
    'model-work-identity',
    MODEL_WORK_REQUEST_SCHEMA_VERSION,
    identity,
    'identityDigest',
  );
}

export function providerAttemptIdentityDigest(
  attempt: ProviderAttemptIdentity,
): Digest {
  return digestWithoutField(
    'provider-attempt-identity',
    MODEL_WORK_REQUEST_SCHEMA_VERSION,
    attempt,
    'attemptDigest',
  );
}

export function providerEffectIdentityDigest(
  effect: ProviderEffectIdentity,
): Digest {
  return digestWithoutField(
    'provider-effect-identity',
    MODEL_WORK_REQUEST_SCHEMA_VERSION,
    effect,
    'idempotencyKey',
  );
}

export function typedModelOutputDigest(output: TypedModelOutput): Digest {
  return canonicalDigest({
    kind: 'typed-model-output',
    schemaVersion: MODEL_WORK_RESULT_SCHEMA_VERSION,
    value: output,
  });
}

export function isRetryableProviderError(code: ProviderErrorCode): boolean {
  return [
    'timeout_before_acceptance',
    'rate_limited',
    'provider_unavailable',
    'transport_interrupted_before_acceptance',
  ].includes(code);
}

export function requiresProviderReconciliation(
  code: ProviderErrorCode,
): boolean {
  return code === 'ambiguous_delivery' || code === 'late_response';
}
