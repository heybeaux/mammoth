import { describe, expect, it } from 'vitest';
import {
  validateP6SynthesisManifest,
  type P6SynthesisManifest,
} from '../src/index.js';

const digest = `sha256:${'b'.repeat(64)}`;

function fixture(): P6SynthesisManifest {
  return {
    schemaVersion: 1,
    contractVersion: '1.0.0',
    programId: 'program-p6',
    criterionId: 'criterion-p6',
    criterionVersion: 1,
    criterionDigest: digest,
    generatedAt: '2026-07-13T20:00:00.000Z',
    admittedClaims: [
      {
        claimId: 'claim-supported',
        criterionId: 'criterion-p6',
        criterionVersion: 1,
        criterionDigest: digest,
        policyId: 'policy-p6',
        policyVersion: '1.0.0',
        verdict: 'supported',
        assessmentId: 'assessment-supported',
        evidence: [
          {
            evidenceId: 'evidence-supported',
            locator: { lineStart: 4, lineEnd: 4 },
            snapshotDigest: digest,
          },
        ],
      },
    ],
    factualSentences: [
      {
        sentenceId: 'sentence-supported',
        text: 'The supported claim has immutable evidence.',
        claimIds: ['claim-supported'],
        consensusDescriptorId: 'consensus-descriptive',
        experimentReceiptIds: ['experiment-valid'],
      },
    ],
    consensusDescriptors: [
      {
        id: 'consensus-descriptive',
        claimIds: ['claim-supported'],
        label: 'agreement',
        nonAuthoritative: true,
        correlatedModelProfileIds: [],
      },
    ],
    experimentReceipts: [
      {
        id: 'experiment-valid',
        claimIds: ['claim-supported'],
        status: 'valid_reproduced',
        environmentDigest: digest,
        outputDigest: digest,
      },
    ],
    preservedDissentIds: ['dissent-minority'],
    unresolvedIssueIds: ['issue-boundary'],
  };
}

describe('P6 evidence-aware synthesis manifest validation', () => {
  it('accepts factual sentences backed by admitted claims, policy verdicts, and immutable evidence', () => {
    expect(validateP6SynthesisManifest(fixture())).toMatchObject({ ok: true });
  });

  it('rejects correlated consensus or unsupported agreement as factual authority', () => {
    const input = fixture();
    const sentence = input.factualSentences[0];
    const descriptor = input.consensusDescriptors[0];
    if (!sentence || !descriptor) throw new Error('fixture is incomplete');
    input.factualSentences[0] = {
      ...sentence,
      claimIds: ['claim-supported', 'claim-unadmitted'],
    };
    input.consensusDescriptors[0] = {
      ...descriptor,
      label: 'correlated',
      correlatedModelProfileIds: ['model-a', 'model-b'],
    };

    const result = validateP6SynthesisManifest(input);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'UNADMITTED_CLAIM',
            claimId: 'claim-unadmitted',
          }),
        ]),
      );
    }
  });

  it('rejects missing evidence, criterion drift, invalid verdicts, and invalid experiment receipts', () => {
    const input = fixture();
    const claim = input.admittedClaims[0];
    const receipt = input.experimentReceipts[0];
    if (!claim || !receipt) throw new Error('fixture is incomplete');
    input.admittedClaims[0] = {
      ...claim,
      criterionDigest: `sha256:${'c'.repeat(64)}`,
      verdict: 'unresolved',
      evidence: [],
    };
    input.experimentReceipts[0] = {
      ...receipt,
      status: 'invalid_environment_digest',
    };

    const result = validateP6SynthesisManifest(input);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map(({ code }) => code)).toEqual(
        expect.arrayContaining([
          'CRITERION_DRIFT',
          'INVALID_POLICY_VERDICT',
          'MISSING_EVIDENCE',
          'INVALID_EXPERIMENT_RECEIPT',
        ]),
      );
    }
  });
});
