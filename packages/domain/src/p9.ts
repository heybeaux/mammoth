import { z } from 'zod';

const DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const NonNegativeFiniteSchema = z.number().finite().nonnegative();
const NonNegativeIntegerSchema = z.number().int().nonnegative();
const PositiveIntegerSchema = z.number().int().positive();

export const P9_CONTRACT_FAMILY = 'p9.v1' as const;

export const P9BudgetVectorSchema = z
  .object({
    currencyUsd: NonNegativeFiniteSchema,
    requests: NonNegativeIntegerSchema,
    inputTokens: NonNegativeIntegerSchema,
    outputTokens: NonNegativeIntegerSchema,
    bytes: NonNegativeIntegerSchema,
    durationMs: NonNegativeIntegerSchema,
  })
  .strict();
export type P9BudgetVector = z.infer<typeof P9BudgetVectorSchema>;

export const P9EffectKindSchema = z.enum([
  'search',
  'retrieval',
  'parser',
  'model',
]);
export type P9EffectKind = z.infer<typeof P9EffectKindSchema>;

export const EffectRequestCeilingSchema = z
  .object({
    requests: PositiveIntegerSchema,
    inputTokens: NonNegativeIntegerSchema,
    outputTokens: NonNegativeIntegerSchema,
    bytes: NonNegativeIntegerSchema,
    durationMs: PositiveIntegerSchema,
    attempts: PositiveIntegerSchema,
    parserClass: z.string().min(1).nullable(),
  })
  .strict();
export type EffectRequestCeiling = z.infer<typeof EffectRequestCeilingSchema>;

export const ProviderPriceCatalogEntrySchema = z
  .object({
    id: z.string().min(1),
    provider: z.string().min(1),
    effectKind: P9EffectKindSchema,
    parserClass: z.string().min(1).nullable(),
    flatCostUsd: NonNegativeFiniteSchema,
    costPerRequestUsd: NonNegativeFiniteSchema,
    costPerInputTokenUsd: NonNegativeFiniteSchema,
    costPerOutputTokenUsd: NonNegativeFiniteSchema,
    costPerByteUsd: NonNegativeFiniteSchema,
  })
  .strict();
export type ProviderPriceCatalogEntry = z.infer<
  typeof ProviderPriceCatalogEntrySchema
>;

export const ProviderPriceCatalogSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    contractFamily: z.literal(P9_CONTRACT_FAMILY),
    catalogId: z.string().min(1),
    version: z.string().min(1),
    entries: z.array(ProviderPriceCatalogEntrySchema).min(1),
    catalogDigest: DigestSchema,
  })
  .strict();
export type ProviderPriceCatalog = z.infer<typeof ProviderPriceCatalogSchema>;

export const EffectCostBoundSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    contractFamily: z.literal(P9_CONTRACT_FAMILY),
    effectId: z.string().min(1),
    idempotencyKey: z.string().min(1),
    catalogId: z.string().min(1),
    catalogVersion: z.string().min(1),
    catalogDigest: DigestSchema,
    catalogEntryId: z.string().min(1),
    provider: z.string().min(1),
    effectKind: P9EffectKindSchema,
    ceiling: EffectRequestCeilingSchema,
    reserved: P9BudgetVectorSchema,
    boundedAt: z.string().datetime(),
  })
  .strict();
export type EffectCostBound = z.infer<typeof EffectCostBoundSchema>;

export const SourceDateObservationSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    contractFamily: z.literal(P9_CONTRACT_FAMILY),
    observationId: z.string().min(1),
    field: z.literal('published_at'),
    extractionMethod: z.enum([
      'http_header',
      'html_metadata',
      'json_ld',
      'document_text',
      'operator_supplied',
    ]),
    exactLocator: z.string().min(1),
    sourceValue: z.string().min(1),
    normalizedValue: z.string().datetime(),
    confidence: z.number().finite().min(0).max(1),
    observedAt: z.string().datetime(),
  })
  .strict();
export type SourceDateObservation = z.infer<typeof SourceDateObservationSchema>;

export const DateExtractionVerdictSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    contractFamily: z.literal(P9_CONTRACT_FAMILY),
    observationId: z.string().min(1),
    observationDigest: DigestSchema,
    verdict: z.enum(['accepted', 'rejected', 'ambiguous']),
    policyId: z.string().min(1),
    reason: z.string().min(1),
    decidedAt: z.string().datetime(),
  })
  .strict();
export type DateExtractionVerdict = z.infer<typeof DateExtractionVerdictSchema>;

