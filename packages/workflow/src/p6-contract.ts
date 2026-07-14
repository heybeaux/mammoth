import type { CriterionReference } from '@mammoth/domain';

export const P6_APPLICATION_CONTRACT_MAJOR = 1 as const;
export const P6_TOPOLOGY_WORKFLOW_VERSION = 1 as const;
export const P6_CONTINUE_AS_NEW_MAX_RECEIPTS = 32 as const;
export const P6_TOPOLOGY_PLAN_SCHEMA_VERSION = '1.0.0' as const;
export const P6_TOPOLOGY_PLANNER_POLICY_VERSION = '1.0.0' as const;

export type P6TopologyBoundary =
  | 'topology_planned'
  | 'cell_dispatched'
  | 'cell_completed'
  | 'cell_failed'
  | 'cell_cancelled'
  | 'synthesis_ready'
  | 'topology_settled';

export type P6SchedulerState =
  | 'ready'
  | 'idle_complete'
  | 'blocked_dependencies'
  | 'concurrency_saturated'
  | 'budget_starved';

export interface P6TopologyIdentity {
  readonly topologyId: string;
  readonly topologyDigest: string;
  readonly dependencyDigest: string;
  readonly programId: string;
  readonly workItemId: string;
  readonly criterion: Pick<
    CriterionReference,
    'criterionId' | 'criterionVersion' | 'criterionDigest' | 'branchId'
  >;
  readonly topologyPlanVersion: typeof P6_TOPOLOGY_PLAN_SCHEMA_VERSION;
  readonly plannerPolicyVersion: typeof P6_TOPOLOGY_PLANNER_POLICY_VERSION;
  readonly templateCatalogVersion: '1.0.0';
}

export interface P6TopologyCellIdentity {
  readonly topology: P6TopologyIdentity;
  readonly nodeId: string;
  readonly cellId: string;
  readonly templateId: string;
  readonly templateVersion: number;
  readonly inputDigest: string;
  readonly dependencyDigest: string;
  readonly attempt: number;
}

export interface P6TopologyCarry {
  readonly workflowId: string;
  readonly p6ContractMajor: typeof P6_APPLICATION_CONTRACT_MAJOR;
  readonly p6WorkflowVersion: typeof P6_TOPOLOGY_WORKFLOW_VERSION;
  readonly topologyId: string;
  readonly topologyDigest: string;
  readonly dependencyDigest: string;
  readonly programId: string;
  readonly workItemId: string;
  readonly criterionId: string;
  readonly criterionVersion: number;
  readonly criterionDigest: string;
  readonly branchId: string;
  readonly topologyPlanVersion: typeof P6_TOPOLOGY_PLAN_SCHEMA_VERSION;
  readonly plannerPolicyVersion: typeof P6_TOPOLOGY_PLANNER_POLICY_VERSION;
  readonly templateCatalogVersion: '1.0.0';
  readonly schedulerState: P6SchedulerState;
  readonly completedBoundaries: readonly P6TopologyBoundary[];
  readonly receiptIds: readonly string[];
}

export interface P6TopologyStatePort<ProductState> {
  loadTopologyState(input: {
    readonly identity: P6TopologyIdentity;
    readonly schedulerState: P6SchedulerState;
    readonly completedBoundaries: readonly P6TopologyBoundary[];
    readonly receiptIds: readonly string[];
  }): Promise<ProductState>;
}

export function deriveP6TopologyWorkflowId(
  identity: P6TopologyIdentity,
): string {
  const parsed = parseP6TopologyIdentity(identity);
  return [
    'mammoth',
    'TopologyWorkflow',
    `v${String(P6_TOPOLOGY_WORKFLOW_VERSION)}`,
    encodeComponent(parsed.topologyId),
    encodeComponent(parsed.topologyDigest),
    encodeComponent(parsed.dependencyDigest),
  ].join(':');
}

export function deriveP6ChildWorkflowId(
  identity: P6TopologyCellIdentity,
): string {
  const parsed = parseP6TopologyCellIdentity(identity);
  return [
    'mammoth',
    'TopologyCellWorkflow',
    `v${String(P6_TOPOLOGY_WORKFLOW_VERSION)}`,
    encodeComponent(parsed.topology.topologyId),
    encodeComponent(parsed.cellId),
    encodeComponent(parsed.nodeId),
    encodeComponent(parsed.templateId),
    encodeComponent(String(parsed.templateVersion)),
    encodeComponent(String(parsed.attempt)),
  ].join(':');
}

