import {
  P9_REQUIRED_EXECUTION_ARTIFACTS,
  canonicalDigest,
} from '@mammoth/domain';
import { describe, expect, it } from 'vitest';
import {
  RESEARCH_PROJECTION_CONTRACT_FAMILY,
  ResearchProjectionIntegrityError,
  compileResearchProjections,
  verifyResearchProjectionBundle,
  type ResearchProjectionInput,
} from '../src/index.js';

const at = '2026-07-17T06:00:00.000Z';
const digest = (value: string) => canonicalDigest(value);

const domains = [
  {
    label: 'technical',
    question: 'Which local inference optimization should be tested first?',
    title: 'Runtime benchmark methodology',
    url: 'https://example.org/runtime-benchmark',
    sourceClass: 'primary_technical',
    factual:
      'The benchmark reports lower median latency under the bounded configuration.',
    interpretation:
      'The bounded configuration is therefore the best candidate for a controlled local test.',
  },
  {
    label: 'policy',
    question: 'Which cooling policy most reduces heat exposure?',
    title: 'Municipal heat response evaluation',
    url: 'https://example.gov/heat-response',
    sourceClass: 'government_evaluation',
    factual:
      'The evaluation reports higher cooling-centre attendance after extended evening hours.',
    interpretation:
      'Extended evening hours are the strongest policy candidate for a bounded pilot.',
  },
  {
    label: 'scientific',
    question: 'Which soil treatment should be replicated next?',
    title: 'Multi-site soil treatment study',
    url: 'https://example.edu/soil-treatment',
    sourceClass: 'peer_reviewed_study',
    factual:
      'The multi-site study reports higher water retention for the amended plots.',
    interpretation:
      'Replication should prioritize the amendment under a preregistered protocol.',
  },
] as const;