export const RobotsDecisionSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    contractFamily: z.literal(P9_CONTRACT_FAMILY),
    status: z.enum([
      'allowed',
      'denied',
      'not_checked',
      'unavailable',
      'ambiguous',
      'operator_override',
    ]),
    policyId: z.string().min(1),
    userAgent: z.string().min(1),
    requestedUrl: z.string().url(),
    finalUrl: z.string().url(),
    evaluatedAt: z.string().datetime(),
    decisionPath: z.array(z.string().min(1)),
    robotsReceiptDigest: DigestSchema.optional(),
    overrideActorId: z.string().min(1).optional(),
    overrideReason: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((decision, context) => {
    if (
      (decision.status === 'allowed' || decision.status === 'denied') &&
      (!decision.robotsReceiptDigest || decision.decisionPath.length === 0)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'allowed or denied robots status requires evaluated bytes/receipt and a decision path',
      });
    }
    if (
      decision.status === 'operator_override' &&
      (!decision.overrideActorId || !decision.overrideReason)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'operator override requires actor and reason',
      });
    }
  });
export type RobotsDecision = z.infer<typeof RobotsDecisionSchema>;

export const SourceRightsStatusSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    contractFamily: z.literal(P9_CONTRACT_FAMILY),
    status: z.enum([
      'unknown',
      'conflicting',
      'declared_permissive',
      'declared_restricted',
      'public_domain_claimed',
    ]),
    observationMethod: z.enum([
      'not_observed',
      'http_header',
      'page_metadata',
      'document_text',
      'operator_supplied',
    ]),
    exactLocator: z.string().min(1).nullable(),
    sourceValue: z.string().min(1).nullable(),
    observedAt: z.string().datetime(),
    policyId: z.string().min(1),
  })
  .strict()
  .superRefine((rights, context) => {
    if (
      rights.status !== 'unknown' &&
      (!rights.exactLocator || !rights.sourceValue)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'observed rights status requires an exact locator and value',
      });
    }
  });
export type SourceRightsStatus = z.infer<typeof SourceRightsStatusSchema>;

export const RetrievalTerminalStatusSchema = z.enum([
  'admitted',
  'rejected',
  'denied',
  'unavailable',
  'timed_out',
  'rate_limited',
  'parser_failed',
  'policy_blocked',
  'cancelled',
  'unknown',
]);
export type RetrievalTerminalStatus = z.infer<
  typeof RetrievalTerminalStatusSchema
>;

export const RetrievalFailureSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
    retryable: z.boolean(),
    policyEffect: z.enum([
      'none',
      'retry_bounded',
      'fail_closed',
      'quarantine',
    ]),
  })
  .strict();
export type RetrievalFailure = z.infer<typeof RetrievalFailureSchema>;

export const RetrievalAttemptSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    contractFamily: z.literal(P9_CONTRACT_FAMILY),
    attemptId: z.string().min(1),
    candidateId: z.string().min(1),
    effectId: z.string().min(1),
    requestedUrl: z.string().url(),
    finalUrl: z.string().url().nullable(),
    status: RetrievalTerminalStatusSchema,
    startedAt: z.string().datetime(),
    finishedAt: z.string().datetime(),
    retrievedAt: z.string().datetime().nullable(),
    publishedAt: z.string().datetime().nullable(),
    dateObservation: SourceDateObservationSchema.nullable(),
    dateVerdict: DateExtractionVerdictSchema.nullable(),
    robotsDecision: RobotsDecisionSchema,
    rightsStatus: SourceRightsStatusSchema,
    bytes: NonNegativeIntegerSchema,
    failure: RetrievalFailureSchema.nullable(),
  })
  .strict()
  .superRefine((attempt, context) => {
    if (attempt.publishedAt !== null) {
      if (
        !attempt.dateObservation ||
        !attempt.dateVerdict ||
        attempt.dateVerdict.verdict !== 'accepted' ||
        attempt.publishedAt !== attempt.dateObservation.normalizedValue
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'publishedAt requires an accepted exact date observation with the same normalized value',
        });
      }
    }
    if (
      attempt.dateObservation &&
      attempt.dateVerdict?.observationId !==
        attempt.dateObservation.observationId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'date verdict must reference the supplied observation',
      });
    }
    if (attempt.status === 'admitted' && attempt.failure !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'admitted retrieval cannot carry a failure',
      });
    }
    if (attempt.status !== 'admitted' && attempt.failure === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'non-admitted retrieval requires typed failure residue',
      });
    }
  });
export type RetrievalAttempt = z.infer<typeof RetrievalAttemptSchema>;

export const RetrievalCoverageResidueSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    contractFamily: z.literal(P9_CONTRACT_FAMILY),
    selectedCandidateIds: z.array(z.string().min(1)),
    terminalAttemptIds: z.array(z.string().min(1)),
    attemptsByStatus: z.record(
      RetrievalTerminalStatusSchema,
      NonNegativeIntegerSchema,
    ),
    missingCandidateIds: z.array(z.string().min(1)),
    missingSourceClasses: z.array(z.string().min(1)),
    assessedAt: z.string().datetime(),
  })
  .strict();
export type RetrievalCoverageResidue = z.infer<
  typeof RetrievalCoverageResidueSchema
>;