export function deriveP6SynthesisInputId(identity: P6TopologyIdentity): string {
  const parsed = parseP6TopologyIdentity(identity);
  return [
    'mammoth',
    'topology-synthesis-input',
    `v${String(P6_TOPOLOGY_WORKFLOW_VERSION)}`,
    encodeComponent(parsed.topologyId),
    encodeComponent(parsed.topologyDigest),
    encodeComponent(parsed.dependencyDigest),
  ].join(':');
}

export function deriveP6SynthesisOutputId(
  identity: P6TopologyIdentity,
): string {
  const parsed = parseP6TopologyIdentity(identity);
  return [
    'mammoth',
    'topology-synthesis-output',
    `v${String(P6_TOPOLOGY_WORKFLOW_VERSION)}`,
    encodeComponent(parsed.topologyId),
    encodeComponent(parsed.criterion.criterionId),
    encodeComponent(String(parsed.criterion.criterionVersion)),
    encodeComponent(parsed.criterion.criterionDigest),
  ].join(':');
}

export function createP6TopologyCarry(input: {
  readonly identity: P6TopologyIdentity;
  readonly schedulerState: P6SchedulerState;
  readonly completedBoundaries: readonly P6TopologyBoundary[];
  readonly receiptIds: readonly string[];
}): P6TopologyCarry {
  const record = requireRecord(input, 'P6 carry input');
  requireExactKeys(
    record,
    ['identity', 'schedulerState', 'completedBoundaries', 'receiptIds'],
    'P6 carry input',
  );
  const identity = parseP6TopologyIdentity(record.identity);
  const completedBoundaries = requireBoundaryArray(
    record.completedBoundaries,
    'completedBoundaries',
  );
  const receiptIds = requireStringArray(record.receiptIds, 'receiptIds');
  if (receiptIds.length > P6_CONTINUE_AS_NEW_MAX_RECEIPTS)
    throw new Error('P6 continue-as-new carry has too many receipts');
  return {
    workflowId: deriveP6TopologyWorkflowId(identity),
    p6ContractMajor: P6_APPLICATION_CONTRACT_MAJOR,
    p6WorkflowVersion: P6_TOPOLOGY_WORKFLOW_VERSION,
    topologyId: identity.topologyId,
    topologyDigest: identity.topologyDigest,
    dependencyDigest: identity.dependencyDigest,
    programId: identity.programId,
    workItemId: identity.workItemId,
    criterionId: identity.criterion.criterionId,
    criterionVersion: identity.criterion.criterionVersion,
    criterionDigest: identity.criterion.criterionDigest,
    branchId: identity.criterion.branchId,
    topologyPlanVersion: identity.topologyPlanVersion,
    plannerPolicyVersion: identity.plannerPolicyVersion,
    templateCatalogVersion: identity.templateCatalogVersion,
    schedulerState: requireSchedulerState(record.schedulerState),
    completedBoundaries,
    receiptIds,
  };
}

