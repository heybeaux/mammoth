import { z } from 'zod';
import {
  DigestSchema,
  EntityIdSchema,
  NonEmptyStringSchema,
  TimestampSchema,
  UnitIntervalSchema,
} from './primitives.js';

export const ClaimKindSchema = z.enum([
  'external_fact',
  'operational',
  'derived',
  'experimental',
  'forecast',
  'hypothesis',
  'normative',
]);
export const ClaimStatusSchema = z.enum([
  'observed',
  'candidate',
  'supported',
  'contradicted',
  'unresolved',
  'expired',
  'revoked',
  'superseded',
]);

export const ClaimSchema = z
  .object({
    id: EntityIdSchema,
    programId: EntityIdSchema,
    criterionId: EntityIdSchema,
    version: z.number().int().positive(),
    kind: ClaimKindSchema,
    canonicalText: NonEmptyStringSchema,
    subject: NonEmptyStringSchema,
    predicate: NonEmptyStringSchema,
    object: NonEmptyStringSchema,
    status: ClaimStatusSchema,
    validFrom: TimestampSchema.optional(),
    validTo: TimestampSchema.optional(),
    observedAt: TimestampSchema,
    recordedAt: TimestampSchema,
    supersedesClaimId: EntityIdSchema.optional(),
    contradictedByClaimIds: z.array(EntityIdSchema),
    assessmentId: EntityIdSchema.optional(),
    canonicalDigest: DigestSchema,
  })
  .strict()
  .superRefine((claim, ctx) => {
    if (
      claim.validFrom &&
      claim.validTo &&
      Date.parse(claim.validTo) < Date.parse(claim.validFrom)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['validTo'],
        message: 'validTo precedes validFrom',
      });
    }
    if (claim.version > 1 && !claim.supersedesClaimId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['supersedesClaimId'],
        message: 'versioned claims must link their predecessor',
      });
    }
  });

export const ClaimAssessmentSchema = z
  .object({
    id: EntityIdSchema,
    claimId: EntityIdSchema,
    policyId: EntityIdSchema,
    policyVersion: NonEmptyStringSchema,
    verdict: z.enum([
      'supported',
      'contradicted',
      'unresolved',
      'expired',
      'needs_human',
    ]),
    reasonCodes: z.array(NonEmptyStringSchema).min(1),
    metrics: z
      .object({
        evidenceCoverage: UnitIntervalSchema,
        directEntailmentCoverage: UnitIntervalSchema,
        sourceIndependence: UnitIntervalSchema,
        freshness: UnitIntervalSchema,
        reproducibility: UnitIntervalSchema,
        contradictionWeight: UnitIntervalSchema,
        correlatedVerifierRisk: UnitIntervalSchema,
      })
      .strict(),
    evidenceIds: z.array(EntityIdSchema),
    evaluatedAt: TimestampSchema,
    evaluatorDigest: DigestSchema,
  })
  .strict();

export type ClaimKind = z.infer<typeof ClaimKindSchema>;
export type ClaimStatus = z.infer<typeof ClaimStatusSchema>;
export type Claim = z.infer<typeof ClaimSchema>;
export type ClaimAssessment = z.infer<typeof ClaimAssessmentSchema>;

export const CLAIM_TRANSITIONS = {
  observed: ['candidate'],
  candidate: ['supported', 'contradicted', 'unresolved'],
  supported: ['expired', 'revoked', 'superseded'],
  contradicted: ['candidate'],
  unresolved: ['candidate'],
  expired: ['candidate'],
  revoked: ['candidate'],
  superseded: [],
} as const satisfies Record<ClaimStatus, readonly ClaimStatus[]>;

export type ClaimPromotionAuthority =
  | 'model'
  | 'evidence_policy'
  | 'human_exception'
  | 'system';
export interface ClaimTransitionContext {
  authority: ClaimPromotionAuthority;
  assessment?: ClaimAssessment;
  receiptId?: string;
  humanApprovalId?: string;
}
export type ClaimTransitionResult =
  | { ok: true }
  | {
      ok: false;
      code:
        | 'illegal_claim_transition'
        | 'fabricated_promotion'
        | 'assessment_mismatch'
        | 'unreceipted_exception';
      message: string;
    };

export function validateClaimTransition(
  claim: Claim,
  to: ClaimStatus,
  context: ClaimTransitionContext,
): ClaimTransitionResult {
  if (!(CLAIM_TRANSITIONS[claim.status] as readonly string[]).includes(to)) {
    return {
      ok: false,
      code: 'illegal_claim_transition',
      message: `${claim.status} cannot transition to ${to}`,
    };
  }
  if (to === 'supported') {
    if (context.authority === 'model') {
      return {
        ok: false,
        code: 'fabricated_promotion',
        message: 'model output cannot promote a claim to supported',
      };
    }
    if (context.authority === 'evidence_policy') {
      if (
        !context.assessment ||
        context.assessment.claimId !== claim.id ||
        context.assessment.verdict !== 'supported'
      ) {
        return {
          ok: false,
          code: 'assessment_mismatch',
          message: 'support requires a matching supported policy assessment',
        };
      }
    } else if (context.authority === 'human_exception') {
      if (!context.receiptId || !context.humanApprovalId) {
        return {
          ok: false,
          code: 'unreceipted_exception',
          message: 'human policy exceptions require approval and receipt ids',
        };
      }
    } else {
      return {
        ok: false,
        code: 'fabricated_promotion',
        message:
          'only evidence policy or explicit human exception may support a claim',
      };
    }
  }
  return { ok: true };
}

export function validateClaimRevision(previous: Claim, next: Claim): boolean {
  return (
    previous.programId === next.programId &&
    previous.criterionId === next.criterionId &&
    previous.id !== next.id &&
    next.version === previous.version + 1 &&
    next.supersedesClaimId === previous.id
  );
}
