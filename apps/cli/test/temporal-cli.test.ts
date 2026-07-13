/* eslint-disable @typescript-eslint/require-await -- async operator contract fakes */
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProgramBranchIdentity } from '@mammoth/workflow';
import { describe, expect, it } from 'vitest';
import {
  executeTemporalCli,
  type TemporalCliDependencies,
  type TemporalOperatorPort,
} from '../src/index.js';

const identity: ProgramBranchIdentity = {
  programId: 'program-temporal-cli',
  criterionVersion: 'criterion-v1',
  branchId: 'main',
};

async function setup() {
  const cwd = await mkdtemp(join(tmpdir(), 'mammoth-temporal-cli-'));
  const charterPath = join(cwd, 'charter.json');
  await writeFile(
    charterPath,
    JSON.stringify({
      schemaVersion: 1,
      charter: { programId: identity.programId },
    }),
  );
  const stdout: string[] = [];
  const stderr: string[] = [];
  const calls: string[] = [];
  let state: 'paused' | 'running' | 'cancelled' = 'paused';
  const inspection = () => ({
    workflowId: 'mammoth:ResearchProgramWorkflow',
    runId: 'run-1',
    workflowVersion: 1 as const,
    cycle: 1,
    revision: state === 'paused' ? 1 : 2,
    activeBranch: identity,
    status: state,
    completedStages: ['commit-budget'] as const,
    pendingGates: [],
    cancellation: { requested: state === 'cancelled' },
    retry: { attempt: 0 },
    receiptReferences: ['receipt:commit-budget'],
    processedSignalIds: [],
  });
  const operator: TemporalOperatorPort = {
    run: async (input) => {
      calls.push(`run:${input.identity.programId}`);
      return {
        workflowId: 'mammoth:ResearchProgramWorkflow',
        firstExecutionRunId: 'run-1',
      };
    },
    status: async () => {
      calls.push('status');
      return inspection();
    },
    inspect: async () => {
      calls.push('inspect');
      return inspection();
    },
    resume: async () => {
      calls.push('resume');
      state = 'running';
    },
    cancel: async () => {
      calls.push('cancel');
      state = 'cancelled';
    },
  };
  const dependencies: TemporalCliDependencies = {
    io: {
      stdout: (value) => stdout.push(value),
      stderr: (value) => stderr.push(value),
    },
    operator,
    cwd: () => cwd,
    identity: (programId) => ({ ...identity, programId }),
  };
  return { cwd, charterPath, stdout, stderr, calls, dependencies };
}

describe('Temporal-backed operator CLI', () => {
  it('runs, queries, resumes, cancels, and inspects through a stateless port', async () => {
    const fixture = await setup();

    expect(
      await executeTemporalCli(
        ['run', fixture.charterPath, '--json'],
        fixture.dependencies,
      ),
    ).toBe(0);
    expect(lastJson(fixture.stdout)).toMatchObject({
      command: 'run',
      firstExecutionRunId: 'run-1',
      identity,
    });

    for (const command of ['status', 'resume', 'cancel', 'inspect'] as const) {
      expect(
        await executeTemporalCli(
          [command, identity.programId, '--json'],
          fixture.dependencies,
        ),
      ).toBe(0);
      expect(lastJson(fixture.stdout)).toMatchObject({ command });
    }

    expect(fixture.calls).toEqual([
      `run:${identity.programId}`,
      'status',
      'resume',
      'status',
      'cancel',
      'status',
      'inspect',
    ]);
    expect(lastJson(fixture.stdout)).toMatchObject({
      command: 'inspect',
      status: 'cancelled',
      receiptReferences: ['receipt:commit-budget'],
    });
  });

  it('fails closed on malformed run input and unsupported bounded execution', async () => {
    const fixture = await setup();
    const malformed = join(fixture.cwd, 'malformed.json');
    await writeFile(malformed, '{');

    expect(
      await executeTemporalCli(['run', malformed], fixture.dependencies),
    ).toBe(2);
    expect(lastJson(fixture.stderr)).toMatchObject({
      error: 'INVALID_CHARTER',
    });

    fixture.stderr.splice(0);
    expect(
      await executeTemporalCli(
        ['run', fixture.charterPath, '--max-steps', '1'],
        fixture.dependencies,
      ),
    ).toBe(2);
    expect(lastJson(fixture.stderr)).toMatchObject({
      error: 'USAGE',
      message: 'Temporal execution does not support --max-steps',
    });
  });
});

function lastJson(values: readonly string[]): Record<string, unknown> {
  const value = values.at(-1);
  if (!value) throw new Error('expected JSON output');
  return JSON.parse(value) as Record<string, unknown>;
}
