/**
 * P4 contracts for carrying the authoritative domain research-cell identity
 * across orchestration boundaries.
 *
 * Temporal history is orchestration evidence only. These contracts carry stable
 * identifiers and reconstruct product state through ports backed by
 * authoritative stores.
 */

import {
  CellTemplateSchema,
  CriterionReferenceSchema,
  type CellTemplate,
  type CriterionReference,
} from '@mammoth/domain';

export const P4_APPLICATION_CONTRACT_MAJOR = 1 as const;
export const P4_CELL_PLAN_SCHEMA_VERSION = 1 as const;
export const P4_CELL_WORK_ITEM_SCHEMA_VERSION = 1 as const;
export const P4_RESEARCH_CELL_WORKFLOW_VERSION = 1 as const;

export const P4_CELL_ROLES = CellTemplateSchema.shape.kind.options;

export type P4CellRole = CellTemplate['kind'];

export type P4CriterionReference = Pick<
  CriterionReference,
  'criterionId' | 'criterionVersion' | 'criterionDigest' | 'branchId'
>;

export interface P4CellPlanIdentity {
  readonly programId: string;
  readonly criterion: P4CriterionReference;
  readonly cellPlanId: string;
  readonly cellPlanVersion: string;
  readonly branchId: string;
  readonly role: P4CellRole;
}

export interface P4CellWorkItemIdentity {
  readonly cellPlan: P4CellPlanIdentity;
  readonly workItemId: string;
  readonly workItemVersion: string;
  readonly workRole: P4CellRole;
}

export interface P4CellPlanApplicationContract {
  readonly contractMajor: typeof P4_APPLICATION_CONTRACT_MAJOR;
  readonly schemaVersion: typeof P4_CELL_PLAN_SCHEMA_VERSION;
  readonly identity: P4CellPlanIdentity;
  readonly planInputDigest: string;
  readonly outputContractDigest: string;
  readonly stableCellPlanId: string;
}

export interface P4CellWorkItemApplicationContract {
  readonly contractMajor: typeof P4_APPLICATION_CONTRACT_MAJOR;
  readonly schemaVersion: typeof P4_CELL_WORK_ITEM_SCHEMA_VERSION;
  readonly identity: P4CellWorkItemIdentity;
  readonly workInputDigest: string;
  readonly requiredOutputDigest: string;
  readonly stableWorkItemId: string;
}

export interface P4CellPlanContinueAsNewCarry {
  readonly workflowId: string;
  readonly contractMajor: typeof P4_APPLICATION_CONTRACT_MAJOR;
  readonly workflowVersion: typeof P4_RESEARCH_CELL_WORKFLOW_VERSION;
  readonly stableCellPlanId: string;
  readonly programId: string;
  readonly criterionId: string;
  readonly criterionVersion: number;
  readonly criterionDigest: string;
  readonly cellPlanId: string;
  readonly cellPlanVersion: string;
  readonly branchId: string;
  readonly role: P4CellRole;
}

export interface P4CellWorkItemContinueAsNewCarry
  extends P4CellPlanContinueAsNewCarry {
  readonly stableWorkItemId: string;
  readonly workItemId: string;
  readonly workItemVersion: string;
  readonly workRole: P4CellRole;
}

export interface P4CellPlanStatePort<ProductState> {
  loadCellPlan(identity: P4CellPlanIdentity): Promise<ProductState>;
}

export interface P4CellWorkItemStatePort<ProductState> {
  loadCellWorkItem(identity: P4CellWorkItemIdentity): Promise<ProductState>;
}

export function deriveP4CellPlanId(identity: P4CellPlanIdentity): string {
  assertCellPlanIdentity(identity);
  return [
    'mammoth',
    'cell-plan',
    `v${String(P4_CELL_PLAN_SCHEMA_VERSION)}`,
    encodeIdComponent(identity.programId),
    encodeIdComponent(identity.criterion.criterionId),
    encodeIdComponent(String(identity.criterion.criterionVersion)),
    encodeIdComponent(identity.criterion.criterionDigest),
    encodeIdComponent(identity.cellPlanId),
    encodeIdComponent(identity.cellPlanVersion),
    encodeIdComponent(identity.branchId),
    encodeIdComponent(identity.role),
  ].join(':');
}

