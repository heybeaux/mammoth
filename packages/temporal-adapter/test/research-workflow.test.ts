/* eslint-disable @typescript-eslint/require-await -- async Activity contract fakes */
import { fileURLToPath } from 'node:url';
import { Worker } from '@temporalio/worker';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import type {
  ProgramBranchIdentity,
  ResearchProgramStageId,
} from '@mammoth/workflow';
import { describe, expect, it } from 'vitest';
import {
  TemporalResearchProgramClient,
  loadTemporalAdapterConfig,
  researchProgramWorkflowId,
} from '../src/index.js';
import type {
  ResearchProgramDurableState,
  ResearchStageReceipt,
} from '../src/research-workflow-types.js';

const identity: ProgramBranchIdentity = {
  programId: 'program-temporal-live',
  criterionVersion: 'criterion-v1',
  branchId: 'main',
};

describe('MVP research Temporal workflow v1', () => {
  it('uses stable IDs, survives continue-as-new, exposes controls, gates, and replays', async () => {
    const env = await TestWorkflowEnvironment.createLocal();
    const states = new Map<string, ResearchProgramDurableState>();
    const activities = durableActivities(states);
    const config = loadTemporalAdapterConfig({
      MAMMOTH_TEMPORAL_NAMESPACE: env.namespace ?? 'default',
    });
    const worker = await Worker.create({
      connection: env.nativeConnection,
      ...(env.namespace === undefined ? {} : { namespace: env.namespace }),
      taskQueue: config.taskQueue,
      workflowsPath: fileURLToPath(
        new URL('../src/research-workflows.ts', import.meta.url),
      ),
      activities,
    });
    const operator = new TemporalResearchProgramClient(env.client, config);

    try {
      await worker.runUntil(async () => {
        const execution = await operator.run({
          identity,
          workflowVersion: 1,
          humanGate: {
            gateId: 'gate-assessment',
            beforeStage: 'assess-claims',
            timeoutMs: 60_000,
          },
        });
        expect(execution.workflowId).toBe(researchProgramWorkflowId(identity));

        await eventually(async () => {
          expect((await operator.status(identity)).status).toBe(
            'waiting-human',
          );
        });
        await operator.branchCriterion(identity, {
          signalId: 'signal-criterion-branch',
          criterionVersion: 'criterion-v2',
          branchId: 'adversarial-review',
        });
        expect(await operator.status(identity)).toMatchObject({
          activeBranch: {
            programId: identity.programId,
            criterionVersion: 'criterion-v2',
            branchId: 'adversarial-review',
          },
          processedSignalIds: ['signal-criterion-branch'],
        });
        await operator.pause(identity, 'signal-pause');
        expect(await operator.status(identity)).toMatchObject({
          status: 'paused',
          pendingGates: [{ gateId: 'gate-assessment' }],
        });
        await operator.decideHumanGate(identity, {
          signalId: 'signal-approve',
          gateId: 'gate-assessment',
          decision: 'approve',
          receiptId: 'gate-receipt-approved',
        });
        await operator.resume(identity, 'signal-resume');
        const result = await operator.result(identity);
        expect(result).toMatchObject({
          status: 'completed',
          partial: false,
          activeBranch: {
            programId: identity.programId,
            criterionVersion: 'criterion-v2',
            branchId: 'adversarial-review',
          },
          completedStages: [
            'commit-budget',
            'snapshot-source',
            'assess-claims',
            'persist-ledger',
            'compile-report',
            'commit-receipt',
          ],
        });
        expect(result.receiptReferences).toContain('gate-receipt-approved');

        const handle = env.client.workflow.getHandle(execution.workflowId);
        const history = await handle.fetchHistory();
        await Worker.runReplayHistory(
          {
            workflowsPath: fileURLToPath(
              new URL('../src/research-workflows.ts', import.meta.url),
            ),
          },
          history,
          execution.workflowId,
        );
      });
    } finally {
      await env.teardown();
    }
  }, 120_000);

  it('returns honest partial receipts for signal cancellation and gate timeout', async () => {
    const env = await TestWorkflowEnvironment.createLocal();
    const states = new Map<string, ResearchProgramDurableState>();
    const config = loadTemporalAdapterConfig({
      MAMMOTH_TEMPORAL_NAMESPACE: env.namespace ?? 'default',
    });
    const worker = await Worker.create({
      connection: env.nativeConnection,
      ...(env.namespace === undefined ? {} : { namespace: env.namespace }),
      taskQueue: config.taskQueue,
      workflowsPath: fileURLToPath(
        new URL('../src/research-workflows.ts', import.meta.url),
      ),
      activities: durableActivities(states),
    });
    const operator = new TemporalResearchProgramClient(env.client, config);
    try {
      await worker.runUntil(async () => {
        const cancelIdentity = { ...identity, branchId: 'cancel' };
        await operator.run({
          identity: cancelIdentity,
          workflowVersion: 1,
          humanGate: {
            gateId: 'cancel-gate',
            beforeStage: 'snapshot-source',
            timeoutMs: 3_600_000,
          },
        });
        await eventually(async () => {
          expect(
            (await operator.status(cancelIdentity)).pendingGates,
          ).toHaveLength(1);
        });
        await operator.cancel(
          cancelIdentity,
          'signal-cancel',
          'operator request',
        );
        expect(await operator.result(cancelIdentity)).toMatchObject({
          status: 'cancelled',
          partial: true,
          reason: 'operator request',
          completedStages: ['commit-budget'],
          receiptReferences: [
            'receipt:commit-budget',
            'receipt:termination:cancelled',
          ],
        });

        const timeoutIdentity = { ...identity, branchId: 'timeout' };
        await operator.run({
          identity: timeoutIdentity,
          workflowVersion: 1,
          humanGate: {
            gateId: 'timeout-gate',
            beforeStage: 'snapshot-source',
            timeoutMs: 10,
          },
        });
        expect(await operator.result(timeoutIdentity)).toMatchObject({
          status: 'gate-timeout',
          partial: true,
          completedStages: ['commit-budget'],
          receiptReferences: [
            'receipt:commit-budget',
            'receipt:termination:gate-timeout',
          ],
        });
      });
    } finally {
      await env.teardown();
    }
  }, 120_000);
});

