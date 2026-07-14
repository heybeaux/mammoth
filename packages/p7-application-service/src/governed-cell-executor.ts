import {
  MODEL_WORK_POLICY_VERSION,
  MODEL_WORK_REQUEST_SCHEMA_VERSION,
  MODEL_WORK_RESULT_SCHEMA_VERSION,
  TypedModelOutputSchema,
  canonicalDigest,
  canonicalJson,
  isRetryableProviderError,
  modelWorkIdentityDigest,
  providerAttemptIdentityDigest,
  providerEffectIdentityDigest,
  requiresProviderReconciliation,
  type ModelWorkIdentity,
  type ModelWorkRequest,
  type ProviderAttemptIdentity,
  type ProviderCapabilityManifest,
  type ProviderEffectIdentity,
  type ProviderError,
  type ProviderUsage,
  type TypedModelOutput,
} from '@mammoth/domain';
import type {
  P7ArtifactReferenceRecord,
  P7CapabilityDecisionRecord,
  P7EgressDecisionRecord,
  P7ModelWorkRecord,
  P7ModelWorkRepository,
  P7ProviderAttemptRecord,
  P7ProviderChargeRecord,
  P7BudgetReleaseRecord,
  P7BudgetSettlementRecord,
  P7CancellationFenceRecord,
  P7ReconstructedState,
  P7ValidationResidueRecord,
} from '@mammoth/persistence';
import type {
  ModelProviderPort,
  ProviderDispatchResult,
  ProviderEnvelope,
} from '@mammoth/provider-port';
import type { ContentAddressedStore } from '@mammoth/retrieval';
import {
  deriveP7ResearchRunId,
  type P7ResearchRunRequest,
  type P7ResearchStatus,
} from '@mammoth/workflow';
import type {
  P7GovernedCellExecutor,
  P7GovernedCellIdentity,
  P7GovernedCellOutcome,
  P7ResearchAuthorityReader,
} from './index.js';
import type { P7ExpectedCellReader } from './model-work-authority.js';

const PLACEHOLDER_DIGEST = `sha256:${'0'.repeat(64)}`;

export interface P7PlannedModelWork {
  readonly modelWork: ModelWorkRequest;
  readonly canonicalRequestBytes: Uint8Array;
}

export function planP7CellIdentity(
  request: P7ResearchRunRequest,
  cellId: string,
): ModelWorkIdentity {
  const base: ModelWorkIdentity = {
    programId: request.topology.programId,
    topologyId: request.topology.topologyId,
    topologyDigest: request.topology.topologyDigest,
    cellId,
    criterionId: request.topology.criterion.criterionId,
    criterionVersion: request.topology.criterion.criterionVersion,
    criterionDigest: request.topology.criterion.criterionDigest,
    workItemContractDigest: canonicalDigest({
      kind: 'p7-work-item-contract',
      workItemId: request.topology.workItemId,
      dependencyDigest: request.topology.dependencyDigest,
      toolContractDigest: request.toolContractDigest,
    }),
    promptTemplateDigest: request.promptTemplateDigest,
    canonicalInputDigest: canonicalDigest({
      kind: 'p7-cell-input',
      charterDigest: request.charterDigest,
      topologyDigest: request.topology.topologyDigest,
      criterionDigest: request.topology.criterion.criterionDigest,
      cellId,
    }),
    modelProfileVersionId: request.modelProfileVersionId,
    modelProfileVersionDigest: request.modelProfileVersionDigest,
    policyVersion: MODEL_WORK_POLICY_VERSION,
    policyDigest: request.modelWorkPolicyDigest,
    toolContractDigest: request.toolContractDigest,
    outputSchemaDigest: request.outputSchemaDigest,
    identityDigest: PLACEHOLDER_DIGEST,
  };
  return { ...base, identityDigest: modelWorkIdentityDigest(base) };
}

export function planP7ModelWork(
  request: P7ResearchRunRequest,
  manifest: ProviderCapabilityManifest,
  cellId: string,
): P7PlannedModelWork {
  const identity = planP7CellIdentity(request, cellId);
  const body = p7CanonicalChatBody(request, identity, manifest.concreteModel);
  const canonicalRequestDigest = canonicalDigest(body);
  const attemptBase: ProviderAttemptIdentity = {
    modelWorkIdentityDigest: identity.identityDigest,
    attemptOrdinal: 1,
    provider: manifest.provider,
    concreteModel: manifest.concreteModel,
    checkpoint: manifest.checkpoint,
    attemptDigest: PLACEHOLDER_DIGEST,
  };
  const attempt: ProviderAttemptIdentity = {
    ...attemptBase,
    attemptDigest: providerAttemptIdentityDigest(attemptBase),
  };
  const effectBase: ProviderEffectIdentity = {
    providerAttemptDigest: attempt.attemptDigest,
    modelWorkIdentityDigest: identity.identityDigest,
    operationKind: 'chat_completion',
    canonicalRequestDigest,
    idempotencyKey: PLACEHOLDER_DIGEST,
  };
  const effect: ProviderEffectIdentity = {
    ...effectBase,
    idempotencyKey: providerEffectIdentityDigest(effectBase),
  };
  return {
    modelWork: {
      schemaVersion: MODEL_WORK_REQUEST_SCHEMA_VERSION,
      identity,
      attempt,
      effect,
      capabilityManifestDigest: manifest.manifestDigest,
      canonicalPromptDigest: canonicalRequestDigest,
      budget: request.budget,
      outputSchemaVersion: MODEL_WORK_RESULT_SCHEMA_VERSION,
    },
    canonicalRequestBytes: new TextEncoder().encode(canonicalJson(body)),
  };
}