export function deriveP4CellWorkItemId(
  identity: P4CellWorkItemIdentity,
): string {
  assertCellWorkItemIdentity(identity);
  return [
    'mammoth',
    'cell-work-item',
    `v${String(P4_CELL_WORK_ITEM_SCHEMA_VERSION)}`,
    encodeIdComponent(deriveP4CellPlanId(identity.cellPlan)),
    encodeIdComponent(identity.workItemId),
    encodeIdComponent(identity.workItemVersion),
    encodeIdComponent(identity.workRole),
  ].join(':');
}

export function deriveP4ResearchCellWorkflowId(
  identity: P4CellPlanIdentity,
): string {
  assertCellPlanIdentity(identity);
  return [
    'mammoth',
    'ResearchCellWorkflow',
    `v${String(P4_RESEARCH_CELL_WORKFLOW_VERSION)}`,
    encodeIdComponent(deriveP4CellPlanId(identity)),
  ].join(':');
}

export function createP4CellPlanApplicationContract(input: {
  readonly identity: P4CellPlanIdentity;
  readonly planInputDigest: string;
  readonly outputContractDigest: string;
}): P4CellPlanApplicationContract {
  const record = requireRecord(input, 'cell plan contract input');
  requireExactKeys(
    record,
    ['identity', 'planInputDigest', 'outputContractDigest'],
    'cell plan contract input',
  );
  const identity = parseCellPlanIdentity(record.identity);
  const planInputDigest = requireDigest(
    record.planInputDigest,
    'planInputDigest',
  );
  const outputContractDigest = requireDigest(
    record.outputContractDigest,
    'outputContractDigest',
  );
  return {
    contractMajor: P4_APPLICATION_CONTRACT_MAJOR,
    schemaVersion: P4_CELL_PLAN_SCHEMA_VERSION,
    identity,
    planInputDigest,
    outputContractDigest,
    stableCellPlanId: deriveP4CellPlanId(identity),
  };
}

export function createP4CellWorkItemApplicationContract(input: {
  readonly identity: P4CellWorkItemIdentity;
  readonly workInputDigest: string;
  readonly requiredOutputDigest: string;
}): P4CellWorkItemApplicationContract {
  const record = requireRecord(input, 'cell work item contract input');
  requireExactKeys(
    record,
    ['identity', 'workInputDigest', 'requiredOutputDigest'],
    'cell work item contract input',
  );
  const identity = parseCellWorkItemIdentity(record.identity);
  const workInputDigest = requireDigest(
    record.workInputDigest,
    'workInputDigest',
  );
  const requiredOutputDigest = requireDigest(
    record.requiredOutputDigest,
    'requiredOutputDigest',
  );
  return {
    contractMajor: P4_APPLICATION_CONTRACT_MAJOR,
    schemaVersion: P4_CELL_WORK_ITEM_SCHEMA_VERSION,
    identity,
    workInputDigest,
    requiredOutputDigest,
    stableWorkItemId: deriveP4CellWorkItemId(identity),
  };
}

export function createP4CellPlanContinueAsNewCarry(
  identity: P4CellPlanIdentity,
): P4CellPlanContinueAsNewCarry {
  const parsed = parseCellPlanIdentity(identity);
  return {
    workflowId: deriveP4ResearchCellWorkflowId(parsed),
    contractMajor: P4_APPLICATION_CONTRACT_MAJOR,
    workflowVersion: P4_RESEARCH_CELL_WORKFLOW_VERSION,
    stableCellPlanId: deriveP4CellPlanId(parsed),
    programId: parsed.programId,
    criterionId: parsed.criterion.criterionId,
    criterionVersion: parsed.criterion.criterionVersion,
    criterionDigest: parsed.criterion.criterionDigest,
    cellPlanId: parsed.cellPlanId,
    cellPlanVersion: parsed.cellPlanVersion,
    branchId: parsed.branchId,
    role: parsed.role,
  };
}

export function createP4CellWorkItemContinueAsNewCarry(
  identity: P4CellWorkItemIdentity,
): P4CellWorkItemContinueAsNewCarry {
  const parsed = parseCellWorkItemIdentity(identity);
  return {
    ...createP4CellPlanContinueAsNewCarry(parsed.cellPlan),
    stableWorkItemId: deriveP4CellWorkItemId(parsed),
    workItemId: parsed.workItemId,
    workItemVersion: parsed.workItemVersion,
    workRole: parsed.workRole,
  };
}

export async function reconstructP4CellPlanAfterContinueAsNew<ProductState>(
  value: unknown,
  port: P4CellPlanStatePort<ProductState>,
): Promise<ProductState> {
  const carry = parseP4CellPlanContinueAsNewCarry(value);
  return port.loadCellPlan(cellPlanIdentityFromCarry(carry));
}

