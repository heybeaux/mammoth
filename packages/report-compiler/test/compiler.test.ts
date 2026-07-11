import { describe, expect, it } from 'vitest';
import {
  compileReport,
  ReportManifestSchema,
  type ReportCompilerInput,
} from '../src/index.js';

const digest = `sha256:${'a'.repeat(64)}`;
const now = '2026-07-10T20:00:00.000Z';

function fixture(): ReportCompilerInput {
  return {
    manifest: {
      id: 'report-1',
      programId: 'program-1',
      version: 1,
      templateId: 'template-1',
      claimIds: ['claim-1'],
      hypothesisIds: [],
      experimentRunIds: [],
      unresolvedIssueIds: [],
      sourceFreshnessEvaluatedAt: now,
      compilerVersion: '1.0.0',
      outputArtifactIds: ['report-artifact-1'],
      receiptId: 'receipt-1',
    },
    template: {
      id: 'template-1',
      requiredStatuses: ['supported' as const],
      sections: [
        {
          id: 'findings',
          title: 'Findings',
          facts: [
            {
              id: 'fact-1',
              sectionId: 'findings',
              textTemplate: 'The measured value is {{value}}.',
              renderingData: { value: 42 },
              claimIds: ['claim-1'],
              status: 'supported' as const,
            },
          ],
        },
      ],
    },
    claims: [
      {
        id: 'claim-1',
        programId: 'program-1',
        criterionId: 'criterion-1',
        version: 1,
        kind: 'external_fact' as const,
        canonicalText: 'The measured value is 42.',
        subject: 'measured value',
        predicate: 'equals',
        object: '42',
        status: 'supported' as const,
        observedAt: now,
        recordedAt: now,
        contradictedByClaimIds: [],
        assessmentId: 'assessment-1',
        canonicalDigest: digest,
      },
    ],
    assessments: [
      {
        id: 'assessment-1',
        claimId: 'claim-1',
        policyId: 'policy-1',
        policyVersion: '1.0.0',
        verdict: 'supported' as const,
        reasonCodes: ['direct_fresh_support'],
        metrics: {
          evidenceCoverage: 1,
          directEntailmentCoverage: 1,
          sourceIndependence: 1,
          freshness: 1,
          reproducibility: 1,
          contradictionWeight: 0,
          correlatedVerifierRisk: 0,
        },
        evidenceIds: ['evidence-1'],
        evaluatedAt: now,
        evaluatorDigest: digest,
      },
    ],
    evidence: [
      {
        id: 'evidence-1',
        programId: 'program-1',
        kind: 'web_snapshot' as const,
        sourceUri: 'https://example.test/measurement',
        retrievedAt: '2026-07-10T19:00:00.000Z',
        expiresAt: '2026-07-11T20:00:00.000Z',
        contentDigest: digest,
        storageUri: 'cas://sha256/aaaa',
        mediaType: 'text/html',
        byteLength: 120,
        sourceLineageId: 'lineage-1',
        upstreamEvidenceIds: [],
        injectionRisk: 'low' as const,
        dataClassification: 'public' as const,
      },
    ],
    edges: [
      {
        id: 'edge-1',
        claimId: 'claim-1',
        evidenceId: 'evidence-1',
        stance: 'supports' as const,
        entailment: 'direct' as const,
        locator: { lineStart: 10, lineEnd: 10 },
        extractedByWorkItemId: 'work-1',
        checkedByWorkItemId: 'work-2',
        extractionDigest: digest,
      },
    ],
  };
}

describe('report manifest', () => {
  it('rejects incomplete manifests', () => {
    expect(ReportManifestSchema.safeParse({ id: 'report-1' }).success).toBe(
      false,
    );
  });
});

describe('evidence-bound report compilation', () => {
  it('emits prose with a sentence-to-policy-to-snapshot trace', () => {
    const result = compileReport(fixture());
    expect(result).toEqual({
      ok: true,
      report: {
        markdown: '## Findings\n\nThe measured value is 42.',
        traces: [
          {
            factNodeId: 'fact-1',
            sectionId: 'findings',
            sentence: 'The measured value is 42.',
            bindings: [
              {
                claimId: 'claim-1',
                assessmentId: 'assessment-1',
                policyId: 'policy-1',
                policyVersion: '1.0.0',
                evidenceId: 'evidence-1',
                snapshotDigest: digest,
                locator: { lineStart: 10, lineEnd: 10 },
              },
            ],
          },
        ],
      },
    });
  });

  it.each(['candidate', 'unresolved', 'contradicted', 'expired'] as const)(
    'rejects %s claims from supported factual sections',
    (status) => {
      const input = fixture();
      const claim = input.claims[0];
      if (!claim) throw new Error('fixture claim missing');
      claim.status = status;

      const result = compileReport(input);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              code: 'INELIGIBLE_CLAIM_STATUS',
              claimId: 'claim-1',
              factNodeId: 'fact-1',
            }),
          ]),
        );
      }
    },
  );

  it('rejects stale snapshots', () => {
    const input = fixture();
    const evidence = input.evidence[0];
    if (!evidence) throw new Error('fixture evidence missing');
    evidence.expiresAt = '2026-07-10T19:30:00.000Z';
    const result = compileReport(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'STALE_EVIDENCE' }),
          expect.objectContaining({ code: 'MISSING_EVIDENCE_BINDING' }),
        ]),
      );
    }
  });

  it('rejects prose whose claim is not declared by the manifest', () => {
    const input = fixture();
    input.manifest.claimIds = [];
    const result = compileReport(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]).toMatchObject({ code: 'UNDECLARED_CLAIM' });
    }
  });

  it('rejects multiple factual sentences hidden in one node', () => {
    const input = fixture();
    const section = input.template.sections[0];
    const fact = section?.facts[0];
    if (!fact) throw new Error('fixture fact missing');
    fact.textTemplate =
      'The measured value is {{value}}. A second fact appeared.';
    const result = compileReport(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]).toMatchObject({
        code: 'TEMPLATE_RENDER_ERROR',
      });
    }
  });
});