function durableActivities(states: Map<string, ResearchProgramDurableState>) {
  const key = (value: ProgramBranchIdentity) => JSON.stringify(value);
  return {
    ensureResearchProgramControlPlan: async (input: {
      identity: ProgramBranchIdentity;
      humanGate?: ResearchProgramDurableState['humanGate'];
    }) => {
      const state = states.get(key(input.identity)) ?? {
        completedStages: [],
        receipts: [],
        receiptReferences: [],
        retry: { attempt: 0 },
      };
      states.set(key(input.identity), {
        ...state,
        ...(input.humanGate === undefined
          ? {}
          : { humanGate: input.humanGate }),
      });
    },
    loadResearchProgramState: async (value: ProgramBranchIdentity) =>
      states.get(key(value)) ?? {
        completedStages: [],
        receipts: [],
        receiptReferences: [],
        retry: { attempt: 0 },
      },
    executeResearchStage: async (input: {
      identity: ProgramBranchIdentity;
      workflowVersion: 1;
      stageId: ResearchProgramStageId;
    }): Promise<ResearchStageReceipt> => {
      const state = states.get(key(input.identity)) ?? {
        completedStages: [],
        receipts: [],
        receiptReferences: [],
        retry: { attempt: 0 },
      };
      const receipt = {
        stageId: input.stageId,
        receiptId: `receipt:${input.stageId}`,
        productRevisionId: `revision:${String(state.completedStages.length + 1)}`,
      };
      states.set(key(input.identity), {
        ...state,
        completedStages: [...state.completedStages, input.stageId],
        receipts: [...state.receipts, receipt],
        receiptReferences: [
          ...(state.receiptReferences ?? []),
          receipt.receiptId,
        ],
        retry: { attempt: 0 },
      });
      return receipt;
    },
    recordHumanGateDecision: async (input: {
      identity: ProgramBranchIdentity;
      gateId: string;
      decision: 'approve' | 'reject';
      receiptId: string;
    }) => {
      const state = states.get(key(input.identity)) ?? {
        completedStages: [],
        receipts: [],
        receiptReferences: [],
        retry: { attempt: 0 },
      };
      states.set(key(input.identity), {
        ...state,
        receiptReferences: [
          ...(state.receiptReferences ?? []),
          input.receiptId,
        ],
      });
    },
    recordCriterionBranch: async (input: {
      workflowIdentity: ProgramBranchIdentity;
      activeBranch: ProgramBranchIdentity;
    }) => {
      const state = states.get(key(input.workflowIdentity));
      if (!state) throw new Error('program state is missing');
      states.set(key(input.workflowIdentity), {
        ...state,
        activeBranch: input.activeBranch,
      });
    },
    recordResearchProgramTermination: async (input: {
      status: 'cancelled' | 'rejected' | 'gate-timeout';
    }) => ({ receiptId: `receipt:termination:${input.status}` }),
  };
}

async function eventually(assertion: () => Promise<void>): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await assertion();
      return;
    } catch (error: unknown) {
      if (attempt === 99) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}
