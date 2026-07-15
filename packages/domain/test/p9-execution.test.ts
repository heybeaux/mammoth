import { describe, expect, it } from 'vitest';
import { canonicalDigest, P9ReportManifestSchema } from '../src/index.js';

const NOW = '2026-07-15T16:20:00.000Z';

function manifestFixture(
  mutate: (identity: Record<string, unknown>) => Record<string, unknown> = (
    identity,
  ) => identity,
) {
  const quote = 'The runtime records exact provenance for admitted claims.';
  const locator = {
    evidenceSpanId: 'span-1',
    snapshotDigest: canonicalDigest('source-bytes'),
    quoteDigest: canonicalDigest(quote),
    contextDigest: canonicalDigest(quote),
    coordinateSpace: 'utf16-code-units/v1',
    startOffset: 0,
    endOffset: quote.length,
  };
  const identity = mutate({
    schemaVersion: '1.0.0',
    contractFamily: 'p9.v1',
    manifestId: 'manifest:test',
    planId: 'plan:test',
    planDigest: canonicalDigest('plan'),
    question: 'Can the runtime preserve provenance?',
    coverageAssessmentDigest: canonicalDigest('assessment'),
    sections: [
      {
        sectionId: 'summary',
        title: 'Summary',
        sentences: [
          {
            sentenceId: 'sentence-1',
            kind: 'factual',
            text: quote,
            claimIds: ['claim-1'],
          },
        ],
      },
    ],
    citations: [
      {
        claimId: 'claim-1',
        admissionId: 'admission-1',
        admissionPolicyId: 'p9-independent-entailment/v1',
        admissionDecision: 'admitted',
        admissionDigest: canonicalDigest('admission'),
        entailmentVerdictId: 'verdict-1',
        entailmentVerdict: 'entailed',
        entailmentVerdictDigest: canonicalDigest('verdict'),
        attemptId: 'attempt-1',
        requestedUrl: 'https://example.test/source',
        sourceClass: 'repository_docs',
        sourceFamilyId: 'example.test',
        locator,
        snapshotDigest: locator.snapshotDigest,
        quoteDigest: locator.quoteDigest,
      },
    ],
    compiledAt: NOW,
  });
  return { ...identity, manifestDigest: canonicalDigest(identity) };
}

describe('p9 execution report manifest', () => {
  it('requires factual citations to bind exact locator provenance', () => {
    expect(() => P9ReportManifestSchema.parse(manifestFixture())).not.toThrow();

    expect(() =>
      P9ReportManifestSchema.parse(
        manifestFixture((identity) => {
          const citations = structuredClone(identity.citations) as Record<
            string,
            unknown
          >[];
          citations[0] = {
            ...citations[0],
            quoteDigest: canonicalDigest('different quote'),
          };
          return { ...identity, citations };
        }),
      ),
    ).toThrow(/citation quote digest must match its exact locator/u);
  });
});
