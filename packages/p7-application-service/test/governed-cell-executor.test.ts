import { describe, expect, it } from 'vitest';
import {
  canonicalDigest,
  canonicalJson,
  providerCapabilityManifestDigest,
  type ProviderCapabilityManifest,
  type TypedModelOutput,
} from '@mammoth/domain';
import { InMemoryP7ModelWorkRepository } from '@mammoth/persistence';
import {
  DeterministicModelProvider,
  type ModelProviderPort,
  type ProviderDispatchRequest,
  type ProviderDispatchResult,
} from '@mammoth/provider-port';
import { contentDigest } from '@mammoth/retrieval';
import type { CasObject, ContentAddressedStore } from '@mammoth/retrieval';
import {
  deriveP7ResearchRunId,
  type P7ResearchRunRequest,
} from '@mammoth/workflow';
import {
  GovernedProviderCellExecutor,
  ModelWorkP7ResearchAuthority,
  createP7GovernedCellPlanner,
  extractTypedOutput,
  planP7GovernedCells,
  planP7ModelWork,
  type P7ModelEgressEvaluator,
} from '../src/index.js';

const digest =
  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

const typedOutput: TypedModelOutput = {
  observations: ['governed executor observation'],
  claimProposals: [],
  evidenceReferences: [],
  assumptions: [],
  dissent: [],
  proposedFalsifiers: [],
};

function runRequest(topologySuffix: string): P7ResearchRunRequest {
  return {
    applicationContractMajor: 1,
    workflowVersion: 1,
    charterDigest: digest,
    topology: {
      topologyId: `topology-${topologySuffix}`,
      topologyDigest: digest,
      dependencyDigest: digest,
      programId: `program-${topologySuffix}`,
      workItemId: `work-${topologySuffix}`,
      criterion: {
        criterionId: `criterion-${topologySuffix}`,
        criterionVersion: 1,
        criterionDigest: digest,
        branchId: 'main',
      },
      topologyPlanVersion: '1.0.0',
      plannerPolicyVersion: '1.0.0',
      templateCatalogVersion: '1.0.0',
    },
    modelWorkPolicyDigest: digest,
    modelProfileVersionId: `profile-${topologySuffix}`,
    modelProfileVersionDigest: digest,
    promptTemplateDigest: digest,
    toolContractDigest: digest,
    outputSchemaDigest: digest,
    budget: {
      inputTokens: 10_000,
      outputTokens: 10_000,
      currencyMicros: 0,
      wallClockMs: 30_000,
      toolCalls: 0,
    },
  };
}

class MemoryCas implements ContentAddressedStore {
  readonly values = new Map<string, Uint8Array>();

  put(bytes: Uint8Array): Promise<CasObject> {
    const value = Uint8Array.from(bytes);
    const valueDigest = contentDigest(value);
    this.values.set(valueDigest, value);
    return Promise.resolve({
      digest: valueDigest,
      size: value.byteLength,
      storageUri: `memory:${valueDigest}`,
    });
  }

  get(objectDigest: string): Promise<Uint8Array> {
    const value = this.values.get(objectDigest);
    if (!value) return Promise.reject(new Error('missing CAS object'));
    return Promise.resolve(Uint8Array.from(value));
  }
}

function allowAllEgress(): P7ModelEgressEvaluator {
  return {
    policyDigest: digest,
    evaluate: (input) => ({
      policyVersion: '1.0.0',
      policyDigest: digest,
      decision: 'allowed',
      reason: 'test policy allows loopback dispatch',
      policyEvaluationDigest: canonicalDigest({
        kind: 'test-egress-evaluation',
        prompt: input.promptDigest,
      }),
    }),
  };
}

function denyAllEgress(): P7ModelEgressEvaluator {
  return {
    policyDigest: digest,
    evaluate: (input) => ({
      policyVersion: '1.0.0',
      policyDigest: digest,
      decision: 'denied',
      reason: 'test policy denies all destinations',
      policyEvaluationDigest: canonicalDigest({
        kind: 'test-egress-evaluation',
        prompt: input.promptDigest,
      }),
    }),
  };
}

interface Harness {
  readonly request: P7ResearchRunRequest;
  readonly runId: string;
  readonly repository: InMemoryP7ModelWorkRepository;
  readonly cas: MemoryCas;
  readonly authority: ModelWorkP7ResearchAuthority;
  readonly executor: GovernedProviderCellExecutor;
  readonly cells: ReturnType<typeof planP7GovernedCells>;
}

