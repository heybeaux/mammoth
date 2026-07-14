import { canonicalDigest } from '@mammoth/domain';
import type { P7ReconstructedState } from '@mammoth/persistence';
import type { P7DossierManifest } from '@mammoth/report-compiler';
import {
  P7_PROJECTION_EXTENSION_VERSION,
  type P7ResearchRunRequest,
} from '@mammoth/workflow';

export interface P7LiveResearchProjection {
  readonly schemaVersion: 1;
  readonly extensionVersion: typeof P7_PROJECTION_EXTENSION_VERSION;
  readonly authorityContractMajor: 1;
  readonly runId: string;
  readonly generatedAt: string;
  readonly authoritativeRevision: number;
  readonly topology: {
    readonly programId: string;
    readonly topologyId: string;
    readonly topologyDigest: string;
    readonly criterionId: string;
    readonly criterionDigest: string;
  };
  readonly complete: boolean;
  readonly dossierManifestDigest: string;
  readonly admittedClaimIds: readonly string[];
  readonly rejectedClaimIds: readonly string[];
  readonly residue: {
    readonly failedCellIds: readonly string[];
    readonly cancelledCellIds: readonly string[];
    readonly unresolvedCellIds: readonly string[];
    readonly dissentDigests: readonly string[];
  };
  readonly modelWorks: readonly {
    readonly id: string;
    readonly cellId: string;
    readonly identityDigest: string;
    readonly state: P7ReconstructedState['modelWorks'][number]['state'];
    readonly providerAttemptId: string;
    readonly providerAttemptDigest: string;
    readonly provider: string;
    readonly concreteModel: string;
    readonly checkpoint: string;
    readonly artifactDigests: readonly string[];
    readonly validationResidueDigests: readonly string[];
    readonly usage?: {
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly currencyMicros: number;
      readonly wallClockMs: number;
      readonly toolCalls: 0;
    };
    readonly chargeReceiptDigest?: string;
    readonly settlementReceiptDigest?: string;
    readonly releaseReceiptDigest?: string;
    readonly cancellationFenceDigest?: string;
    readonly reconstructionLinkDigest?: string;
  }[];
  readonly writeAttempts: readonly [];
  readonly projectionDigest: string;
}

export interface BuildP7ProjectionInput {
  readonly runId: string;
  readonly request: P7ResearchRunRequest;
  readonly state: P7ReconstructedState;
  readonly dossier: P7DossierManifest;
  readonly dossierManifestDigest: string;
  readonly authoritativeRevision: number;
  readonly authorityContractMajor?: number;
}