export function parseP6TopologyCarry(value: unknown): P6TopologyCarry {
  const carry = requireRecord(value, 'P6 topology carry');
  requireExactKeys(
    carry,
    [
      'workflowId',
      'p6ContractMajor',
      'p6WorkflowVersion',
      'topologyId',
      'topologyDigest',
      'dependencyDigest',
      'programId',
      'workItemId',
      'criterionId',
      'criterionVersion',
      'criterionDigest',
      'branchId',
      'topologyPlanVersion',
      'plannerPolicyVersion',
      'templateCatalogVersion',
      'schedulerState',
      'completedBoundaries',
      'receiptIds',
    ],
    'P6 topology carry',
  );
  if (carry.p6ContractMajor !== P6_APPLICATION_CONTRACT_MAJOR)
    throw new Error('unsupported P6 application contract major');
  if (carry.p6WorkflowVersion !== P6_TOPOLOGY_WORKFLOW_VERSION)
    throw new Error('unsupported P6 topology workflow version');
  const identity = parseP6TopologyIdentity({
    topologyId: carry.topologyId,
    topologyDigest: carry.topologyDigest,
    dependencyDigest: carry.dependencyDigest,
    programId: carry.programId,
    workItemId: carry.workItemId,
    criterion: {
      criterionId: carry.criterionId,
      criterionVersion: carry.criterionVersion,
      criterionDigest: carry.criterionDigest,
      branchId: carry.branchId,
    },
    topologyPlanVersion: carry.topologyPlanVersion,
    plannerPolicyVersion: carry.plannerPolicyVersion,
    templateCatalogVersion: carry.templateCatalogVersion,
  });
  const workflowId = requireString(carry.workflowId, 'workflowId');
  if (workflowId !== deriveP6TopologyWorkflowId(identity))
    throw new Error('P6 topology carry workflow identity mismatch');
  const receiptIds = requireStringArray(carry.receiptIds, 'receiptIds');
  if (receiptIds.length > P6_CONTINUE_AS_NEW_MAX_RECEIPTS)
    throw new Error('P6 continue-as-new carry has too many receipts');
  return {
    workflowId,
    p6ContractMajor: P6_APPLICATION_CONTRACT_MAJOR,
    p6WorkflowVersion: P6_TOPOLOGY_WORKFLOW_VERSION,
    topologyId: identity.topologyId,
    topologyDigest: identity.topologyDigest,
    dependencyDigest: identity.dependencyDigest,
    programId: identity.programId,
    workItemId: identity.workItemId,
    criterionId: identity.criterion.criterionId,
    criterionVersion: identity.criterion.criterionVersion,
    criterionDigest: identity.criterion.criterionDigest,
    branchId: identity.criterion.branchId,
    topologyPlanVersion: identity.topologyPlanVersion,
    plannerPolicyVersion: identity.plannerPolicyVersion,
    templateCatalogVersion: identity.templateCatalogVersion,
    schedulerState: requireSchedulerState(carry.schedulerState),
    completedBoundaries: requireBoundaryArray(
      carry.completedBoundaries,
      'completedBoundaries',
    ),
    receiptIds,
  };
}

export async function reconstructP6TopologyAfterContinueAsNew<ProductState>(
  carryValue: unknown,
  port: P6TopologyStatePort<ProductState>,
): Promise<ProductState> {
  const carry = parseP6TopologyCarry(carryValue);
  return port.loadTopologyState({
    identity: topologyIdentityFromCarry(carry),
    schedulerState: carry.schedulerState,
    completedBoundaries: carry.completedBoundaries,
    receiptIds: carry.receiptIds,
  });
}

function topologyIdentityFromCarry(carry: P6TopologyCarry): P6TopologyIdentity {
  return {
    topologyId: carry.topologyId,
    topologyDigest: carry.topologyDigest,
    dependencyDigest: carry.dependencyDigest,
    programId: carry.programId,
    workItemId: carry.workItemId,
    criterion: {
      criterionId: carry.criterionId,
      criterionVersion: carry.criterionVersion,
      criterionDigest: carry.criterionDigest,
      branchId: carry.branchId,
    },
    topologyPlanVersion: carry.topologyPlanVersion,
    plannerPolicyVersion: carry.plannerPolicyVersion,
    templateCatalogVersion: carry.templateCatalogVersion,
  };
}

function parseP6TopologyIdentity(value: unknown): P6TopologyIdentity {
  const record = requireRecord(value, 'P6 topology identity');
  requireExactKeys(
    record,
    [
      'topologyId',
      'topologyDigest',
      'dependencyDigest',
      'programId',
      'workItemId',
      'criterion',
      'topologyPlanVersion',
      'plannerPolicyVersion',
      'templateCatalogVersion',
    ],
    'P6 topology identity',
  );
  const criterion = requireRecord(record.criterion, 'P6 criterion identity');
  requireExactKeys(
    criterion,
    ['criterionId', 'criterionVersion', 'criterionDigest', 'branchId'],
    'P6 criterion identity',
  );
  return {
    topologyId: requireString(record.topologyId, 'topologyId'),
    topologyDigest: requireDigest(record.topologyDigest, 'topologyDigest'),
    dependencyDigest: requireDigest(
      record.dependencyDigest,
      'dependencyDigest',
    ),
    programId: requireString(record.programId, 'programId'),
    workItemId: requireString(record.workItemId, 'workItemId'),
    criterion: {
      criterionId: requireString(criterion.criterionId, 'criterionId'),
      criterionVersion: requirePositiveInteger(
        criterion.criterionVersion,
        'criterionVersion',
      ),
      criterionDigest: requireDigest(
        criterion.criterionDigest,
        'criterionDigest',
      ),
      branchId: requireString(criterion.branchId, 'branchId'),
    },
    topologyPlanVersion: requireExactVersion(
      record.topologyPlanVersion,
      P6_TOPOLOGY_PLAN_SCHEMA_VERSION,
      'topologyPlanVersion',
    ),
    plannerPolicyVersion: requireExactVersion(
      record.plannerPolicyVersion,
      P6_TOPOLOGY_PLANNER_POLICY_VERSION,
      'plannerPolicyVersion',
    ),
    templateCatalogVersion: requireExactVersion(
      record.templateCatalogVersion,
      '1.0.0',
      'templateCatalogVersion',
    ),
  };
}