export function planP7GovernedCells(
  request: P7ResearchRunRequest,
  manifest: ProviderCapabilityManifest,
  cellIds: readonly string[],
): readonly P7GovernedCellIdentity[] {
  return cellIds.map((cellId) => {
    const planned = planP7ModelWork(request, manifest, cellId);
    return {
      cellId,
      modelWorkId: `mw:${planned.modelWork.identity.identityDigest}`,
      modelWorkIdentityDigest: planned.modelWork.identity.identityDigest,
      providerAttemptId: `pa:${planned.modelWork.attempt.attemptDigest}`,
      providerAttemptDigest: planned.modelWork.attempt.attemptDigest,
    };
  });
}

export interface P7GovernedCellPlanner {
  resolve(
    request: P7ResearchRunRequest,
  ): Promise<readonly P7GovernedCellIdentity[]>;
}

export function createP7GovernedCellPlanner(
  provider: ModelProviderPort,
  topology: P7ExpectedCellReader,
): P7GovernedCellPlanner {
  return {
    async resolve(request: P7ResearchRunRequest) {
      const manifest = await provider.discoverCapabilities();
      const cellIds = [
        ...new Set(await topology.cellIds(request.topology.topologyId)),
      ].sort();
      return planP7GovernedCells(request, manifest, cellIds);
    },
  };
}

export interface P7EgressEvaluationInput {
  readonly modelWorkIdentityDigest: string;
  readonly providerAttemptDigest: string;
  readonly reservationId: string;
  readonly dataClassification: 'local_only' | 'cloud_allowed';
  readonly provider: string;
  readonly concreteModel: string;
  readonly checkpoint: string;
  readonly destinationOrigin: string;
  readonly allowedTools: readonly never[];
  readonly promptDigest: string;
  readonly policyDigest: string;
}

export interface P7EgressEvaluation {
  readonly policyVersion: '1.0.0';
  readonly policyDigest: string;
  readonly decision: 'allowed' | 'denied';
  readonly reason: string;
  readonly policyEvaluationDigest: string;
}

/** Structural egress port so composition roots alone bind @mammoth/governance. */
export interface P7ModelEgressEvaluator {
  readonly policyDigest: string;
  evaluate(input: P7EgressEvaluationInput): P7EgressEvaluation;
}

export interface GovernedProviderCellExecutorOptions {
  readonly provider: ModelProviderPort;
  readonly repository: P7ModelWorkRepository;
  readonly cas: ContentAddressedStore;
  readonly authority: P7ResearchAuthorityReader;
  readonly egress: P7ModelEgressEvaluator;
  readonly destinationOrigin: string;
  readonly dataClassification?: 'local_only' | 'cloud_allowed';
  readonly now?: () => Date;
}

interface CellSnapshot {
  readonly work?: P7ModelWorkRecord;
  readonly attempt?: P7ProviderAttemptRecord;
  readonly capability?: P7CapabilityDecisionRecord;
  readonly egress?: P7EgressDecisionRecord;
  readonly artifacts: ReadonlyMap<
    P7ArtifactReferenceRecord['kind'],
    P7ArtifactReferenceRecord
  >;
  readonly residues: readonly P7ValidationResidueRecord[];
  readonly charge?: P7ProviderChargeRecord;
  readonly settlement?: P7BudgetSettlementRecord;
  readonly release?: P7BudgetReleaseRecord;
  readonly fence?: P7CancellationFenceRecord;
}

interface CellContext {
  work: P7ModelWorkRecord;
  attempt: P7ProviderAttemptRecord;
  readonly snapshot: CellSnapshot;
  readonly artifactIds: string[];
  readonly runId: string;
}

/**
 * Executes one governed model-work cell: capability + egress decisions,
 * CAS-backed artifacts, provider dispatch through the neutral port, charge
 * and settlement receipts, and terminal transitions. Every write is
 * check-before-write against reconstructed Postgres/CAS state so activity
 * redelivery and process restarts reuse the same attempt and idempotency key.
 */