async function harness(options: {
  readonly suffix: string;
  readonly cellIds: readonly string[];
  readonly provider?: ModelProviderPort;
  readonly egress?: P7ModelEgressEvaluator;
}): Promise<Harness> {
  const request = runRequest(options.suffix);
  const provider =
    options.provider ?? new DeterministicModelProvider({ typedOutput });
  const repository = new InMemoryP7ModelWorkRepository();
  const cas = new MemoryCas();
  const topology = { cellIds: () => Promise.resolve([...options.cellIds]) };
  const authority = new ModelWorkP7ResearchAuthority(cas, repository, topology);
  await authority.register(request);
  const executor = new GovernedProviderCellExecutor({
    provider,
    repository,
    cas,
    authority,
    egress: options.egress ?? allowAllEgress(),
    destinationOrigin: 'http://127.0.0.1:11434',
  });
  const manifest = await provider.discoverCapabilities();
  const cells = planP7GovernedCells(
    request,
    manifest,
    [...options.cellIds].sort(),
  );
  return {
    request,
    runId: deriveP7ResearchRunId(request),
    repository,
    cas,
    authority,
    executor,
    cells,
  };
}

/** Delegates to an inner provider while letting tests inject failures. */
class ScriptedProvider implements ModelProviderPort {
  #failures: readonly ProviderDispatchResult[];
  #reconcilable: ProviderDispatchResult | undefined;

  constructor(
    private readonly inner: DeterministicModelProvider,
    failures: readonly ProviderDispatchResult[] = [],
  ) {
    this.#failures = failures;
  }

  discoverCapabilities(): Promise<ProviderCapabilityManifest> {
    return this.inner.discoverCapabilities();
  }

  async dispatch(
    request: ProviderDispatchRequest,
  ): Promise<ProviderDispatchResult> {
    const [next, ...rest] = this.#failures;
    if (next) {
      this.#failures = rest;
      this.#reconcilable = await this.inner.dispatch(request);
      return next;
    }
    return this.inner.dispatch(request);
  }

  async reconcile(input: {
    readonly idempotencyKey: string;
    readonly providerOperationId?: string;
  }): Promise<ProviderDispatchResult | undefined> {
    const inner = await this.inner.reconcile(input);
    return inner ?? this.#reconcilable;
  }
}

