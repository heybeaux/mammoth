import { z } from 'zod';
import { canonicalDigest } from './digest.js';

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
  .strict()
  .superRefine((catalog, context) => {
    const identity = {
      schemaVersion: catalog.schemaVersion,
      contractFamily: catalog.contractFamily,
      catalogId: catalog.catalogId,
      version: catalog.version,
      entries: catalog.entries,
    };
    if (catalog.catalogDigest !== canonicalDigest(identity)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['catalogDigest'],
        message: 'catalog digest must bind the exact immutable price catalog',
      });
    }
  });
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
      rights.observationMethod === 'not_observed'
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'declared rights status requires an observed source method',
      });
    }
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

export const MediaSupportDecisionSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    contractFamily: z.literal(P9_CONTRACT_FAMILY),
    decisionId: z.string().min(1),
    declaredMediaType: z.string().min(1),
    sniffedMediaType: z.string().min(1).nullable(),
    fileExtension: z.string().min(1).nullable(),
    status: z.enum(['supported', 'unsupported', 'ambiguous']),
    parserId: z.string().min(1).nullable(),
    parserVersion: z.string().min(1).nullable(),
    parserDigest: DigestSchema.nullable(),
    policyId: z.string().min(1),
    reasonCode: z.string().min(1),
    decidedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((decision, context) => {
    const parserIdentity = [
      decision.parserId,
      decision.parserVersion,
      decision.parserDigest,
    ];
    if (
      decision.status === 'supported' &&
      parserIdentity.some((value) => value === null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'supported media requires a complete pinned parser identity',
      });
    }
    if (
      decision.status !== 'supported' &&
      parserIdentity.some((value) => value !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'unsupported or ambiguous media cannot select a parser',
      });
    }
  });
export type MediaSupportDecision = z.infer<typeof MediaSupportDecisionSchema>;

export const ParserReceiptSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    contractFamily: z.literal(P9_CONTRACT_FAMILY),
    receiptId: z.string().min(1),
    decisionId: z.string().min(1),
    inputDigest: DigestSchema,
    parserId: z.string().min(1),
    parserVersion: z.string().min(1),
    parserDigest: DigestSchema,
    mediaType: z.string().min(1),
    limits: z
      .object({
        maximumInputBytes: PositiveIntegerSchema,
        maximumOutputCharacters: PositiveIntegerSchema,
        timeoutMs: PositiveIntegerSchema,
        maximumMemoryBytes: PositiveIntegerSchema,
        maximumProcesses: PositiveIntegerSchema,
      })
      .strict(),
    status: z.enum(['parsed', 'rejected', 'failed', 'timed_out', 'cancelled']),
    outputDigest: DigestSchema.nullable(),
    outputCharacters: NonNegativeIntegerSchema,
    locatorCoordinateSpace: z.string().min(1).nullable(),
    failureCode: z.string().min(1).nullable(),
    startedAt: z.string().datetime(),
    finishedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((receipt, context) => {
    if (
      receipt.status === 'parsed' &&
      (!receipt.outputDigest || !receipt.locatorCoordinateSpace)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'parsed receipt requires output digest and locator space',
      });
    }
    if (receipt.status !== 'parsed' && receipt.failureCode === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'non-parsed receipt requires a typed failure code',
      });
    }
  });
export type ParserReceipt = z.infer<typeof ParserReceiptSchema>;

export const NetworkHopReceiptSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    contractFamily: z.literal(P9_CONTRACT_FAMILY),
    policyId: z.string().min(1),
    hop: NonNegativeIntegerSchema,
    canonicalUrl: z.string().url(),
    origin: z.string().url(),
    approvedAddresses: z.array(z.string().min(1)).min(1),
    connectedAddress: z.string().min(1),
    resolvedAt: z.string().datetime(),
    responseStatus: NonNegativeIntegerSchema,
    redirectLocation: z.string().min(1).nullable(),
  })
  .strict()
  .superRefine((receipt, context) => {
    if (!receipt.approvedAddresses.includes(receipt.connectedAddress)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'network receipt must bind the actual connected address',
      });
    }
  });
export type NetworkHopReceipt = z.infer<typeof NetworkHopReceiptSchema>;

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
    if ((attempt.dateObservation === null) !== (attempt.dateVerdict === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'date observation and verdict must be supplied together',
      });
    }
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
    if (
      attempt.dateObservation &&
      attempt.dateVerdict &&
      attempt.dateVerdict.observationDigest !==
        canonicalDigest(attempt.dateObservation)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'date verdict must bind the exact supplied observation',
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

export const P9ModelRoleSchema = z.enum([
  'claim_proposer',
  'entailment_evaluator',
]);
export type P9ModelRole = z.infer<typeof P9ModelRoleSchema>;

export const P9ModelWorkRefSchema = z
  .object({
    workId: z.string().min(1),
    workDigest: DigestSchema,
    rawResponseDigest: DigestSchema,
    role: P9ModelRoleSchema,
    profileVersionId: z.string().min(1),
    profileFamilyId: z.string().min(1),
  })
  .strict();
export type P9ModelWorkRef = z.infer<typeof P9ModelWorkRefSchema>;

export const P9EntailmentLocatorSchema = z
  .object({
    evidenceSpanId: z.string().min(1),
    snapshotDigest: DigestSchema,
    quoteDigest: DigestSchema,
    contextDigest: DigestSchema,
    coordinateSpace: z.string().min(1),
    startOffset: NonNegativeIntegerSchema,
    endOffset: NonNegativeIntegerSchema,
  })
  .strict()
  .superRefine((locator, context) => {
    if (locator.endOffset <= locator.startOffset) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endOffset'],
        message: 'entailment locator must select a non-empty span',
      });
    }
  });
