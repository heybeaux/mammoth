import {
  createP4CellWorkItemContinueAsNewCarry,
  deriveP4CellWorkItemId,
  type P4CellWorkItemContinueAsNewCarry,
  type P4CellWorkItemIdentity,
} from './p4-contract.js';

export const P5_APPLICATION_CONTRACT_MAJOR = 1 as const;
export const P5_DIVERGENCE_REVIEW_WORKFLOW_VERSION = 1 as const;
export const P5_CONTINUE_AS_NEW_MAX_BOUNDARIES = 3 as const;

export type P5DurableBoundary =
  | 'budget_reserved'
  | 'position_dispatched'
  | 'position_committed'
  | 'position_revealed'
  | 'review_assigned'
  | 'review_committed'
  | 'budget_settled';

export type P5CancellationPoint =
  | 'before_dispatch'
  | 'during_generation'
  | 'after_commit_before_reveal'
  | 'during_review'
  | 'during_settlement';

export interface P5DivergenceReviewIdentity {
  readonly positionWorkItem: P4CellWorkItemIdentity;
  readonly reviewWorkItem: P4CellWorkItemIdentity;
  readonly isolationProtocolVersion: '1.0.0';
  readonly assignmentPolicyVersion: '1.0.0';
  readonly sanitizedContextContractVersion: '1.0.0';
}

export interface P5DivergenceReviewCarry
  extends P4CellWorkItemContinueAsNewCarry {
  readonly p5ContractMajor: typeof P5_APPLICATION_CONTRACT_MAJOR;
  readonly p5WorkflowVersion: typeof P5_DIVERGENCE_REVIEW_WORKFLOW_VERSION;
  readonly p5WorkflowId: string;
  readonly reviewStableWorkItemId: string;
  readonly isolationProtocolVersion: '1.0.0';
  readonly assignmentPolicyVersion: '1.0.0';
  readonly sanitizedContextContractVersion: '1.0.0';
  readonly completedBoundaries: readonly P5DurableBoundary[];
  readonly receiptIds: readonly string[];
}

export interface P5WorkflowStatePort<ProductState> {
  loadDivergenceReviewState(input: {
    readonly identity: P5DivergenceReviewIdentity;
    readonly completedBoundaries: readonly P5DurableBoundary[];
    readonly receiptIds: readonly string[];
  }): Promise<ProductState>;
}

export function deriveP5DivergenceReviewWorkflowId(
  identity: P5DivergenceReviewIdentity,
): string {
  const parsed = parseP5Identity(identity);
  return [
    'mammoth',
    'DivergenceReviewWorkflow',
    `v${String(P5_DIVERGENCE_REVIEW_WORKFLOW_VERSION)}`,
    encodeComponent(deriveP4CellWorkItemId(parsed.positionWorkItem)),
    encodeComponent(deriveP4CellWorkItemId(parsed.reviewWorkItem)),
    encodeComponent(parsed.isolationProtocolVersion),
    encodeComponent(parsed.assignmentPolicyVersion),
    encodeComponent(parsed.sanitizedContextContractVersion),
  ].join(':');
}

export function deriveP5ActivityId(input: {
  readonly workflowId: string;
  readonly boundary: P5DurableBoundary | P5CancellationPoint;
  readonly attemptId: string;
  readonly operationKind: string;
}): string {
  const record = requireRecord(input, 'P5 activity identity');
  requireExactKeys(
    record,
    ['workflowId', 'boundary', 'attemptId', 'operationKind'],
    'P5 activity identity',
  );
  return [
    'mammoth',
    'activity',
    encodeComponent(requireStableString(record.workflowId, 'workflowId')),
    encodeComponent(requireKnownBoundary(record.boundary, 'boundary')),
    encodeComponent(requireStableString(record.attemptId, 'attemptId')),
    encodeComponent(requireStableString(record.operationKind, 'operationKind')),
  ].join(':');
}