describe('P7 governed provider-backed cell executor', () => {
  it('completes a governed cell with capability, egress, artifacts, and settlement', async () => {
    const fixture = await harness({
      suffix: 'happy',
      cellIds: ['cell-a', 'cell-b'],
    });
    for (const cell of fixture.cells) {
      const outcome = await fixture.executor.execute({
        runId: fixture.runId,
        request: fixture.request,
        cells: fixture.cells,
        cell,
      });
      expect(outcome.status).toBe('completed');
      expect(outcome.retryable).toBe(false);
      expect(outcome.receiptIds).toHaveLength(2);
    }
    const status = await fixture.authority.status(fixture.runId);
    expect(status.state).toBe('completed');
    expect(status.completedCellIds).toEqual(['cell-a', 'cell-b']);
    expect(status.unresolvedCellIds).toEqual([]);

    const state = await fixture.repository.reconstructProgram(
      fixture.request.topology.programId,
    );
    expect(state.capabilityDecisions).toHaveLength(2);
    expect(state.egressDecisions).toHaveLength(2);
    expect(state.providerCharges).toHaveLength(2);
    expect(state.settlements).toHaveLength(2);
    expect(state.releases).toHaveLength(0);
    expect(state.reconstructionLinks).toHaveLength(2);
    const artifactKinds = state.artifacts.map(({ kind }) => kind).sort();
    expect(artifactKinds).toEqual([
      'canonical_prompt',
      'canonical_prompt',
      'raw_provider_response',
      'raw_provider_response',
      'typed_output',
      'typed_output',
    ]);
    for (const artifact of state.artifacts) {
      await expect(fixture.cas.get(artifact.digest)).resolves.toBeInstanceOf(
        Uint8Array,
      );
    }
  });

  it('anchors the canonical prompt artifact to the provider effect identity', async () => {
    const fixture = await harness({ suffix: 'prompt', cellIds: ['cell-a'] });
    const cell = fixture.cells[0];
    if (!cell) throw new Error('expected planned cell');
    await fixture.executor.execute({
      runId: fixture.runId,
      request: fixture.request,
      cells: fixture.cells,
      cell,
    });
    const state = await fixture.repository.reconstructProgram(
      fixture.request.topology.programId,
    );
    const prompt = state.artifacts.find(
      ({ kind }) => kind === 'canonical_prompt',
    );
    const work = state.modelWorks[0];
    if (!prompt || !work) throw new Error('expected prompt artifact and work');
    expect(prompt.digest).toBe(work.request.effect.canonicalRequestDigest);
    expect(prompt.digest).toBe(work.request.canonicalPromptDigest);
  });

  it('is idempotent across activity redelivery without duplicate charges', async () => {
    const fixture = await harness({ suffix: 'replay', cellIds: ['cell-a'] });
    const cell = fixture.cells[0];
    if (!cell) throw new Error('expected planned cell');
    const first = await fixture.executor.execute({
      runId: fixture.runId,
      request: fixture.request,
      cells: fixture.cells,
      cell,
    });
    const second = await fixture.executor.execute({
      runId: fixture.runId,
      request: fixture.request,
      cells: fixture.cells,
      cell,
    });
    expect(first.status).toBe('completed');
    expect(second.status).toBe('completed');
    expect(second.receiptIds).toEqual(first.receiptIds);
    const state = await fixture.repository.reconstructProgram(
      fixture.request.topology.programId,
    );
    expect(state.modelWorks).toHaveLength(1);
    expect(state.providerAttempts).toHaveLength(1);
    expect(state.providerAttempts[0]?.attemptOrdinal).toBe(1);
    expect(state.providerCharges).toHaveLength(1);
    expect(state.settlements).toHaveLength(1);
  });

  it('fails closed with a release when egress policy denies the dispatch', async () => {
    const fixture = await harness({
      suffix: 'egress',
      cellIds: ['cell-a'],
      egress: denyAllEgress(),
    });
    const cell = fixture.cells[0];
    if (!cell) throw new Error('expected planned cell');
    const outcome = await fixture.executor.execute({
      runId: fixture.runId,
      request: fixture.request,
      cells: fixture.cells,
      cell,
    });
    expect(outcome).toMatchObject({
      status: 'failed',
      retryable: false,
      failureCode: 'policy_denied',
    });
    expect(outcome.receiptIds).toHaveLength(1);
    const state = await fixture.repository.reconstructProgram(
      fixture.request.topology.programId,
    );
    expect(state.modelWorks[0]?.state).toBe('failed');
    expect(state.egressDecisions[0]?.decision).toBe('denied');
    expect(state.providerCharges).toHaveLength(0);
    expect(state.releases).toHaveLength(1);
    expect(outcome.authoritativeStatus.state).toBe('partial');
  });

  it('rejects malformed provider output with a validation residue', async () => {
    const inner = new DeterministicModelProvider({ typedOutput });
    const manifest = await inner.discoverCapabilities();
    const malformed: ModelProviderPort = {
      discoverCapabilities: () => inner.discoverCapabilities(),
      dispatch: async (request) => {
        const result = await inner.dispatch(request);
        if (!result.ok) return result;
        return {
          ok: true,
          envelope: {
            ...result.envelope,
            rawResponseBytes: new TextEncoder().encode('not json at all'),
          },
        };
      },
      reconcile: () => Promise.resolve(undefined),
    };
    void manifest;
    const fixture = await harness({
      suffix: 'malformed',
      cellIds: ['cell-a'],
      provider: malformed,
    });
    const cell = fixture.cells[0];
    if (!cell) throw new Error('expected planned cell');
    const outcome = await fixture.executor.execute({
      runId: fixture.runId,
      request: fixture.request,
      cells: fixture.cells,
      cell,
    });
    expect(outcome).toMatchObject({
      status: 'failed',
      retryable: false,
      failureCode: 'malformed_output',
    });
    const state = await fixture.repository.reconstructProgram(
      fixture.request.topology.programId,
    );
    const rejected = state.validationResidue.find(
      ({ verdict }) => verdict === 'rejected',
    );
    expect(rejected?.code).toBe('malformed_output');
    expect(
      state.artifacts.some(({ kind }) => kind === 'raw_provider_response'),
    ).toBe(true);
    expect(state.artifacts.some(({ kind }) => kind === 'typed_output')).toBe(
      false,
    );
  });

  it('keeps retryable failures in flight and resumes with the same idempotency key', async () => {
    const inner = new DeterministicModelProvider({ typedOutput });
    const provider = new ScriptedProvider(inner, [
      {
        ok: false,
        error: {
          schemaVersion: '1.0.0',
          code: 'rate_limited',
          message: 'synthetic rate limit',
        },
      },
    ]);
    const fixture = await harness({
      suffix: 'retryable',
      cellIds: ['cell-a'],
      provider,
    });
    const cell = fixture.cells[0];
    if (!cell) throw new Error('expected planned cell');
    const first = await fixture.executor.execute({
      runId: fixture.runId,
      request: fixture.request,
      cells: fixture.cells,
      cell,
    });
    expect(first).toMatchObject({
      status: 'failed',
      retryable: true,
      failureCode: 'rate_limited',
    });
    const inFlight = await fixture.repository.reconstructProgram(
      fixture.request.topology.programId,
    );
    expect(inFlight.modelWorks[0]?.state).toBe('in_flight');
    expect(inFlight.providerAttempts[0]?.state).toBe('in_flight');

    const second = await fixture.executor.execute({
      runId: fixture.runId,
      request: fixture.request,
      cells: fixture.cells,
      cell,
    });
    expect(second.status).toBe('completed');
    const state = await fixture.repository.reconstructProgram(
      fixture.request.topology.programId,
    );
    expect(state.providerAttempts).toHaveLength(1);
    expect(state.providerAttempts[0]?.attemptOrdinal).toBe(1);
    expect(state.providerCharges).toHaveLength(1);
  });

  it('reconciles ambiguous deliveries instead of redispatching', async () => {
    const inner = new DeterministicModelProvider({ typedOutput });
    const provider = new ScriptedProvider(inner, [
      {
        ok: false,
        error: {
          schemaVersion: '1.0.0',
          code: 'ambiguous_delivery',
          message: 'synthetic ambiguous delivery',
        },
      },
    ]);
    const fixture = await harness({
      suffix: 'ambiguous',
      cellIds: ['cell-a'],
      provider,
    });
    const cell = fixture.cells[0];
    if (!cell) throw new Error('expected planned cell');
    const outcome = await fixture.executor.execute({
      runId: fixture.runId,
      request: fixture.request,
      cells: fixture.cells,
      cell,
    });
    expect(outcome.status).toBe('completed');
    const state = await fixture.repository.reconstructProgram(
      fixture.request.topology.programId,
    );
    expect(state.providerAttempts).toHaveLength(1);
    expect(state.providerCharges).toHaveLength(1);
  });

  it('fails closed on budget exhaustion after dispatch', async () => {
    const request = runRequest('budget');
    const tight: P7ResearchRunRequest = {
      ...request,
      budget: { ...request.budget, outputTokens: 1 },
    };
    const provider = new DeterministicModelProvider({ typedOutput });
    const repository = new InMemoryP7ModelWorkRepository();
    const cas = new MemoryCas();
    const authority = new ModelWorkP7ResearchAuthority(cas, repository, {
      cellIds: () => Promise.resolve(['cell-a']),
    });
    await authority.register(tight);
    const executor = new GovernedProviderCellExecutor({
      provider,
      repository,
      cas,
      authority,
      egress: allowAllEgress(),
      destinationOrigin: 'http://127.0.0.1:11434',
    });
    const manifest = await provider.discoverCapabilities();
    const cells = planP7GovernedCells(tight, manifest, ['cell-a']);
    const cell = cells[0];
    if (!cell) throw new Error('expected planned cell');
    const outcome = await executor.execute({
      runId: deriveP7ResearchRunId(tight),
      request: tight,
      cells,
      cell,
    });
    expect(outcome).toMatchObject({
      status: 'failed',
      retryable: false,
      failureCode: 'budget_exhausted',
    });
    const state = await repository.reconstructProgram(tight.topology.programId);
    expect(state.releases).toHaveLength(1);
    expect(state.settlements).toHaveLength(0);
  });

  it('denies unsupported provider capabilities before any dispatch', async () => {
    const inner = new DeterministicModelProvider({ typedOutput });
    const base = await inner.discoverCapabilities();
    const withoutJson: ProviderCapabilityManifest = {
      ...base,
      supportsJsonOutput: false,
      manifestDigest: `sha256:${'0'.repeat(64)}`,
    };
    const degraded: ProviderCapabilityManifest = {
      ...withoutJson,
      manifestDigest: providerCapabilityManifestDigest(withoutJson),
    };
    let dispatched = false;
    const provider: ModelProviderPort = {
      discoverCapabilities: () => Promise.resolve(degraded),
      dispatch: () => {
        dispatched = true;
        return Promise.reject(new Error('must not dispatch'));
      },
      reconcile: () => Promise.resolve(undefined),
    };
    const fixture = await harness({
      suffix: 'capability',
      cellIds: ['cell-a'],
      provider,
    });
    const cell = fixture.cells[0];
    if (!cell) throw new Error('expected planned cell');
    const outcome = await fixture.executor.execute({
      runId: fixture.runId,
      request: fixture.request,
      cells: fixture.cells,
      cell,
    });
    expect(outcome).toMatchObject({
      status: 'failed',
      retryable: false,
      failureCode: 'unsupported_capability',
    });
    expect(dispatched).toBe(false);
    const state = await fixture.repository.reconstructProgram(
      fixture.request.topology.programId,
    );
    expect(state.capabilityDecisions[0]?.decision).toBe('denied');
  });

  it('records idempotent cancellation fences and releases', async () => {
    const fixture = await harness({
      suffix: 'cancel',
      cellIds: ['cell-a', 'cell-b'],
    });
    const first = await fixture.executor.cancel({
      runId: fixture.runId,
      request: fixture.request,
      cells: fixture.cells,
      reason: 'operator requested cancellation',
    });
    expect(first.authoritativeStatus.state).toBe('cancelled');
    expect(first.authoritativeStatus.cancelledCellIds).toEqual([
      'cell-a',
      'cell-b',
    ]);
    const second = await fixture.executor.cancel({
      runId: fixture.runId,
      request: fixture.request,
      cells: fixture.cells,
      reason: 'operator requested cancellation',
    });
    expect(second.receiptId).toBe(first.receiptId);
    const state = await fixture.repository.reconstructProgram(
      fixture.request.topology.programId,
    );
    expect(state.cancellationFences).toHaveLength(2);
    expect(state.releases).toHaveLength(2);
    const firstCell = fixture.cells[0];
    if (!firstCell) throw new Error('fixture did not plan a first cell');
    const outcome = await fixture.executor.execute({
      runId: fixture.runId,
      request: fixture.request,
      cells: fixture.cells,
      cell: firstCell,
    });
    expect(outcome.status).toBe('cancelled');
  });

  it('plans deterministic cell identities that the executor accepts', async () => {
    const request = runRequest('planner');
    const provider = new DeterministicModelProvider({ typedOutput });
    const planner = createP7GovernedCellPlanner(provider, {
      cellIds: () => Promise.resolve(['cell-b', 'cell-a', 'cell-a']),
    });
    const resolved = await planner.resolve(request);
    expect(resolved.map(({ cellId }) => cellId)).toEqual(['cell-a', 'cell-b']);
    const manifest = await provider.discoverCapabilities();
    const replanned = planP7GovernedCells(request, manifest, [
      'cell-a',
      'cell-b',
    ]);
    expect(resolved).toEqual(replanned);
    const one = planP7ModelWork(request, manifest, 'cell-a');
    const two = planP7ModelWork(request, manifest, 'cell-a');
    expect(one.modelWork).toEqual(two.modelWork);
    expect(
      canonicalJson(
        JSON.parse(new TextDecoder().decode(one.canonicalRequestBytes)),
      ),
    ).toBe(new TextDecoder().decode(one.canonicalRequestBytes));
  });

  it('extracts typed output from direct JSON and OpenAI chat envelopes', () => {
    const direct = new TextEncoder().encode(JSON.stringify(typedOutput));
    expect(extractTypedOutput(direct)).toEqual(typedOutput);
    const chat = new TextEncoder().encode(
      JSON.stringify({
        id: 'chatcmpl-1',
        choices: [
          {
            index: 0,
            finish_reason: 'stop',
            message: {
              role: 'assistant',
              content: JSON.stringify(typedOutput),
            },
          },
        ],
      }),
    );
    expect(extractTypedOutput(chat)).toEqual(typedOutput);
    expect(
      extractTypedOutput(new TextEncoder().encode('{"unexpected":true}')),
    ).toBeUndefined();
    expect(
      extractTypedOutput(new TextEncoder().encode('not json')),
    ).toBeUndefined();
  });
});
