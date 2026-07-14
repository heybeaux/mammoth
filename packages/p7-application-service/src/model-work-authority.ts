import { canonicalDigest, canonicalJson } from '@mammoth/domain';
import type {
  P7ModelWorkRecord,
  P7ModelWorkRepository,
  P7ReconstructedState,
} from '@mammoth/persistence';
import type { ContentAddressedStore } from '@mammoth/retrieval';
import {
  deriveP7ResearchRunId,
  parseP7ResearchRunRequest,
  type P7ResearchInspection,
  type P7ResearchRunRequest,
  type P7ResearchStatus,
} from '@mammoth/workflow';
import type { P7ResearchAuthorityReader } from './index.js';

const RUN_DIGEST = /^sha256:[0-9a-f]{64}$/u;

export interface P7ExpectedCellReader {
  cellIds(topologyId: string): Promise<readonly string[]>;
}

/** Reconstructs operator state from an immutable CAS request plus P7 rows. */
export class ModelWorkP7ResearchAuthority implements P7ResearchAuthorityReader {
  constructor(
    private readonly cas: ContentAddressedStore,
    private readonly modelWork: P7ModelWorkRepository,
    private readonly topology: P7ExpectedCellReader,
  ) {}

  async register(request: P7ResearchRunRequest): Promise<void> {
    const parsed = parseP7ResearchRunRequest(request);
    const expectedDigest = runRequestDigest(deriveP7ResearchRunId(parsed));
    const stored = await this.cas.put(
      new TextEncoder().encode(canonicalJson(parsed)),
    );
    if (stored.digest !== expectedDigest)
      throw new Error('P7 run request CAS digest mismatch');
  }

  async status(runId: string): Promise<P7ResearchStatus> {
    const request = await this.request(runId);
    const expectedCellIds = uniqueSorted(
      await this.topology.cellIds(request.topology.topologyId),
    );
    if (expectedCellIds.length === 0)
      throw new Error('P7 topology contains no cells');
    const reconstructed = await this.modelWork.reconstructProgram(
      request.topology.programId,
    );
    const works = reconstructed.modelWorks.filter((work) =>
      belongsToRun(work, request),
    );
    const unexpected = works.find(
      (work) => !expectedCellIds.includes(work.cellId),
    );
    if (unexpected)
      throw new Error(`P7 run contains unexpected cell ${unexpected.cellId}`);

    const completedCellIds = cellIdsInState(works, 'completed');
    const failedCellIds = cellIdsInState(works, 'failed');
    const cancelledCellIds = cellIdsInState(works, 'cancelled');
    const unresolvedCellIds = expectedCellIds.filter(
      (cellId) =>
        !completedCellIds.includes(cellId) &&
        !cancelledCellIds.includes(cellId),
    );
    const active = works.some((work) =>
      ['in_flight', 'ambiguous'].includes(work.state),
    );
    const allCompleted = completedCellIds.length === expectedCellIds.length;
    const allCancelled = cancelledCellIds.length === expectedCellIds.length;
    const hasTerminalResidue =
      failedCellIds.length > 0 || cancelledCellIds.length > 0;
    const hasStarted = works.some((work) => work.state !== 'planned');
    const state: P7ResearchStatus['state'] = allCompleted
      ? 'completed'
      : allCancelled
        ? 'cancelled'
        : hasTerminalResidue
          ? 'partial'
          : active || hasStarted
            ? 'running'
            : 'accepted';
    const workIds = new Set(works.map(({ id }) => id));

    return {
      runId,
      state,
      authoritativeRevision: revisionOf(reconstructed, workIds),
      completedCellIds,
      failedCellIds,
      cancelledCellIds,
      unresolvedCellIds,
      receiptIds: receiptIdsOf(reconstructed, workIds),
    };
  }

  async inspect(runId: string): Promise<P7ResearchInspection> {
    const request = await this.request(runId);
    return {
      ...(await this.status(runId)),
      charterDigest: request.charterDigest,
      topologyId: request.topology.topologyId,
      topologyDigest: request.topology.topologyDigest,
    };
  }

  private async request(runId: string): Promise<P7ResearchRunRequest> {
    const digest = runRequestDigest(runId);
    const bytes = await this.cas.get(digest);
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const value: unknown = JSON.parse(decoded);
    if (decoded !== canonicalJson(value) || canonicalDigest(value) !== digest)
      throw new Error('P7 run request CAS integrity failure');
    const request = parseP7ResearchRunRequest(value);
    if (deriveP7ResearchRunId(request) !== runId)
      throw new Error('P7 run request does not match run ID');
    return request;
  }
}

function runRequestDigest(runId: string): string {
  const segment = runId.slice(runId.lastIndexOf(':') + 1);
  const digest = decodeURIComponent(segment);
  if (!RUN_DIGEST.test(digest)) throw new Error('invalid P7 run ID');
  return digest;
}

function belongsToRun(
  work: P7ModelWorkRecord,
  request: P7ResearchRunRequest,
): boolean {
  const identity = work.request.identity;
  return (
    work.topologyId === request.topology.topologyId &&
    identity.topologyDigest === request.topology.topologyDigest &&
    identity.modelProfileVersionId === request.modelProfileVersionId &&
    identity.modelProfileVersionDigest === request.modelProfileVersionDigest &&
    identity.promptTemplateDigest === request.promptTemplateDigest &&
    identity.policyDigest === request.modelWorkPolicyDigest &&
    identity.toolContractDigest === request.toolContractDigest &&
    identity.outputSchemaDigest === request.outputSchemaDigest
  );
}

function cellIdsInState(
  works: readonly P7ModelWorkRecord[],
  state: P7ModelWorkRecord['state'],
): string[] {
  return uniqueSorted(
    works.filter((work) => work.state === state).map(({ cellId }) => cellId),
  );
}

function revisionOf(
  state: P7ReconstructedState,
  workIds: ReadonlySet<string>,
): number {
  const owned = <T extends { readonly modelWorkId: string }>(
    rows: readonly T[],
  ) => rows.filter((row) => workIds.has(row.modelWorkId));
  return (
    state.modelWorks
      .filter((row) => workIds.has(row.id))
      .reduce((sum, row) => sum + row.revision, 0) +
    owned(state.providerAttempts).reduce((sum, row) => sum + row.revision, 0) +
    owned(state.capabilityDecisions).length +
    owned(state.egressDecisions).length +
    owned(state.artifacts).length +
    owned(state.validationResidue).length +
    owned(state.providerCharges).length +
    owned(state.settlements).length +
    owned(state.releases).length +
    owned(state.cancellationFences).length +
    owned(state.reconstructionLinks).length
  );
}

function receiptIdsOf(
  state: P7ReconstructedState,
  workIds: ReadonlySet<string>,
): string[] {
  return uniqueSorted([
    ...state.providerCharges
      .filter((row) => workIds.has(row.modelWorkId))
      .map(({ receiptDigest }) => receiptDigest),
    ...state.settlements
      .filter((row) => workIds.has(row.modelWorkId))
      .map(({ receiptDigest }) => receiptDigest),
    ...state.releases
      .filter((row) => workIds.has(row.modelWorkId))
      .map(({ receiptDigest }) => receiptDigest),
    ...state.reconstructionLinks
      .filter((row) => workIds.has(row.modelWorkId))
      .flatMap((row) => row.completedReceiptDigest ?? []),
  ]);
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}