export function createP5DivergenceReviewCarry(input: {
  readonly identity: P5DivergenceReviewIdentity;
  readonly completedBoundaries: readonly P5DurableBoundary[];
  readonly receiptIds: readonly string[];
}): P5DivergenceReviewCarry {
  const record = requireRecord(input, 'P5 carry input');
  requireExactKeys(
    record,
    ['identity', 'completedBoundaries', 'receiptIds'],
    'P5 carry input',
  );
  const identity = parseP5Identity(record.identity);
  const positionCarry = createP4CellWorkItemContinueAsNewCarry(
    identity.positionWorkItem,
  );
  const completedBoundaries = requireBoundaries(
    record.completedBoundaries,
    'completedBoundaries',
  );
  if (completedBoundaries.length > P5_CONTINUE_AS_NEW_MAX_BOUNDARIES)
    throw new Error('P5 continue-as-new carry is too large');
  const receiptIds = requireStableStringArray(record.receiptIds, 'receiptIds');
  return {
    ...positionCarry,
    p5ContractMajor: P5_APPLICATION_CONTRACT_MAJOR,
    p5WorkflowVersion: P5_DIVERGENCE_REVIEW_WORKFLOW_VERSION,
    p5WorkflowId: deriveP5DivergenceReviewWorkflowId(identity),
    reviewStableWorkItemId: deriveP4CellWorkItemId(identity.reviewWorkItem),
    isolationProtocolVersion: identity.isolationProtocolVersion,
    assignmentPolicyVersion: identity.assignmentPolicyVersion,
    sanitizedContextContractVersion: identity.sanitizedContextContractVersion,
    completedBoundaries,
    receiptIds,
  };
}

export function parseP5DivergenceReviewCarry(
  value: unknown,
): P5DivergenceReviewCarry {
  const carry = requireRecord(value, 'P5 divergence/review carry');
  requireExactKeys(
    carry,
    [
      'workflowId',
      'contractMajor',
      'workflowVersion',
      'stableCellPlanId',
      'programId',
      'criterionId',
      'criterionVersion',
      'criterionDigest',
      'cellPlanId',
      'cellPlanVersion',
      'branchId',
      'role',
      'stableWorkItemId',
      'workItemId',
      'workItemVersion',
      'workRole',
      'p5ContractMajor',
      'p5WorkflowVersion',
      'p5WorkflowId',
      'reviewStableWorkItemId',
      'isolationProtocolVersion',
      'assignmentPolicyVersion',
      'sanitizedContextContractVersion',
      'completedBoundaries',
      'receiptIds',
    ],
    'P5 divergence/review carry',
  );
  if (carry.p5ContractMajor !== P5_APPLICATION_CONTRACT_MAJOR)
    throw new Error('unsupported P5 application contract major');
  if (carry.p5WorkflowVersion !== P5_DIVERGENCE_REVIEW_WORKFLOW_VERSION)
    throw new Error('unsupported P5 divergence/review workflow version');
  const completedBoundaries = requireBoundaries(
    carry.completedBoundaries,
    'completedBoundaries',
  );
  if (completedBoundaries.length > P5_CONTINUE_AS_NEW_MAX_BOUNDARIES)
    throw new Error('P5 continue-as-new carry is too large');
  const parsed = {
    ...createP4CellWorkItemContinueAsNewCarry({
      cellPlan: {
        programId: requireStableString(carry.programId, 'programId'),
        criterion: {
          criterionId: requireStableString(carry.criterionId, 'criterionId'),
          criterionVersion: requirePositiveInteger(
            carry.criterionVersion,
            'criterionVersion',
          ),
          criterionDigest: requireDigest(
            carry.criterionDigest,
            'criterionDigest',
          ),
          branchId: requireStableString(carry.branchId, 'branchId'),
        },
        cellPlanId: requireStableString(carry.cellPlanId, 'cellPlanId'),
        cellPlanVersion: requireStableString(
          carry.cellPlanVersion,
          'cellPlanVersion',
        ),
        branchId: requireStableString(carry.branchId, 'branchId'),
        role: requireStableString(carry.role, 'role') as never,
      },
      workItemId: requireStableString(carry.workItemId, 'workItemId'),
      workItemVersion: requireStableString(
        carry.workItemVersion,
        'workItemVersion',
      ),
      workRole: requireStableString(carry.workRole, 'workRole') as never,
    }),
    p5ContractMajor: P5_APPLICATION_CONTRACT_MAJOR,
    p5WorkflowVersion: P5_DIVERGENCE_REVIEW_WORKFLOW_VERSION,
    p5WorkflowId: requireStableString(carry.p5WorkflowId, 'p5WorkflowId'),
    reviewStableWorkItemId: requireStableString(
      carry.reviewStableWorkItemId,
      'reviewStableWorkItemId',
    ),
    isolationProtocolVersion: requireExactVersion(
      carry.isolationProtocolVersion,
      'isolationProtocolVersion',
    ),
    assignmentPolicyVersion: requireExactVersion(
      carry.assignmentPolicyVersion,
      'assignmentPolicyVersion',
    ),
    sanitizedContextContractVersion: requireExactVersion(
      carry.sanitizedContextContractVersion,
      'sanitizedContextContractVersion',
    ),
    completedBoundaries,
    receiptIds: requireStableStringArray(carry.receiptIds, 'receiptIds'),
  };
  if (parsed.workflowId !== carry.workflowId)
    throw new Error('P5 carry P4 workflow identity mismatch');
  if (parsed.stableWorkItemId !== carry.stableWorkItemId)
    throw new Error('P5 carry position identity mismatch');
  return parsed;
}