export class GovernedProviderCellExecutor implements P7GovernedCellExecutor {
  readonly #provider: ModelProviderPort;
  readonly #repository: P7ModelWorkRepository;
  readonly #cas: ContentAddressedStore;
  readonly #authority: P7ResearchAuthorityReader;
  readonly #egress: P7ModelEgressEvaluator;
  readonly #destinationOrigin: string;
  readonly #dataClassification: 'local_only' | 'cloud_allowed';
  readonly #now: () => Date;

  constructor(options: GovernedProviderCellExecutorOptions) {
    this.#provider = options.provider;
    this.#repository = options.repository;
    this.#cas = options.cas;
    this.#authority = options.authority;
    this.#egress = options.egress;
    this.#destinationOrigin = options.destinationOrigin;
    this.#dataClassification = options.dataClassification ?? 'local_only';
    this.#now = options.now ?? (() => new Date());
  }

  async execute(input: {
    readonly runId: string;
    readonly request: P7ResearchRunRequest;
    readonly cells: readonly P7GovernedCellIdentity[];
    readonly cell: P7GovernedCellIdentity;
  }): Promise<P7GovernedCellOutcome> {
    const runId = requireRunId(input.runId, input.request);
    const manifest = await this.#provider.discoverCapabilities();
    const planned = planP7ModelWork(input.request, manifest, input.cell.cellId);
    if (
      planned.modelWork.identity.identityDigest !==
      input.cell.modelWorkIdentityDigest
    ) {
      throw new Error(
        'P7 planned cell identity does not match the workflow cell identity',
      );
    }
    const snapshot = await this.#snapshot(planned.modelWork);
    const terminal = await this.#terminalOutcome(
      input.cell.cellId,
      snapshot,
      runId,
    );
    if (terminal) return terminal;

