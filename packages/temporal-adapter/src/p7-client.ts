import { Client, Connection, type WorkflowHandle } from '@temporalio/client';
import type { P7ResearchOrchestrationPort } from '@mammoth/p7-application-service';
import {
  deriveP7ResearchRunId,
  type P7ResearchRunRequest,
} from '@mammoth/workflow';
import type { TemporalAdapterConfig } from './config.js';
import type { P7LiveCellIdentity } from './p7-workflow-types.js';
import {
  p7LiveResearchWorkflow,
  p7ResearchControlSignal,
} from './p7-workflows.js';

export interface P7LiveCellPlanResolver {
  resolve(
    request: P7ResearchRunRequest,
  ): Promise<readonly P7LiveCellIdentity[]>;
}

/** Stateless orchestration adapter. Product status remains in Postgres/CAS. */
export class TemporalP7ResearchOrchestrator
  implements P7ResearchOrchestrationPort
{
  constructor(
    private readonly client: Client,
    private readonly config: TemporalAdapterConfig,
    private readonly plans: P7LiveCellPlanResolver,
  ) {}

  async start(
    request: P7ResearchRunRequest,
  ): Promise<{ readonly runId: string }> {
    const runId = deriveP7ResearchRunId(request);
    const cells = await this.plans.resolve(request);
    if (cells.length === 0) throw new Error('P7 live research requires cells');
    await this.client.workflow.start(p7LiveResearchWorkflow, {
      workflowId: runId,
      taskQueue: this.config.taskQueue,
      args: [{ request, cells }],
    });
    return { runId };
  }

  async resume(input: {
    readonly runId: string;
    readonly expectedRevision: number;
  }): Promise<void> {
    await this.handle(input.runId).signal(p7ResearchControlSignal, {
      kind: 'resume',
      signalId: controlSignalId('resume', input.runId, input.expectedRevision),
      expectedRevision: input.expectedRevision,
    });
  }

  async cancel(input: {
    readonly runId: string;
    readonly expectedRevision: number;
    readonly reason: string;
  }): Promise<void> {
    await this.handle(input.runId).signal(p7ResearchControlSignal, {
      kind: 'cancel',
      signalId: controlSignalId('cancel', input.runId, input.expectedRevision),
      expectedRevision: input.expectedRevision,
      reason: input.reason,
    });
  }

  private handle(runId: string): WorkflowHandle<typeof p7LiveResearchWorkflow> {
    return this.client.workflow.getHandle<typeof p7LiveResearchWorkflow>(runId);
  }
}

export async function connectTemporalP7ResearchOrchestrator(
  config: TemporalAdapterConfig,
  plans: P7LiveCellPlanResolver,
): Promise<{
  readonly orchestration: TemporalP7ResearchOrchestrator;
  close(): Promise<void>;
}> {
  const connection = await Connection.connect({ address: config.address });
  const client = new Client({ connection, namespace: config.namespace });
  return {
    orchestration: new TemporalP7ResearchOrchestrator(client, config, plans),
    close: async () => connection.close(),
  };
}

function controlSignalId(
  kind: 'resume' | 'cancel',
  runId: string,
  revision: number,
): string {
  return `${kind}:${runId}:${String(revision)}`;
}
