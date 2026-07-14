import { describe, expect, it } from 'vitest';
import {
  canonicalDigest,
  canonicalJson,
  type TypedModelOutput,
} from '@mammoth/domain';
import type { P7ReconstructedState } from '@mammoth/persistence';
import type { CasObject, ContentAddressedStore } from '@mammoth/retrieval';
import type { P7ResearchRunRequest } from '@mammoth/workflow';
import { compileP7Dossier } from '../src/p7-dossier.js';

const digest = `sha256:${'a'.repeat(64)}`;
const runId = 'mammoth:LiveResearchLoop:v1:topology:request';
const request = {
  topology: {
    programId: 'program',
    topologyId: 'topology',
    topologyDigest: digest,
    criterion: {
      criterionId: 'criterion',
      criterionVersion: 1,
      criterionDigest: digest,
    },
  },
} as unknown as P7ResearchRunRequest;

describe('P7 admitted-only dossier compiler', () => {
  it('renders only evidence-bound claims and preserves redacted residue', async () => {
    const evidence = { locator: 'cas://evidence', snapshotDigest: digest };
    const output: TypedModelOutput = {
      observations: ['provider observation is not a fact'],
      claimProposals: [
        {
          proposalId: 'supported',
          statement: 'Evidence-bound statement.',
          evidenceReferences: [evidence],
        },
        {
          proposalId: 'unsupported',
          statement: 'Unsupported statement.',
          evidenceReferences: [],
        },
      ],
      evidenceReferences: [evidence],
      assumptions: ['assumption text'],
      dissent: ['minority dissent text'],
      proposedFalsifiers: ['falsifier text'],
    };
    const cas = new MemoryCas(output);
    const dossier = await compileP7Dossier({
      runId,
      request,
      state: reconstructed(cas.digest),
      cas,
      expectedCellIds: ['cell-a'],
    });

    expect(dossier.complete).toBe(true);
    expect(dossier.facts).toHaveLength(1);
    expect(dossier.facts[0]?.text).toBe('Evidence-bound statement.');
    expect(dossier.rejectedClaims).toMatchObject([
      { proposalId: 'unsupported', reason: 'missing_evidence' },
    ]);
    expect(canonicalJson(dossier)).not.toContain('provider observation');
    expect(canonicalJson(dossier)).not.toContain('minority dissent text');
    expect(dossier.dissent).toHaveLength(1);
  });

  it('fails closed for missing CAS and rejects secret-bearing facts', async () => {
    const output: TypedModelOutput = {
      observations: [],
      claimProposals: [
        {
          proposalId: 'secret',
          statement: 'Authorization Bearer abcdefghijklmnop',
          evidenceReferences: [
            { locator: 'cas://evidence', snapshotDigest: digest },
          ],
        },
      ],
      evidenceReferences: [
        { locator: 'cas://evidence', snapshotDigest: digest },
      ],
      assumptions: [],
      dissent: [],
      proposedFalsifiers: [],
    };
    const cas = new MemoryCas(output);
    const dossier = await compileP7Dossier({
      runId,
      request,
      state: reconstructed(cas.digest),
      cas,
      expectedCellIds: ['cell-a'],
    });
    expect(dossier.facts).toEqual([]);
    expect(dossier.rejectedClaims[0]?.reason).toBe('secret_detected');

    await expect(
      compileP7Dossier({
        runId,
        request,
        state: reconstructed(digest),
        cas,
        expectedCellIds: ['cell-a'],
      }),
    ).rejects.toThrow(`P7_DOSSIER_MISSING_CAS:${digest}`);
  });

  it('returns an honest partial dossier with failure and cancellation residue', async () => {
    const cas = new MemoryCas({
      observations: [],
      claimProposals: [],
      evidenceReferences: [],
      assumptions: [],
      dissent: [],
      proposedFalsifiers: [],
    });
    const state = reconstructed(cas.digest);
    const completed = state.modelWorks[0];
    expect(completed).toBeDefined();
    if (completed === undefined) throw new Error('missing completed fixture');
    const partial = {
      ...state,
      modelWorks: [
        ...state.modelWorks,
        {
          ...completed,
          id: 'work-failed',
          cellId: 'cell-b',
          state: 'failed',
        },
        {
          ...completed,
          id: 'work-cancelled',
          cellId: 'cell-c',
          state: 'cancelled',
        },
      ],
    } as P7ReconstructedState;
    const dossier = await compileP7Dossier({
      runId,
      request,
      state: partial,
      cas,
      expectedCellIds: ['cell-a', 'cell-b', 'cell-c'],
    });
    expect(dossier.complete).toBe(false);
    expect(dossier.failedCellIds).toEqual(['cell-b']);
    expect(dossier.cancelledCellIds).toEqual(['cell-c']);
    expect(dossier.unresolvedCellIds).toEqual(['cell-b', 'cell-c']);
  });
});

class MemoryCas implements ContentAddressedStore {
  readonly digest: string;
  readonly bytes: Uint8Array;

  constructor(value: unknown) {
    this.bytes = new TextEncoder().encode(canonicalJson(value));
    this.digest = canonicalDigest(value);
  }

  put(bytes: Uint8Array): Promise<CasObject> {
    return Promise.resolve({
      digest: canonicalDigest(JSON.parse(new TextDecoder().decode(bytes))),
      size: bytes.byteLength,
      storageUri: 'memory:',
    });
  }

  get(value: string): Promise<Uint8Array> {
    return value === this.digest
      ? Promise.resolve(this.bytes)
      : Promise.reject(new Error('missing CAS object'));
  }
}

function reconstructed(typedOutputDigest: string): P7ReconstructedState {
  return {
    modelWorks: [
      {
        id: 'work-a',
        programId: 'program',
        topologyId: 'topology',
        topologyAttemptId: runId,
        cellId: 'cell-a',
        state: 'completed',
        createdAt: '2026-07-14T00:00:00.000Z',
        updatedAt: '2026-07-14T00:00:01.000Z',
      },
    ],
    artifacts: [
      {
        id: 'artifact-typed',
        modelWorkId: 'work-a',
        kind: 'typed_output',
        digest: typedOutputDigest,
      },
    ],
    validationResidue: [
      {
        id: 'residue',
        modelWorkId: 'work-a',
        verdict: 'accepted',
        residueDigest: digest,
        recordedAt: '2026-07-14T00:00:01.000Z',
      },
    ],
    providerAttempts: [],
    capabilityDecisions: [],
    egressDecisions: [],
    providerCharges: [],
    settlements: [],
    releases: [],
    cancellationFences: [],
    reconstructionLinks: [],
  } as unknown as P7ReconstructedState;
}
