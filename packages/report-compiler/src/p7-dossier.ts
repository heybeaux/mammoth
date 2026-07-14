import {
  TypedModelOutputSchema,
  canonicalDigest,
  canonicalJson,
  type TypedModelOutput,
} from '@mammoth/domain';
import type { P7ReconstructedState } from '@mammoth/persistence';
import type { ContentAddressedStore } from '@mammoth/retrieval';
import type { P7ResearchRunRequest } from '@mammoth/workflow';

export const P7_DOSSIER_CONTRACT_VERSION = '1.0.0' as const;
export const P7_EVIDENCE_ADMISSION_POLICY_VERSION = '1.0.0' as const;

export interface P7DossierFact {
  readonly sentenceId: string;
  readonly text: string;
  readonly claimId: string;
  readonly proposalId: string;
  readonly cellId: string;
  readonly modelWorkId: string;
  readonly typedOutputDigest: string;
  readonly validationResidueDigest: string;
  readonly evidence: readonly {
    readonly locator: string;
    readonly snapshotDigest: string;
  }[];
}

export interface P7DossierManifest {
  readonly schemaVersion: 1;
  readonly contractVersion: typeof P7_DOSSIER_CONTRACT_VERSION;
  readonly admissionPolicyVersion: typeof P7_EVIDENCE_ADMISSION_POLICY_VERSION;
  readonly runId: string;
  readonly programId: string;
  readonly topologyId: string;
  readonly topologyDigest: string;
  readonly criterionId: string;
  readonly criterionVersion: number;
  readonly criterionDigest: string;
  readonly generatedAt: string;
  readonly complete: boolean;
  readonly facts: readonly P7DossierFact[];
  readonly rejectedClaims: readonly {
    readonly claimId: string;
    readonly proposalId: string;
    readonly cellId: string;
    readonly modelWorkId: string;
    readonly reason:
      | 'missing_evidence'
      | 'unbound_evidence'
      | 'secret_detected';
  }[];
  readonly dissent: readonly {
    readonly id: string;
    readonly cellId: string;
    readonly digest: string;
  }[];
  readonly assumptions: readonly {
    readonly id: string;
    readonly cellId: string;
    readonly digest: string;
  }[];
  readonly proposedFalsifiers: readonly {
    readonly id: string;
    readonly cellId: string;
    readonly digest: string;
  }[];
  readonly failedCellIds: readonly string[];
  readonly cancelledCellIds: readonly string[];
  readonly unresolvedCellIds: readonly string[];
  readonly validationResidueDigests: readonly string[];
}

export interface CompileP7DossierInput {
  readonly runId: string;
  readonly request: P7ResearchRunRequest;
  readonly state: P7ReconstructedState;
  readonly cas: ContentAddressedStore;
  readonly expectedCellIds: readonly string[];
}

/**
 * Compiles provider proposals into an admitted-only dossier. Provider prose is
 * never authoritative by itself: a proposal must bind every citation to the
 * typed output's top-level immutable evidence set and pass secret screening.
 */
export async function compileP7Dossier(
  input: CompileP7DossierInput,
): Promise<P7DossierManifest> {
  const ownedWorks = input.state.modelWorks
    .filter(
      (work) =>
        work.programId === input.request.topology.programId &&
        work.topologyId === input.request.topology.topologyId &&
        work.topologyAttemptId === input.runId,
    )
    .sort(byId);
  const facts: P7DossierFact[] = [];
  const rejectedClaims: P7DossierManifest['rejectedClaims'][number][] = [];
  const dissent: P7DossierManifest['dissent'][number][] = [];
  const assumptions: P7DossierManifest['assumptions'][number][] = [];
  const proposedFalsifiers: P7DossierManifest['proposedFalsifiers'][number][] =
    [];

  for (const work of ownedWorks) {
    const artifacts = input.state.artifacts.filter(
      ({ modelWorkId }) => modelWorkId === work.id,
    );
    const typedArtifact = artifacts.find(({ kind }) => kind === 'typed_output');
    const accepted = input.state.validationResidue.find(
      (residue) =>
        residue.modelWorkId === work.id && residue.verdict === 'accepted',
    );
    if (work.state !== 'completed') continue;
    if (!typedArtifact || !accepted)
      throw new Error(`P7_DOSSIER_INCOMPLETE_ADMISSION:${work.id}`);
    const output = await readTypedOutput(input.cas, typedArtifact.digest);
    const evidenceSet = new Set(
      output.evidenceReferences.map((evidence) => canonicalDigest(evidence)),
    );
    for (const proposal of output.claimProposals) {
      const claimId = `claim:${canonicalDigest({
        modelWorkId: work.id,
        proposalId: proposal.proposalId,
        statement: proposal.statement,
      })}`;
      const reason = admissionFailure(proposal, evidenceSet);
      if (reason !== undefined) {
        rejectedClaims.push({
          claimId,
          proposalId: proposal.proposalId,
          cellId: work.cellId,
          modelWorkId: work.id,
          reason,
        });
        continue;
      }
      facts.push({
        sentenceId: `sentence:${canonicalDigest({ claimId })}`,
        text: proposal.statement,
        claimId,
        proposalId: proposal.proposalId,
        cellId: work.cellId,
        modelWorkId: work.id,
        typedOutputDigest: typedArtifact.digest,
        validationResidueDigest: accepted.residueDigest,
        evidence: [...proposal.evidenceReferences].sort((left, right) =>
          canonicalJson(left).localeCompare(canonicalJson(right)),
        ),
      });
    }
    appendRedactedResidue(dissent, work.cellId, 'dissent', output.dissent);
    appendRedactedResidue(
      assumptions,
      work.cellId,
      'assumption',
      output.assumptions,
    );
    appendRedactedResidue(
      proposedFalsifiers,
      work.cellId,
      'falsifier',
      output.proposedFalsifiers,
    );
  }

  const expectedCellIds = [...new Set(input.expectedCellIds)].sort();
  if (expectedCellIds.length === 0)
    throw new Error('P7_DOSSIER_EXPECTED_CELLS_EMPTY');
  const unexpected = ownedWorks.find(
    ({ cellId }) => !expectedCellIds.includes(cellId),
  );
  if (unexpected)
    throw new Error(`P7_DOSSIER_UNEXPECTED_CELL:${unexpected.cellId}`);
  const failedCellIds = cellIdsInState(ownedWorks, 'failed');
  const cancelledCellIds = cellIdsInState(ownedWorks, 'cancelled');
  const completed = new Set(cellIdsInState(ownedWorks, 'completed'));
  const unresolvedCellIds = expectedCellIds
    .filter((cellId) => !completed.has(cellId))
    .sort();

  return {
    schemaVersion: 1,
    contractVersion: P7_DOSSIER_CONTRACT_VERSION,
    admissionPolicyVersion: P7_EVIDENCE_ADMISSION_POLICY_VERSION,
    runId: input.runId,
    programId: input.request.topology.programId,
    topologyId: input.request.topology.topologyId,
    topologyDigest: input.request.topology.topologyDigest,
    criterionId: input.request.topology.criterion.criterionId,
    criterionVersion: input.request.topology.criterion.criterionVersion,
    criterionDigest: input.request.topology.criterion.criterionDigest,
    generatedAt: latestTimestamp(input.state),
    complete: unresolvedCellIds.length === 0,
    facts: facts.sort(byId),
    rejectedClaims: rejectedClaims.sort(byId),
    dissent: dissent.sort(byId),
    assumptions: assumptions.sort(byId),
    proposedFalsifiers: proposedFalsifiers.sort(byId),
    failedCellIds,
    cancelledCellIds,
    unresolvedCellIds,
    validationResidueDigests: input.state.validationResidue
      .filter(({ modelWorkId }) =>
        ownedWorks.some(({ id }) => id === modelWorkId),
      )
      .map(({ residueDigest }) => residueDigest)
      .sort(),
  };
}

