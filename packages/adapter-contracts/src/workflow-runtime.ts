import type { AdapterDescriptor, AdapterCapability } from './capabilities.js';
import {
  P3_WORKFLOW_CONTRACT_MAJOR,
  P3_TASK_QUEUES,
  deriveWorkflowId,
  parseWorkflowControlSignal,
  parseWorkflowQuery,
  supportedWorkflowVersion,
  type P3TaskQueue,
  type P3WorkflowKind,
  type P3WorkflowName,
  type ProgramBranchIdentity,
  type SupportedWorkflowVersion,
  type WorkflowControlSignal,
  type WorkflowQuery,
  type WorkflowQueryKind,
} from '@mammoth/workflow';

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
  readonly workflow: SupportedWorkflowVersion;
  readonly identity: ProgramBranchIdentity;
  readonly workflowId: string;
  readonly taskQueue: WorkflowTaskQueueTarget;
  readonly workItemId: string;
}

export interface WorkflowTaskQueueTarget {
  readonly logical: P3TaskQueue;
  readonly physical: string;
}

/**
 * Maps a logical architecture queue to its versioned Temporal queue. The
 * mapping is deterministic and must be shared by workflow dispatch and worker
 * registration.
 */
export function workflowTaskQueueTarget(
  workflow: SupportedWorkflowVersion,
): WorkflowTaskQueueTarget {
  const registered = registeredWorkflow(workflow);
  return {
    logical: registered.taskQueue,
    physical: `mammoth-${registered.taskQueue}-v${String(registered.version)}`,
  };
}

export function parseWorkflowStartRequest(
  value: unknown,
): WorkflowStartRequest {
  const request = record(value, 'workflow start request');
  exactKeys(
    request,
    ['workflow', 'identity', 'workflowId', 'taskQueue', 'workItemId'],
    'workflow start request',
  );
  const workflow = parseRegisteredWorkflow(request.workflow);
  const identity = parseBranchIdentity(request.identity);
  const workflowId = identifier(request.workflowId, 'workflowId');
  if (workflowId !== deriveWorkflowId(workflow, identity)) {
    throw new Error('workflow start ID does not match its contract and branch');
  }
  const taskQueue = parseTaskQueueTarget(request.taskQueue);
  const expectedQueue = workflowTaskQueueTarget(workflow);
  if (
    taskQueue.logical !== expectedQueue.logical ||
    taskQueue.physical !== expectedQueue.physical
  ) {
    throw new Error('workflow start task queue does not match its contract');
  }
  return {
    workflow,
    identity,
    workflowId,
    taskQueue,
    workItemId: identifier(request.workItemId, 'workItemId'),
  };
}

export interface WorkflowExecutionReference {
  readonly workflowId: string;
  readonly runId: string;
  readonly workflowKind: P3WorkflowKind;
  readonly workflowName: P3WorkflowName;
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
  readonly signal: WorkflowControlSignal;
}

export function parseWorkflowSignalRequest(
  value: unknown,
): WorkflowSignalRequest {
  const request = record(value, 'workflow signal request');
  exactKeys(request, ['workflowId', 'signal'], 'workflow signal request');
  return {
    workflowId: identifier(request.workflowId, 'workflowId'),
    signal: parseWorkflowControlSignal(request.signal),
  };
}

export interface WorkflowCancellationRequest {
  readonly workflowId: string;
  readonly signal: Extract<WorkflowControlSignal, { readonly kind: 'cancel' }>;
}

export function parseWorkflowCancellationRequest(
  value: unknown,
): WorkflowCancellationRequest {
  const request = parseWorkflowSignalRequest(value);
  if (request.signal.kind !== 'cancel') {
    throw new Error('workflow cancellation requires a cancel signal');
  }
  return { workflowId: request.workflowId, signal: request.signal };
}

export interface WorkflowQueryRequest {
  readonly workflowId: string;
  readonly query: WorkflowQuery;
}