    const now = this.#timestamp();
    const work =
      snapshot.work ??
      (await this.#repository.recordModelWork({
        id: `mw:${planned.modelWork.identity.identityDigest}`,
        stableIdentity: planned.modelWork.identity.identityDigest,
        programId: planned.modelWork.identity.programId,
        topologyId: planned.modelWork.identity.topologyId,
        cellId: planned.modelWork.identity.cellId,
        topologyAttemptId: runId,
        reservationId: `rsv:${planned.modelWork.identity.identityDigest}`,
        request: planned.modelWork,
        state: 'planned',
        revision: 0,
        createdAt: now,
        updatedAt: now,
      }));
    const context: CellContext = {
      work,
      attempt: undefined as unknown as P7ProviderAttemptRecord,
      snapshot,
      artifactIds: [],
      runId,
    };

    if (
      planned.modelWork.attempt.attemptDigest !==
      input.cell.providerAttemptDigest
    ) {
      return this.#fail(
        context,
        'profile_drift',
        'provider identity drifted from the planned attempt',
      );
    }
    if (
      work.request.attempt.attemptDigest !==
      planned.modelWork.attempt.attemptDigest
    ) {
      return this.#fail(
        context,
        'profile_drift',
        'provider identity drifted from the authoritative attempt',
      );
    }

    context.attempt =
      snapshot.attempt ??
      (await this.#repository.recordProviderAttempt({
        id: `pa:${work.request.attempt.attemptDigest}`,
        stableIdentity: work.request.attempt.attemptDigest,
        modelWorkId: work.id,
        modelWorkIdentityDigest: work.stableIdentity,
        attemptOrdinal: 1,
        provider: work.request.attempt.provider,
        concreteModel: work.request.attempt.concreteModel,
        checkpoint: work.request.attempt.checkpoint,
        capabilityManifestDigest: work.request.capabilityManifestDigest,
        request: work.request,
        state: 'planned',
        revision: 0,
        createdAt: now,
        updatedAt: now,
      }));

    if (manifest.manifestDigest !== work.request.capabilityManifestDigest) {
      return this.#fail(
        context,
        'profile_drift',
        'provider capability manifest drifted after planning',
      );
    }
    const capability =
      context.snapshot.capability ??
      (await this.#recordCapabilityDecision(context, manifest));
    if (capability.decision !== 'allowed') {
      return this.#fail(context, 'unsupported_capability', capability.reason);
    }

    const egress =
      context.snapshot.egress ?? (await this.#recordEgressDecision(context));
    if (egress.decision !== 'allowed') {
      return this.#fail(context, 'policy_denied', egress.reason);
    }

    const promptArtifact =
      context.snapshot.artifacts.get('canonical_prompt') ??
      (await this.#recordArtifact(
        context,
        'canonical_prompt',
        planned.canonicalRequestBytes,
        'accepted',
      ));
    context.artifactIds.push(promptArtifact.id);
    if (promptArtifact.digest !== work.request.effect.canonicalRequestDigest) {
      throw new Error(
        'P7 canonical prompt artifact does not match the effect identity',
      );
    }

    await this.#markInFlight(context);

    const dispatched = await this.#dispatch(context, planned);
    if (!dispatched.ok) {
      return this.#handleProviderError(context, dispatched.error);
    }
    return this.#complete(context, dispatched.envelope);
  }

  async cancel(input: {
    readonly runId: string;
    readonly request: P7ResearchRunRequest;
    readonly cells: readonly P7GovernedCellIdentity[];
    readonly reason: string;
  }): Promise<{
    readonly receiptId: string;
    readonly authoritativeStatus: P7ResearchStatus;
  }> {
    const runId = requireRunId(input.runId, input.request);
    const manifest = await this.#provider.discoverCapabilities();
    const fenceDigests: string[] = [];
    for (const cell of input.cells) {
      const planned = planP7ModelWork(input.request, manifest, cell.cellId);
      const snapshot = await this.#snapshot(planned.modelWork);
      if (snapshot.work && isTerminal(snapshot.work.state)) {
        if (snapshot.fence) fenceDigests.push(snapshot.fence.fenceDigest);
        continue;
      }
      const now = this.#timestamp();
      const work =
        snapshot.work ??
        (await this.#repository.recordModelWork({
          id: `mw:${planned.modelWork.identity.identityDigest}`,
          stableIdentity: planned.modelWork.identity.identityDigest,
          programId: planned.modelWork.identity.programId,
          topologyId: planned.modelWork.identity.topologyId,
          cellId: planned.modelWork.identity.cellId,
          topologyAttemptId: runId,
          reservationId: `rsv:${planned.modelWork.identity.identityDigest}`,
          request: planned.modelWork,
          state: 'planned',
          revision: 0,
          createdAt: now,
          updatedAt: now,
        }));
      const fence =
        snapshot.fence ??
        (await this.#repository.recordCancellationFence(
          sealRecord('p7-cancellation-fence', 'fenceDigest', {
            id: `fence:${work.stableIdentity}`,
            stableIdentity: canonicalDigest({
              kind: 'p7-cancellation-fence-identity',
              modelWork: work.stableIdentity,
            }),
            modelWorkId: work.id,
            reservationId: work.reservationId,
            phase: work.state === 'planned' ? 'before_call' : 'during_call',
            reason: input.reason,
            requestedAt: now,
          }),
        ));
      fenceDigests.push(fence.fenceDigest);
      if (snapshot.attempt && !isAttemptTerminal(snapshot.attempt.state)) {
        await this.#repository.transitionProviderAttempt({
          id: snapshot.attempt.id,
          expectedRevision: snapshot.attempt.revision,
          state: 'failed',
          updatedAt: now,
        });
      }
      await this.#repository.transitionModelWork({
        id: work.id,
        expectedRevision: work.revision,
        state: 'cancelled',
        updatedAt: now,
      });
      if (!snapshot.settlement && !snapshot.release) {
        await this.#recordRelease(work, `cancelled: ${input.reason}`);
      }
    }
    return {
      receiptId: canonicalDigest({
        kind: 'p7-cancellation-receipt',
        runId,
        fenceDigests: [...fenceDigests].sort(),
      }),
      authoritativeStatus: await this.#authority.status(runId),
    };
  }

  async #snapshot(modelWork: ModelWorkRequest): Promise<CellSnapshot> {
    const state = await this.#repository.reconstructProgram(
      modelWork.identity.programId,
    );
    return snapshotFor(state, modelWork.identity.identityDigest);
  }

  async #terminalOutcome(
    cellId: string,
    snapshot: CellSnapshot,
    runId: string,
  ): Promise<P7GovernedCellOutcome | undefined> {
    const work = snapshot.work;
    if (!work || !isTerminal(work.state)) return undefined;
    const authoritativeStatus = await this.#authority.status(runId);
    if (work.state === 'completed') {
      return {
        cellId,
        status: 'completed',
        retryable: false,
        receiptIds: completionReceipts(snapshot),
        authoritativeStatus,
      };
    }
    if (work.state === 'cancelled') {
      return {
        cellId,
        status: 'cancelled',
        retryable: false,
        receiptIds: snapshot.fence ? [snapshot.fence.fenceDigest] : [],
        authoritativeStatus,
      };
    }
    const rejected = snapshot.residues.find(
      (residue) => residue.verdict === 'rejected',
    );
    return {
      cellId,
      status: 'failed',
      retryable: false,
      receiptIds: snapshot.release ? [snapshot.release.receiptDigest] : [],
      ...(rejected === undefined ? {} : { failureCode: rejected.code }),
      authoritativeStatus,
    };
  }

  async #recordCapabilityDecision(
    context: CellContext,
    manifest: ProviderCapabilityManifest,
  ): Promise<P7CapabilityDecisionRecord> {
    const allowed =
      manifest.supportsJsonOutput && manifest.modalities.includes('text');
    return this.#repository.recordCapabilityDecision(
      sealRecord('p7-capability-decision', 'decisionDigest', {
        id: `cap:${context.attempt.stableIdentity}`,
        stableIdentity: canonicalDigest({
          kind: 'p7-capability-decision-identity',
          attempt: context.attempt.stableIdentity,
        }),
        modelWorkId: context.work.id,
        providerAttemptId: context.attempt.id,
        manifest,
        decision: allowed ? ('allowed' as const) : ('denied' as const),
        reason: allowed
          ? 'provider manifest supports governed JSON text output'
          : 'provider manifest lacks governed JSON text output support',
        recordedAt: this.#timestamp(),
      }),
    );
  }

  async #recordEgressDecision(
    context: CellContext,
  ): Promise<P7EgressDecisionRecord> {
    const evaluation = this.#egress.evaluate({
      modelWorkIdentityDigest: context.work.stableIdentity,
      providerAttemptDigest: context.attempt.stableIdentity,
      reservationId: context.work.reservationId,
      dataClassification: this.#dataClassification,
      provider: context.attempt.provider,
      concreteModel: context.attempt.concreteModel,
      checkpoint: context.attempt.checkpoint,
      destinationOrigin: this.#destinationOrigin,
      allowedTools: [],
      promptDigest: context.work.request.canonicalPromptDigest,
      policyDigest: this.#egress.policyDigest,
    });
    return this.#repository.recordEgressDecision(
      sealRecord('p7-egress-decision', 'decisionDigest', {
        id: `egr:${context.attempt.stableIdentity}`,
        stableIdentity: canonicalDigest({
          kind: 'p7-egress-decision-identity',
          attempt: context.attempt.stableIdentity,
        }),
        modelWorkId: context.work.id,
        providerAttemptId: context.attempt.id,
        reservationId: context.work.reservationId,
        dataClassification: this.#dataClassification,
        provider: context.attempt.provider,
        concreteModel: context.attempt.concreteModel,
        checkpoint: context.attempt.checkpoint,
        destinationOrigin: this.#destinationOrigin,
        allowedTools: [],
        promptDigest: context.work.request.canonicalPromptDigest,
        policyVersion: evaluation.policyVersion,
        policyDigest: evaluation.policyDigest,
        policyEvaluationDigest: evaluation.policyEvaluationDigest,
        decision: evaluation.decision,
        reason: evaluation.reason,
        recordedAt: this.#timestamp(),
      }),
    );
  }

  async #recordArtifact(
    context: CellContext,
    kind: P7ArtifactReferenceRecord['kind'],
    bytes: Uint8Array,
    validationVerdict: P7ArtifactReferenceRecord['validationVerdict'],
  ): Promise<P7ArtifactReferenceRecord> {
    const stored = await this.#cas.put(bytes);
    return this.#repository.recordArtifact({
      id: `art:${kind}:${context.attempt.stableIdentity}`,
      stableIdentity: canonicalDigest({
        kind: 'p7-artifact-identity',
        attempt: context.attempt.stableIdentity,
        artifactKind: kind,
      }),
      modelWorkId: context.work.id,
      providerAttemptId: context.attempt.id,
      kind,
      digest: stored.digest,
      byteLength: bytes.byteLength,
      dataClassification: 'local_only',
      retention: 'retained',
      validationVerdict,
      createdAt: this.#timestamp(),
    });
  }

  async #recordResidue(
    context: CellContext,
    artifactId: string,
    verdict: 'accepted' | 'rejected',
    code: string,
    redactedSummary: string,
  ): Promise<P7ValidationResidueRecord> {
    return this.#repository.recordValidationResidue(
      sealRecord('p7-validation-residue', 'residueDigest', {
        id: `res:${verdict}:${context.attempt.stableIdentity}`,
        stableIdentity: canonicalDigest({
          kind: 'p7-validation-residue-identity',
          attempt: context.attempt.stableIdentity,
          verdict,
        }),
        modelWorkId: context.work.id,
        providerAttemptId: context.attempt.id,
        artifactId,
        verdict,
        code,
        redactedSummary,
        recordedAt: this.#timestamp(),
      }),
    );
  }

  async #recordRelease(
    work: P7ModelWorkRecord,
    reason: string,
  ): Promise<P7BudgetReleaseRecord> {
    return this.#repository.recordRelease(
      sealRecord('p7-budget-release', 'receiptDigest', {
        id: `rel:${work.stableIdentity}`,
        stableIdentity: canonicalDigest({
          kind: 'p7-budget-release-identity',
          modelWork: work.stableIdentity,
        }),
        modelWorkId: work.id,
        reservationId: work.reservationId,
        reason,
        releasedAt: this.#timestamp(),
      }),
    );
  }

  async #markInFlight(context: CellContext): Promise<void> {
    if (context.work.state === 'planned') {
      context.work = await this.#repository.transitionModelWork({
        id: context.work.id,
        expectedRevision: context.work.revision,
        state: 'in_flight',
        updatedAt: this.#timestamp(),
      });
    }
    if (context.attempt.state === 'planned') {
      context.attempt = await this.#repository.transitionProviderAttempt({
        id: context.attempt.id,
        expectedRevision: context.attempt.revision,
        state: 'in_flight',
        updatedAt: this.#timestamp(),
      });
    }
  }

  async #dispatch(
    context: CellContext,
    planned: P7PlannedModelWork,
  ): Promise<ProviderDispatchResult> {
    if (
      context.work.state === 'ambiguous' ||
      context.attempt.state === 'ambiguous'
    ) {
      const reconciled = await this.#provider.reconcile({
        idempotencyKey: context.work.request.effect.idempotencyKey,
      });
      if (reconciled) return reconciled;
      return {
        ok: false,
        error: {
          schemaVersion: '1.0.0',
          code: 'ambiguous_delivery',
          message: 'provider effect remains unreconciled',
        },
      };
    }
    return this.#provider.dispatch({
      modelWork: context.work.request,
      canonicalRequestBytes: planned.canonicalRequestBytes,
      limits: context.work.request.budget,
    });
  }

  async #handleProviderError(
    context: CellContext,
    error: ProviderError,
  ): Promise<P7GovernedCellOutcome> {
    if (requiresProviderReconciliation(error.code)) {
      const reconciled = await this.#provider.reconcile({
        idempotencyKey: context.work.request.effect.idempotencyKey,
        ...(error.providerOperationId === undefined
          ? {}
          : { providerOperationId: error.providerOperationId }),
      });
      if (reconciled?.ok) return this.#complete(context, reconciled.envelope);
      await this.#markAmbiguous(context);
      return this.#retryableOutcome(context, error.code);
    }
    if (isRetryableProviderError(error.code)) {
      return this.#retryableOutcome(context, error.code);
    }
    return this.#fail(context, error.code, error.message);
  }

  async #markAmbiguous(context: CellContext): Promise<void> {
    if (context.attempt.state === 'in_flight') {
      context.attempt = await this.#repository.transitionProviderAttempt({
        id: context.attempt.id,
        expectedRevision: context.attempt.revision,
        state: 'ambiguous',
        updatedAt: this.#timestamp(),
      });
    }
    if (context.work.state === 'in_flight') {
      context.work = await this.#repository.transitionModelWork({
        id: context.work.id,
        expectedRevision: context.work.revision,
        state: 'ambiguous',
        updatedAt: this.#timestamp(),
      });
    }
  }

  async #retryableOutcome(
    context: CellContext,
    failureCode: string,
  ): Promise<P7GovernedCellOutcome> {
    return {
      cellId: context.work.cellId,
      status: 'failed',
      retryable: true,
      receiptIds: [],
      failureCode,
      authoritativeStatus: await this.#authority.status(context.runId),
    };
  }

  async #complete(
    context: CellContext,
    envelope: ProviderEnvelope,
  ): Promise<P7GovernedCellOutcome> {
    const attemptIdentity = context.work.request.attempt;
    if (
      envelope.provider !== attemptIdentity.provider ||
      envelope.concreteModel !== attemptIdentity.concreteModel ||
      envelope.checkpoint !== attemptIdentity.checkpoint
    ) {
      return this.#fail(
        context,
        'profile_drift',
        'provider envelope identity does not match the attempt',
      );
    }
    if (exceedsBudget(envelope.usage, context.work.request.budget)) {
      return this.#fail(
        context,
        'budget_exhausted',
        'provider usage exceeds the reserved budget',
      );
    }
    const rawArtifact =
      context.snapshot.artifacts.get('raw_provider_response') ??
      (await this.#recordArtifact(
        context,
        'raw_provider_response',
        envelope.rawResponseBytes,
        'pending',
      ));
    context.artifactIds.push(rawArtifact.id);

    const typedOutput = extractTypedOutput(envelope.rawResponseBytes);
    if (!typedOutput) {
      await this.#recordResidue(
        context,
        rawArtifact.id,
        'rejected',
        'malformed_output',
        'provider response failed typed model output validation',
      );
      return this.#fail(
        context,
        'malformed_output',
        'provider response failed typed model output validation',
      );
    }
    const typedBytes = new TextEncoder().encode(canonicalJson(typedOutput));
    const typedArtifact =
      context.snapshot.artifacts.get('typed_output') ??
      (await this.#recordArtifact(
        context,
        'typed_output',
        typedBytes,
        'accepted',
      ));
    context.artifactIds.push(typedArtifact.id);
    const acceptedResidue =
      context.snapshot.residues.find(
        (residue) => residue.verdict === 'accepted',
      ) ??
      (await this.#recordResidue(
        context,
        typedArtifact.id,
        'accepted',
        'typed_output_accepted',
        'provider response validated against the typed model output schema',
      ));
    void acceptedResidue;

    const usage = {
      inputTokens: envelope.usage.inputTokens,
      outputTokens: envelope.usage.outputTokens,
      currencyMicros: envelope.usage.currencyMicros,
      wallClockMs: envelope.usage.wallClockMs,
      toolCalls: 0 as const,
    };
    const effect = context.work.request.effect;
    const charge =
      context.snapshot.charge ??
      (await (async () => {
        const chargeRecord = sealRecord('p7-provider-charge', 'receiptDigest', {
          id: `chg:${context.attempt.stableIdentity}`,
          stableIdentity: canonicalDigest({
            kind: 'p7-provider-charge-identity',
            effect: effect.idempotencyKey,
          }),
          modelWorkId: context.work.id,
          providerAttemptId: context.attempt.id,
          reservationId: context.work.reservationId,
          providerEffectIdempotencyKey: effect.idempotencyKey,
          provider: context.attempt.provider,
          providerOperationId:
            envelope.providerOperationId ?? `effect:${effect.idempotencyKey}`,
          usage,
          priceVersion: 'p7-price-1.0.0',
          currencyConversionPolicy: 'none',
          chargedAt: this.#timestamp(),
        });
        const settlementRecord = sealRecord(
          'p7-budget-settlement',
          'receiptDigest',
          {
            id: `stl:${context.attempt.stableIdentity}`,
            stableIdentity: canonicalDigest({
              kind: 'p7-budget-settlement-identity',
              effect: effect.idempotencyKey,
            }),
            modelWorkId: context.work.id,
            reservationId: context.work.reservationId,
            providerChargeId: chargeRecord.id,
            amount: usage,
            settledAt: this.#timestamp(),
          },
        );
        const recorded = await this.#repository.recordChargeAndSettlement({
          charge: chargeRecord,
          settlement: settlementRecord,
        });
        return recorded.charge;
      })());
    const state = await this.#repository.reconstructProgram(
      context.work.programId,
    );
    const refreshed = snapshotFor(state, context.work.stableIdentity);
    const settlement = refreshed.settlement;
    if (!settlement) {
      throw new Error('P7 settlement is missing after charge recording');
    }
    context.work = refreshed.work ?? context.work;
    context.attempt = refreshed.attempt ?? context.attempt;

    if (!isAttemptTerminal(context.attempt.state)) {
      context.attempt = await this.#repository.transitionProviderAttempt({
        id: context.attempt.id,
        expectedRevision: context.attempt.revision,
        state: 'completed',
        updatedAt: this.#timestamp(),
      });
    }
    if (!isTerminal(context.work.state)) {
      context.work = await this.#repository.transitionModelWork({
        id: context.work.id,
        expectedRevision: context.work.revision,
        state: 'completed',
        updatedAt: this.#timestamp(),
      });
    }
    await this.#recordLink(context, refreshed, {
      providerChargeId: charge.id,
      settlementId: settlement.id,
      completedReceiptDigest: settlement.receiptDigest,
    });
    return {
      cellId: context.work.cellId,
      status: 'completed',
      retryable: false,
      receiptIds: [charge.receiptDigest, settlement.receiptDigest],
      authoritativeStatus: await this.#authority.status(context.runId),
    };
  }

  async #fail(
    context: CellContext,
    failureCode: string,
    message: string,
  ): Promise<P7GovernedCellOutcome> {
    const now = this.#timestamp();
    if (context.attempt && !isAttemptTerminal(context.attempt.state)) {
      context.attempt = await this.#repository.transitionProviderAttempt({
        id: context.attempt.id,
        expectedRevision: context.attempt.revision,
        state: 'failed',
        updatedAt: now,
      });
    }
    if (!isTerminal(context.work.state)) {
      context.work = await this.#repository.transitionModelWork({
        id: context.work.id,
        expectedRevision: context.work.revision,
        state: 'failed',
        updatedAt: now,
      });
    }
    let releaseReceipt: string | undefined;
    if (!context.snapshot.settlement && !context.snapshot.release) {
      const release = await this.#recordRelease(
        context.work,
        `failed: ${failureCode}: ${message}`,
      );
      releaseReceipt = release.receiptDigest;
    } else if (context.snapshot.release) {
      releaseReceipt = context.snapshot.release.receiptDigest;
    }
    const state = await this.#repository.reconstructProgram(
      context.work.programId,
    );
    const refreshed = snapshotFor(state, context.work.stableIdentity);
    await this.#recordLink(context, refreshed, {});
    return {
      cellId: context.work.cellId,
      status: 'failed',
      retryable: false,
      receiptIds: releaseReceipt ? [releaseReceipt] : [],
      failureCode,
      authoritativeStatus: await this.#authority.status(context.runId),
    };
  }

  async #recordLink(
    context: CellContext,
    refreshed: CellSnapshot,
    completion: {
      readonly providerChargeId?: string;
      readonly settlementId?: string;
      readonly completedReceiptDigest?: string;
    },
  ): Promise<void> {
    const artifactIds = [...refreshed.artifacts.values()]
      .map(({ id }) => id)
      .sort();
    await this.#repository.recordReconstructionLink(
      sealRecord('p7-reconstruction-link', 'linkDigest', {
        id: `link:${context.work.stableIdentity}`,
        stableIdentity: canonicalDigest({
          kind: 'p7-reconstruction-link-identity',
          modelWork: context.work.stableIdentity,
        }),
        modelWorkId: context.work.id,
        activityEffectId: `ae:${context.work.stableIdentity}`,
        topologyAttemptId: context.work.topologyAttemptId,
        reservationId: context.work.reservationId,
        artifactIds,
        ...completion,
        ...(refreshed.fence === undefined
          ? {}
          : { cancellationFenceId: refreshed.fence.id }),
        recordedAt: this.#timestamp(),
      }),
    );
  }

  #timestamp(): string {
    return this.#now().toISOString();
  }
}

