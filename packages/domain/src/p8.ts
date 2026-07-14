import { z } from 'zod';
import { canonicalDigest } from './digest.js';
import {
  DigestSchema,
  EntityIdSchema,
  NonEmptyStringSchema,
  SchemaVersionSchema,
  TimestampSchema,
  type Digest,
} from './primitives.js';

export const P8_CONTRACT_FAMILY = 'p8.v1' as const;
export const P8_SCHEMA_VERSION = '1.0.0' as const;

export const P8DepthSchema = z.enum(['quick', 'standard', 'comprehensive']);
export const P8ModeSchema = z.enum(['report', 'explore']);

export const P8BudgetSchema = z
  .object({
    maxCostUsd: z.number().nonnegative().finite(),
    maxTokens: z.number().int().nonnegative(),
    maxSearchRequests: z.number().int().nonnegative(),
    maxRetrievalRequests: z.number().int().nonnegative(),
    maxRetrievalBytes: z.number().int().nonnegative(),
  })
  .strict();

export const ResearchBriefSchema = z
  .object({
    schemaVersion: z.literal(P8_SCHEMA_VERSION),
    contractFamily: z.literal(P8_CONTRACT_FAMILY),
    mode: P8ModeSchema,
    question: NonEmptyStringSchema,
    audience: NonEmptyStringSchema,
    geography: NonEmptyStringSchema,
    timeframe: NonEmptyStringSchema,
    depth: P8DepthSchema,
    outputDirectory: NonEmptyStringSchema,
    constraints: z.array(NonEmptyStringSchema),
    risk: z.enum(['low', 'moderate', 'high']),
    budget: P8BudgetSchema,
    briefDigest: DigestSchema,
  })
  .strict()
  .superRefine((brief, ctx) => {
    if (brief.briefDigest !== p8IdentityDigest('p8-research-brief', brief)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['briefDigest'],
        message: 'brief digest is not canonical',
      });
    }
  });

export const QuestionCharterSchema = z
  .object({
    schemaVersion: z.literal(P8_SCHEMA_VERSION),
    contractFamily: z.literal(P8_CONTRACT_FAMILY),
    briefDigest: DigestSchema,
    charterDigest: DigestSchema,
    normalizedQuestion: NonEmptyStringSchema,
    criterionVersion: z.number().int().positive(),
    subquestions: z.array(NonEmptyStringSchema).min(1),
    coverageTopicIds: z.array(EntityIdSchema).min(1),
    admissibleEvidence: z.array(NonEmptyStringSchema).min(1),
    prohibitedEvidence: z.array(NonEmptyStringSchema).min(1),
    falsifiers: z.array(NonEmptyStringSchema).min(1),
    stopPolicy: z
      .object({
        maxCycles: z.number().int().positive(),
        requireEveryTopicSupportedOrInsufficient: z.literal(true),
        requireEvidenceDrivenFollowUpWhenGapDetected: z.literal(true),
      })
      .strict(),
  })
  .strict()
  .superRefine((charter, ctx) => {
    if (
      charter.charterDigest !== p8IdentityDigest('p8-question-charter', charter)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['charterDigest'],
        message: 'charter digest is not canonical',
      });
    }
  });

export const EvidenceSpanV1Schema = z
  .object({
    id: EntityIdSchema,
    sourceId: EntityIdSchema,
    rawSnapshotDigest: DigestSchema,
    parsedArtifactDigest: DigestSchema,
    parserId: NonEmptyStringSchema,
    parserVersion: SchemaVersionSchema,
    locator: z
      .object({
        coordinateSpace: z.enum(['text-offset', 'json-path', 'pdf-page-text']),
        version: z.literal(P8_SCHEMA_VERSION),
        lineStart: z.number().int().positive(),
        lineEnd: z.number().int().positive(),
        quote: NonEmptyStringSchema,
        quoteDigest: DigestSchema,
      })
      .strict(),
    spanDigest: DigestSchema,
  })
  .strict()
  .superRefine((span, ctx) => {
    if (span.locator.lineEnd < span.locator.lineStart) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['locator', 'lineEnd'],
        message: 'lineEnd precedes lineStart',
      });
    }
    if (span.locator.quoteDigest !== canonicalDigest(span.locator.quote)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['locator', 'quoteDigest'],
        message: 'quote digest is not canonical',
      });
    }
    if (span.spanDigest !== p8IdentityDigest('p8-evidence-span', span)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['spanDigest'],
        message: 'span digest is not canonical',
      });
    }
  });