/** Builds a metadata-only, read-only projection over authoritative rows. */
export function buildP7LiveResearchProjection(
  input: BuildP7ProjectionInput,
): P7LiveResearchProjection {
  if ((input.authorityContractMajor ?? 1) !== 1)
    throw new Error('P7_PROJECTION_FUTURE_AUTHORITY');
  if (
    input.dossier.runId !== input.runId ||
    input.dossier.topologyDigest !== input.request.topology.topologyDigest ||
    canonicalDigest(input.dossier) !== input.dossierManifestDigest
  )
    throw new Error('P7_PROJECTION_DOSSIER_INTEGRITY');

  const works = input.state.modelWorks
    .filter(
      (work) =>
        work.programId === input.request.topology.programId &&
        work.topologyAttemptId === input.runId,
    )
    .sort((left, right) => left.id.localeCompare(right.id));
  const modelWorks = works.map((work) => {
    const attempt = uniqueOwned(
      input.state.providerAttempts,
      work.id,
      'provider attempt',
    );
    const link = optionalOwned(input.state.reconstructionLinks, work.id);
    if (
      ['completed', 'failed', 'cancelled'].includes(work.state) &&
      link === undefined
    )
      throw new Error(`P7_PROJECTION_RECONSTRUCTION_LINK:${work.id}`);
    const artifacts = input.state.artifacts
      .filter(({ modelWorkId }) => modelWorkId === work.id)
      .sort((left, right) => left.id.localeCompare(right.id));
    if (
      link !== undefined &&
      (artifacts.some(({ id }) => !link.artifactIds.includes(id)) ||
        link.artifactIds.some((id) => !artifacts.some((row) => row.id === id)))
    )
      throw new Error(`P7_PROJECTION_BROKEN_ARTIFACT_REFERENCE:${work.id}`);
    const residues = input.state.validationResidue.filter(
      ({ modelWorkId }) => modelWorkId === work.id,
    );
    const charge = optionalOwned(input.state.providerCharges, work.id);
    const settlement = optionalOwned(input.state.settlements, work.id);
    const release = optionalOwned(input.state.releases, work.id);
    const fence = optionalOwned(input.state.cancellationFences, work.id);
    if (
      link !== undefined &&
      ((link.providerChargeId !== undefined) !== (charge !== undefined) ||
        (link.settlementId !== undefined) !== (settlement !== undefined) ||
        (link.cancellationFenceId !== undefined) !== (fence !== undefined))
    )
      throw new Error(`P7_PROJECTION_BROKEN_AUTHORITY_REFERENCE:${work.id}`);
    return {
      id: work.id,
      cellId: work.cellId,
      identityDigest: work.stableIdentity,
      state: work.state,
      providerAttemptId: attempt.id,
      providerAttemptDigest: attempt.stableIdentity,
      provider: attempt.provider,
      concreteModel: attempt.concreteModel,
      checkpoint: attempt.checkpoint,
      artifactDigests: artifacts.map(({ digest }) => digest),
      validationResidueDigests: residues
        .map(({ residueDigest }) => residueDigest)
        .sort(),
      ...(charge === undefined ? {} : { usage: charge.usage }),
      ...(charge === undefined
        ? {}
        : { chargeReceiptDigest: charge.receiptDigest }),
      ...(settlement === undefined
        ? {}
        : { settlementReceiptDigest: settlement.receiptDigest }),
      ...(release === undefined
        ? {}
        : { releaseReceiptDigest: release.receiptDigest }),
      ...(fence === undefined
        ? {}
        : { cancellationFenceDigest: fence.fenceDigest }),
      ...(link === undefined
        ? {}
        : { reconstructionLinkDigest: link.linkDigest }),
    };
  });
  const base = {
    schemaVersion: 1 as const,
    extensionVersion: P7_PROJECTION_EXTENSION_VERSION,
    authorityContractMajor: 1 as const,
    runId: input.runId,
    generatedAt: input.dossier.generatedAt,
    authoritativeRevision: input.authoritativeRevision,
    topology: {
      programId: input.request.topology.programId,
      topologyId: input.request.topology.topologyId,
      topologyDigest: input.request.topology.topologyDigest,
      criterionId: input.request.topology.criterion.criterionId,
      criterionDigest: input.request.topology.criterion.criterionDigest,
    },
    complete: input.dossier.complete,
    dossierManifestDigest: input.dossierManifestDigest,
    admittedClaimIds: input.dossier.facts.map(({ claimId }) => claimId).sort(),
    rejectedClaimIds: input.dossier.rejectedClaims
      .map(({ claimId }) => claimId)
      .sort(),
    residue: {
      failedCellIds: input.dossier.failedCellIds,
      cancelledCellIds: input.dossier.cancelledCellIds,
      unresolvedCellIds: input.dossier.unresolvedCellIds,
      dissentDigests: input.dossier.dissent.map(({ digest }) => digest).sort(),
    },
    modelWorks,
    writeAttempts: [] as const,
  };
  return { ...base, projectionDigest: canonicalDigest(base) };
}

function uniqueOwned<T extends { readonly modelWorkId: string }>(
  rows: readonly T[],
  modelWorkId: string,
  label: string,
): T {
  const owned = rows.filter((row) => row.modelWorkId === modelWorkId);
  if (owned.length !== 1)
    throw new Error(
      `P7_PROJECTION_${label.toUpperCase().replaceAll(' ', '_')}:${modelWorkId}`,
    );
  const value = owned[0];
  if (value === undefined)
    throw new Error(
      `P7_PROJECTION_${label.toUpperCase().replaceAll(' ', '_')}:${modelWorkId}`,
    );
  return value;
}

function optionalOwned<T extends { readonly modelWorkId: string }>(
  rows: readonly T[],
  modelWorkId: string,
): T | undefined {
  const owned = rows.filter((row) => row.modelWorkId === modelWorkId);
  if (owned.length > 1)
    throw new Error(`P7_PROJECTION_DUPLICATE_AUTHORITY_ROW:${modelWorkId}`);
  return owned[0];
}
