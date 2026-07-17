import {
  AcquisitionReleaseSchema,
  canonicalDigest,
  INVESTIGATION_ACQUISITION_CONTRACT_FAMILY,
  INVESTIGATION_ACQUISITION_POLICY_ID,
  INVESTIGATION_ACQUISITION_RELEASE_POLICY_ID,
  InvestigationAcquisitionIntentSetSchema,
  InvestigationPlanSchema,
  P9LiveAuthorityReceiptSchema,
  TimestampSchema,
  type AcquisitionIntent,
  type AcquisitionRelease,
  type InvestigationAcquisitionIntentSet,
  type InvestigationPlan,
} from '@mammoth/domain';

export {
  AcquisitionIntentSchema,
  AcquisitionReleaseSchema,
  INVESTIGATION_ACQUISITION_CONTRACT_FAMILY,
  INVESTIGATION_ACQUISITION_POLICY_ID,
  INVESTIGATION_ACQUISITION_RELEASE_POLICY_ID,
  InvestigationAcquisitionIntentSetSchema,
  type AcquisitionIntent,
  type AcquisitionRelease,
  type InvestigationAcquisitionIntentSet,
} from '@mammoth/domain';

function intentId(
  planDigest: string,
  kind: AcquisitionIntent['kind'],
  index: number,
  subject: string,
): string {
  return `intent:${canonicalDigest({ planDigest, kind, index, subject }).slice(7, 23)}`;
}

/**
 * Deterministically projects an accepted immutable investigation plan into
 * generic discovery and acquisition intents. Every subject is taken verbatim
 * from the digest-bound plan; nothing here may branch on topic content. The
 * result is strictly no-effect: it declares work, it does not execute any.
 */
export function deriveAcquisitionIntents(
  planInput: unknown,
): InvestigationAcquisitionIntentSet {
  const plan: InvestigationPlan = InvestigationPlanSchema.parse(planInput);
  const intents: AcquisitionIntent[] = [];
  for (const [index, query] of plan.plan.searchQueries.entries()) {
    const discoveryId = intentId(
      plan.planDigest,
      'discovery.search',
      index,
      query,
    );
    intents.push({
      intentId: discoveryId,
      kind: 'discovery.search',
      subject: query,
      derivedFrom: `plan.searchQueries[${String(index)}]`,
      dependsOn: [],
      steps: [
        'enumerate candidate public sources for the subject query',
        'classify candidates under the pinned source policy',
        'emit candidate source records for acquisition',
      ],
      constraints: [...plan.plan.contradictionChecks],
    });
    intents.push({
      intentId: intentId(plan.planDigest, 'acquisition.preserve', index, query),
      kind: 'acquisition.preserve',
      subject: query,
      derivedFrom: `plan.searchQueries[${String(index)}]`,
      dependsOn: [discoveryId],
      steps: [
        'policy-pinned retrieval of admitted candidate sources',
        'immutable snapshot preservation with content digests',
        'deterministic parsing with recorded lineage',
        'exact source span extraction for claim support',
      ],
      constraints: [...plan.plan.evidenceRequirements],
    });
  }
  const identity = {
    schemaVersion: '1.0.0' as const,
    contractFamily: INVESTIGATION_ACQUISITION_CONTRACT_FAMILY,
    intentSetId: `acquisition:${plan.investigationId}`,
    investigationId: plan.investigationId,
    planId: plan.planId,
    planDigest: plan.planDigest,
    sourcePreviewDigest: plan.sourcePreviewDigest,
    approvalId: plan.approvalId,
    question: plan.question,
    derivationPolicyId: INVESTIGATION_ACQUISITION_POLICY_ID,
    effectAuthority: 'none_granted' as const,
    executionAuthorized: false as const,
    externalEffectsExecuted: false as const,
    coverage: {
      subquestions: [...plan.plan.subquestions],
      evidenceRequirements: [...plan.plan.evidenceRequirements],
      falsificationChecks: [...plan.plan.falsificationChecks],
      contradictionChecks: [...plan.plan.contradictionChecks],
      stopCriteria: [...plan.plan.stopCriteria],
    },
    intents,
  };
  return InvestigationAcquisitionIntentSetSchema.parse({
    ...identity,
    intentSetDigest: canonicalDigest(identity),
  });
}

