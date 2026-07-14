import { canonicalDigest, type ModelWorkBudget } from '@mammoth/domain';
import {
  P6_TOPOLOGY_PLAN_SCHEMA_VERSION,
  P6_TOPOLOGY_PLANNER_POLICY_VERSION,
  deriveP6TopologyWorkflowId,
  type P6TopologyIdentity,
} from './p6-contract.js';

export const P7_APPLICATION_CONTRACT_MAJOR = 1 as const;
export const P7_WORKFLOW_VERSION = 1 as const;
export const P7_PROJECTION_EXTENSION_VERSION = '1.0.0' as const;

export interface P7ResearchRunRequest {
  readonly applicationContractMajor: typeof P7_APPLICATION_CONTRACT_MAJOR;
  readonly workflowVersion: typeof P7_WORKFLOW_VERSION;
  readonly charterDigest: string;
  readonly topology: P6TopologyIdentity;
  readonly modelWorkPolicyDigest: string;
  readonly modelProfileVersionId: string;
  readonly modelProfileVersionDigest: string;
  readonly promptTemplateDigest: string;
  readonly toolContractDigest: string;
  readonly outputSchemaDigest: string;
  readonly budget: ModelWorkBudget;
}

export type P7ResearchRunState =
  | 'accepted'
  | 'running'
  | 'partial'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface P7ResearchStatus {
  readonly runId: string;
  readonly state: P7ResearchRunState;
  readonly authoritativeRevision: number;
  readonly completedCellIds: readonly string[];
  readonly failedCellIds: readonly string[];
  readonly cancelledCellIds: readonly string[];
  readonly unresolvedCellIds: readonly string[];
  readonly receiptIds: readonly string[];
}

export interface P7ResearchInspection extends P7ResearchStatus {
  readonly charterDigest: string;
  readonly topologyId: string;
  readonly topologyDigest: string;
  readonly dossierManifestDigest?: string;
  readonly projectionDigest?: string;
}

export interface P7ResearchApplicationPort {
  run(request: P7ResearchRunRequest): Promise<P7ResearchStatus>;
  resume(runId: string): Promise<P7ResearchStatus>;
  cancel(runId: string): Promise<P7ResearchStatus>;
  status(runId: string): Promise<P7ResearchStatus>;
  inspect(runId: string): Promise<P7ResearchInspection>;
}

export function deriveP7ResearchRunId(request: P7ResearchRunRequest): string {
  const parsed = parseP7ResearchRunRequest(request);
  return [
    'mammoth',
    'LiveResearchLoop',
    `v${String(P7_WORKFLOW_VERSION)}`,
    encodeURIComponent(parsed.topology.topologyId),
    encodeURIComponent(canonicalDigest(parsed)),
  ].join(':');
}

export function parseP7ResearchRunRequest(
  value: unknown,
): P7ResearchRunRequest {
  const record = requireRecord(value, 'P7 research run request');
  requireExactKeys(
    record,
    [
      'applicationContractMajor',
      'workflowVersion',
      'charterDigest',
      'topology',
      'modelWorkPolicyDigest',
      'modelProfileVersionId',
      'modelProfileVersionDigest',
      'promptTemplateDigest',
      'toolContractDigest',
      'outputSchemaDigest',
      'budget',
    ],
    'P7 research run request',
  );
  if (record.applicationContractMajor !== P7_APPLICATION_CONTRACT_MAJOR)
    throw new Error('unsupported P7 application contract major');
  if (record.workflowVersion !== P7_WORKFLOW_VERSION)
    throw new Error('unsupported P7 workflow version');
  const topology = parseTopology(record.topology);
  deriveP6TopologyWorkflowId(topology);
  return {
    applicationContractMajor: P7_APPLICATION_CONTRACT_MAJOR,
    workflowVersion: P7_WORKFLOW_VERSION,
    charterDigest: requireDigest(record.charterDigest, 'charterDigest'),
    topology,
    modelWorkPolicyDigest: requireDigest(
      record.modelWorkPolicyDigest,
      'modelWorkPolicyDigest',
    ),
    modelProfileVersionId: requireString(
      record.modelProfileVersionId,
      'modelProfileVersionId',
    ),
    modelProfileVersionDigest: requireDigest(
      record.modelProfileVersionDigest,
      'modelProfileVersionDigest',
    ),
    promptTemplateDigest: requireDigest(
      record.promptTemplateDigest,
      'promptTemplateDigest',
    ),
    toolContractDigest: requireDigest(
      record.toolContractDigest,
      'toolContractDigest',
    ),
    outputSchemaDigest: requireDigest(
      record.outputSchemaDigest,
      'outputSchemaDigest',
    ),
    budget: parseBudget(record.budget),
  };
}

function parseTopology(value: unknown): P6TopologyIdentity {
  const record = requireRecord(value, 'P7 topology identity');
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
    'P7 topology identity',
  );
  const criterion = requireRecord(record.criterion, 'P7 criterion identity');
  requireExactKeys(
    criterion,
    ['criterionId', 'criterionVersion', 'criterionDigest', 'branchId'],
    'P7 criterion identity',
  );
  if (record.topologyPlanVersion !== P6_TOPOLOGY_PLAN_SCHEMA_VERSION)
    throw new Error('unsupported P6 topology plan version');
  if (record.plannerPolicyVersion !== P6_TOPOLOGY_PLANNER_POLICY_VERSION)
    throw new Error('unsupported P6 planner policy version');
  if (record.templateCatalogVersion !== '1.0.0')
    throw new Error('unsupported template catalog version');
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
    topologyPlanVersion: P6_TOPOLOGY_PLAN_SCHEMA_VERSION,
    plannerPolicyVersion: P6_TOPOLOGY_PLANNER_POLICY_VERSION,
    templateCatalogVersion: '1.0.0',
  };
}

function parseBudget(value: unknown): ModelWorkBudget {
  const record = requireRecord(value, 'P7 budget');
  requireExactKeys(
    record,
    [
      'inputTokens',
      'outputTokens',
      'currencyMicros',
      'wallClockMs',
      'toolCalls',
    ],
    'P7 budget',
  );
  if (record.toolCalls !== 0) throw new Error('P7 tools are disabled');
  return {
    inputTokens: requireNonnegativeInteger(record.inputTokens, 'inputTokens'),
    outputTokens: requireNonnegativeInteger(
      record.outputTokens,
      'outputTokens',
    ),
    currencyMicros: requireNonnegativeInteger(
      record.currencyMicros,
      'currencyMicros',
    ),
    wallClockMs: requirePositiveInteger(record.wallClockMs, 'wallClockMs'),
    toolCalls: 0,
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
  if (
    Object.keys(record).some((key) => !expected.has(key)) ||
    keys.some((key) => !(key in record))
  )
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

function requireNonnegativeInteger(value: unknown, name: string): number {
  if (!Number.isInteger(value) || Number(value) < 0)
    throw new Error(`${name} must be a nonnegative integer`);
  return Number(value);
}
