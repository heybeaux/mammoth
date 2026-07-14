import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  deriveP7ResearchRunId,
  type P7ResearchApplicationPort,
  type P7ResearchInspection,
  type P7ResearchRunRequest,
  type P7ResearchStatus,
} from '@mammoth/workflow';
import { executeP7ResearchCli } from '../src/p7-operator.js';

const digest =
  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const request: P7ResearchRunRequest = {
  applicationContractMajor: 1,
  workflowVersion: 1,
  charterDigest: digest,
  topology: {
    topologyId: 'topology-cli',
    topologyDigest: digest,
    dependencyDigest: digest,
    programId: 'program-cli',
    workItemId: 'work-cli',
    criterion: {
      criterionId: 'criterion-cli',
      criterionVersion: 1,
      criterionDigest: digest,
      branchId: 'main',
    },
    topologyPlanVersion: '1.0.0',
    plannerPolicyVersion: '1.0.0',
    templateCatalogVersion: '1.0.0',
  },
  modelWorkPolicyDigest: digest,
  modelProfileVersionId: 'profile-cli',
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

class FixtureApplication implements P7ResearchApplicationPort {
  readonly calls: string[] = [];
  readonly runId = deriveP7ResearchRunId(request);

  run(input: P7ResearchRunRequest): Promise<P7ResearchStatus> {
    this.calls.push(`run:${input.topology.topologyId}`);
    return Promise.resolve(this.statusValue('accepted'));
  }

  resume(runId: string): Promise<P7ResearchStatus> {
    this.calls.push(`resume:${runId}`);
    return Promise.resolve(this.statusValue('running'));
  }

  cancel(runId: string): Promise<P7ResearchStatus> {
    this.calls.push(`cancel:${runId}`);
    return Promise.resolve(this.statusValue('cancelled'));
  }

  status(runId: string): Promise<P7ResearchStatus> {
    this.calls.push(`status:${runId}`);
    return Promise.resolve(this.statusValue('partial'));
  }

  inspect(runId: string): Promise<P7ResearchInspection> {
    this.calls.push(`inspect:${runId}`);
    return Promise.resolve({
      ...this.statusValue('partial'),
      charterDigest: request.charterDigest,
      topologyId: request.topology.topologyId,
      topologyDigest: request.topology.topologyDigest,
    });
  }

  private statusValue(state: P7ResearchStatus['state']): P7ResearchStatus {
    return {
      runId: this.runId,
      state,
      authoritativeRevision: 1,
      completedCellIds: [],
      failedCellIds: [],
      cancelledCellIds: [],
      unresolvedCellIds: ['cell-1'],
      receiptIds: [],
    };
  }
}

describe('P7 research CLI adapter', () => {
  it('runs a validated request through the application port', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mammoth-p7-cli-'));
    const path = join(root, 'request.json');
    await writeFile(path, JSON.stringify(request));
    const fixture = new FixtureApplication();
    const output: string[] = [];
    const code = await executeP7ResearchCli(
      ['research', 'run', path],
      fixture,
      {
        stdout: (value) => output.push(value),
        stderr: (value) => output.push(value),
      },
    );
    expect(code).toBe(0);
    expect(fixture.calls).toEqual(['run:topology-cli']);
    expect(JSON.parse(output[0] ?? '{}')).toMatchObject({
      command: 'research run',
      state: 'accepted',
    });
  });

  it.each(['status', 'inspect', 'resume', 'cancel'] as const)(
    'adapts research %s without importing persistence or Temporal',
    async (command) => {
      const fixture = new FixtureApplication();
      const output: string[] = [];
      const code = await executeP7ResearchCli(
        ['research', command, fixture.runId],
        fixture,
        {
          stdout: (value) => output.push(value),
          stderr: (value) => output.push(value),
        },
      );
      expect(code).toBe(0);
      expect(fixture.calls).toEqual([`${command}:${fixture.runId}`]);
    },
  );

  it('fails closed on malformed request input', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mammoth-p7-cli-bad-'));
    const path = join(root, 'request.json');
    await writeFile(path, JSON.stringify({ workflowVersion: 1 }));
    const errors: string[] = [];
    const code = await executeP7ResearchCli(
      ['research', 'run', path],
      new FixtureApplication(),
      { stdout: () => undefined, stderr: (value) => errors.push(value) },
    );
    expect(code).toBe(2);
    expect(JSON.parse(errors[0] ?? '{}')).toMatchObject({
      error: 'P7_RESEARCH_COMMAND_FAILED',
    });
  });
});
