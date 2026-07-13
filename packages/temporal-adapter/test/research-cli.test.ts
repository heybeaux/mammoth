/* eslint-disable @typescript-eslint/require-await -- async Activity contract fakes */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import type {
  ProgramBranchIdentity,
  ResearchProgramStageId,
} from '@mammoth/workflow';
import { describe, expect, it } from 'vitest';
import {
  TemporalResearchProgramClient,
  loadTemporalAdapterConfig,
} from '../src/index.js';
import type {
  ResearchProgramDurableState,
  ResearchStageReceipt,
} from '../src/research-workflow-types.js';

const execFileAsync = promisify(execFile);

describe('Temporal research operator CLI', () => {
  it('runs, queries, pauses, resumes, inspects, and cancels from fresh processes', async () => {
    const env = await TestWorkflowEnvironment.createLocal();
    const [host, rawPort] = env.address.split(':');
    const childEnv = {
      ...process.env,
      MAMMOTH_TEMPORAL_HOST: host,
      MAMMOTH_TEMPORAL_PORT: rawPort,
      MAMMOTH_TEMPORAL_ADDRESS: env.address,
      MAMMOTH_TEMPORAL_NAMESPACE: env.namespace ?? 'default',
    };
    const config = loadTemporalAdapterConfig(childEnv);
    const states = new Map<string, ResearchProgramDurableState>();
    const worker = await Worker.create({
      connection: env.nativeConnection,
      ...(env.namespace === undefined ? {} : { namespace: env.namespace }),
      taskQueue: config.taskQueue,
      workflowsPath: fileURLToPath(
        new URL('../src/research-workflows.ts', import.meta.url),
      ),
      activities: durableActivities(states),
    });
    const parentOperator = new TemporalResearchProgramClient(
      env.client,
      config,
    );

    try {
      await worker.runUntil(async () => {
        const run = await cli(
          [
            'run',
            'program-cli',
            '--gate-id',
            'cli-gate',
            '--before-stage',
            'snapshot-source',
            '--timeout-ms',
            '60000',
          ],
          childEnv,
        );
        expect(run).toMatchObject({ command: 'run' });
        const identity = branch('program-cli', 'main');
        await eventually(async () => {
          expect((await parentOperator.status(identity)).status).toBe(
            'waiting-human',
          );
        });

        expect(await cli(['status', 'program-cli'], childEnv)).toMatchObject({
          command: 'status',
          status: 'waiting-human',
          durableStep: 'snapshot-source',
        });
        expect(await cli(['pause', 'program-cli'], childEnv)).toMatchObject({
          command: 'pause',
          status: 'paused',
        });
        expect(await cli(['inspect', 'program-cli'], childEnv)).toMatchObject({
          command: 'inspect',
          pendingGates: [{ gateId: 'cli-gate' }],
        });
        await cli(
          [
            'approve',
            'program-cli',
            '--gate-id',
            'cli-gate',
            '--receipt-id',
            'receipt:cli-gate-approved',
          ],
          childEnv,
        );
        await cli(['resume', 'program-cli'], childEnv);
        expect(await parentOperator.result(identity)).toMatchObject({
          status: 'completed',
          partial: false,
        });

        await cli(
          [
            'run',
            'program-cli',
            '--branch',
            'cancel',
            '--gate-id',
            'cancel-gate',
            '--before-stage',
            'snapshot-source',
            '--timeout-ms',
            '60000',
          ],
          childEnv,
        );
        const cancelIdentity = branch('program-cli', 'cancel');
        await eventually(async () => {
          expect((await parentOperator.status(cancelIdentity)).status).toBe(
            'waiting-human',
          );
        });
        expect(
          await cli(
            [
              'cancel',
              'program-cli',
              '--branch',
              'cancel',
              '--reason',
              'operator-stop',
            ],
            childEnv,
          ),
        ).toMatchObject({
          command: 'cancel',
          status: 'cancelled',
          cancellation: { requested: true, reason: 'operator-stop' },
        });
        expect(await parentOperator.result(cancelIdentity)).toMatchObject({
          status: 'cancelled',
          partial: true,
          completedStages: ['commit-budget'],
        });
      });
    } finally {
      await env.teardown();
    }
  }, 120_000);
});

async function cli(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<Record<string, unknown>> {
  const executable = fileURLToPath(
    new URL('../node_modules/tsx/dist/cli.mjs', import.meta.url),
  );
  const script = fileURLToPath(
    new URL('../src/research-cli.ts', import.meta.url),
  );
  const result = await execFileAsync(
    process.execPath,
    [executable, script, ...args],
    {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env,
      timeout: 15_000,
    },
  );
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

function branch(programId: string, branchId: string): ProgramBranchIdentity {
  return { programId, criterionVersion: 'criterion-v1', branchId };
}

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
        retry: { attempt: 0 },
      };
      const receipt = {
        stageId: input.stageId,
        receiptId: `receipt:${input.identity.branchId}:${input.stageId}`,
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
      receiptId: string;
    }) => {
      const state = states.get(key(input.identity));
      if (!state) throw new Error('control plan is missing');
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
      const serialized = key(input.workflowIdentity);
      const state = states.get(serialized);
      if (!state) throw new Error('program state is missing');
      states.set(serialized, { ...state, activeBranch: input.activeBranch });
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