async function readTypedOutput(
  cas: ContentAddressedStore,
  digest: string,
): Promise<TypedModelOutput> {
  let bytes: Uint8Array;
  try {
    bytes = await cas.get(digest);
  } catch {
    throw new Error(`P7_DOSSIER_MISSING_CAS:${digest}`);
  }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const value: unknown = JSON.parse(text);
  if (text !== canonicalJson(value) || canonicalDigest(value) !== digest)
    throw new Error(`P7_DOSSIER_CAS_INTEGRITY:${digest}`);
  return TypedModelOutputSchema.parse(value);
}

function admissionFailure(
  proposal: TypedModelOutput['claimProposals'][number],
  evidenceSet: ReadonlySet<string>,
): P7DossierManifest['rejectedClaims'][number]['reason'] | undefined {
  if (containsSecret(proposal.statement)) return 'secret_detected';
  if (proposal.evidenceReferences.length === 0) return 'missing_evidence';
  if (
    proposal.evidenceReferences.some((evidence) =>
      containsSecret(evidence.locator),
    )
  )
    return 'secret_detected';
  if (
    proposal.evidenceReferences.some(
      (evidence) => !evidenceSet.has(canonicalDigest(evidence)),
    )
  )
    return 'unbound_evidence';
  return undefined;
}

function containsSecret(value: string): boolean {
  return /(?:bearer\s+[a-z0-9._~-]{8,}|\bsk-[a-z0-9_-]{8,}|api[_-]?key\s*[:=]\s*\S+)/iu.test(
    value,
  );
}

function appendRedactedResidue(
  target: { id: string; cellId: string; digest: string }[],
  cellId: string,
  kind: string,
  values: readonly string[],
): void {
  for (const value of values) {
    const digest = canonicalDigest({ kind, cellId, value });
    target.push({ id: `${kind}:${digest}`, cellId, digest });
  }
}

function cellIdsInState(
  works: P7ReconstructedState['modelWorks'],
  state: P7ReconstructedState['modelWorks'][number]['state'],
): string[] {
  return works
    .filter((work) => work.state === state)
    .map(({ cellId }) => cellId)
    .sort();
}

function latestTimestamp(state: P7ReconstructedState): string {
  const timestamps = [
    ...state.modelWorks.flatMap((row) => [row.createdAt, row.updatedAt]),
    ...state.providerAttempts.flatMap((row) => [row.createdAt, row.updatedAt]),
    ...state.artifacts.map(({ createdAt }) => createdAt),
    ...state.validationResidue.map(({ recordedAt }) => recordedAt),
  ].sort();
  return timestamps.at(-1) ?? '1970-01-01T00:00:00.000Z';
}

function byId(
  left: {
    readonly id?: string;
    readonly sentenceId?: string;
    readonly claimId?: string;
  },
  right: {
    readonly id?: string;
    readonly sentenceId?: string;
    readonly claimId?: string;
  },
): number {
  return (left.id ?? left.sentenceId ?? left.claimId ?? '').localeCompare(
    right.id ?? right.sentenceId ?? right.claimId ?? '',
  );
}