export function parseWorkflowQueryRequest(
  value: unknown,
): WorkflowQueryRequest {
  const request = record(value, 'workflow query request');
  exactKeys(request, ['workflowId', 'query'], 'workflow query request');
  return {
    workflowId: identifier(request.workflowId, 'workflowId'),
    query: parseWorkflowQuery(request.query),
  };
}

export type WorkflowOrchestrationStatus =
  | 'running'
  | 'paused'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'continued-as-new';

interface WorkflowQueryResultBase<Kind extends WorkflowQueryKind, Value> {
  readonly workflowId: string;
  readonly queryKind: Kind;
  readonly value: Value;
}

export type WorkflowQueryResult =
  | WorkflowQueryResultBase<
      'program-state',
      {
        readonly status: WorkflowOrchestrationStatus;
        readonly revision: number;
      }
    >
  | WorkflowQueryResultBase<
      'current-durable-step',
      { readonly stepId: string | null }
    >
  | WorkflowQueryResultBase<
      'pending-gates',
      { readonly gateIds: readonly string[] }
    >
  | WorkflowQueryResultBase<
      'cancellation-state',
      { readonly requested: boolean; readonly reason?: string }
    >
  | WorkflowQueryResultBase<
      'retry-state',
      { readonly attempt: number; readonly nextRetryAt: string | null }
    >
  | WorkflowQueryResultBase<
      'receipt-references',
      { readonly receiptIds: readonly string[] }
    >;

export function parseWorkflowQueryResult(value: unknown): WorkflowQueryResult {
  const result = record(value, 'workflow query result');
  exactKeys(
    result,
    ['workflowId', 'queryKind', 'value'],
    'workflow query result',
  );
  const workflowId = identifier(result.workflowId, 'workflowId');
  const query = parseWorkflowQuery({ kind: result.queryKind });
  const payload = record(result.value, 'workflow query result value');
  switch (query.kind) {
    case 'program-state': {
      exactKeys(payload, ['status', 'revision'], 'program-state result');
      return {
        workflowId,
        queryKind: query.kind,
        value: {
          status: orchestrationStatus(payload.status),
          revision: nonNegativeInteger(payload.revision, 'revision'),
        },
      };
    }
    case 'current-durable-step': {
      exactKeys(payload, ['stepId'], 'current-durable-step result');
      return {
        workflowId,
        queryKind: query.kind,
        value: {
          stepId:
            payload.stepId === null
              ? null
              : identifier(payload.stepId, 'stepId'),
        },
      };
    }
    case 'pending-gates': {
      exactKeys(payload, ['gateIds'], 'pending-gates result');
      return {
        workflowId,
        queryKind: query.kind,
        value: { gateIds: identifierList(payload.gateIds, 'gateIds') },
      };
    }
    case 'cancellation-state': {
      exactKeys(payload, ['requested', 'reason'], 'cancellation-state result', [
        'reason',
      ]);
      if (typeof payload.requested !== 'boolean') {
        throw new Error('requested must be a boolean');
      }
      if (payload.reason !== undefined && typeof payload.reason !== 'string') {
        throw new Error('reason must be a string');
      }
      return {
        workflowId,
        queryKind: query.kind,
        value: {
          requested: payload.requested,
          ...(payload.reason === undefined ? {} : { reason: payload.reason }),
        },
      };
    }
    case 'retry-state': {
      exactKeys(payload, ['attempt', 'nextRetryAt'], 'retry-state result');
      return {
        workflowId,
        queryKind: query.kind,
        value: {
          attempt: nonNegativeInteger(payload.attempt, 'attempt'),
          nextRetryAt:
            payload.nextRetryAt === null
              ? null
              : timestamp(payload.nextRetryAt, 'nextRetryAt'),
        },
      };
    }
    case 'receipt-references': {
      exactKeys(payload, ['receiptIds'], 'receipt-references result');
      return {
        workflowId,
        queryKind: query.kind,
        value: {
          receiptIds: identifierList(payload.receiptIds, 'receiptIds'),
        },
      };
    }
  }
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
  cancel(request: WorkflowCancellationRequest): Promise<void>;
}