function requireRunId(runId: string, request: P7ResearchRunRequest): string {
  const derived = deriveP7ResearchRunId(request);
  if (runId !== derived) {
    throw new Error('P7 cell execution run ID does not match its request');
  }
  return derived;
}

function p7CanonicalChatBody(
  request: P7ResearchRunRequest,
  identity: ModelWorkIdentity,
  concreteModel: string,
): Record<string, unknown> {
  const prompt = [
    'You are a Mammoth P7 research cell.',
    'Return only a JSON object with the fields observations, claimProposals,',
    'evidenceReferences, assumptions, dissent, and proposedFalsifiers.',
    `Charter digest: ${request.charterDigest}.`,
    `Criterion ${identity.criterionId} v${String(identity.criterionVersion)}`,
    `(${identity.criterionDigest}).`,
    `Cell ${identity.cellId} of topology ${identity.topologyId}`,
    `(${identity.topologyDigest}).`,
    `Canonical input digest: ${identity.canonicalInputDigest}.`,
  ].join(' ');
  return {
    messages: [{ content: prompt, role: 'user' }],
    model: concreteModel,
    response_format: { type: 'json_object' },
    stream: false,
    temperature: 0,
  };
}

function snapshotFor(
  state: P7ReconstructedState,
  identityDigest: string,
): CellSnapshot {
  const work = state.modelWorks.find(
    (row) => row.stableIdentity === identityDigest,
  );
  if (!work) return { artifacts: new Map(), residues: [] };
  const owned = <T extends { readonly modelWorkId: string }>(
    rows: readonly T[],
  ) => rows.filter((row) => row.modelWorkId === work.id);
  const attempt = owned(state.providerAttempts).find(
    (row) => row.attemptOrdinal === 1,
  );
  return {
    work,
    ...(attempt === undefined ? {} : { attempt }),
    ...pick('capability', owned(state.capabilityDecisions)[0]),
    ...pick('egress', owned(state.egressDecisions)[0]),
    artifacts: new Map(
      owned(state.artifacts).map((artifact) => [artifact.kind, artifact]),
    ),
    residues: owned(state.validationResidue),
    ...pick('charge', owned(state.providerCharges)[0]),
    ...pick('settlement', owned(state.settlements)[0]),
    ...pick('release', owned(state.releases)[0]),
    ...pick('fence', owned(state.cancellationFences)[0]),
  };
}