export async function reconstructP4CellWorkItemAfterContinueAsNew<ProductState>(
  value: unknown,
  port: P4CellWorkItemStatePort<ProductState>,
): Promise<ProductState> {
  const carry = parseP4CellWorkItemContinueAsNewCarry(value);
  return port.loadCellWorkItem({
    cellPlan: cellPlanIdentityFromCarry(carry),
    workItemId: carry.workItemId,
    workItemVersion: carry.workItemVersion,
    workRole: carry.workRole,
  });
}

export function parseP4CellPlanContinueAsNewCarry(
  value: unknown,
): P4CellPlanContinueAsNewCarry {
  const carry = requireRecord(value, 'P4 cell-plan continue-as-new carry');
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
    ],
    'P4 cell-plan continue-as-new carry',
  );
  if (carry.contractMajor !== P4_APPLICATION_CONTRACT_MAJOR)
    throw new Error('unsupported P4 application contract major');
  if (carry.workflowVersion !== P4_RESEARCH_CELL_WORKFLOW_VERSION)
    throw new Error('unsupported P4 research-cell workflow version');
  const identity = cellPlanIdentityFromRawCarry(carry);
  const stableCellPlanId = requireStableString(
    carry.stableCellPlanId,
    'stableCellPlanId',
  );
  const workflowId = requireStableString(carry.workflowId, 'workflowId');
  if (stableCellPlanId !== deriveP4CellPlanId(identity))
    throw new Error('P4 cell-plan carry identity mismatch');
  if (workflowId !== deriveP4ResearchCellWorkflowId(identity))
    throw new Error('P4 cell workflow identity mismatch');
  return {
    workflowId,
    contractMajor: P4_APPLICATION_CONTRACT_MAJOR,
    workflowVersion: P4_RESEARCH_CELL_WORKFLOW_VERSION,
    stableCellPlanId,
    programId: identity.programId,
    criterionId: identity.criterion.criterionId,
    criterionVersion: identity.criterion.criterionVersion,
    criterionDigest: identity.criterion.criterionDigest,
    cellPlanId: identity.cellPlanId,
    cellPlanVersion: identity.cellPlanVersion,
    branchId: identity.branchId,
    role: identity.role,
  };
}

export function parseP4CellWorkItemContinueAsNewCarry(
  value: unknown,
): P4CellWorkItemContinueAsNewCarry {
  const carry = requireRecord(value, 'P4 cell work-item continue-as-new carry');
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
    ],
    'P4 cell work-item continue-as-new carry',
  );
  const planCarry = parseP4CellPlanContinueAsNewCarry({
    workflowId: carry.workflowId,
    contractMajor: carry.contractMajor,
    workflowVersion: carry.workflowVersion,
    stableCellPlanId: carry.stableCellPlanId,
    programId: carry.programId,
    criterionId: carry.criterionId,
    criterionVersion: carry.criterionVersion,
    criterionDigest: carry.criterionDigest,
    cellPlanId: carry.cellPlanId,
    cellPlanVersion: carry.cellPlanVersion,
    branchId: carry.branchId,
    role: carry.role,
  });
  const identity = {
    cellPlan: cellPlanIdentityFromCarry(planCarry),
    workItemId: requireIdentifier(carry.workItemId, 'workItemId'),
    workItemVersion: requireIdentifier(
      carry.workItemVersion,
      'workItemVersion',
    ),
    workRole: requireCellRole(carry.workRole, 'workRole'),
  };
  const stableWorkItemId = requireStableString(
    carry.stableWorkItemId,
    'stableWorkItemId',
  );
  if (stableWorkItemId !== deriveP4CellWorkItemId(identity))
    throw new Error('P4 cell work-item carry identity mismatch');
  return {
    ...planCarry,
    stableWorkItemId,
    workItemId: identity.workItemId,
    workItemVersion: identity.workItemVersion,
    workRole: identity.workRole,
  };
}