export type P9EntailmentLocator = z.infer<typeof P9EntailmentLocatorSchema>;

export const P9ClaimProposalSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    contractFamily: z.literal(P9_CONTRACT_FAMILY),
    proposalId: z.string().min(1),
    statement: z.string().min(1),
    critical: z.boolean(),
    locator: P9EntailmentLocatorSchema,
    proposerWork: P9ModelWorkRefSchema,
    proposalDigest: DigestSchema,
  })
  .strict()
  .superRefine((proposal, context) => {
    if (proposal.proposerWork.role !== 'claim_proposer') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['proposerWork', 'role'],
        message: 'claim proposal requires claim_proposer work',
      });
    }
    const identity = { ...proposal, proposalDigest: undefined };
    if (proposal.proposalDigest !== canonicalDigest(identity)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['proposalDigest'],
        message: 'proposal digest must bind the exact proposal and locator',
      });
    }
  });
export type P9ClaimProposal = z.infer<typeof P9ClaimProposalSchema>;

export const P9SemanticDeltaSchema = z.enum([
  'negation',
  'quantity',
  'unit',
  'scope',
  'causality',
  'comparison',
  'certainty',
  'actor',
  'timeframe',
  'recommendation_premise',
]);
export type P9SemanticDelta = z.infer<typeof P9SemanticDeltaSchema>;

export const P9EntailmentVerdictSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    contractFamily: z.literal(P9_CONTRACT_FAMILY),
    verdictId: z.string().min(1),
    proposalId: z.string().min(1),
    proposalDigest: DigestSchema,
    evaluatedStatement: z.string().min(1),
    evaluatedQuote: z.string().min(1),
    boundedContext: z.string().min(1),
    locator: P9EntailmentLocatorSchema,
    verdict: z.enum(['entailed', 'contradicted', 'insufficient']),
    semanticDeltas: z.array(P9SemanticDeltaSchema),
    hostileInstructionDetected: z.boolean(),
    reasonCodes: z.array(z.string().min(1)).min(1),
    evaluatorWork: P9ModelWorkRefSchema,
    evaluatedAt: z.string().datetime(),
    verdictDigest: DigestSchema,
  })
  .strict()
  .superRefine((verdict, context) => {
    if (verdict.evaluatorWork.role !== 'entailment_evaluator') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['evaluatorWork', 'role'],
        message: 'entailment verdict requires entailment_evaluator work',
      });
    }
    if (
      verdict.locator.quoteDigest !== canonicalDigest(verdict.evaluatedQuote)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['locator', 'quoteDigest'],
        message:
          'entailment verdict quote digest does not bind evaluated quote',
      });
    }
    if (
      verdict.locator.contextDigest !== canonicalDigest(verdict.boundedContext)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['locator', 'contextDigest'],
        message:
          'entailment verdict context digest does not bind bounded context',
      });
    }
    const identity = { ...verdict, verdictDigest: undefined };
    if (verdict.verdictDigest !== canonicalDigest(identity)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['verdictDigest'],
        message: 'verdict digest must bind the complete evaluator result',
      });
    }
  });
export type P9EntailmentVerdict = z.infer<typeof P9EntailmentVerdictSchema>;

export const P9ClaimAdmissionSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    contractFamily: z.literal(P9_CONTRACT_FAMILY),
    admissionId: z.string().min(1),
    proposalId: z.string().min(1),
    proposalDigest: DigestSchema,
    verdictId: z.string().min(1),
    verdictDigest: DigestSchema,
    decision: z.enum(['admitted', 'contradicted', 'rejected']),
    independentProfile: z.boolean(),
    reasonCodes: z.array(z.string().min(1)).min(1),
    policyId: z.string().min(1),
    decidedAt: z.string().datetime(),
    admissionDigest: DigestSchema,
  })
  .strict()
  .superRefine((admission, context) => {
    const identity = { ...admission, admissionDigest: undefined };
    if (admission.admissionDigest !== canonicalDigest(identity)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['admissionDigest'],
        message:
          'admission digest must bind the complete deterministic decision',
      });
    }
  });
export type P9ClaimAdmission = z.infer<typeof P9ClaimAdmissionSchema>;
