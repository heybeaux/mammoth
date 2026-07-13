import type { AdapterDescriptor, AdapterCapability } from './capabilities.js';

/** Diagnostic orchestration metadata. It is never authoritative product state. */
export interface WorkflowRuntimeDescriptor extends AdapterDescriptor {
  readonly kind: 'workflow-runtime';
  readonly namespace: string;
  readonly taskQueue: string;
  readonly retentionDays: number;
  readonly workflowBundleId: string;
  readonly workerBuildId: string;
}

export const WORKFLOW_RUNTIME_READINESS_FAILURES = [
  'not-started',
  'service-unavailable',
  'namespace-unavailable',
  'namespace-retention-mismatch',
  'task-queue-unavailable',
  'worker-incompatible',
  'contract-version-mismatch',
  'missing-capability',
] as const;

export type WorkflowRuntimeReadinessFailure =
  (typeof WORKFLOW_RUNTIME_READINESS_FAILURES)[number];

export interface WorkflowRuntimeReadiness {
  readonly ready: boolean;
  readonly checkedAt: string;
  readonly failures: readonly WorkflowRuntimeReadinessFailure[];
}

export interface WorkflowRuntimeHealth {
  readonly health: AdapterDescriptor['health'];
  readonly checkedAt: string;
}

export interface WorkflowRuntimeLifecycle {
  descriptor(): WorkflowRuntimeDescriptor;
  start(): Promise<void>;
  health(): Promise<WorkflowRuntimeHealth>;
  readiness(): Promise<WorkflowRuntimeReadiness>;
  shutdown(): Promise<void>;
}

export interface WorkflowStartRequest {
  readonly workflowName: string;
  readonly workflowVersion: number;
  readonly workflowId: string;
  readonly taskQueue: string;
  readonly inputDigest: string;
  readonly programId: string;
  readonly workItemId: string;
  readonly searchAttributes?: Readonly<Record<string, string>>;
}

export interface WorkflowExecutionReference {
  readonly workflowId: string;
  readonly runId: string;
  readonly workflowName: string;
  readonly workflowVersion: number;
}

export interface WorkflowDescription extends WorkflowExecutionReference {
  readonly orchestrationStatus:
    | 'running'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'terminated'
    | 'continued-as-new';
}

export interface WorkflowSignalRequest {
  readonly workflowId: string;
  readonly signalName: string;
  readonly payloadDigest: string;
}

export interface WorkflowQueryRequest {
  readonly workflowId: string;
  readonly queryName: string;
}

export interface WorkflowQueryResult {
  readonly workflowId: string;
  readonly queryName: string;
  readonly orchestrationValue: unknown;
}

/**
 * Inward orchestration port. Implementations must not expose SDK handles or use
 * query results as Mammoth product authority.
 */
export interface WorkflowGateway {
  start(request: WorkflowStartRequest): Promise<WorkflowExecutionReference>;
  describe(workflowId: string): Promise<WorkflowDescription>;
  signal(request: WorkflowSignalRequest): Promise<void>;
  query(request: WorkflowQueryRequest): Promise<WorkflowQueryResult>;
  cancel(workflowId: string, reason: string): Promise<void>;
}

export interface WorkflowRuntimeRequirementMetadata {
  readonly namespace: string;
  readonly taskQueue: string;
  readonly retentionDays: number;
  readonly workflowBundleId: string;
  readonly workerBuildId: string;
  readonly capabilities: readonly AdapterCapability[];
}