export interface AcquisitionReleaseInput {
  readonly intentSet: unknown;
  readonly effectAuthority?: unknown;
  readonly trustedIssuerId?: string;
  readonly now: string;
}

const REQUIRED_ACQUISITION_EFFECT_KINDS = [
  'search',
  'retrieval',
  'parser',
] as const;

/**
 * Fail-closed gate between derived acquisition intents and any executor.
 * Authorization is never implicit: it requires a valid scoped live authority
 * receipt from a caller-pinned trusted issuer that binds the exact plan digest
 * and question of the derived intent set and is inside its validity window.
 * Even an authorized release executes nothing; it only names the authority
 * under which a separately governed executor may act.
 */
export function evaluateAcquisitionRelease(
  input: AcquisitionReleaseInput,
): AcquisitionRelease {
  const intentSet = InvestigationAcquisitionIntentSetSchema.parse(
    input.intentSet,
  );
  const evaluatedAt = TimestampSchema.parse(input.now);
  const now = Date.parse(evaluatedAt);
  const reasons = new Set<string>();
  let authorityReceiptDigest: string | null = null;
  if (input.effectAuthority === undefined || input.effectAuthority === null) {
    reasons.add('no_scoped_effect_authority');
  } else {
    const parsed = P9LiveAuthorityReceiptSchema.safeParse(
      input.effectAuthority,
    );
    if (!parsed.success) {
      reasons.add('invalid_effect_authority_receipt');
    } else {
      const receipt = parsed.data;
      if (!input.trustedIssuerId) {
        reasons.add('no_trusted_authority_issuer');
      } else if (receipt.issuerId !== input.trustedIssuerId) {
        reasons.add('untrusted_authority_issuer');
      }
      if (receipt.planScope.planDigest !== intentSet.planDigest) {
        reasons.add('authority_plan_scope_mismatch');
      }
      if (
        receipt.planScope.question !== intentSet.question ||
        receipt.planScope.questionDigest !== canonicalDigest(intentSet.question)
      ) {
        reasons.add('authority_question_scope_mismatch');
      }
      if (now < Date.parse(receipt.notBeforeAt)) {
        reasons.add('authority_not_yet_valid');
      }
      if (now >= Date.parse(receipt.expiresAt)) {
        reasons.add('authority_expired');
      }
      const effectKinds = new Set(receipt.authorizedEffectKinds);
      for (const kind of REQUIRED_ACQUISITION_EFFECT_KINDS) {
        if (!effectKinds.has(kind)) {
          reasons.add('authority_missing_required_effect_kind');
        }
      }
      if (reasons.size === 0) authorityReceiptDigest = receipt.receiptDigest;
    }
  }
  const decision = reasons.size === 0 ? 'authorized' : 'refused';
  const reasonCodes =
    decision === 'authorized'
      ? ['acquisition_release_policy_satisfied']
      : [...reasons].sort();
  const identity = {
    schemaVersion: '1.0.0' as const,
    contractFamily: INVESTIGATION_ACQUISITION_CONTRACT_FAMILY,
    releaseId: `acquisition-release:${canonicalDigest({
      intentSetDigest: intentSet.intentSetDigest,
      evaluatedAt,
      authorityReceiptDigest,
      decision,
    }).slice(7, 23)}`,
    investigationId: intentSet.investigationId,
    planDigest: intentSet.planDigest,
    intentSetDigest: intentSet.intentSetDigest,
    decision,
    reasonCodes,
    authorityReceiptDigest,
    releasePolicyId: INVESTIGATION_ACQUISITION_RELEASE_POLICY_ID,
    evaluatedAt,
    externalEffectsExecuted: false as const,
  };
  return AcquisitionReleaseSchema.parse({
    ...identity,
    releaseDigest: canonicalDigest(identity),
  });
}
