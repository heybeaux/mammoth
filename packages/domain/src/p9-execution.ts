import { z } from 'zod';
import { canonicalDigest } from './digest.js';
import { ResearchDomainPackIdSchema } from './p9-planning.js';

const DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const NonNegativeFiniteSchema = z.number().finite().nonnegative();
const NonNegativeIntegerSchema = z.number().int().nonnegative();
const PositiveIntegerSchema = z.number().int().positive();

export const P9_EXECUTION_CONTRACT_FAMILY = 'p9.v1' as const;

export const CoverageRequirementStatusSchema = z
  .object({
    coverageId: z.string().min(1),
    subquestionId: z.string().min(1),
    mandatory: z.boolean(),
    status: z.enum(['supported', 'unsupported']),
    supportingClaimIds: z.array(z.string().min(1)),
  })
  .strict()
  .superRefine((entry, context) => {
    if (entry.status === 'supported' && entry.supportingClaimIds.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'supported coverage requires at least one admitted claim',
      });
    }
    if (entry.status === 'unsupported' && entry.supportingClaimIds.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'unsupported coverage cannot cite supporting claims',
      });
    }
  });
export type CoverageRequirementStatus = z.infer<
  typeof CoverageRequirementStatusSchema
>;

export const SourceClassCoverageStatusSchema = z
  .object({
    sourceClass: z.string().min(1),
    mandatory: z.boolean(),
    minimumIndependentSources: PositiveIntegerSchema,
    independentSourceFamilyIds: z.array(z.string().min(1)),
    satisfied: z.boolean(),
  })
  .strict()
  .superRefine((entry, context) => {
    const families = new Set(entry.independentSourceFamilyIds);
    if (families.size !== entry.independentSourceFamilyIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'independent source families must be unique',
      });
    }
    if (entry.satisfied !== families.size >= entry.minimumIndependentSources) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'source class satisfaction must match its independent family count',
      });
    }
  });
export type SourceClassCoverageStatus = z.infer<
  typeof SourceClassCoverageStatusSchema
>;

export const ContradictionRequirementStatusSchema = z
  .object({
    contradictionId: z.string().min(1),
    status: z.enum(['found', 'not_found']),
    contradictedClaimIds: z.array(z.string().min(1)),
  })
  .strict()
  .superRefine((entry, context) => {
    if (entry.status === 'found' && entry.contradictedClaimIds.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'found contradiction requires contradicted claim identities',
      });
    }
    if (entry.status === 'not_found' && entry.contradictedClaimIds.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'absent contradiction cannot cite contradicted claims',
      });
    }
  });
export type ContradictionRequirementStatus = z.infer<
  typeof ContradictionRequirementStatusSchema
>;

export const FreshnessRequirementStatusSchema = z
  .object({
    freshnessId: z.string().min(1),
    evaluated: z.literal(true),
    knownPublicationDates: NonNegativeIntegerSchema,
    unknownPublicationDates: NonNegativeIntegerSchema,
    staleAttemptIds: z.array(z.string().min(1)),
  })
  .strict();
export type FreshnessRequirementStatus = z.infer<
  typeof FreshnessRequirementStatusSchema
>;

export const StopCriterionStatusSchema = z
  .object({
    stopId: z.string().min(1),
    status: z.enum(['met', 'not_met']),
    reason: z.string().min(1),
  })
  .strict();
export type StopCriterionStatus = z.infer<typeof StopCriterionStatusSchema>;

export const CriticalClaimCorroborationSchema = z
  .object({
    claimGroupId: z.string().min(1),
    criticalClaimIds: z.array(z.string().min(1)).min(1),
    independentSourceFamilyIds: z.array(z.string().min(1)),
    requiredIndependentFamilies: PositiveIntegerSchema,
    satisfied: z.boolean(),
  })
  .strict()
  .superRefine((entry, context) => {
    const families = new Set(entry.independentSourceFamilyIds);
    if (families.size !== entry.independentSourceFamilyIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'corroborating source families must be unique',
      });
    }
    if (
      entry.satisfied !==
      families.size >= entry.requiredIndependentFamilies
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'critical corroboration must match its independent family count',
      });
    }
  });
export type CriticalClaimCorroboration = z.infer<
  typeof CriticalClaimCorroborationSchema
>;

export const PlanCoverageGapSchema = z
  .string()
  .regex(/^[a-z0-9_]+(?::[A-Za-z0-9 ._/-]+)?$/u);
export type PlanCoverageGap = z.infer<typeof PlanCoverageGapSchema>;

export const PlanCoverageAssessmentSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    contractFamily: z.literal(P9_EXECUTION_CONTRACT_FAMILY),
    assessmentId: z.string().min(1),
    planId: z.string().min(1),
    planDigest: DigestSchema,
    packId: ResearchDomainPackIdSchema,
    policyId: z.string().min(1),
    coverageStatuses: z.array(CoverageRequirementStatusSchema).min(1),
    sourceClassStatuses: z.array(SourceClassCoverageStatusSchema).min(1),
    contradictionStatuses: z.array(ContradictionRequirementStatusSchema),
    freshnessStatuses: z.array(FreshnessRequirementStatusSchema).min(1),
    stopCriterionStatuses: z.array(StopCriterionStatusSchema).min(1),
    criticalClaimCorroborations: z.array(CriticalClaimCorroborationSchema),
    admittedClaimCount: NonNegativeIntegerSchema,
    criticalClaimCount: NonNegativeIntegerSchema,
    rejectedClaimCount: NonNegativeIntegerSchema,
    contradictedClaimCount: NonNegativeIntegerSchema,
    mandatorySourceClassCoverageRatio: z.number().finite().min(0).max(1),
    gaps: z.array(PlanCoverageGapSchema),
    verdict: z.enum(['covered', 'insufficient']),
    assessedAt: z.string().datetime(),
    assessmentDigest: DigestSchema,
  })
  .strict()
  .superRefine((assessment, context) => {
    if (new Set(assessment.gaps).size !== assessment.gaps.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['gaps'],
        message: 'coverage gaps must be unique',
      });
    }
    if ((assessment.verdict === 'covered') !== (assessment.gaps.length === 0)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['verdict'],
        message: 'covered verdict requires zero gaps and vice versa',
      });
    }
    const identity = { ...assessment, assessmentDigest: undefined };
    if (assessment.assessmentDigest !== canonicalDigest(identity)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['assessmentDigest'],
        message: 'assessment digest must bind the complete coverage result',
      });
    }
  });
export type PlanCoverageAssessment = z.infer<
  typeof PlanCoverageAssessmentSchema
>;

export const P9ReportSentenceSchema = z
  .object({
    sentenceId: z.string().min(1),
    kind: z.enum(['factual', 'interpretive']),
    text: z.string().min(1),
    claimIds: z.array(z.string().min(1)),
  })
  .strict()
  .superRefine((sentence, context) => {
    if (sentence.kind === 'factual' && sentence.claimIds.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'factual sentence requires at least one claim identity',
      });
    }
    if (sentence.kind === 'interpretive' && sentence.claimIds.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'interpretive sentence cannot cite claims as fact',
      });
    }
  });
export type P9ReportSentence = z.infer<typeof P9ReportSentenceSchema>;

export const P9ReportSectionSchema = z
  .object({
    sectionId: z.string().min(1),
    title: z.string().min(1),
    sentences: z.array(P9ReportSentenceSchema).min(1),
  })
  .strict();
export type P9ReportSection = z.infer<typeof P9ReportSectionSchema>;

export const P9ReportCitationSchema = z
  .object({
    claimId: z.string().min(1),
    admissionId: z.string().min(1),
    admissionPolicyId: z.string().min(1),
    admissionDigest: DigestSchema,
    verdictId: z.string().min(1),
    verdictDigest: DigestSchema,
    attemptId: z.string().min(1),
    requestedUrl: z.string().url(),
    sourceClass: z.string().min(1),
    sourceFamilyId: z.string().min(1),
    evidenceSpanId: z.string().min(1),
    snapshotDigest: DigestSchema,
    quoteDigest: DigestSchema,
    coordinateSpace: z.string().min(1),
    startOffset: NonNegativeIntegerSchema,
    endOffset: PositiveIntegerSchema,
  })
  .strict()
  .superRefine((citation, context) => {
    if (citation.endOffset <= citation.startOffset) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endOffset'],
        message: 'report citation must select a non-empty evidence span',
      });
    }
  });
export type P9ReportCitation = z.infer<typeof P9ReportCitationSchema>;

export const P9ReportContradictionSchema = z
  .object({
    proposalId: z.string().min(1),
    admissionId: z.string().min(1),
    verdictId: z.string().min(1),
    attemptId: z.string().min(1),
    contradictionIds: z.array(z.string().min(1)).min(1),
    statement: z.string().min(1),
    evidenceSpanId: z.string().min(1),
    snapshotDigest: DigestSchema,
    quoteDigest: DigestSchema,
    coordinateSpace: z.string().min(1),
    startOffset: NonNegativeIntegerSchema,
    endOffset: PositiveIntegerSchema,
  })
  .strict()
  .superRefine((contradiction, context) => {
    if (
      new Set(contradiction.contradictionIds).size !==
      contradiction.contradictionIds.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['contradictionIds'],
        message: 'contradiction identities must be unique',
      });
    }
    if (contradiction.endOffset <= contradiction.startOffset) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endOffset'],
        message: 'report contradiction must bind a non-empty evidence span',
      });
    }
  });
