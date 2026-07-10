import { z } from 'zod';
import {
  DigestSchema,
  EntityIdSchema,
  NonEmptyStringSchema,
  SchemaVersionSchema,
  TimestampSchema,
} from './primitives.js';
import { canonicalDigest } from './digest.js';

export const ProgramBudgetSchema = z
  .object({
    maxCostUsd: z.number().nonnegative().finite(),
    maxTokens: z.number().int().nonnegative(),
    maxDurationSeconds: z.number().int().positive(),
  })
  .strict();

export const StopConditionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('deadline'), at: TimestampSchema }).strict(),
  z.object({ kind: z.literal('budget_exhausted') }).strict(),
  z
    .object({
      kind: z.literal('criterion_satisfied'),
      description: NonEmptyStringSchema,
    })
    .strict(),
  z.object({ kind: z.literal('human_stop') }).strict(),
]);

export const ResearchProgramSchema = z
  .object({
    id: EntityIdSchema,
    schemaVersion: SchemaVersionSchema,
    title: NonEmptyStringSchema,
    question: NonEmptyStringSchema,
    description: NonEmptyStringSchema.optional(),
    criterionId: EntityIdSchema,
    evidencePolicyId: EntityIdSchema,
    noveltyPolicyId: EntityIdSchema.optional(),
    humanApprovalPolicyId: EntityIdSchema,
    riskClass: z.enum(['low', 'moderate', 'high', 'critical']),
    budget: ProgramBudgetSchema,
    stopConditions: z.array(StopConditionSchema).min(1),
    falsifiers: z.array(NonEmptyStringSchema),
    status: z.enum([
      'draft',
      'active',
      'sleeping',
      'blocked',
      'completed',
      'abandoned',
      'cancelled',
    ]),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    completedAt: TimestampSchema.optional(),
  })
  .strict()
  .superRefine((program, ctx) => {
    if (program.status === 'completed' && !program.completedAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['completedAt'],
        message: 'completed programs require completedAt',
      });
    }
    if (program.completedAt && program.status !== 'completed') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['completedAt'],
        message: 'only completed programs may set completedAt',
      });
    }
    if (Date.parse(program.updatedAt) < Date.parse(program.createdAt)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['updatedAt'],
        message: 'updatedAt precedes createdAt',
      });
    }
  });

export const DecisionCriterionSchema = z
  .object({
    id: EntityIdSchema,
    programId: EntityIdSchema,
    version: z.number().int().positive(),
    question: NonEmptyStringSchema,
    standard: NonEmptyStringSchema,
    admissibleEvidence: z.array(NonEmptyStringSchema),
    prohibitedEvidence: z.array(NonEmptyStringSchema),
    tiePolicy: z.enum(['unresolved', 'human_review']),
    canonicalDigest: DigestSchema,
    createdAt: TimestampSchema,
    supersedesCriterionId: EntityIdSchema.optional(),
  })
  .strict();

export type ProgramBudget = z.infer<typeof ProgramBudgetSchema>;
export type StopCondition = z.infer<typeof StopConditionSchema>;
export type ResearchProgram = z.infer<typeof ResearchProgramSchema>;
export type DecisionCriterion = z.infer<typeof DecisionCriterionSchema>;

export type CriterionContent = Pick<
  DecisionCriterion,
  | 'programId'
  | 'version'
  | 'question'
  | 'standard'
  | 'admissibleEvidence'
  | 'prohibitedEvidence'
  | 'tiePolicy'
  | 'supersedesCriterionId'
>;

export function criterionDigest(criterion: CriterionContent): string {
  const content: CriterionContent = {
    programId: criterion.programId,
    version: criterion.version,
    question: criterion.question,
    standard: criterion.standard,
    admissibleEvidence: criterion.admissibleEvidence,
    prohibitedEvidence: criterion.prohibitedEvidence,
    tiePolicy: criterion.tiePolicy,
    ...(criterion.supersedesCriterionId
      ? { supersedesCriterionId: criterion.supersedesCriterionId }
      : {}),
  };
  return canonicalDigest(content);
}

export type CriterionRevisionResult =
  | { ok: true }
  | { ok: false; code: 'criterion_drift'; message: string };

/** Validates immutable criterion history; any semantic edit must be a new, linked version. */
export function validateCriterionRevision(
  previous: DecisionCriterion,
  next: DecisionCriterion,
): CriterionRevisionResult {
  if (previous.programId !== next.programId) {
    return {
      ok: false,
      code: 'criterion_drift',
      message: 'criterion cannot move between programs',
    };
  }
  if (previous.id === next.id) {
    return {
      ok: false,
      code: 'criterion_drift',
      message: 'criterion records are immutable; create a new id',
    };
  }
  if (
    next.version !== previous.version + 1 ||
    next.supersedesCriterionId !== previous.id
  ) {
    return {
      ok: false,
      code: 'criterion_drift',
      message:
        'criterion revision must increment version and link its predecessor',
    };
  }
  if (next.canonicalDigest !== criterionDigest(next)) {
    return {
      ok: false,
      code: 'criterion_drift',
      message: 'criterion digest does not match its canonical content',
    };
  }
  return { ok: true };
}

export const PROGRAM_TRANSITIONS = {
  draft: ['active', 'abandoned', 'cancelled'],
  active: ['sleeping', 'blocked', 'completed', 'abandoned', 'cancelled'],
  sleeping: ['active', 'blocked', 'abandoned', 'cancelled'],
  blocked: ['active', 'sleeping', 'abandoned', 'cancelled'],
  completed: [],
  abandoned: [],
  cancelled: [],
} as const satisfies Record<
  ResearchProgram['status'],
  readonly ResearchProgram['status'][]
>;

export function canTransitionProgram(
  from: ResearchProgram['status'],
  to: ResearchProgram['status'],
): boolean {
  return (PROGRAM_TRANSITIONS[from] as readonly string[]).includes(to);
}
