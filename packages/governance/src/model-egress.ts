import { canonicalDigest } from '@mammoth/domain';
import { z } from 'zod';

export const MODEL_EGRESS_POLICY_VERSION = '1.0.0' as const;
const policyContract = {
  kind: 'model-egress-policy',
  version: MODEL_EGRESS_POLICY_VERSION,
  cloudDefault: 'deny',
  tools: [],
  localDestinations: ['localhost', '127.0.0.0/8', '::1/128'],
  cloudRequirements: ['cloud_allowed', 'exact_origin_allowlist', 'https'],
} as const;

const DigestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);

const ExactCloudOriginSchema = z
  .string()
  .url()
  .superRefine((approved, ctx) => {
    const url = new URL(approved);
    if (
      url.protocol !== 'https:' ||
      url.href !== `${url.origin}/` ||
      url.username !== '' ||
      url.password !== ''
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'approved cloud destinations must be exact HTTPS origins',
      });
    }
  });

export const ModelEgressPolicySchema = z
  .object({
    version: z.literal(MODEL_EGRESS_POLICY_VERSION),
    approvedCloudOrigins: z.array(ExactCloudOriginSchema),
    digest: DigestSchema,
  })
  .strict()
  .superRefine((policy, context) => {
    if (
      policy.digest !== modelEgressPolicyDigest(policy.approvedCloudOrigins)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['digest'],
        message: 'model egress policy digest is not canonical',
      });
    }
  });

export type ModelEgressPolicy = z.infer<typeof ModelEgressPolicySchema>;

export function createModelEgressPolicy(
  approvedCloudOrigins: readonly string[],
): ModelEgressPolicy {
  const origins = [...approvedCloudOrigins].sort();
  return ModelEgressPolicySchema.parse({
    version: MODEL_EGRESS_POLICY_VERSION,
    approvedCloudOrigins: origins,
    digest: modelEgressPolicyDigest(origins),
  });
}

export const DEFAULT_MODEL_EGRESS_POLICY = createModelEgressPolicy([]);
export const MODEL_EGRESS_POLICY_DIGEST = DEFAULT_MODEL_EGRESS_POLICY.digest;

export const ModelEgressEvaluationInputSchema = z
  .object({
    modelWorkIdentityDigest: DigestSchema,
    providerAttemptDigest: DigestSchema,
    reservationId: z.string().min(1),
    dataClassification: z.enum(['local_only', 'cloud_allowed']),
    provider: z.string().min(1),
    concreteModel: z.string().min(1),
    checkpoint: z.string().min(1),
    destinationOrigin: z.string().url(),
    allowedTools: z.array(z.never()).length(0),
    promptDigest: DigestSchema,
    policyDigest: DigestSchema,
  })
  .strict();

export type ModelEgressEvaluationInput = z.infer<
  typeof ModelEgressEvaluationInputSchema
>;

export interface ModelEgressEvaluation {
  readonly policyVersion: typeof MODEL_EGRESS_POLICY_VERSION;
  readonly policyDigest: string;
  readonly decision: 'allowed' | 'denied';
  readonly reason:
    | 'local_loopback_allowed'
    | 'cloud_origin_allowed'
    | 'cloud_default_deny'
    | 'local_only_non_loopback_denied'
    | 'cloud_origin_must_use_https'
    | 'policy_digest_mismatch'
    | 'destination_must_be_origin_only';
  readonly policyEvaluationDigest: string;
}

export function evaluateModelEgress(
  raw: ModelEgressEvaluationInput,
  rawPolicy: ModelEgressPolicy = DEFAULT_MODEL_EGRESS_POLICY,
): ModelEgressEvaluation {
  const input = ModelEgressEvaluationInputSchema.parse(raw);
  const policy = ModelEgressPolicySchema.parse(rawPolicy);
  const destination = new URL(input.destinationOrigin);
  const originOnly =
    destination.href === `${destination.origin}/` &&
    destination.username === '' &&
    destination.password === '';
  let decision: ModelEgressEvaluation['decision'] = 'denied';
  let reason: ModelEgressEvaluation['reason'];
  if (input.policyDigest !== policy.digest) {
    reason = 'policy_digest_mismatch';
  } else if (!originOnly) {
    reason = 'destination_must_be_origin_only';
  } else if (isLoopback(destination.hostname)) {
    decision = 'allowed';
    reason = 'local_loopback_allowed';
  } else if (input.dataClassification === 'local_only') {
    reason = 'local_only_non_loopback_denied';
  } else if (destination.protocol !== 'https:') {
    reason = 'cloud_origin_must_use_https';
  } else if (
    policy.approvedCloudOrigins.some(
      (approved) => new URL(approved).origin === destination.origin,
    )
  ) {
    decision = 'allowed';
    reason = 'cloud_origin_allowed';
  } else {
    reason = 'cloud_default_deny';
  }
  const unsigned = {
    policyVersion: MODEL_EGRESS_POLICY_VERSION,
    policyDigest: policy.digest,
    decision,
    reason,
  };
  return {
    ...unsigned,
    policyEvaluationDigest: canonicalDigest({
      kind: 'model-egress-decision',
      input,
      policy,
      ...unsigned,
    }),
  };
}

function modelEgressPolicyDigest(origins: readonly string[]): string {
  return canonicalDigest({ ...policyContract, approvedCloudOrigins: origins });
}

function isLoopback(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/gu, '');
  if (host === 'localhost' || host === '::1') return true;
  const match = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/u.exec(host);
  return match !== null && Number(match[1]) === 127;
}
