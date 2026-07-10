import { isEvidenceFresh } from '@mammoth/domain';
import type { ClaimStatus } from '@mammoth/domain';
import {
  ReportCompilerInputSchema,
  type CompilationIssue,
  type CompilationResult,
  type EvidenceBinding,
  type ReportFactNode,
} from './types.js';

const ELIGIBLE_STATUSES: Record<ReportFactNode['status'], ClaimStatus[]> = {
  supported: ['supported'],
  contradicted: ['contradicted'],
  unresolved: ['unresolved'],
  historical: ['expired', 'revoked', 'superseded'],
};

function renderFact(node: ReportFactNode): string | undefined {
  const referenced = new Set<string>();
  const rendered = node.textTemplate.replace(
    /\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g,
    (_match, key: string) => {
      referenced.add(key);
      const value = node.renderingData[key];
      return value === undefined ? `{{${key}}}` : String(value);
    },
  );
  const supplied = Object.keys(node.renderingData);
  if (
    rendered.includes('{{') ||
    supplied.some((key) => !referenced.has(key)) ||
    /[.!?]\s+\S/.test(rendered)
  ) {
    return undefined;
  }
  return rendered.trim();
}

export function compileReport(input: unknown): CompilationResult {
  const parsed = ReportCompilerInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: [
        {
          code: 'INVALID_INPUT',
          message: parsed.error.issues.map((issue) => issue.message).join('; '),
        },
      ],
    };
  }

  const data = parsed.data;
  const issues: CompilationIssue[] = [];
  if (data.manifest.templateId !== data.template.id) {
    issues.push({
      code: 'MANIFEST_TEMPLATE_MISMATCH',
      message: `manifest template ${data.manifest.templateId} does not match ${data.template.id}`,
    });
  }

  const manifestClaims = new Set(data.manifest.claimIds);
  const claims = new Map(data.claims.map((claim) => [claim.id, claim]));
  const assessments = new Map(
    data.assessments.map((assessment) => [assessment.claimId, assessment]),
  );
  const evidence = new Map(
    data.evidence.map((artifact) => [artifact.id, artifact]),
  );
  const traces: NonNullable<
    Extract<CompilationResult, { ok: true }>['report']
  >['traces'] = [];
  const markdown: string[] = [];

  for (const status of data.template.requiredStatuses) {
    if (
      !data.template.sections.some((section) =>
        section.facts.some((fact) => fact.status === status),
      )
    ) {
      issues.push({
        code: 'MISSING_REQUIRED_STATUS',
        message: `template requires a ${status} section fact`,
      });
    }
  }

  for (const section of data.template.sections) {
    markdown.push(`## ${section.title}`, '');
    for (const fact of section.facts) {
      const sentence = renderFact(fact);
      if (!sentence) {
        issues.push({
          code: 'TEMPLATE_RENDER_ERROR',
          message: 'fact template contains missing or unused rendering data',
          factNodeId: fact.id,
        });
        continue;
      }

      const bindings: EvidenceBinding[] = [];
      for (const claimId of fact.claimIds) {
        if (!manifestClaims.has(claimId)) {
          issues.push({
            code: 'UNDECLARED_CLAIM',
            message: `claim ${claimId} is absent from the report manifest`,
            factNodeId: fact.id,
            claimId,
          });
          continue;
        }
        const claim = claims.get(claimId);
        if (!claim) {
          issues.push({
            code: 'MISSING_CLAIM',
            message: `claim ${claimId} was not supplied to the compiler`,
            factNodeId: fact.id,
            claimId,
          });
          continue;
        }
        if (!ELIGIBLE_STATUSES[fact.status].includes(claim.status)) {
          issues.push({
            code: 'INELIGIBLE_CLAIM_STATUS',
            message: `${claim.status} claim cannot render as ${fact.status}`,
            factNodeId: fact.id,
            claimId,
          });
          continue;
        }
        const assessment = assessments.get(claimId);
        if (!assessment) {
          issues.push({
            code: 'MISSING_ASSESSMENT',
            message: `claim ${claimId} has no policy assessment`,
            factNodeId: fact.id,
            claimId,
          });
          continue;
        }
        if (claim.assessmentId && claim.assessmentId !== assessment.id) {
          issues.push({
            code: 'ASSESSMENT_NOT_ELIGIBLE',
            message: `claim ${claimId} points to assessment ${claim.assessmentId}, not ${assessment.id}`,
            factNodeId: fact.id,
            claimId,
          });
          continue;
        }
        if (
          fact.status !== 'historical' &&
          assessment.verdict !== fact.status
        ) {
          issues.push({
            code: 'ASSESSMENT_NOT_ELIGIBLE',
            message: `assessment verdict ${assessment.verdict} cannot render as ${fact.status}`,
            factNodeId: fact.id,
            claimId,
          });
          continue;
        }

        const requiredStance =
          fact.status === 'supported'
            ? 'supports'
            : fact.status === 'contradicted'
              ? 'contradicts'
              : undefined;
        const candidates = data.edges.filter(
          (edge) =>
            edge.claimId === claimId &&
            assessment.evidenceIds.includes(edge.evidenceId) &&
            (!requiredStance || edge.stance === requiredStance),
        );
        for (const edge of candidates) {
          const artifact = evidence.get(edge.evidenceId);
          if (!artifact) continue;
          if (
            fact.status !== 'historical' &&
            !isEvidenceFresh(artifact, data.manifest.sourceFreshnessEvaluatedAt)
          ) {
            issues.push({
              code: 'STALE_EVIDENCE',
              message: `evidence ${artifact.id} was stale at compilation time`,
              factNodeId: fact.id,
              claimId,
            });
            continue;
          }
          bindings.push({
            claimId,
            assessmentId: assessment.id,
            policyId: assessment.policyId,
            policyVersion: assessment.policyVersion,
            evidenceId: artifact.id,
            snapshotDigest: artifact.contentDigest,
            locator: edge.locator,
          });
        }
        if (!bindings.some((binding) => binding.claimId === claimId)) {
          issues.push({
            code: 'MISSING_EVIDENCE_BINDING',
            message: `claim ${claimId} has no assessed evidence with an exact locator and snapshot`,
            factNodeId: fact.id,
            claimId,
          });
        }
      }

      if (bindings.length > 0) {
        traces.push({
          factNodeId: fact.id,
          sectionId: section.id,
          sentence,
          bindings,
        });
        markdown.push(sentence, '');
      }
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, report: { markdown: markdown.join('\n').trim(), traces } };
}
