import { fileURLToPath } from 'node:url';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { describe, expect, it } from 'vitest';
import type { TypedModelOutput } from '@mammoth/domain';
import { canonicalDigest } from '@mammoth/domain';
import {
  DEFAULT_MODEL_EGRESS_POLICY,
  evaluateModelEgress,
} from '@mammoth/governance';
import {
  GovernedProviderCellExecutor,
  ModelWorkP7ResearchAuthority,
  createP7GovernedCellPlanner,
  type P7ModelEgressEvaluator,
} from '@mammoth/p7-application-service';
import { InMemoryP7ModelWorkRepository } from '@mammoth/persistence';
import { DeterministicModelProvider } from '@mammoth/provider-port';
import type { CasObject, ContentAddressedStore } from '@mammoth/retrieval';
import { deriveP7ResearchRunId } from '@mammoth/workflow';
import type { P7ResearchRunRequest } from '@mammoth/workflow';
import {
  P7_MODEL_PROVIDER_TASK_QUEUE,
  P7ResearchActivityFacade,
  p7LiveResearchWorkflow,
  type P7ResearchActivities,
} from '../src/index.js';

const digest =
  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

const typedOutput: TypedModelOutput = {
  observations: ['governed live loop observation'],
  claimProposals: [],
  evidenceReferences: [],
  assumptions: [],
  dissent: [],
  proposedFalsifiers: [],
};

const request: P7ResearchRunRequest = {
  applicationContractMajor: 1,
  workflowVersion: 1,
  charterDigest: digest,
  topology: {
    topologyId: 'topology-p7-governed-live',
    topologyDigest: digest,
    dependencyDigest: digest,
    programId: 'program-p7-governed-live',
    workItemId: 'work-p7-governed-live',
    criterion: {
      criterionId: 'criterion-p7-governed-live',
      criterionVersion: 1,
      criterionDigest: digest,
      branchId: 'main',
    },
    topologyPlanVersion: '1.0.0',
    plannerPolicyVersion: '1.0.0',
    templateCatalogVersion: '1.0.0',
  },
  modelWorkPolicyDigest: digest,
  modelProfileVersionId: 'profile-p7-governed-live',
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

class MemoryCas implements ContentAddressedStore {
  readonly values = new Map<string, Uint8Array>();

  put(bytes: Uint8Array): Promise<CasObject> {
    const value = Uint8Array.from(bytes);
    const valueDigest = canonicalDigest(
      JSON.parse(new TextDecoder().decode(value)),
    );
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

describe('P7 governed live Temporal workflow', () => {
  it('drives the governed provider-backed executor through continue-as-new and replay', async () => {
    const environment = await TestWorkflowEnvironment.createLocal();
    const workflowTaskQueue = 'mammoth-p7-governed-live-workflow';
    const workflowsPath = fileURLToPath(
      new URL('../src/p7-workflows.ts', import.meta.url),
    );

    const provider = new DeterministicModelProvider({ typedOutput });
    const repository = new InMemoryP7ModelWorkRepository();
    const cas = new MemoryCas();
    const topology = {
      cellIds: () => Promise.resolve(['cell-a', 'cell-b', 'cell-c']),
    };
    const authority = new ModelWorkP7ResearchAuthority(
      cas,
      repository,
      topology,
    );
    const egress: P7ModelEgressEvaluator = {
      policyDigest: DEFAULT_MODEL_EGRESS_POLICY.digest,
      evaluate: (input) =>
        evaluateModelEgress(
          { ...input, allowedTools: [] },
          DEFAULT_MODEL_EGRESS_POLICY,
        ),
    };
    const executor = new GovernedProviderCellExecutor({
      provider,
      repository,
      cas,
      authority,
      egress,
      destinationOrigin: 'http://127.0.0.1:11434',
    });
    const facade = new P7ResearchActivityFacade(authority, executor);
    const activities: P7ResearchActivities = {
      ensureRun: (input) => facade.ensureRun(input),
      reconstructRun: (runId) => facade.reconstructRun(runId),
      executeCell: (input) => facade.executeCell(input),
      recordCancellation: (input) => facade.recordCancellation(input),
      finalizeRun: (input) => facade.finalizeRun(input),
      inspectRun: (runId) => facade.inspectRun(runId),
    };

    const planner = createP7GovernedCellPlanner(provider, topology);
    const cells = await planner.resolve(request);
    expect(cells.map(({ cellId }) => cellId)).toEqual([
      'cell-a',
      'cell-b',
      'cell-c',
    ]);

    const activityWorker = await Worker.create({
      connection: environment.nativeConnection,
      ...(environment.namespace === undefined
        ? {}
        : { namespace: environment.namespace }),
      taskQueue: P7_MODEL_PROVIDER_TASK_QUEUE,
      activities,
    });
    const workflowWorker = await Worker.create({
      connection: environment.nativeConnection,
      ...(environment.namespace === undefined
        ? {}
        : { namespace: environment.namespace }),
      taskQueue: workflowTaskQueue,
      workflowsPath,
    });
    const activityRun = activityWorker.run();
    try {
      const observed = await workflowWorker.runUntil(async () => {
        const workflowId = deriveP7ResearchRunId(request);
        const handle = await environment.client.workflow.start(
          p7LiveResearchWorkflow,
          {
            workflowId,
            taskQueue: workflowTaskQueue,
            args: [{ request, cells }],
          },
        );
        const result = await handle.result();
        const history = await handle.fetchHistory();
        await Worker.runReplayHistory({ workflowsPath }, history, workflowId);
        return { result, history: JSON.stringify(history) };
      });

      expect(observed.result).toMatchObject({
        state: 'completed',
        completedCellIds: ['cell-a', 'cell-b', 'cell-c'],
        failedCellIds: [],
        cancelledCellIds: [],
        unresolvedCellIds: [],
        partial: false,
      });
      expect(observed.result.receiptIds.length).toBeGreaterThan(0);
      expect(observed.history).not.toContain('governed live loop observation');

      const state = await repository.reconstructProgram(
        request.topology.programId,
      );
      expect(state.modelWorks).toHaveLength(3);
      expect(
        state.modelWorks.every(({ state: work }) => work === 'completed'),
      ).toBe(true);
      expect(state.providerAttempts).toHaveLength(3);
      expect(
        state.providerAttempts.every(
          ({ attemptOrdinal }) => attemptOrdinal === 1,
        ),
      ).toBe(true);
      expect(
        state.egressDecisions.every(
          (decision) =>
            decision.decision === 'allowed' &&
            decision.policyDigest === DEFAULT_MODEL_EGRESS_POLICY.digest,
        ),
      ).toBe(true);
      expect(state.egressDecisions).toHaveLength(3);
      expect(state.providerCharges).toHaveLength(3);
      expect(state.settlements).toHaveLength(3);
      expect(state.reconstructionLinks).toHaveLength(3);
      expect(state.artifacts).toHaveLength(9);
      for (const artifact of state.artifacts) {
        await expect(cas.get(artifact.digest)).resolves.toBeInstanceOf(
          Uint8Array,
        );
      }

      const status = await authority.status(deriveP7ResearchRunId(request));
      expect(status.state).toBe('completed');
      expect(status).toMatchObject({
        completedCellIds: observed.result.completedCellIds,
        receiptIds: observed.result.receiptIds,
      });
    } finally {
      activityWorker.shutdown();
      await activityRun;
      await environment.teardown();
    }
  }, 120_000);
});