export interface WorkflowRuntimeRequirementMetadata {
  readonly namespace: string;
  readonly taskQueue: string;
  readonly retentionDays: number;
  readonly workflowBundleId: string;
  readonly workerBuildId: string;
  readonly capabilities: readonly AdapterCapability[];
}

function registeredWorkflow(
  workflow: SupportedWorkflowVersion,
): SupportedWorkflowVersion {
  return parseRegisteredWorkflow(workflow);
}

function parseRegisteredWorkflow(value: unknown): SupportedWorkflowVersion {
  const workflow = record(value, 'workflow contract');
  exactKeys(
    workflow,
    ['contractMajor', 'kind', 'name', 'version', 'taskQueue'],
    'workflow contract',
  );
  if (workflow.contractMajor !== P3_WORKFLOW_CONTRACT_MAJOR) {
    throw new Error('unsupported workflow contract major');
  }
  if (typeof workflow.kind !== 'string' || !isWorkflowKind(workflow.kind)) {
    throw new Error('unsupported workflow kind');
  }
  const registered = supportedWorkflowVersion(
    workflow.kind,
    nonNegativeInteger(workflow.version, 'workflowVersion'),
  );
  if (
    workflow.name !== registered.name ||
    workflow.taskQueue !== registered.taskQueue
  ) {
    throw new Error(
      'workflow contract tuple does not match its registered kind',
    );
  }
  return registered;
}

function parseBranchIdentity(value: unknown): ProgramBranchIdentity {
  const identity = record(value, 'program branch identity');
  exactKeys(
    identity,
    ['programId', 'criterionVersion', 'branchId'],
    'program branch identity',
  );
  return {
    programId: identifier(identity.programId, 'programId'),
    criterionVersion: identifier(identity.criterionVersion, 'criterionVersion'),
    branchId: identifier(identity.branchId, 'branchId'),
  };
}

function parseTaskQueueTarget(value: unknown): WorkflowTaskQueueTarget {
  const target = record(value, 'workflow task queue target');
  exactKeys(target, ['logical', 'physical'], 'workflow task queue target');
  if (typeof target.logical !== 'string' || !isTaskQueue(target.logical)) {
    throw new Error('unsupported logical workflow task queue');
  }
  return {
    logical: target.logical,
    physical: identifier(target.physical, 'physical task queue'),
  };
}

function isWorkflowKind(value: string): value is P3WorkflowKind {
  try {
    supportedWorkflowVersion(value as P3WorkflowKind);
    return true;
  } catch {
    return false;
  }
}

function isTaskQueue(value: string): value is P3TaskQueue {
  return P3_TASK_QUEUES.includes(value as P3TaskQueue);
}

function orchestrationStatus(value: unknown): WorkflowOrchestrationStatus {
  if (
    value !== 'running' &&
    value !== 'paused' &&
    value !== 'waiting' &&
    value !== 'completed' &&
    value !== 'failed' &&
    value !== 'cancelled' &&
    value !== 'continued-as-new'
  ) {
    throw new Error('invalid workflow orchestration status');
  }
  return value;
}

function identifierList(value: unknown, name: string): readonly string[] {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
  return value.map((item) => identifier(item, name));
}

function timestamp(value: unknown, name: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${name} must be an ISO timestamp`);
  }
  return value;
}

function identifier(value: unknown, name: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 256 ||
    value.trim() !== value
  ) {
    throw new Error(`${name} must be a stable non-empty identifier`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
  return value as number;
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  name: string,
  optional: readonly string[] = [],
): void {
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  const missing = allowed.filter(
    (key) => !optional.includes(key) && !(key in value),
  );
  if (extras.length > 0 || missing.length > 0) {
    throw new Error(`${name} has invalid fields`);
  }
}
