import {
  canonicalDigest,
  DomainPolicyPackSchema,
  P9ClaimAdmissionSchema,
  P9ClaimProposalSchema,
  PlanCoverageAssessmentSchema,
  ResearchPlanSchema,
  RetrievalAttemptSchema,
  type ContradictionRequirementStatus,
  type CoverageRequirementStatus,
  type CriticalClaimCorroboration,
  type DomainPolicyPack,
  type FreshnessRequirementStatus,
  type P9ClaimAdmission,
  type P9ClaimProposal,
  type PlanCoverageAssessment,
  type ResearchPlan,
  type RetrievalAttempt,
  type SourceClassCoverageStatus,
  type StopCriterionStatus,
} from '@mammoth/domain';
import { z } from 'zod';
import { GovernanceError } from './common.js';
import { materialQuestionTerms } from './p9-plan-authority.js';

export const P9_PLAN_COVERAGE_POLICY_ID = 'p9-plan-relative-coverage/v1';

/** Minimum material subquestion terms a claim must share to count as coverage. */
export const P9_MIN_SHARED_SUBQUESTION_TERMS = 2;

const CoverageEvidenceSchema = z
  .object({
    attemptId: z.string().min(1),
    snapshotDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    sourceClass: z.string().min(1),
    sourceFamilyId: z.string().min(1),
    evidenceDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  })
  .strict()
  .superRefine((evidence, context) => {
    const identity = { ...evidence, evidenceDigest: undefined };
    if (evidence.evidenceDigest !== canonicalDigest(identity)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'coverage evidence digest must bind immutable metadata',
      });
    }
  });

export interface P9ClaimEvidenceBinding {
  readonly proposal: P9ClaimProposal;
  readonly admission: P9ClaimAdmission;
  readonly subquestionIds: readonly string[];
  readonly claimGroupId: string;
  readonly contradictionIds: readonly string[];
  /** Immutable retrieval record; coverage derives source labels from this record. */
  readonly evidence: z.infer<typeof CoverageEvidenceSchema>;
}

export interface P9StopCriterionFinding {
  readonly stopId: string;
  readonly met: boolean;
  readonly reason: string;
}

export interface PlanCoverageThresholds {
  readonly minAdmittedClaims: number;
  readonly minCriticalClaims: number;
  readonly minIndependentFamiliesPerCriticalClaim: number;
  readonly minMandatorySourceClassCoverageRatio: number;
}

export interface PlanCoverageInput {
  readonly plan: ResearchPlan;
  readonly pack: DomainPolicyPack;
  readonly claims: readonly P9ClaimEvidenceBinding[];
  readonly attempts: readonly RetrievalAttempt[];
  readonly reportSectionTexts: readonly {
    readonly sectionId: string;
    readonly text: string;
  }[];
  readonly stopCriterionFindings: readonly P9StopCriterionFinding[];
  readonly thresholds: PlanCoverageThresholds;
  readonly assessedAt: string;
  readonly assessmentId?: string;
}

function sharedMaterialTermCount(statement: string, question: string): number {
  const statementTerms = new Set(materialQuestionTerms(statement));
  return materialQuestionTerms(question).filter((term) =>
    statementTerms.has(term),
  ).length;
}

/**
 * Verifies executed research against the accepted plan itself: claims only
 * count toward a coverage requirement when they are admitted, mapped to the
 * requirement's subquestion, and lexically anchored in that subquestion's
 * material terms. Domain keywords never gate unrelated reports.
 */
