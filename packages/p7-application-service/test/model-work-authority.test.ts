import { describe, expect, it } from 'vitest';
import { canonicalDigest } from '@mammoth/domain';
import { InMemoryP7ModelWorkRepository } from '@mammoth/persistence';
import type { CasObject, ContentAddressedStore } from '@mammoth/retrieval';
import {
  deriveP7ResearchRunId,
  type P7ResearchRunRequest,
} from '@mammoth/workflow';
import { ModelWorkP7ResearchAuthority } from '../src/index.js';

const digest =
  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const request: P7ResearchRunRequest = {
  applicationContractMajor: 1,
  workflowVersion: 1,
  charterDigest: digest,
  topology: {
    topologyId: 'topology-authority',
    topologyDigest: digest,
    dependencyDigest: digest,
    programId: 'program-authority',
    workItemId: 'work-authority',
    criterion: {
      criterionId: 'criterion-authority',
      criterionVersion: 1,
      criterionDigest: digest,
      branchId: 'main',
    },
    topologyPlanVersion: '1.0.0',
    plannerPolicyVersion: '1.0.0',
    templateCatalogVersion: '1.0.0',
  },
  modelWorkPolicyDigest: digest,
  modelProfileVersionId: 'profile-authority',
  modelProfileVersionDigest: digest,
  promptTemplateDigest: digest,
  toolContractDigest: digest,
  outputSchemaDigest: digest,
  budget: {
    inputTokens: 100,
    outputTokens: 50,
    currencyMicros: 0,
    wallClockMs: 30_000,
    toolCalls: 0,
  },
};

class MemoryCas implements ContentAddressedStore {
  readonly values = new Map<string, Uint8Array>();

  put(bytes: Uint8Array): Promise<CasObject> {
    const value = Uint8Array.from(bytes);
    const digest = canonicalDigest(JSON.parse(new TextDecoder().decode(value)));
    this.values.set(digest, value);
    return Promise.resolve({
      digest,
      size: value.byteLength,
      storageUri: `memory:${digest}`,
    });
  }

  get(digest: string): Promise<Uint8Array> {
    const value = this.values.get(digest);
    if (!value) return Promise.reject(new Error('missing CAS object'));
    return Promise.resolve(Uint8Array.from(value));
  }
}

describe('P7 Postgres/CAS authority reconstruction', () => {
  it('registers the canonical request and reconstructs accepted unresolved work', async () => {
    const cas = new MemoryCas();
    const authority = new ModelWorkP7ResearchAuthority(
      cas,
      new InMemoryP7ModelWorkRepository(),
      { cellIds: () => Promise.resolve(['cell-b', 'cell-a', 'cell-a']) },
    );
    await authority.register(request);
    const runId = deriveP7ResearchRunId(request);
    await expect(authority.status(runId)).resolves.toMatchObject({
      runId,
      state: 'accepted',
      authoritativeRevision: 0,
      unresolvedCellIds: ['cell-a', 'cell-b'],
    });
    await expect(authority.inspect(runId)).resolves.toMatchObject({
      charterDigest: request.charterDigest,
      topologyId: request.topology.topologyId,
    });
  });

  it('fails closed when the run request bytes do not match their CAS digest', async () => {
    const cas = new MemoryCas();
    const authority = new ModelWorkP7ResearchAuthority(
      cas,
      new InMemoryP7ModelWorkRepository(),
      { cellIds: () => Promise.resolve(['cell-a']) },
    );
    await authority.register(request);
    const runId = deriveP7ResearchRunId(request);
    const requestDigest = decodeURIComponent(
      runId.slice(runId.lastIndexOf(':') + 1),
    );
    cas.values.set(requestDigest, new TextEncoder().encode('{}'));
    await expect(authority.status(runId)).rejects.toThrow(
      'CAS integrity failure',
    );
  });
});
