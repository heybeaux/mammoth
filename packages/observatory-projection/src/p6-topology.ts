import { canonicalDigest } from '@mammoth/domain';
import {
  DigestSchema,
  EntityIdSchema,
  NonEmptyStringSchema,
  TimestampSchema,
} from '@mammoth/domain';
import { z } from 'zod';

const P6CellStateSchema = z.enum([
  'planned',
  'ready',
  'running',
  'blocked_dependency',
  'budget_starved',
  'concurrency_saturated',
  'failed_policy',
  'cancelled',
  'complete',
]);

const P6ReceiptRefSchema = z
  .object({
    receiptId: EntityIdSchema,
    digest: DigestSchema,
  })
  .strict();

const P6TopologyRecordSchema = z
  .object({
    id: EntityIdSchema,
    programId: EntityIdSchema,
    criterionId: EntityIdSchema,
    criterionVersion: z.number().int().positive(),
    criterionDigest: DigestSchema,
    planDigest: DigestSchema,
    budgetCeilingUsd: z.number().nonnegative(),
    concurrencyLimit: z.number().int().positive(),
  })
  .strict();

const P6SynthesisProjectionRecordSchema = z
  .object({
    manifestId: EntityIdSchema,
    admittedClaimIds: z.array(EntityIdSchema),
    preservedDissentIds: z.array(EntityIdSchema),
    unresolvedIssueIds: z.array(EntityIdSchema),
    sentenceTraceDigest: DigestSchema,
  })
  .strict();

export const P6TopologyProjectionInputSchema = z
  .object({
    schemaVersion: z.literal(1),
    extensionVersion: z.literal('1.0.0'),
    generatedAt: TimestampSchema,
    authoritativeRevision: z.number().int().nonnegative(),
    auditHeadHash: DigestSchema,
    complete: z.boolean(),
    omissions: z.array(NonEmptyStringSchema),
    topology: P6TopologyRecordSchema,
    cells: z.array(
      z
        .object({
          id: EntityIdSchema,
          templateId: EntityIdSchema,
          templateVersion: z.literal('1.0.0'),
          stableIdentityDigest: DigestSchema,
          state: P6CellStateSchema,
          dependencyCellIds: z.array(EntityIdSchema),
          claimIds: z.array(EntityIdSchema),
          evidenceIds: z.array(EntityIdSchema),
          dissentIds: z.array(EntityIdSchema),
          receiptRefs: z.array(P6ReceiptRefSchema),
          reservationUsd: z.number().nonnegative(),
          consumedUsd: z.number().nonnegative(),
          releasedUsd: z.number().nonnegative(),
          retryCount: z.number().int().nonnegative(),
          partialFailure: z.boolean(),
          temporalWorkflowId: NonEmptyStringSchema.optional(),
          hiddenTemporalProductStateDigest: DigestSchema.optional(),
          recordDigest: DigestSchema,
          authoritativeRevision: z.number().int().nonnegative(),
        })
        .strict(),
    ),
    synthesis: P6SynthesisProjectionRecordSchema,
    writeAttempts: z.array(
      z
        .object({
          id: EntityIdSchema,
          attemptedAt: TimestampSchema,
          target: NonEmptyStringSchema,
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.complete && input.omissions.length > 0)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['omissions'],
        message: 'complete P6 projections cannot declare omissions',
      });
    if (!input.complete && input.omissions.length === 0)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['omissions'],
        message: 'incomplete P6 projections must name omissions',
      });
  });

export type P6TopologyProjectionInput = z.infer<
  typeof P6TopologyProjectionInputSchema
>;

export const P6TopologyProjectionSchema = z
  .object({
    schemaVersion: z.literal(1),
    extensionVersion: z.literal('1.0.0'),
    generatedAt: TimestampSchema,
    sourceRevision: NonEmptyStringSchema,
    topology: P6TopologyRecordSchema,
    cells: z.array(
      z
        .object({
          id: EntityIdSchema,
          templateId: EntityIdSchema,
          state: P6CellStateSchema,
          dependencyCellIds: z.array(EntityIdSchema),
          claimIds: z.array(EntityIdSchema),
          evidenceIds: z.array(EntityIdSchema),
          dissentIds: z.array(EntityIdSchema),
          receiptIds: z.array(EntityIdSchema),
          reservationUsd: z.number().nonnegative(),
          consumedUsd: z.number().nonnegative(),
          releasedUsd: z.number().nonnegative(),
          retryCount: z.number().int().nonnegative(),
          partialFailure: z.boolean(),
          temporalWorkflowId: NonEmptyStringSchema.optional(),
        })
        .strict(),
    ),
    synthesis: P6SynthesisProjectionRecordSchema,
    integrity: z
      .object({
        canonicalDigest: DigestSchema,
        authoritativeRevision: z.number().int().nonnegative(),
        auditHeadHash: DigestSchema,
        complete: z.boolean(),
        omissions: z.array(NonEmptyStringSchema),
      })
      .strict(),
  })
  .strict();