function parseP6TopologyCellIdentity(value: unknown): P6TopologyCellIdentity {
  const record = requireRecord(value, 'P6 topology cell identity');
  requireExactKeys(
    record,
    [
      'topology',
      'nodeId',
      'cellId',
      'templateId',
      'templateVersion',
      'inputDigest',
      'dependencyDigest',
      'attempt',
    ],
    'P6 topology cell identity',
  );
  return {
    topology: parseP6TopologyIdentity(record.topology),
    nodeId: requireString(record.nodeId, 'nodeId'),
    cellId: requireString(record.cellId, 'cellId'),
    templateId: requireString(record.templateId, 'templateId'),
    templateVersion: requirePositiveInteger(
      record.templateVersion,
      'templateVersion',
    ),
    inputDigest: requireDigest(record.inputDigest, 'inputDigest'),
    dependencyDigest: requireDigest(
      record.dependencyDigest,
      'dependencyDigest',
    ),
    attempt: requirePositiveInteger(record.attempt, 'attempt'),
  };
}

function requireRecord(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${name} must be an object`);
  return value as Record<string, unknown>;
}

function requireExactKeys(
  record: Record<string, unknown>,
  keys: readonly string[],
  name: string,
): void {
  const expected = new Set(keys);
  const actual = Object.keys(record);
  const invalid = actual.filter((key) => !expected.has(key));
  const missing = keys.filter((key) => !actual.includes(key));
  if (invalid.length > 0 || missing.length > 0)
    throw new Error(`${name} has invalid fields`);
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '')
    throw new Error(`${name} must be a non-empty string`);
  return value;
}

function requireDigest(value: unknown, name: string): string {
  const digest = requireString(value, name);
  if (!/^sha256:[0-9a-f]{64}$/.test(digest))
    throw new Error(`${name} must be a sha256 digest`);
  return digest;
}

function requirePositiveInteger(value: unknown, name: string): number {
  if (!Number.isInteger(value) || Number(value) <= 0)
    throw new Error(`${name} must be a positive integer`);
  return Number(value);
}

function requireExactVersion<T extends string>(
  value: unknown,
  expected: T,
  name: string,
): T {
  if (value !== expected) throw new Error(`${name} is unsupported`);
  return expected;
}

function requireSchedulerState(value: unknown): P6SchedulerState {
  if (
    ![
      'ready',
      'idle_complete',
      'blocked_dependencies',
      'concurrency_saturated',
      'budget_starved',
    ].includes(String(value))
  )
    throw new Error('schedulerState is not supported');
  return String(value) as P6SchedulerState;
}

function requireBoundaryArray(
  value: unknown,
  name: string,
): P6TopologyBoundary[] {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
  return value.map((entry) => {
    if (
      ![
        'topology_planned',
        'cell_dispatched',
        'cell_completed',
        'cell_failed',
        'cell_cancelled',
        'synthesis_ready',
        'topology_settled',
      ].includes(String(entry))
    )
      throw new Error(`${name} contains unsupported P6 boundary`);
    return String(entry) as P6TopologyBoundary;
  });
}

function requireStringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
  return value.map((entry, index) =>
    requireString(entry, `${name}[${String(index)}]`),
  );
}

function encodeComponent(value: string): string {
  return encodeURIComponent(value);
}