export function assessPlanCoverage(
  input: PlanCoverageInput,
): PlanCoverageAssessment {
  const plan = ResearchPlanSchema.parse(input.plan);
  const pack = DomainPolicyPackSchema.parse(input.pack);
  if (
    pack.packId !== plan.domainPackId ||
    pack.packDigest !== plan.packDigest
  ) {
    throw new GovernanceError(
      'coverage_pack_mismatch',
      'coverage assessment requires the exact accepted plan domain pack',
    );
  }
  const thresholds = input.thresholds;
  if (
    !Number.isSafeInteger(thresholds.minAdmittedClaims) ||
    thresholds.minAdmittedClaims < 0 ||
    !Number.isSafeInteger(thresholds.minCriticalClaims) ||
    thresholds.minCriticalClaims < 0 ||
    !Number.isSafeInteger(thresholds.minIndependentFamiliesPerCriticalClaim) ||
    thresholds.minIndependentFamiliesPerCriticalClaim < 0 ||
    !Number.isFinite(thresholds.minMandatorySourceClassCoverageRatio) ||
    thresholds.minMandatorySourceClassCoverageRatio < 0 ||
    thresholds.minMandatorySourceClassCoverageRatio > 1
  ) {
    throw new GovernanceError(
      'coverage_invalid_thresholds',
      'coverage thresholds must be finite non-negative bounds',
    );
  }
  const claims = input.claims.map((binding) => ({
    ...binding,
    proposal: P9ClaimProposalSchema.parse(binding.proposal),
    admission: P9ClaimAdmissionSchema.parse(binding.admission),
  }));
  for (const binding of claims) {
    if (
      binding.admission.proposalId !== binding.proposal.proposalId ||
      binding.admission.proposalDigest !== binding.proposal.proposalDigest
    ) {
      throw new GovernanceError(
        'coverage_claim_binding_mismatch',
        'claim admission does not bind the supplied proposal',
      );
    }
  }
  const attempts = input.attempts.map((attempt) =>
    RetrievalAttemptSchema.parse(attempt),
  );
  const attemptsById = new Map(
    attempts.map((attempt) => [attempt.attemptId, attempt]),
  );
  const proposalIds = new Set<string>();
  const admissionIds = new Set<string>();
  for (const binding of claims) {
    if (
      proposalIds.has(binding.proposal.proposalId) ||
      admissionIds.has(binding.admission.admissionId)
    ) {
      throw new GovernanceError(
        'coverage_duplicate_claim_binding',
        'coverage requires unique proposal and admission identities',
      );
    }
    proposalIds.add(binding.proposal.proposalId);
    admissionIds.add(binding.admission.admissionId);
    const evidence = CoverageEvidenceSchema.parse(binding.evidence);
    const attempt = attemptsById.get(evidence.attemptId);
    if (
      !attempt ||
      attempt.status !== 'admitted' ||
      evidence.snapshotDigest !== binding.proposal.locator.snapshotDigest
    ) {
      throw new GovernanceError(
        'coverage_evidence_binding_mismatch',
        'coverage labels require an admitted attempt and its immutable snapshot',
      );
    }
  }
  const gaps = new Set<string>();
  const admitted = claims.filter(
    (binding) => binding.admission.decision === 'admitted',
  );
  const contradicted = claims.filter(
    (binding) => binding.admission.decision === 'contradicted',
  );
  const rejected = claims.filter(
    (binding) => binding.admission.decision === 'rejected',
  );

  const subquestionById = new Map(
    plan.subquestions.map((entry) => [entry.subquestionId, entry]),
  );
  const coverageStatuses: CoverageRequirementStatus[] =
    plan.coverageRequirements.map((requirement) => {
      const subquestion = subquestionById.get(requirement.subquestionId);
      if (!subquestion) {
        throw new GovernanceError(
          'coverage_unknown_subquestion',
          `coverage ${requirement.coverageId} references unknown subquestion`,
        );
      }
      const supportingClaimIds = admitted
        .filter(
          (binding) =>
            binding.subquestionIds.includes(requirement.subquestionId) &&
            sharedMaterialTermCount(
              binding.proposal.statement,
              subquestion.question,
            ) >= P9_MIN_SHARED_SUBQUESTION_TERMS,
        )
        .map((binding) => binding.proposal.proposalId)
        .sort();
      const status =
        supportingClaimIds.length > 0 ? 'supported' : 'unsupported';
      if (status === 'unsupported' && requirement.mandatory) {
        gaps.add(`coverage_unsupported:${requirement.coverageId}`);
      }
      return {
        coverageId: requirement.coverageId,
        subquestionId: requirement.subquestionId,
        mandatory: requirement.mandatory,
        status,
        supportingClaimIds,
      };
    });

  const sourceClassStatuses: SourceClassCoverageStatus[] =
    plan.sourceClassTargets.map((target) => {
      const independentSourceFamilyIds = [
        ...new Set(
          admitted
            .filter(
              (binding) => binding.evidence.sourceClass === target.sourceClass,
            )
            .map((binding) => binding.evidence.sourceFamilyId),
        ),
      ].sort();
      const satisfied =
        independentSourceFamilyIds.length >= target.minimumIndependentSources;
      if (!satisfied && target.mandatory) {
        gaps.add(`source_class_uncovered:${target.sourceClass}`);
      }
      return {
        sourceClass: target.sourceClass,
        mandatory: target.mandatory,
        minimumIndependentSources: target.minimumIndependentSources,
        independentSourceFamilyIds,
        satisfied,
      };
    });
  const mandatoryTargets = sourceClassStatuses.filter(
    (status) => status.mandatory,
  );
  const mandatorySourceClassCoverageRatio =
    mandatoryTargets.length === 0
      ? 1
      : mandatoryTargets.filter((status) => status.satisfied).length /
        mandatoryTargets.length;
  if (
    mandatorySourceClassCoverageRatio <
    thresholds.minMandatorySourceClassCoverageRatio
  ) {
    gaps.add('source_class_coverage_ratio_below_minimum');
  }

  const contradictionStatuses: ContradictionRequirementStatus[] =
    plan.contradictionRequirements.map((requirement) => {
      const contradictedClaimIds = contradicted
        .filter((binding) =>
          binding.contradictionIds.includes(requirement.contradictionId),
        )
        .map((binding) => binding.proposal.proposalId)
        .sort();
      return {
        contradictionId: requirement.contradictionId,
        status: contradictedClaimIds.length > 0 ? 'found' : 'not_found',
        contradictedClaimIds,
      };
    });
  const admittedAttempts = attempts.filter(
    (attempt) => attempt.status === 'admitted',
  );
  const assessedAtMs = Date.parse(input.assessedAt);
  const freshnessStatuses: FreshnessRequirementStatus[] =
    plan.freshnessRequirements.map((requirement) => {
      const known = admittedAttempts.filter(
        (attempt) => attempt.publishedAt !== null,
      );
      const maxAgeDays = requirement.maxAgeDays;
      const staleAttemptIds =
        maxAgeDays === null
          ? []
          : known
              .filter(
                (attempt) =>
                  assessedAtMs - Date.parse(attempt.publishedAt ?? '') >
                  maxAgeDays * 24 * 60 * 60 * 1000,
              )
              .map((attempt) => attempt.attemptId)
              .sort();
      return {
        freshnessId: requirement.freshnessId,
        evaluated: true,
        knownPublicationDates: known.length,
        unknownPublicationDates: admittedAttempts.length - known.length,
        staleAttemptIds,
      };
    });
  for (const status of freshnessStatuses) {
    if (status.staleAttemptIds.length > 0) {
      gaps.add(`freshness_unmet:${status.freshnessId}`);
    }
  }

  const findingsByStopId = new Map(
    input.stopCriterionFindings.map((finding) => [finding.stopId, finding]),
  );
  const stopCriterionStatuses: StopCriterionStatus[] = plan.stopCriteria.map(
    (criterion) => {
      const finding = findingsByStopId.get(criterion.stopId);
      if (!finding) {
        gaps.add(`stop_criterion_unevaluated:${criterion.stopId}`);
        return {
          stopId: criterion.stopId,
          status: 'not_met',
          reason: 'no deterministic finding was recorded for this criterion',
        };
      }
      const status = finding.met ? 'met' : 'not_met';
      if (status === 'not_met')
        gaps.add(`stop_criterion_not_met:${criterion.stopId}`);
      return {
        stopId: criterion.stopId,
        status,
        reason: finding.reason,
      };
    },
  );

  const criticalGroups = new Map<string, P9ClaimEvidenceBinding[]>();
  for (const binding of admitted) {
    if (!criticalGroups.has(binding.claimGroupId)) {
      criticalGroups.set(binding.claimGroupId, []);
    }
    criticalGroups.get(binding.claimGroupId)?.push(binding);
  }
  const criticalClaimCorroborations: CriticalClaimCorroboration[] = [
    ...criticalGroups.entries(),
  ]
    .filter(([, members]) =>
      members.some((binding) => binding.proposal.critical),
    )
    .map(([claimGroupId, members]) => {
      const independentSourceFamilyIds = [
        ...new Set(members.map((binding) => binding.evidence.sourceFamilyId)),
      ].sort();
      const satisfied =
        independentSourceFamilyIds.length >=
        thresholds.minIndependentFamiliesPerCriticalClaim;
      if (!satisfied) {
        gaps.add(`critical_claim_uncorroborated:${claimGroupId}`);
      }
      return {
        claimGroupId,
        criticalClaimIds: members
          .filter((binding) => binding.proposal.critical)
          .map((binding) => binding.proposal.proposalId)
          .sort(),
        independentSourceFamilyIds,
        requiredIndependentFamilies:
          thresholds.minIndependentFamiliesPerCriticalClaim,
        satisfied,
      };
    })
    .sort((left, right) => left.claimGroupId.localeCompare(right.claimGroupId));

  const criticalClaimCount = admitted.filter(
    (binding) => binding.proposal.critical,
  ).length;
  if (admitted.length < thresholds.minAdmittedClaims) {
    gaps.add('admitted_claims_below_minimum');
  }
  if (criticalClaimCount < thresholds.minCriticalClaims) {
    gaps.add('critical_claims_below_minimum');
  }

  const scannableTexts = [
    ...input.reportSectionTexts.map((section) => section.text),
    ...claims.map((binding) => binding.proposal.statement),
  ];
  for (const term of pack.forbiddenTemplateVocabulary) {
    if (scannableTexts.some((text) => text.toLowerCase().includes(term))) {
      gaps.add(`forbidden_vocabulary:${term}`);
    }
  }

  const identity = {
    schemaVersion: '1.0.0' as const,
    contractFamily: 'p9.v1' as const,
    assessmentId: input.assessmentId ?? `coverage:${plan.planId}`,
    planId: plan.planId,
    planDigest: plan.planDigest,
    packId: plan.domainPackId,
    policyId: P9_PLAN_COVERAGE_POLICY_ID,
    coverageStatuses,
    sourceClassStatuses,
    contradictionStatuses,
    freshnessStatuses,
    stopCriterionStatuses,
    criticalClaimCorroborations,
    admittedClaimCount: admitted.length,
    criticalClaimCount,
    rejectedClaimCount: rejected.length,
    contradictedClaimCount: contradicted.length,
    mandatorySourceClassCoverageRatio,
    gaps: [...gaps].sort(),
    verdict: gaps.size === 0 ? ('covered' as const) : ('insufficient' as const),
    assessedAt: input.assessedAt,
  };
  return PlanCoverageAssessmentSchema.parse({
    ...identity,
    assessmentDigest: canonicalDigest(identity),
  });
}