export type P9ReportContradiction = z.infer<typeof P9ReportContradictionSchema>;

export const P9ReportManifestSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    contractFamily: z.literal(P9_EXECUTION_CONTRACT_FAMILY),
    manifestId: z.string().min(1),
    planId: z.string().min(1),
    planDigest: DigestSchema,
    question: z.string().min(1),
    coverageAssessmentDigest: DigestSchema,
    sections: z.array(P9ReportSectionSchema).min(1),
    citations: z.array(P9ReportCitationSchema),
    contradictions: z.array(P9ReportContradictionSchema),
    compiledAt: z.string().datetime(),
    manifestDigest: DigestSchema,
  })
  .strict()
  .superRefine((manifest, context) => {
    const sectionIds = manifest.sections.map((section) => section.sectionId);
    if (new Set(sectionIds).size !== sectionIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sections'],
        message: 'report section ids must be unique',
      });
    }
    const sentenceIds = manifest.sections.flatMap((section) =>
      section.sentences.map((sentence) => sentence.sentenceId),
    );
    if (new Set(sentenceIds).size !== sentenceIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sections'],
        message: 'report sentence ids must be unique',
      });
    }
    const citedClaims = new Set(
      manifest.citations.map((citation) => citation.claimId),
    );
    if (citedClaims.size !== manifest.citations.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['citations'],
        message: 'report citations must bind unique admitted claim identities',
      });
    }
    for (const section of manifest.sections) {
      for (const sentence of section.sentences) {
        for (const claimId of sentence.claimIds) {
          if (!citedClaims.has(claimId)) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['citations'],
              message: `factual claim ${claimId} lacks a provenance citation`,
            });
          }
        }
      }
    }
    const identity = { ...manifest, manifestDigest: undefined };
    if (manifest.manifestDigest !== canonicalDigest(identity)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['manifestDigest'],
        message: 'manifest digest must bind the complete report manifest',
      });
    }
  });
export type P9ReportManifest = z.infer<typeof P9ReportManifestSchema>;

export const P9_REQUIRED_TYPED_RESIDUE_KEYS = [
  'retrieval_failures',
  'parser_failures',
  'rejected_claims',
  'unknown_costs',
  'redactions',
  'coverage_gaps',
] as const;

export const P9TypedResidueSchema = z
  .object({
    retrieval_failures: z.array(z.string().min(1)),
    parser_failures: z.array(z.string().min(1)),
    rejected_claims: z.array(z.string().min(1)),
    unknown_costs: z.array(z.string().min(1)),
    redactions: z.array(z.string().min(1)),
    coverage_gaps: z.array(PlanCoverageGapSchema),
  })
  .strict();
export type P9TypedResidue = z.infer<typeof P9TypedResidueSchema>;

export const P9ExecutionBudgetSummarySchema = z
  .object({
    authorizedUsd: NonNegativeFiniteSchema,
    reservedOpenUsd: NonNegativeFiniteSchema,
    spentKnownUsd: NonNegativeFiniteSchema,
    spentConservativeUnknownUsd: NonNegativeFiniteSchema,
    unknownCostReservationIds: z.array(z.string().min(1)),
    unknownCostSerializedAsZero: z.literal(false),
    withinAuthorization: z.boolean(),
  })
  .strict()
  .superRefine((budget, context) => {
    if (
      new Set(budget.unknownCostReservationIds).size !==
      budget.unknownCostReservationIds.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['unknownCostReservationIds'],
        message: 'unknown-cost reservation identities must be unique',
      });
    }
    if (
      budget.unknownCostReservationIds.length > 0 &&
      budget.spentConservativeUnknownUsd <= 0
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'unknown settlements must charge conservative reserved cost, never zero',
      });
    }
    const total =
      budget.reservedOpenUsd +
      budget.spentKnownUsd +
      budget.spentConservativeUnknownUsd;
    if (budget.withinAuthorization !== total <= budget.authorizedUsd) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'withinAuthorization must match the accounted totals',
      });
    }
  });
export type P9ExecutionBudgetSummary = z.infer<
  typeof P9ExecutionBudgetSummarySchema
>;

