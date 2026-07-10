import { z } from 'zod';
import {
  DigestSchema,
  EntityIdSchema,
  NonEmptyStringSchema,
  TimestampSchema,
} from './primitives.js';

export const EvidenceKindSchema = z.enum([
  'web_snapshot',
  'paper',
  'dataset',
  'source_code',
  'test_output',
  'benchmark_output',
  'formal_proof',
  'human_attestation',
  'receipt',
  'system_observation',
]);
export const EvidenceArtifactSchema = z
  .object({
    id: EntityIdSchema,
    programId: EntityIdSchema,
    kind: EvidenceKindSchema,
    sourceUri: z.string().url().optional(),
    publisher: NonEmptyStringSchema.optional(),
    authors: z.array(NonEmptyStringSchema).optional(),
    publishedAt: TimestampSchema.optional(),
    retrievedAt: TimestampSchema,
    validFrom: TimestampSchema.optional(),
    validTo: TimestampSchema.optional(),
    expiresAt: TimestampSchema.optional(),
    revalidateAfter: TimestampSchema.optional(),
    contentDigest: DigestSchema,
    storageUri: NonEmptyStringSchema,
    mediaType: NonEmptyStringSchema,
    byteLength: z.number().int().nonnegative(),
    parserId: EntityIdSchema.optional(),
    parserVersion: NonEmptyStringSchema.optional(),
    parsedArtifactId: EntityIdSchema.optional(),
    sourceLineageId: EntityIdSchema,
    upstreamEvidenceIds: z.array(EntityIdSchema),
    injectionRisk: z.enum(['low', 'medium', 'high', 'quarantined']),
    dataClassification: z.enum([
      'public',
      'internal',
      'sensitive',
      'restricted',
    ]),
    receiptId: EntityIdSchema.optional(),
  })
  .strict()
  .superRefine((artifact, ctx) => {
    if (artifact.kind === 'web_snapshot' && !artifact.sourceUri) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sourceUri'],
        message: 'web snapshots require a source URI',
      });
    }
    if (
      artifact.validFrom &&
      artifact.validTo &&
      Date.parse(artifact.validTo) < Date.parse(artifact.validFrom)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['validTo'],
        message: 'validTo precedes validFrom',
      });
    }
  });

export const EvidenceLocatorSchema = z
  .object({
    page: z.number().int().positive().optional(),
    section: NonEmptyStringSchema.optional(),
    startOffset: z.number().int().nonnegative().optional(),
    endOffset: z.number().int().nonnegative().optional(),
    jsonPath: NonEmptyStringSchema.optional(),
    lineStart: z.number().int().positive().optional(),
    lineEnd: z.number().int().positive().optional(),
  })
  .strict()
  .superRefine((locator, ctx) => {
    if (Object.keys(locator).length === 0)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'an exact evidence locator is required',
      });
    if (
      locator.startOffset !== undefined &&
      locator.endOffset !== undefined &&
      locator.endOffset < locator.startOffset
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endOffset'],
        message: 'endOffset precedes startOffset',
      });
    }
    if (
      locator.lineStart !== undefined &&
      locator.lineEnd !== undefined &&
      locator.lineEnd < locator.lineStart
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['lineEnd'],
        message: 'lineEnd precedes lineStart',
      });
    }
  });

export const ClaimEvidenceEdgeSchema = z
  .object({
    id: EntityIdSchema,
    claimId: EntityIdSchema,
    evidenceId: EntityIdSchema,
    stance: z.enum(['supports', 'contradicts', 'context']),
    entailment: z.enum(['direct', 'partial', 'none', 'uncertain']),
    locator: EvidenceLocatorSchema,
    extractedByWorkItemId: EntityIdSchema,
    checkedByWorkItemId: EntityIdSchema.optional(),
    extractionDigest: DigestSchema,
  })
  .strict()
  .superRefine((edge, ctx) => {
    if (edge.stance === 'supports' && edge.entailment !== 'direct') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['entailment'],
        message: 'only direct entailment may create a supporting edge',
      });
    }
  });

export type EvidenceKind = z.infer<typeof EvidenceKindSchema>;
export type EvidenceArtifact = z.infer<typeof EvidenceArtifactSchema>;
export type EvidenceLocator = z.infer<typeof EvidenceLocatorSchema>;
export type ClaimEvidenceEdge = z.infer<typeof ClaimEvidenceEdgeSchema>;

export function isEvidenceFresh(
  artifact: EvidenceArtifact,
  at: string,
): boolean {
  const instant = Date.parse(at);
  return (
    (!artifact.expiresAt || instant < Date.parse(artifact.expiresAt)) &&
    (!artifact.validTo || instant <= Date.parse(artifact.validTo))
  );
}
