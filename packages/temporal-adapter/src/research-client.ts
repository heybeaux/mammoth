import { Client, Connection, type WorkflowHandle } from '@temporalio/client';
import {
  deriveWorkflowId,
  supportedWorkflowVersion,
  type ProgramBranchIdentity,
  type WorkflowControlSignal,
} from '@mammoth/workflow';
import type { TemporalAdapterConfig } from './config.js';
import {
  researchProgramControlSignal,
  researchProgramStateQuery,
  researchProgramWorkflow,
} from './research-workflows.js';
import type {
  ResearchProgramInspection,
  ResearchProgramResult,
  ResearchProgramWorkflowInput,
} from './research-workflow-types.js';

type ControlSignalInput =
  | { readonly kind: 'pause'; readonly signalId: string }
  | { readonly kind: 'resume'; readonly signalId: string }
  | {
      readonly kind: 'cancel';
      readonly signalId: string;
      readonly reason?: string;
    }
  | {
      readonly kind: 'criterion-branch';
      readonly signalId: string;
      readonly criterionVersion: string;
      readonly branchId: string;
    }
  | {
      readonly kind: 'human-gate-decision';
      readonly signalId: string;
      readonly gateId: string;
      readonly decision: 'approve' | 'reject';
      readonly receiptId: string;
    };

export interface TemporalResearchRun {
  readonly workflowId: string;
  readonly firstExecutionRunId: string;
}

/** Thin, stateless operator surface: every method can be called by a new process. */
export class TemporalResearchProgramClient {
  constructor(
    private readonly client: Client,
    private readonly config: TemporalAdapterConfig,
  ) {}

  async run(input: ResearchProgramWorkflowInput): Promise<TemporalResearchRun> {
    const workflowId = researchProgramWorkflowId(input.identity);
    const handle = await this.client.workflow.start(researchProgramWorkflow, {
      workflowId,
      taskQueue: this.config.taskQueue,
      args: [input],
    });
    return { workflowId, firstExecutionRunId: handle.firstExecutionRunId };
  }

  status(identity: ProgramBranchIdentity): Promise<ResearchProgramInspection> {
    return this.handle(identity).query(researchProgramStateQuery);
  }

  inspect(identity: ProgramBranchIdentity): Promise<ResearchProgramInspection> {
    return this.status(identity);
  }

  async pause(
    identity: ProgramBranchIdentity,
    signalId: string,
  ): Promise<void> {
    await this.control(identity, { kind: 'pause', signalId });
  }

  async resume(
    identity: ProgramBranchIdentity,
    signalId: string,
  ): Promise<void> {
    await this.control(identity, { kind: 'resume', signalId });
  }

  async cancel(
    identity: ProgramBranchIdentity,
    signalId: string,
    reason?: string,
  ): Promise<void> {
    await this.control(identity, {
      kind: 'cancel',
      signalId,
      ...(reason === undefined ? {} : { reason }),
    });
  }

  async decideHumanGate(
    identity: ProgramBranchIdentity,
    input: {
      readonly signalId: string;
      readonly gateId: string;
      readonly decision: 'approve' | 'reject';
      readonly receiptId: string;
    },
  ): Promise<void> {
    await this.control(identity, { kind: 'human-gate-decision', ...input });
  }

  async branchCriterion(
    identity: ProgramBranchIdentity,
    input: {
      readonly signalId: string;
      readonly criterionVersion: string;
      readonly branchId: string;
    },
  ): Promise<void> {
    await this.control(identity, { kind: 'criterion-branch', ...input });
  }

  result(identity: ProgramBranchIdentity): Promise<ResearchProgramResult> {
    return this.handle(identity).result();
  }

  private handle(identity: ProgramBranchIdentity): WorkflowHandle {
    return this.client.workflow.getHandle(researchProgramWorkflowId(identity));
  }

  private async control(
    identity: ProgramBranchIdentity,
    signal: ControlSignalInput,
  ): Promise<void> {
    const handle = this.handle(identity);
    const state = await handle.query(researchProgramStateQuery);
    await handle.signal(researchProgramControlSignal, {
      ...signal,
      expectedRevision: state.revision,
    } as WorkflowControlSignal);
  }
}

export async function connectTemporalResearchProgramClient(
  config: TemporalAdapterConfig,
): Promise<{
  readonly operator: TemporalResearchProgramClient;
  close(): Promise<void>;
}> {
  const connection = await Connection.connect({ address: config.address });
  const client = new Client({ connection, namespace: config.namespace });
  return {
    operator: new TemporalResearchProgramClient(client, config),
    close: async () => connection.close(),
  };
}

export function researchProgramWorkflowId(
  identity: ProgramBranchIdentity,
): string {
  return deriveWorkflowId(
    supportedWorkflowVersion('research-program', 1),
    identity,
  );
}
