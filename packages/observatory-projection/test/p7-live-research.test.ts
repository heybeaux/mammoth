import { describe, expect, it } from 'vitest';
import { canonicalDigest, canonicalJson } from '@mammoth/domain';
import type { P7ReconstructedState } from '@mammoth/persistence';
import type { P7DossierManifest } from '@mammoth/report-compiler';
import type { P7ResearchRunRequest } from '@mammoth/workflow';
import { buildP7LiveResearchProjection } from '../src/p7-live-research.js';

const digest = `sha256:${'a'.repeat(64)}`;
const runId = 'mammoth:LiveResearchLoop:v1:topology:request';
const request = {
  topology: {
    programId: 'program',
    topologyId: 'topology',
    topologyDigest: digest,
    criterion: { criterionId: 'criterion', criterionDigest: digest },
  },
} as unknown as P7ResearchRunRequest;
const dossier = {
  runId,
  topologyDigest: digest,
  generatedAt: '2026-07-14T00:00:01.000Z',
  complete: true,
  facts: [{ claimId: 'claim-a' }],
  rejectedClaims: [{ claimId: 'claim-b' }],
  failedCellIds: [],
  cancelledCellIds: [],
  unresolvedCellIds: [],
  dissent: [{ digest }],
} as unknown as P7DossierManifest;

describe('P7 live research read-only projection', () => {
  it('projects linked authority metadata without raw content or secrets', () => {
    const state = reconstructed();
    const result = buildP7LiveResearchProjection({
      runId,
      request,
      state,
      dossier,
      dossierManifestDigest: canonicalDigest(dossier),
      authoritativeRevision: 7,
    });
    const rendered = canonicalJson(result);
    expect(result.writeAttempts).toEqual([]);
    expect(result.modelWorks[0]).toMatchObject({
      id: 'work-a',
      provider: 'fixture',
      concreteModel: 'fixture:1',
      artifactDigests: [digest],
    });
    expect(rendered).not.toContain('raw provider response');
    expect(rendered).not.toContain('sk-super-secret');
    expect(result.projectionDigest).toBe(
      canonicalDigest({ ...result, projectionDigest: undefined }),
    );
  });

  it('fails closed on future authority and broken artifact references', () => {
    const common = {
      runId,
      request,
      dossier,
      dossierManifestDigest: canonicalDigest(dossier),
      authoritativeRevision: 7,
    };
    expect(() =>
      buildP7LiveResearchProjection({
        ...common,
        state: reconstructed(),
        authorityContractMajor: 2,
      }),
    ).toThrow('P7_PROJECTION_FUTURE_AUTHORITY');
    const state = reconstructed();
    const link = state.reconstructionLinks[0];
    expect(link).toBeDefined();
    if (link === undefined) throw new Error('missing fixture link');
    const broken = {
      ...state,
      reconstructionLinks: [{ ...link, artifactIds: ['missing-artifact'] }],
    } as P7ReconstructedState;
    expect(() =>
      buildP7LiveResearchProjection({ ...common, state: broken }),
    ).toThrow('P7_PROJECTION_BROKEN_ARTIFACT_REFERENCE');
  });
});

function reconstructed(): P7ReconstructedState {
  return {
    modelWorks: [
      {
        id: 'work-a',
        programId: 'program',
        topologyAttemptId: runId,
        cellId: 'cell-a',
        stableIdentity: digest,
        state: 'completed',
      },
    ],
    providerAttempts: [
      {
        id: 'attempt-a',
        modelWorkId: 'work-a',
        stableIdentity: digest,
        provider: 'fixture',
        concreteModel: 'fixture:1',
        checkpoint: digest,
      },
    ],
    artifacts: [
      {
        id: 'artifact-a',
        modelWorkId: 'work-a',
        digest,
        kind: 'typed_output',
        raw: 'raw provider response',
      },
    ],
    validationResidue: [
      {
        modelWorkId: 'work-a',
        residueDigest: digest,
        redactedSummary: 'sk-super-secret',
      },
    ],
    providerCharges: [],
    settlements: [],
    releases: [],
    cancellationFences: [],
    reconstructionLinks: [
      {
        modelWorkId: 'work-a',
        artifactIds: ['artifact-a'],
        linkDigest: digest,
      },
    ],
    capabilityDecisions: [],
    egressDecisions: [],
  } as unknown as P7ReconstructedState;
}
