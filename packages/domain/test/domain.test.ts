import { describe, expect, it } from 'vitest';
import {
  ClaimEvidenceEdgeSchema,
  DecisionCriterionSchema,
  canonicalDigest,
  canonicalJson,
  criterionDigest,
  isEvidenceFresh,
  validateClaimRevision,
  validateClaimTransition,
  validateCriterionRevision,
  type Claim,
  type ClaimAssessment,
  type DecisionCriterion,
  type EvidenceArtifact,
} from '../src/index.js';

const digest = `sha256:${'a'.repeat(64)}`;
const now = '2026-07-10T20:00:00.000Z';
const criterionContent = {
  programId: 'program-1',
  version: 1,
  question: 'Does it work?',
  standard: 'Pass all declared tests',
  admissibleEvidence: ['machine test'],
  prohibitedEvidence: ['model agreement'],
  tiePolicy: 'unresolved' as const,
};
const criterion: DecisionCriterion = {
  id: 'criterion-1',
  ...criterionContent,
  canonicalDigest: criterionDigest(criterionContent),
  createdAt: now,
};
const claim: Claim = {
  id: 'claim-1',
  programId: 'program-1',
  criterionId: criterion.id,
  version: 1,
  kind: 'external_fact',
  canonicalText: 'The system passes.',
  subject: 'system',
  predicate: 'passes',
  object: 'tests',
  status: 'candidate',
  observedAt: now,
  recordedAt: now,
  contradictedByClaimIds: [],
  canonicalDigest: digest,
};
const assessment: ClaimAssessment = {
  id: 'assessment-1',
  claimId: claim.id,
  policyId: 'policy-1',
  policyVersion: '1',
  verdict: 'supported',
  reasonCodes: ['direct_reproducible_evidence'],
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
};

describe('canonical identity', () => {
  it('is stable across object key ordering', () => {
    expect(canonicalJson({ b: 2, a: { d: 4, c: 3 } })).toBe(
      '{"a":{"c":3,"d":4},"b":2}',
    );
    expect(canonicalDigest({ b: 2, a: 1 })).toBe(
      canonicalDigest({ a: 1, b: 2 }),
    );
  });
});

describe('criterion constitution', () => {
  it('accepts a correctly digested criterion', () => {
    expect(DecisionCriterionSchema.parse(criterion)).toEqual(criterion);
  });
  it('names silent edits as criterion drift', () => {
    const edited = { ...criterion, standard: 'Whatever the model thinks' };
    expect(validateCriterionRevision(criterion, edited)).toMatchObject({
      ok: false,
      code: 'criterion_drift',
    });
  });
  it('requires a new linked version for a criterion change', () => {
    const content = {
      ...criterionContent,
      version: 2,
      standard: 'Pass holdout tests',
      supersedesCriterionId: criterion.id,
    };
    const next = {
      id: 'criterion-2',
      ...content,
      canonicalDigest: criterionDigest(content),
      createdAt: now,
    };
    expect(validateCriterionRevision(criterion, next)).toEqual({ ok: true });
  });
});

describe('claim lifecycle', () => {
  it('blocks fabricated model promotion', () => {
    expect(
      validateClaimTransition(claim, 'supported', { authority: 'model' }),
    ).toMatchObject({ ok: false, code: 'fabricated_promotion' });
  });
  it('requires a matching evidence-policy verdict', () => {
    expect(
      validateClaimTransition(claim, 'supported', {
        authority: 'evidence_policy',
        assessment: { ...assessment, claimId: 'other' },
      }),
    ).toMatchObject({ ok: false, code: 'assessment_mismatch' });
    expect(
      validateClaimTransition(claim, 'supported', {
        authority: 'evidence_policy',
        assessment,
      }),
    ).toEqual({ ok: true });
  });
  it('requires a receipt for human exceptions', () => {
    expect(
      validateClaimTransition(claim, 'supported', {
        authority: 'human_exception',
        humanApprovalId: 'approval-1',
      }),
    ).toMatchObject({ ok: false, code: 'unreceipted_exception' });
  });
  it('rejects illegal lifecycle shortcuts', () => {
    expect(
      validateClaimTransition({ ...claim, status: 'observed' }, 'supported', {
        authority: 'evidence_policy',
        assessment,
      }),
    ).toMatchObject({ ok: false, code: 'illegal_claim_transition' });
  });
  it('requires immutable, linked claim versions under the same criterion', () => {
    expect(
      validateClaimRevision(claim, {
        ...claim,
        id: 'claim-2',
        version: 2,
        supersedesClaimId: claim.id,
      }),
    ).toBe(true);
    expect(
      validateClaimRevision(claim, {
        ...claim,
        id: 'claim-2',
        version: 2,
        criterionId: 'drifted',
        supersedesClaimId: claim.id,
      }),
    ).toBe(false);
  });
});

describe('evidence invariants', () => {
  it('rejects non-entailing citations represented as support', () => {
    expect(
      ClaimEvidenceEdgeSchema.safeParse({
        id: 'edge-1',
        claimId: claim.id,
        evidenceId: 'evidence-1',
        stance: 'supports',
        entailment: 'partial',
        locator: { lineStart: 1, lineEnd: 2 },
        extractedByWorkItemId: 'work-1',
        extractionDigest: digest,
      }).success,
    ).toBe(false);
  });
  it('requires an exact locator', () => {
    expect(
      ClaimEvidenceEdgeSchema.safeParse({
        id: 'edge-1',
        claimId: claim.id,
        evidenceId: 'evidence-1',
        stance: 'context',
        entailment: 'uncertain',
        locator: {},
        extractedByWorkItemId: 'work-1',
        extractionDigest: digest,
      }).success,
    ).toBe(false);
  });
  it('expires stale evidence deterministically', () => {
    const artifact = {
      expiresAt: '2026-07-10T19:00:00.000Z',
    } as EvidenceArtifact;
    expect(isEvidenceFresh(artifact, now)).toBe(false);
  });
});