export const ClaimProposalV1Schema = z
  .object({
    id: EntityIdSchema,
    topicId: EntityIdSchema,
    text: NonEmptyStringSchema,
    sourceIds: z.array(EntityIdSchema).min(1),
    evidenceSpanIds: z.array(EntityIdSchema).min(1),
    policyId: NonEmptyStringSchema,
    policyVerdict: z.enum([
      'supported',
      'contradicted',
      'unresolved',
      'rejected',
    ]),
    reasonCodes: z.array(NonEmptyStringSchema).min(1),
    lineageFamilyIds: z.array(EntityIdSchema).min(1),
    claimDigest: DigestSchema,
  })
  .strict()
  .superRefine((claim, ctx) => {
    if (claim.claimDigest !== p8IdentityDigest('p8-claim-proposal', claim)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['claimDigest'],
        message: 'claim digest is not canonical',
      });
    }
  });

export const ReportSentenceV1Schema = z
  .object({
    id: EntityIdSchema,
    kind: z.enum([
      'heading',
      'question',
      'method',
      'limitation',
      'uncertainty',
      'recommendation',
      'transition',
      'factual',
    ]),
    text: NonEmptyStringSchema,
    claimIds: z.array(EntityIdSchema),
    policyVerdicts: z.array(NonEmptyStringSchema),
    locatorIds: z.array(EntityIdSchema),
    snapshotDigests: z.array(DigestSchema),
    sourceLineageIds: z.array(EntityIdSchema),
  })
  .strict()
  .superRefine((sentence, ctx) => {
    if (sentence.kind === 'factual') {
      const fields = [
        ['claimIds', sentence.claimIds],
        ['policyVerdicts', sentence.policyVerdicts],
        ['locatorIds', sentence.locatorIds],
        ['snapshotDigests', sentence.snapshotDigests],
        ['sourceLineageIds', sentence.sourceLineageIds],
      ] as const;
      for (const [path, values] of fields) {
        if (values.length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [path],
            message: 'factual sentence requires full provenance',
          });
        }
      }
    }
  });

export const ReportBlockV1Schema = z
  .object({
    id: EntityIdSchema,
    kind: z.enum(['section', 'appendix', 'table']),
    title: NonEmptyStringSchema,
    sentences: z.array(ReportSentenceV1Schema).min(1),
  })
  .strict();

export const ReportManifestV1Schema = z
  .object({
    schemaVersion: z.literal(P8_SCHEMA_VERSION),
    contractFamily: z.literal(P8_CONTRACT_FAMILY),
    mode: P8ModeSchema,
    question: NonEmptyStringSchema,
    briefDigest: DigestSchema,
    charterDigest: DigestSchema,
    generatedAt: TimestampSchema,
    blocks: z.array(ReportBlockV1Schema).min(1),
    claims: z.array(ClaimProposalV1Schema).min(1),
    evidenceSpans: z.array(EvidenceSpanV1Schema).min(1),
    manifestDigest: DigestSchema,
  })
  .strict()
  .superRefine((manifest, ctx) => {
    if (
      manifest.manifestDigest !==
      p8IdentityDigest('p8-report-manifest', manifest)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['manifestDigest'],
        message: 'report manifest digest is not canonical',
      });
    }
  });

export type P8Depth = z.infer<typeof P8DepthSchema>;
export type ResearchBrief = z.infer<typeof ResearchBriefSchema>;
export type QuestionCharter = z.infer<typeof QuestionCharterSchema>;
export type EvidenceSpanV1 = z.infer<typeof EvidenceSpanV1Schema>;
export type ClaimProposalV1 = z.infer<typeof ClaimProposalV1Schema>;
export type ReportSentenceV1 = z.infer<typeof ReportSentenceV1Schema>;
export type ReportBlockV1 = z.infer<typeof ReportBlockV1Schema>;
export type ReportManifestV1 = z.infer<typeof ReportManifestV1Schema>;

type Digestible = Record<string, unknown>;

export function p8IdentityDigest(label: string, value: Digestible): Digest {
  const withoutDigestFields = Object.fromEntries(
    Object.entries(value).filter(([key]) => !key.endsWith('Digest')),
  );
  return canonicalDigest([label, P8_SCHEMA_VERSION, withoutDigestFields]);
}
