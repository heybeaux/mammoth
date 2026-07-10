import { describe, expect, it } from 'vitest';
import { evaluateEvidencePolicy, validateHandoff } from '../src/index.js';
import type { EvidenceArtifact, HandoffManifest } from '../src/index.js';

const baseArtifact: EvidenceArtifact = {
  id: 'evidence-1',
  kind: 'web_snapshot',
  retrievedAt: '2026-07-01T00:00:00.000Z',
  expiresAt: '2026-08-01T00:00:00.000Z',
  contentDigest: 'a'.repeat(64),
  sourceLineageId: 'lineage-1',
};

function evaluate(
  artifact: EvidenceArtifact,
  entailment: 'direct' | 'none' = 'direct',
) {
  return evaluateEvidencePolicy({
    claimId: 'claim-1',
    evaluatedAt: '2026-07-10T00:00:00.000Z',
    artifacts: [artifact],
    edges: [
      {
        claimId: 'claim-1',
        evidenceId: artifact.id,
        stance: 'supports',
        entailment,
        locator: { section: 'Results' },
      },
    ],
  });
}

describe('evidence policy', () => {
  it('accepts fresh, locator-specific, directly entailing evidence', () => {
    expect(evaluate(baseArtifact)).toMatchObject({
      trusted: true,
      status: 'supported',
    });
  });

  it('does not treat a non-entailing citation as support', () => {
    const verdict = evaluate(baseArtifact, 'none');
    expect(verdict.trusted).toBe(false);
    expect(verdict.status).toBe('unresolved');
    expect(verdict.reasons).toContain('NON_ENTAILING_SUPPORT');
  });

  it('expires stale support', () => {
    const verdict = evaluate({
      ...baseArtifact,
      expiresAt: '2026-07-09T00:00:00.000Z',
    });
    expect(verdict.trusted).toBe(false);
    expect(verdict.status).toBe('expired');
    expect(verdict.reasons).toContain('STALE_EVIDENCE');
  });

  it('keeps cross-model-only agreement untrusted', () => {
    const verdict = evaluate({ ...baseArtifact, kind: 'model_observation' });
    expect(verdict.trusted).toBe(false);
    expect(verdict.status).toBe('unresolved');
    expect(verdict.reasons).toContain('CROSS_MODEL_ONLY');
  });
});

describe('semantic handoffs', () => {
  const manifest: HandoffManifest = {
    contractId: 'contract-1',
    requiredClaimIds: ['claim-1'],
    requiredEvidenceIds: ['evidence-1'],
    fields: [
      {
        name: 'temperature',
        wire: 'temp',
        concept: 'ambient_temperature',
        unit: 'degC',
        expectedDigest: 'digest-1',
      },
    ],
  };

  it('fails when a shared wire value omits semantic identity', () => {
    const result = validateHandoff(manifest, {
      contractId: 'contract-1',
      claimIds: ['claim-1'],
      evidenceIds: ['evidence-1'],
      fields: [{ name: 'temperature', wire: 'temp' }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'MISSING_SEMANTIC:temperature.concept',
        'MISSING_SEMANTIC:temperature.unit',
        'MISSING_SEMANTIC:temperature.expectedDigest',
      ]),
    );
  });
});