export async function reconstructP5DivergenceReviewAfterContinueAsNew<
  ProductState,
>(
  carryValue: unknown,
  identity: P5DivergenceReviewIdentity,
  port: P5WorkflowStatePort<ProductState>,
): Promise<ProductState> {
  const carry = parseP5DivergenceReviewCarry(carryValue);
  const parsedIdentity = parseP5Identity(identity);
  if (carry.p5WorkflowId !== deriveP5DivergenceReviewWorkflowId(parsedIdentity))
    throw new Error('P5 carry workflow identity mismatch');
  if (
    carry.stableWorkItemId !==
    deriveP4CellWorkItemId(parsedIdentity.positionWorkItem)
  )
    throw new Error('P5 carry position identity mismatch');
  if (
    carry.reviewStableWorkItemId !==
    deriveP4CellWorkItemId(parsedIdentity.reviewWorkItem)
  )
    throw new Error('P5 carry review identity mismatch');
  return port.loadDivergenceReviewState({
    identity: parsedIdentity,
    completedBoundaries: carry.completedBoundaries,
    receiptIds: carry.receiptIds,
  });
}

function parseP5Identity(value: unknown): P5DivergenceReviewIdentity {
  const record = requireRecord(value, 'P5 identity');
  requireExactKeys(
    record,
    [
      'positionWorkItem',
      'reviewWorkItem',
      'isolationProtocolVersion',
      'assignmentPolicyVersion',
      'sanitizedContextContractVersion',
    ],
    'P5 identity',
  );
  const isolationProtocolVersion = requireExactVersion(
    record.isolationProtocolVersion,
    'isolationProtocolVersion',
  );
  const assignmentPolicyVersion = requireExactVersion(
    record.assignmentPolicyVersion,
    'assignmentPolicyVersion',
  );
  const sanitizedContextContractVersion = requireExactVersion(
    record.sanitizedContextContractVersion,
    'sanitizedContextContractVersion',
  );
  return {
    positionWorkItem: record.positionWorkItem as P4CellWorkItemIdentity,
    reviewWorkItem: record.reviewWorkItem as P4CellWorkItemIdentity,
    isolationProtocolVersion,
    assignmentPolicyVersion,
    sanitizedContextContractVersion,
  };
}

function requireKnownBoundary(value: unknown, name: string): string {
  if (
    ![
      'budget_reserved',
      'position_dispatched',
      'position_committed',
      'position_revealed',
      'review_assigned',
      'review_committed',
      'budget_settled',
      'before_dispatch',
      'during_generation',
      'after_commit_before_reveal',
      'during_review',
      'during_settlement',
    ].includes(String(value))
  )
    throw new Error(`${name} is not a supported P5 boundary`);
  return String(value);
}

function requireBoundaries(value: unknown, name: string): P5DurableBoundary[] {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
  return value.map(
    (item) => requireKnownBoundary(item, name) as P5DurableBoundary,
  );
}

function requireStableStringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
  return value.map((item) => requireStableString(item, name));
}

function requireExactVersion(value: unknown, name: string): '1.0.0' {
  if (value !== '1.0.0') throw new Error(`${name} must be 1.0.0`);
  return value;
}

function requireDigest(value: unknown, name: string): string {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value))
    throw new Error(`${name} must be a sha256 digest`);
  return value;
}

function requirePositiveInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0)
    throw new Error(`${name} must be a positive integer`);
  return value;
}

function encodeComponent(value: string): string {
  return `${String(value.length)}-${encodeURIComponent(value)}`;
}

function requireStableString(value: unknown, name: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 4096 ||
    value.trim() !== value
  )
    throw new Error(`${name} must be a stable non-empty string`);
  return value;
}

function requireRecord(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error(`${name} must be an object`);
  return value as Record<string, unknown>;
}

function requireExactKeys(
  value: object,
  allowed: readonly string[],
  name: string,
): void {
  const record = value as Record<string, unknown>;
  const extras = Object.keys(record).filter((key) => !allowed.includes(key));
  const required = allowed.filter((key) => !(key in record));
  if (extras.length > 0 || required.length > 0)
    throw new Error(`${name} has invalid fields`);
}