export type P6TopologyProjection = z.infer<typeof P6TopologyProjectionSchema>;

export function buildP6TopologyProjection(
  input: unknown,
): P6TopologyProjection {
  const source = P6TopologyProjectionInputSchema.parse(input);
  validateP6TopologyProjection(source);
  const withoutDigest = {
    schemaVersion: 1 as const,
    extensionVersion: '1.0.0' as const,
    generatedAt: source.generatedAt,
    sourceRevision: String(source.authoritativeRevision),
    topology: source.topology,
    cells: [...source.cells]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((cell) => ({
        id: cell.id,
        templateId: cell.templateId,
        state: cell.state,
        dependencyCellIds: [...cell.dependencyCellIds].sort(),
        claimIds: [...cell.claimIds].sort(),
        evidenceIds: [...cell.evidenceIds].sort(),
        dissentIds: [...cell.dissentIds].sort(),
        receiptIds: cell.receiptRefs
          .map(({ receiptId }) => receiptId)
          .sort((left, right) => left.localeCompare(right)),
        reservationUsd: cell.reservationUsd,
        consumedUsd: cell.consumedUsd,
        releasedUsd: cell.releasedUsd,
        retryCount: cell.retryCount,
        partialFailure: cell.partialFailure,
        ...(cell.temporalWorkflowId === undefined
          ? {}
          : { temporalWorkflowId: cell.temporalWorkflowId }),
      })),
    synthesis: {
      ...source.synthesis,
      admittedClaimIds: [...source.synthesis.admittedClaimIds].sort(),
      preservedDissentIds: [...source.synthesis.preservedDissentIds].sort(),
      unresolvedIssueIds: [...source.synthesis.unresolvedIssueIds].sort(),
    },
    integrity: {
      authoritativeRevision: source.authoritativeRevision,
      auditHeadHash: source.auditHeadHash,
      complete: source.complete,
      omissions: [...source.omissions].sort(),
    },
  };
  return P6TopologyProjectionSchema.parse({
    ...withoutDigest,
    integrity: {
      canonicalDigest: canonicalDigest(withoutDigest),
      ...withoutDigest.integrity,
    },
  });
}

function validateP6TopologyProjection(source: P6TopologyProjectionInput): void {
  if (source.writeAttempts.length > 0)
    throw new Error(
      'P6 projection is read-only and cannot include write attempts',
    );
  const ids = new Set<string>();
  for (const cell of source.cells) {
    if (ids.has(cell.id)) throw new Error(`duplicate topology cell ${cell.id}`);
    ids.add(cell.id);
    if (cell.authoritativeRevision > source.authoritativeRevision)
      throw new Error(`topology cell ${cell.id} references future authority`);
    if (cell.recordDigest !== canonicalDigest(cellWithoutRecordDigest(cell)))
      throw new Error(`topology cell ${cell.id} digest mismatch`);
    if (cell.hiddenTemporalProductStateDigest !== undefined)
      throw new Error(
        `topology cell ${cell.id} contains hidden Temporal product state`,
      );
    if (cell.consumedUsd + cell.releasedUsd > cell.reservationUsd)
      throw new Error(`topology cell ${cell.id} overspends its reservation`);
  }
  for (const cell of source.cells) {
    for (const dependencyId of cell.dependencyCellIds) {
      if (!ids.has(dependencyId))
        throw new Error(
          `topology cell ${cell.id} has broken dependency ${dependencyId}`,
        );
    }
  }
  if (source.complete) {
    const projectedClaims = new Set(
      source.cells.flatMap(({ claimIds }) => claimIds),
    );
    const omitted = source.synthesis.admittedClaimIds.filter(
      (claimId) => !projectedClaims.has(claimId),
    );
    if (omitted.length > 0)
      throw new Error(
        `P6 projection silently omits admitted claims: ${omitted.join(',')}`,
      );
  }
}

function cellWithoutRecordDigest(
  cell: P6TopologyProjectionInput['cells'][number],
): Omit<P6TopologyProjectionInput['cells'][number], 'recordDigest'> {
  const { recordDigest: _recordDigest, ...withoutDigest } = cell;
  return withoutDigest;
}
