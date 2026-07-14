import {
  deriveP7ResearchRunId,
  parseP7ResearchRunRequest,
  type P7ResearchApplicationPort,
  type P7ResearchInspection,
  type P7ResearchRunRequest,
  type P7ResearchStatus,
} from '@mammoth/workflow';

export interface P7ResearchOrchestrationPort {
  start(request: P7ResearchRunRequest): Promise<{ readonly runId: string }>;
  resume(input: {
    readonly runId: string;
    readonly expectedRevision: number;
  }): Promise<void>;
  cancel(input: {
    readonly runId: string;
    readonly expectedRevision: number;
    readonly reason: string;
  }): Promise<void>;
}

/** Read model-work authority from Postgres/CAS, never workflow history. */
export interface P7ResearchAuthorityReader {
  register(request: P7ResearchRunRequest): Promise<void>;
  status(runId: string): Promise<P7ResearchStatus>;
  inspect(runId: string): Promise<P7ResearchInspection>;
}

export interface P7GovernedCellIdentity {
  readonly cellId: string;
  readonly modelWorkId: string;
  readonly modelWorkIdentityDigest: string;
  readonly providerAttemptId: string;
  readonly providerAttemptDigest: string;
}

export interface P7GovernedCellOutcome {
  readonly cellId: string;
  readonly status: 'completed' | 'failed' | 'cancelled';
  readonly retryable: boolean;
  readonly receiptIds: readonly string[];
  readonly failureCode?: string;
  readonly authoritativeStatus: P7ResearchStatus;
}

export interface P7GovernedCellExecutor {
  execute(input: {
    readonly runId: string;
    readonly request: P7ResearchRunRequest;
    readonly cells: readonly P7GovernedCellIdentity[];
    readonly cell: P7GovernedCellIdentity;
  }): Promise<P7GovernedCellOutcome>;
  cancel(input: {
    readonly runId: string;
    readonly request: P7ResearchRunRequest;
    readonly cells: readonly P7GovernedCellIdentity[];
    readonly reason: string;
  }): Promise<{
    readonly receiptId: string;
    readonly authoritativeStatus: P7ResearchStatus;
  }>;
}

export class P7ResearchApplicationService implements P7ResearchApplicationPort {
  constructor(
    private readonly orchestration: P7ResearchOrchestrationPort,
    private readonly authority: P7ResearchAuthorityReader,
  ) {}

  async run(raw: P7ResearchRunRequest): Promise<P7ResearchStatus> {
    const request = parseP7ResearchRunRequest(raw);
    const runId = deriveP7ResearchRunId(request);
    await this.authority.register(request);
    const started = await this.orchestration.start(request);
    if (started.runId !== runId)
      throw new Error('P7 orchestration returned a non-canonical run ID');
    return this.authority.status(runId);
  }

  async resume(runId: string): Promise<P7ResearchStatus> {
    const status = await this.authority.status(runId);
    if (status.state !== 'partial' && status.state !== 'failed')
      throw new Error(`P7 run in state ${status.state} is not resumable`);
    await this.orchestration.resume({
      runId,
      expectedRevision: status.authoritativeRevision,
    });
    return this.authority.status(runId);
  }

  async cancel(runId: string): Promise<P7ResearchStatus> {
    const status = await this.authority.status(runId);
    if (status.state === 'completed' || status.state === 'cancelled')
      return status;
    await this.orchestration.cancel({
      runId,
      expectedRevision: status.authoritativeRevision,
      reason: 'operator request',
    });
    return this.authority.status(runId);
  }

  status(runId: string): Promise<P7ResearchStatus> {
    return this.authority.status(runId);
  }

  inspect(runId: string): Promise<P7ResearchInspection> {
    return this.authority.inspect(runId);
  }
}

export * from './model-work-authority.js';
