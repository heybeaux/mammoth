import { z } from 'zod';
import {
  ClaimAssessmentSchema,
  ClaimEvidenceEdgeSchema,
  ClaimSchema,
  DigestSchema,
  EntityIdSchema,
  EvidenceArtifactSchema,
  EvidenceLocatorSchema,
  NonEmptyStringSchema,
  TimestampSchema,
} from '@mammoth/domain';

export const ReportManifestSchema = z
  .object({
    id: EntityIdSchema,
    programId: EntityIdSchema,
    version: z.number().int().positive(),
    templateId: EntityIdSchema,
    claimIds: z.array(EntityIdSchema),
    hypothesisIds: z.array(EntityIdSchema),
    experimentRunIds: z.array(EntityIdSchema),
    unresolvedIssueIds: z.array(EntityIdSchema),
    sourceFreshnessEvaluatedAt: TimestampSchema,
    compilerVersion: NonEmptyStringSchema,
    outputArtifactIds: z.array(EntityIdSchema),
    receiptId: EntityIdSchema,
  })
  .strict();

export const ReportFactNodeSchema = z
  .object({
    id: EntityIdSchema,
    sectionId: EntityIdSchema,
    textTemplate: NonEmptyStringSchema,
    claimIds: z.array(EntityIdSchema).min(1),
    renderingData: z.record(z.union([z.string(), z.number(), z.boolean()])),
    status: z.enum(['supported', 'contradicted', 'unresolved', 'historical']),
  })
  .strict();

export const ReportSectionSchema = z
  .object({
    id: EntityIdSchema,
    title: NonEmptyStringSchema,
    facts: z.array(ReportFactNodeSchema),
  })
  .strict();

export const ReportTemplateSchema = z
  .object({
    id: EntityIdSchema,
    sections: z.array(ReportSectionSchema).min(1),
    requiredStatuses: z
      .array(z.enum(['supported', 'contradicted', 'unresolved', 'historical']))
      .default([]),
  })
  .strict();

export const ReportCompilerInputSchema = z
  .object({
    manifest: ReportManifestSchema,
    template: ReportTemplateSchema,
    claims: z.array(ClaimSchema),
    assessments: z.array(ClaimAssessmentSchema),
    evidence: z.array(EvidenceArtifactSchema),
    edges: z.array(ClaimEvidenceEdgeSchema),
  })
  .strict();

export const EvidenceBindingSchema = z
  .object({
    claimId: EntityIdSchema,
    assessmentId: EntityIdSchema,
    policyId: EntityIdSchema,
    policyVersion: NonEmptyStringSchema,
    evidenceId: EntityIdSchema,
    snapshotDigest: DigestSchema,
    locator: EvidenceLocatorSchema,
  })
  .strict();

export const ReportSentenceTraceSchema = z
  .object({
    factNodeId: EntityIdSchema,
    sectionId: EntityIdSchema,
    sentence: NonEmptyStringSchema,
    bindings: z.array(EvidenceBindingSchema).min(1),
  })
  .strict();

export type ReportManifest = z.infer<typeof ReportManifestSchema>;
export type ReportFactNode = z.infer<typeof ReportFactNodeSchema>;
export type ReportTemplate = z.infer<typeof ReportTemplateSchema>;
export type ReportCompilerInput = z.infer<typeof ReportCompilerInputSchema>;
export type EvidenceBinding = z.infer<typeof EvidenceBindingSchema>;
export type ReportSentenceTrace = z.infer<typeof ReportSentenceTraceSchema>;

export interface ReportCompilation {
  markdown: string;
  traces: ReportSentenceTrace[];
}

export interface CompilationIssue {
  code:
    | 'INVALID_INPUT'
    | 'MANIFEST_TEMPLATE_MISMATCH'
    | 'UNDECLARED_CLAIM'
    | 'MISSING_CLAIM'
    | 'INELIGIBLE_CLAIM_STATUS'
    | 'MISSING_ASSESSMENT'
    | 'ASSESSMENT_NOT_ELIGIBLE'
    | 'MISSING_EVIDENCE_BINDING'
    | 'STALE_EVIDENCE'
    | 'TEMPLATE_RENDER_ERROR'
    | 'MISSING_REQUIRED_STATUS';
  message: string;
  factNodeId?: string;
  claimId?: string;
}

export type CompilationResult =
  | { ok: true; report: ReportCompilation }
  | { ok: false; issues: CompilationIssue[] };