function parseCellPlanIdentity(value: unknown): P4CellPlanIdentity {
  const identity = requireRecord(value, 'P4 cell plan identity');
  requireExactKeys(
    identity,
    [
      'programId',
      'criterion',
      'cellPlanId',
      'cellPlanVersion',
      'branchId',
      'role',
    ],
    'P4 cell plan identity',
  );
  const criterion = requireRecord(identity.criterion, 'P4 criterion reference');
  requireExactKeys(
    criterion,
    ['criterionId', 'criterionVersion', 'criterionDigest', 'branchId'],
    'P4 criterion reference',
  );
  const parsedCriterion = CriterionReferenceSchema.parse(criterion);
  const branchId = requireIdentifier(identity.branchId, 'branchId');
  if (parsedCriterion.branchId !== branchId)
    throw new Error('P4 cell plan criterion branch mismatch');
  return {
    programId: requireIdentifier(identity.programId, 'programId'),
    criterion: {
      criterionId: parsedCriterion.criterionId,
      criterionVersion: parsedCriterion.criterionVersion,
      criterionDigest: parsedCriterion.criterionDigest,
      branchId: parsedCriterion.branchId,
    },
    cellPlanId: requireIdentifier(identity.cellPlanId, 'cellPlanId'),
    cellPlanVersion: requireIdentifier(
      identity.cellPlanVersion,
      'cellPlanVersion',
    ),
    branchId,
    role: requireCellRole(identity.role, 'role'),
  };
}

function parseCellWorkItemIdentity(value: unknown): P4CellWorkItemIdentity {
  const identity = requireRecord(value, 'P4 cell work-item identity');
  requireExactKeys(
    identity,
    ['cellPlan', 'workItemId', 'workItemVersion', 'workRole'],
    'P4 cell work-item identity',
  );
  return {
    cellPlan: parseCellPlanIdentity(identity.cellPlan),
    workItemId: requireIdentifier(identity.workItemId, 'workItemId'),
    workItemVersion: requireIdentifier(
      identity.workItemVersion,
      'workItemVersion',
    ),
    workRole: requireCellRole(identity.workRole, 'workRole'),
  };
}

function assertCellPlanIdentity(identity: P4CellPlanIdentity): void {
  parseCellPlanIdentity(identity);
}

function assertCellWorkItemIdentity(identity: P4CellWorkItemIdentity): void {
  parseCellWorkItemIdentity(identity);
}

function cellPlanIdentityFromCarry(
  carry: P4CellPlanContinueAsNewCarry,
): P4CellPlanIdentity {
  return {
    programId: carry.programId,
    criterion: {
      criterionId: carry.criterionId,
      criterionVersion: carry.criterionVersion,
      criterionDigest: carry.criterionDigest,
      branchId: carry.branchId,
    },
    cellPlanId: carry.cellPlanId,
    cellPlanVersion: carry.cellPlanVersion,
    branchId: carry.branchId,
    role: carry.role,
  };
}

function cellPlanIdentityFromRawCarry(
  carry: Record<string, unknown>,
): P4CellPlanIdentity {
  return {
    programId: requireIdentifier(carry.programId, 'programId'),
    criterion: {
      criterionId: requireIdentifier(carry.criterionId, 'criterionId'),
      criterionVersion: requirePositiveInteger(
        carry.criterionVersion,
        'criterionVersion',
      ),
      criterionDigest: requireDigest(carry.criterionDigest, 'criterionDigest'),
      branchId: requireIdentifier(carry.branchId, 'branchId'),
    },
    cellPlanId: requireIdentifier(carry.cellPlanId, 'cellPlanId'),
    cellPlanVersion: requireIdentifier(
      carry.cellPlanVersion,
      'cellPlanVersion',
    ),
    branchId: requireIdentifier(carry.branchId, 'branchId'),
    role: requireCellRole(carry.role, 'role'),
  };
}

function requireCellRole(value: unknown, name: string): P4CellRole {
  const parsed = CellTemplateSchema.shape.kind.safeParse(value);
  if (!parsed.success) {
    throw new Error(`${name} must be a supported P4 cell role`);
  }
  return parsed.data;
}

function requirePositiveInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0)
    throw new Error(`${name} must be a positive integer`);
  return value;
}

function encodeIdComponent(value: string): string {
  return `${String(value.length)}-${encodeURIComponent(value)}`;
}

function requireDigest(value: unknown, name: string): string {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${name} must be a sha256 digest`);
  }
  return value;
}

function requireIdentifier(value: unknown, name: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 256 ||
    value.trim() !== value ||
    hasControlCharacter(value)
  ) {
    throw new Error(
      `${name} must be a stable non-empty string of at most 256 characters`,
    );
  }
  return value;
}

function requireStableString(value: unknown, name: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 4096 ||
    value.trim() !== value ||
    hasControlCharacter(value)
  ) {
    throw new Error(
      `${name} must be a stable non-empty string of at most 4096 characters`,
    );
  }
  return value;
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function requireRecord(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
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
  if (extras.length > 0 || required.length > 0) {
    throw new Error(`${name} has invalid fields`);
  }
}