export const P9ExecutionCountsSchema = z
  .object({
    selectedCandidates: NonNegativeIntegerSchema,
    terminalAttempts: NonNegativeIntegerSchema,
    admittedSources: NonNegativeIntegerSchema,
    retrievalFailures: NonNegativeIntegerSchema,
    parserReceipts: NonNegativeIntegerSchema,
    parserFailures: NonNegativeIntegerSchema,
    claimProposals: NonNegativeIntegerSchema,
    admittedClaims: NonNegativeIntegerSchema,
    rejectedClaims: NonNegativeIntegerSchema,
    contradictedClaims: NonNegativeIntegerSchema,
    criticalClaims: NonNegativeIntegerSchema,
    factualSentences: NonNegativeIntegerSchema,
  })
  .strict()
  .superRefine((counts, context) => {
    if (counts.selectedCandidates !== counts.terminalAttempts) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'every selected candidate requires one terminal attempt',
      });
    }
    if (
      counts.terminalAttempts !==
      counts.admittedSources + counts.retrievalFailures
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'terminal attempts must equal admitted sources and retrieval failures',
      });
    }
    if (counts.parserFailures > counts.parserReceipts) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'parser failures cannot exceed parser receipts',
      });
    }
    if (
      counts.claimProposals !==
      counts.admittedClaims + counts.rejectedClaims + counts.contradictedClaims
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'claim proposals must equal admitted, rejected, and contradicted claims',
      });
    }
    if (counts.criticalClaims > counts.admittedClaims) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'critical claims cannot exceed admitted claims',
      });
    }
  });
export type P9ExecutionCounts = z.infer<typeof P9ExecutionCountsSchema>;

export const P9_REQUIRED_EXECUTION_ARTIFACTS = [
  'research-plan-proposal.json',
  'research-plan.json',
  'plan-acceptance-receipt.json',
  'retrieval-attempts.jsonl',
  'budget-ledger.json',
  'parser-receipts.jsonl',
  'entailment-verdicts.jsonl',
  'plan-coverage-assessment.json',
  'report-manifest.json',
  'report.md',
] as const;

export const P9ExecutionReceiptSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    contractFamily: z.literal(P9_EXECUTION_CONTRACT_FAMILY),
    executionId: z.string().min(1),
    planId: z.string().min(1),
    planDigest: DigestSchema,
    question: z.string().min(1),
    budget: P9ExecutionBudgetSummarySchema,
    counts: P9ExecutionCountsSchema,
    typedResidue: P9TypedResidueSchema,
    coverageVerdict: z.enum(['covered', 'insufficient']),
    coverageAssessmentDigest: DigestSchema,
    artifactDigests: z.record(z.string().min(1), DigestSchema),
    startedAt: z.string().datetime(),
    finishedAt: z.string().datetime(),
    receiptDigest: DigestSchema,
  })
  .strict()
  .superRefine((receipt, context) => {
    for (const artifact of P9_REQUIRED_EXECUTION_ARTIFACTS) {
      if (!(artifact in receipt.artifactDigests)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['artifactDigests'],
          message: `execution receipt must bind required artifact ${artifact}`,
        });
      }
    }
    if ('execution-receipt.json' in receipt.artifactDigests) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['artifactDigests'],
        message:
          'execution receipt cannot publish a self-referential artifact digest',
      });
    }
    const counts = receipt.counts;
    const residue = receipt.typedResidue;
    if (
      counts.retrievalFailures !== residue.retrieval_failures.length ||
      counts.parserFailures !== residue.parser_failures.length ||
      counts.rejectedClaims !== residue.rejected_claims.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['typedResidue'],
        message: 'typed residue must match the declared execution counts',
      });
    }
    const unknownReservationIds = new Set(
      receipt.budget.unknownCostReservationIds,
    );
    const unknownResidueIds = new Set(residue.unknown_costs);
    if (
      unknownReservationIds.size !==
        receipt.budget.unknownCostReservationIds.length ||
      unknownResidueIds.size !== residue.unknown_costs.length ||
      unknownReservationIds.size !== unknownResidueIds.size ||
      [...unknownReservationIds].some((id) => !unknownResidueIds.has(id))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['typedResidue', 'unknown_costs'],
        message: 'unknown cost residue must match unknown settlements',
      });
    }
    if (Date.parse(receipt.finishedAt) < Date.parse(receipt.startedAt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['finishedAt'],
        message: 'execution cannot finish before it starts',
      });
    }
    if (
      (receipt.coverageVerdict === 'covered') !==
      (residue.coverage_gaps.length === 0)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['coverageVerdict'],
        message: 'coverage verdict must match recorded coverage gaps',
      });
    }
    const identity = { ...receipt, receiptDigest: undefined };
    if (receipt.receiptDigest !== canonicalDigest(identity)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['receiptDigest'],
        message: 'receipt digest must bind the complete execution receipt',
      });
    }
  });
export type P9ExecutionReceipt = z.infer<typeof P9ExecutionReceiptSchema>;