function fixture(domain: (typeof domains)[number]): ResearchProjectionInput {
  const prefix = domain.label;
  const sourceId = `source:${prefix}:primary`;
  const rejectedSourceId = `source:${prefix}:rejected`;
  const admittedClaimId = `claim:${prefix}:admitted`;
  const rejectedClaimId = `claim:${prefix}:rejected`;
  const primarySnapshot = digest(`${prefix}:primary-snapshot`);
  const rejectedSnapshot = digest(`${prefix}:rejected-snapshot`);
  const primaryParserRecord = {
    parserClass: 'bounded-text',
    status: 'parsed',
    candidate: sourceId,
  };
  const rejectedParserRecord = {
    parserClass: 'bounded-text',
    status: 'parsed',
    candidate: rejectedSourceId,
  };
  const budgetEntries = [
    {
      reservationId: `reservation:${prefix}:research`,
      state: 'settled',
      chargedUsd: 0.12,
    },
  ];
  const verificationRecord = {
    verifier: 'projection-fixture',
    verdict: 'releaseable',
  };
  return {
    schemaVersion: '1.0.0',
    contractFamily: RESEARCH_PROJECTION_CONTRACT_FAMILY,
    question: domain.question,
    compiledAt: at,
    lineage: {
      planId: `plan:${prefix}`,
      planDigest: digest(`${prefix}:plan`),
      acceptanceReceiptId: `acceptance:${prefix}`,
      acceptanceReceiptDigest: digest(`${prefix}:acceptance`),
      executionId: `execution:${prefix}`,
      executionReceiptId: `execution-receipt:${prefix}`,
      executionReceiptDigest: digest(`${prefix}:execution-receipt`),
    },
    coverage: {
      assessmentId: `coverage:${prefix}`,
      assessmentDigest: digest(`${prefix}:coverage`),
      verdict: 'covered',
      gaps: [],
    },
    operatorResidue: {
      budgetJournal: {
        journalDigest: canonicalDigest(budgetEntries),
        entries: budgetEntries,
      },
      parserReceipts: [
        {
          recordId: `parser:${prefix}:primary`,
          recordDigest: canonicalDigest(primaryParserRecord),
          record: primaryParserRecord,
        },
        {
          recordId: `parser:${prefix}:rejected`,
          recordDigest: canonicalDigest(rejectedParserRecord),
          record: rejectedParserRecord,
        },
      ],
      verificationRecords: [
        {
          recordId: `verification:${prefix}:releaseability`,
          recordDigest: canonicalDigest(verificationRecord),
          record: verificationRecord,
        },
      ],
    },
    sources: [
      {
        sourceId,
        title: domain.title,
        url: domain.url,
        sourceClass: domain.sourceClass,
        sourceFamilyId: `family:${prefix}:primary`,
        snapshotDigest: primarySnapshot,
        retrievedAt: at,
        attemptId: `attempt:${prefix}:primary`,
        attemptDigest: digest(`${prefix}:attempt-primary`),
        parserReceiptId: `parser:${prefix}:primary`,
        parserReceiptDigest: canonicalDigest(primaryParserRecord),
      },
      {
        sourceId: rejectedSourceId,
        title: 'Contrary source',
        url: `https://independent.example/${prefix}`,
        sourceClass: 'independent_analysis',
        sourceFamilyId: `family:${prefix}:independent`,
        snapshotDigest: rejectedSnapshot,
        retrievedAt: at,
        attemptId: `attempt:${prefix}:rejected`,
        attemptDigest: digest(`${prefix}:attempt-rejected`),
        parserReceiptId: `parser:${prefix}:rejected`,
        parserReceiptDigest: canonicalDigest(rejectedParserRecord),
      },
    ],
    claims: [
      {
        claimId: admittedClaimId,
        statement: domain.factual,
        proposalId: `proposal:${prefix}:admitted`,
        proposalDigest: digest(`${prefix}:proposal-admitted`),
        verdictId: `verdict:${prefix}:admitted`,
        verdictDigest: digest(`${prefix}:verdict-admitted`),
        verdict: 'entailed',
        evaluatorProfileVersionId: `evaluator:${prefix}:v1`,
        evaluatorProfileFamilyId: `evaluator-family:${prefix}`,
        verdictReasonCodes: ['evidence_entails_statement'],
        admissionId: `admission:${prefix}:admitted`,
        admissionDigest: digest(`${prefix}:admission-admitted`),
        admissionPolicyId: 'independent_entailment/v1',
        admissionDecision: 'admitted',
        admissionReasonCodes: ['independently_entailed'],
        evidence: [
          {
            sourceId,
            snapshotDigest: primarySnapshot,
            quoteDigest: digest(`${prefix}:primary-quote`),
            locator: {
              coordinateSpace: 'utf16-code-units/v1',
              startOffset: 20,
              endOffset: 80,
            },
          },
        ],
      },
      {
        claimId: rejectedClaimId,
        statement: 'A broader conclusion not supported by the bounded source.',
        proposalId: `proposal:${prefix}:rejected`,
        proposalDigest: digest(`${prefix}:proposal-rejected`),
        verdictId: `verdict:${prefix}:rejected`,
        verdictDigest: digest(`${prefix}:verdict-rejected`),
        verdict: 'insufficient',
        evaluatorProfileVersionId: `evaluator:${prefix}:v1`,
        evaluatorProfileFamilyId: `evaluator-family:${prefix}`,
        verdictReasonCodes: ['scope_exceeds_evidence'],
        admissionId: `admission:${prefix}:rejected`,
        admissionDigest: digest(`${prefix}:admission-rejected`),
        admissionPolicyId: 'independent_entailment/v1',
        admissionDecision: 'rejected',
        admissionReasonCodes: ['not_entailed'],
        evidence: [
          {
            sourceId: rejectedSourceId,
            snapshotDigest: rejectedSnapshot,
            quoteDigest: digest(`${prefix}:rejected-quote`),
            locator: {
              coordinateSpace: 'utf16-code-units/v1',
              startOffset: 4,
              endOffset: 44,
            },
          },
        ],
      },
    ],
    sections: [
      {
        sectionId: `section:${prefix}:answer`,
        title: 'Answer',
        sentences: [
          {
            sentenceId: `sentence:${prefix}:interpretation`,
            kind: 'interpretive',
            text: domain.interpretation,
            claimIds: [],
          },
          {
            sentenceId: `sentence:${prefix}:fact`,
            kind: 'factual',
            text: domain.factual,
            claimIds: [admittedClaimId],
          },
        ],
      },
    ],
    rejectionResidue: [
      {
        claimId: rejectedClaimId,
        stage: 'independent_evaluation',
        reasonCodes: ['scope_exceeds_evidence'],
      },
    ],
  };
}

