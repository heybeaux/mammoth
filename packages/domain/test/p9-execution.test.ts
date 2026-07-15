import {
  canonicalDigest,
  P9ExecutionReceiptSchema,
  P9ReportManifestSchema,
} from '../src/index.js';
import { describe, expect, it } from 'vitest';

const DIGEST = canonicalDigest({ fixture: 'p9-execution-test' });
const REQUIRED_ARTIFACTS = [
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

function receiptIdentity() {
  return {
    schemaVersion: '1.0.0' as const,
    contractFamily: 'p9.v1' as const,
    executionId: 'execution:test',
    planId: 'plan:test',
    planDigest: DIGEST,
    question: 'What does the accepted plan establish?',
    budget: {
      authorizedUsd: 5,
      reservedOpenUsd: 0,
      spentKnownUsd: 1,
      spentConservativeUnknownUsd: 0.5,
      unknownCostReservationIds: ['reservation:unknown'],
      unknownCostSerializedAsZero: false as const,
      withinAuthorization: true,
    },
    counts: {
      selectedCandidates: 2,
      terminalAttempts: 2,
      admittedSources: 1,
      retrievalFailures: 1,
      parserReceipts: 1,
      parserFailures: 0,
      claimProposals: 2,
      admittedClaims: 1,
      rejectedClaims: 1,
      contradictedClaims: 0,
      criticalClaims: 1,
      factualSentences: 2,
    },
    typedResidue: {
      retrieval_failures: ['attempt:failed'] as string[],
      parser_failures: [] as string[],
      rejected_claims: ['claim:rejected'] as string[],
      unknown_costs: ['reservation:unknown'] as string[],
      redactions: [] as string[],
      coverage_gaps: [] as string[],
    },
    coverageVerdict: 'covered' as const,
    coverageAssessmentDigest: DIGEST,
    artifactDigests: Object.fromEntries(
      REQUIRED_ARTIFACTS.map((name) => [name, DIGEST]),
    ),
    startedAt: '2026-07-15T08:00:00.000Z',
    finishedAt: '2026-07-15T08:01:00.000Z',
  };
}

function parseReceipt(
  mutate: (identity: ReturnType<typeof receiptIdentity>) => void = () =>
    undefined,
) {
  const identity = receiptIdentity();
  mutate(identity);
  return P9ExecutionReceiptSchema.safeParse({
    ...identity,
    receiptDigest: canonicalDigest(identity),
  });
}

describe('P9 execution receipt invariants', () => {
  it('accepts a fully attributable receipt', () => {
    expect(parseReceipt().success).toBe(true);
  });

  it('rejects unknown-cost identity substitution and duplicates', () => {
    expect(
      parseReceipt((identity) => {
        identity.typedResidue.unknown_costs = ['reservation:other'];
      }).success,
    ).toBe(false);
    expect(
      parseReceipt((identity) => {
        identity.budget.unknownCostReservationIds = [
          'reservation:unknown',
          'reservation:unknown',
        ];
        identity.typedResidue.unknown_costs = [
          'reservation:unknown',
          'reservation:unknown',
        ];
      }).success,
    ).toBe(false);
  });

  it('rejects impossible candidate, parser, decision, and critical counts', () => {
    const mutations = [
      (identity: ReturnType<typeof receiptIdentity>) => {
        identity.counts.selectedCandidates = 3;
      },
      (identity: ReturnType<typeof receiptIdentity>) => {
        identity.counts.admittedSources = 2;
      },
      (identity: ReturnType<typeof receiptIdentity>) => {
        identity.counts.parserFailures = 2;
        identity.typedResidue.parser_failures = ['parser:a', 'parser:b'];
      },
      (identity: ReturnType<typeof receiptIdentity>) => {
        identity.counts.claimProposals = 3;
      },
      (identity: ReturnType<typeof receiptIdentity>) => {
        identity.counts.criticalClaims = 2;
      },
    ];
    for (const mutate of mutations)
      expect(parseReceipt(mutate).success).toBe(false);
  });

  it('rejects reverse execution time and a self-referential receipt digest', () => {
    expect(
      parseReceipt((identity) => {
        identity.finishedAt = '2026-07-15T07:59:59.000Z';
      }).success,
    ).toBe(false);
    expect(
      parseReceipt((identity) => {
        identity.artifactDigests['execution-receipt.json'] = DIGEST;
      }).success,
    ).toBe(false);
  });
});

describe('P9 report provenance contracts', () => {
  it('requires locator-bound citations and typed contradictions', () => {
    const identity = {
      schemaVersion: '1.0.0' as const,
      contractFamily: 'p9.v1' as const,
      manifestId: 'manifest:test',
      planId: 'plan:test',
      planDigest: DIGEST,
      question: 'What does the evidence establish?',
      coverageAssessmentDigest: DIGEST,
      sections: [
        {
          sectionId: 'findings',
          title: 'Findings',
          sentences: [
            {
              sentenceId: 'sentence:1',
              kind: 'factual' as const,
              text: 'The admitted evidence supports this statement.',
              claimIds: ['claim:1'],
            },
          ],
        },
      ],
      citations: [
        {
          claimId: 'claim:1',
          admissionId: 'admission:1',
          verdictId: 'verdict:1',
          attemptId: 'attempt:1',
          requestedUrl: 'https://example.test/source',
          sourceClass: 'primary',
          sourceFamilyId: 'family:1',
          evidenceSpanId: 'span:1',
          snapshotDigest: DIGEST,
          quoteDigest: DIGEST,
          coordinateSpace: 'utf16-code-units/v1',
          startOffset: 0,
          endOffset: 10,
        },
      ],
      contradictions: [
        {
          proposalId: 'claim:contradicted',
          admissionId: 'admission:contradicted',
          verdictId: 'verdict:contradicted',
          attemptId: 'attempt:1',
          contradictionIds: ['contradiction:1'],
          statement: 'The contradicted proposal.',
          evidenceSpanId: 'span:contradiction',
          snapshotDigest: DIGEST,
          quoteDigest: DIGEST,
          coordinateSpace: 'utf16-code-units/v1',
          startOffset: 10,
          endOffset: 20,
        },
      ],
      compiledAt: '2026-07-15T08:00:00.000Z',
    };
    expect(
      P9ReportManifestSchema.safeParse({
        ...identity,
        manifestDigest: canonicalDigest(identity),
      }).success,
    ).toBe(true);

    const unbound = structuredClone(identity);
    delete (unbound.citations[0] as Partial<(typeof unbound.citations)[number]>)
      .snapshotDigest;
    expect(
      P9ReportManifestSchema.safeParse({
        ...unbound,
        manifestDigest: canonicalDigest(unbound),
      }).success,
    ).toBe(false);
  });
});
