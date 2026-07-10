import { z } from 'zod';
import {
  DigestSchema,
  EntityIdSchema,
  NonEmptyStringSchema,
  TimestampSchema,
} from './primitives.js';

export const ReceiptSchema = z
  .object({
    id: EntityIdSchema,
    programId: EntityIdSchema,
    workItemId: EntityIdSchema.optional(),
    kind: z.enum([
      'source_acquired',
      'snapshot_refreshed',
      'experiment_executed',
      'benchmark_completed',
      'code_modified',
      'claim_promoted',
      'claim_revoked',
      'human_approval',
      'report_published',
    ]),
    claim: NonEmptyStringSchema,
    changes: z.array(NonEmptyStringSchema),
    evidenceIds: z.array(EntityIdSchema),
    verificationChecks: z.array(
      z
        .object({
          name: NonEmptyStringSchema,
          passed: z.boolean(),
          details: NonEmptyStringSchema.optional(),
        })
        .strict(),
    ),
    risks: z.array(NonEmptyStringSchema),
    assumptions: z.array(NonEmptyStringSchema),
    nextAction: NonEmptyStringSchema.optional(),
    inputDigest: DigestSchema,
    outputDigest: DigestSchema,
    artifactDigests: z.array(DigestSchema),
    createdAt: TimestampSchema,
    actorId: EntityIdSchema,
  })
  .strict();

export const AuditIntegritySchema = z
  .object({
    streamId: EntityIdSchema,
    sequence: z.number().int().nonnegative(),
    previousHash: DigestSchema,
    eventHash: DigestSchema,
    checkpoint: z
      .object({
        eventCount: z.number().int().positive(),
        highWaterSequence: z.number().int().nonnegative(),
        merkleRoot: DigestSchema,
        signedAt: TimestampSchema,
        signerId: EntityIdSchema,
        signature: NonEmptyStringSchema,
      })
      .strict()
      .optional(),
  })
  .strict();

export const AopObservationSchema = z
  .object({
    id: EntityIdSchema,
    eventType: NonEmptyStringSchema,
    taskId: EntityIdSchema.optional(),
    programId: EntityIdSchema,
    causalId: EntityIdSchema,
    occurredAt: TimestampSchema,
    capabilityIds: z.array(EntityIdSchema),
    memoryReferenceIds: z.array(EntityIdSchema),
    modelIds: z.array(EntityIdSchema),
    criterionId: EntityIdSchema,
    governance: z
      .object({
        decision: z.enum(['allow', 'deny', 'require_human']),
        violations: z.array(NonEmptyStringSchema),
      })
      .strict(),
    predictedOutcome: NonEmptyStringSchema.optional(),
    intendedAction: NonEmptyStringSchema,
    actualOutcome: NonEmptyStringSchema.optional(),
    inputDigest: DigestSchema,
    outputDigest: DigestSchema.optional(),
    artifactDigests: z.array(DigestSchema),
    budgetUsage: z
      .object({
        costUsd: z.number().nonnegative(),
        tokens: z.number().int().nonnegative(),
        durationMs: z.number().int().nonnegative(),
      })
      .strict(),
    receiptId: EntityIdSchema.optional(),
    payloadContractId: EntityIdSchema,
    integrity: AuditIntegritySchema,
  })
  .strict();

export type Receipt = z.infer<typeof ReceiptSchema>;
export type AuditIntegrity = z.infer<typeof AuditIntegritySchema>;
export type AopObservation = z.infer<typeof AopObservationSchema>;