function pick<K extends string, V>(
  key: K,
  value: V | undefined,
): Partial<Record<K, V>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

function completionReceipts(snapshot: CellSnapshot): readonly string[] {
  return [
    ...(snapshot.charge ? [snapshot.charge.receiptDigest] : []),
    ...(snapshot.settlement ? [snapshot.settlement.receiptDigest] : []),
  ];
}

function exceedsBudget(
  usage: ProviderUsage,
  budget: ModelWorkRequest['budget'],
): boolean {
  return (
    usage.inputTokens > budget.inputTokens ||
    usage.outputTokens > budget.outputTokens ||
    usage.currencyMicros > budget.currencyMicros ||
    usage.wallClockMs > budget.wallClockMs
  );
}

export function extractTypedOutput(
  rawResponseBytes: Uint8Array,
): TypedModelOutput | undefined {
  let value: unknown;
  try {
    value = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(rawResponseBytes),
    );
  } catch {
    return undefined;
  }
  const direct = TypedModelOutputSchema.safeParse(value);
  if (direct.success) return direct.data;
  if (value && typeof value === 'object' && 'choices' in value) {
    const choices = (value as { readonly choices?: unknown }).choices;
    if (Array.isArray(choices) && choices.length > 0) {
      const first = choices[0] as {
        readonly message?: { readonly content?: unknown };
      };
      const content = first.message?.content;
      if (typeof content === 'string') {
        try {
          const inner = TypedModelOutputSchema.safeParse(JSON.parse(content));
          if (inner.success) return inner.data;
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

function sealRecord<T extends Record<string, unknown>, F extends string>(
  kind: string,
  field: F,
  record: T,
): T & Record<F, string> {
  return {
    ...record,
    [field]: canonicalDigest({ kind, ...record }),
  } as T & Record<F, string>;
}

function isTerminal(state: P7ModelWorkRecord['state']): boolean {
  return state === 'completed' || state === 'failed' || state === 'cancelled';
}

function isAttemptTerminal(state: P7ProviderAttemptRecord['state']): boolean {
  return state === 'completed' || state === 'failed';
}