describe('versioned reader and audit projections', () => {
  for (const domain of domains) {
    it(`compiles and verifies a ${domain.label} answer through the same contract`, () => {
      const input = fixture(domain);
      const bundle = compileResearchProjections(input);

      expect(bundle.reader.markdown).toContain(domain.interpretation);
      expect(bundle.reader.markdown).toContain(
        `${domain.interpretation}\n\n${domain.factual}[1]`,
      );
      expect(bundle.reader.markdown).toContain(`${domain.factual}[1]`);
      expect(bundle.reader.markdown).toContain(
        `1. [${domain.title}](${domain.url}) — ${domain.sourceClass}.`,
      );
      expect(bundle.reader.markdown).not.toContain(input.lineage.planId);
      expect(bundle.reader.markdown).not.toContain(input.claims[0]?.claimId);
      expect(bundle.reader.markdown).not.toContain('sha256:');
      expect(bundle.reader.markdown).not.toContain(
        input.sources[0]?.parserReceiptId,
      );
      expect(bundle.audit.markdown).toContain(input.lineage.planId);
      expect(bundle.audit.markdown).toContain(input.claims[0]?.claimId);
      expect(bundle.audit.markdown).toContain(
        input.operatorResidue.budgetJournal.journalDigest,
      );
      expect(bundle.audit.markdown).toContain(
        `reservation:${domain.label}:research`,
      );
      expect(bundle.audit.markdown).toContain('bounded-text');
      expect(bundle.audit.markdown).toContain('scope_exceeds_evidence');
      expect(verifyResearchProjectionBundle(bundle)).toEqual(bundle);
    });
  }

  it('rejects reader, audit, citation bridge, and receipt tampering', () => {
    const bundle = compileResearchProjections(fixture(domains[0]));
    const variants = [
      {
        ...bundle,
        reader: { ...bundle.reader, markdown: `${bundle.reader.markdown}x` },
      },
      {
        ...bundle,
        audit: { ...bundle.audit, markdown: `${bundle.audit.markdown}x` },
      },
      {
        ...bundle,
        audit: {
          ...bundle.audit,
          sentenceBindings: bundle.audit.sentenceBindings.map(
            (binding, index) =>
              index === 1 ? { ...binding, citationNumbers: [] } : binding,
          ),
        },
      },
      {
        ...bundle,
        receipt: {
          ...bundle.receipt,
          projectionDigest: digest('forged-projection'),
        },
      },
    ];

    for (const variant of variants) {
      expect(() => verifyResearchProjectionBundle(variant)).toThrowError(
        ResearchProjectionIntegrityError,
      );
    }
  });

  it('rejects factual reader prose backed by a rejected claim', () => {
    const input = fixture(domains[1]);
    const invalid = {
      ...input,
      sections: input.sections.map((section) => ({
        ...section,
        sentences: section.sentences.map((sentence) =>
          sentence.kind === 'factual'
            ? { ...sentence, claimIds: [input.claims[1]?.claimId] }
            : sentence,
        ),
      })),
    };
    expect(() => compileResearchProjections(invalid)).toThrowError(
      /non-admitted claim/u,
    );
  });

  it('does not change the legacy P9 exact-bundle artifact contract', () => {
    expect(P9_REQUIRED_EXECUTION_ARTIFACTS).toContain('report.md');
    expect(P9_REQUIRED_EXECUTION_ARTIFACTS).not.toContain('report-audit.md');
  });
});
