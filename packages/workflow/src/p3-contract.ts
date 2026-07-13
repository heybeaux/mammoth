/**
 * Dependency-free contracts for P3 workflow implementations and adapters.
 *
 * These values describe deterministic inputs and history. They do not execute a
 * Temporal workflow and they never contain authoritative product state.
 */

export const P3_WORKFLOW_CONTRACT_MAJOR = 1 as const;

export const P3_TASK_QUEUES = [
  'research-control',
  'local-small',
  'local-large',
  'cloud-frontier',
  'retrieval',
  'experiment',
  'human-gate',
] as const;

export type P3TaskQueue = (typeof P3_TASK_QUEUES)[number];

export const P3_WORKFLOW_CONTRACTS = {
  'research-program': {
    name: 'ResearchProgramWorkflow',
    supportedVersions: [1],
    taskQueue: 'research-control',
  },
  acquisition: {
    name: 'AcquisitionWorkflow',
    supportedVersions: [1],
    taskQueue: 'retrieval',
  },
  'hypothesis-campaign': {
    name: 'HypothesisCampaignWorkflow',
    supportedVersions: [1],
    taskQueue: 'local-large',
  },
  experiment: {
    name: 'ExperimentWorkflow',
    supportedVersions: [1],
    taskQueue: 'experiment',
  },
  revalidation: {
    name: 'RevalidationWorkflow',
    supportedVersions: [1],
    taskQueue: 'retrieval',
  },
  'report-compilation': {
    name: 'ReportCompilationWorkflow',
    supportedVersions: [1],
    taskQueue: 'research-control',
  },
  'human-review': {
    name: 'HumanReviewWorkflow',
    supportedVersions: [1],
    taskQueue: 'human-gate',
  },
} as const;

export type P3WorkflowKind = keyof typeof P3_WORKFLOW_CONTRACTS;
export type P3WorkflowName =
  (typeof P3_WORKFLOW_CONTRACTS)[P3WorkflowKind]['name'];

export interface ProgramBranchIdentity {
  readonly programId: string;
  readonly criterionVersion: string;
  readonly branchId: string;
}

export interface SupportedWorkflowVersion {
  readonly contractMajor: typeof P3_WORKFLOW_CONTRACT_MAJOR;
  readonly kind: P3WorkflowKind;
  readonly name: P3WorkflowName;
  readonly version: number;
  readonly taskQueue: P3TaskQueue;
}

export function supportedWorkflowVersion(
  kind: P3WorkflowKind,
  requestedVersion?: number,
): SupportedWorkflowVersion {
  const contract = P3_WORKFLOW_CONTRACTS[kind];
  const versions: readonly number[] = contract.supportedVersions;
  const version = requestedVersion ?? versions.at(-1);
  if (version === undefined || !versions.includes(version)) {
    throw new Error(
      `unsupported workflow version: ${contract.name}@${String(version)}`,
    );
  }
  return {
    contractMajor: P3_WORKFLOW_CONTRACT_MAJOR,
    kind,
    name: contract.name,
    version,
    taskQueue: contract.taskQueue,
  };
}

/**
 * Derives an injective execution ID from the frozen contract and branch
 * identity. Length-prefixed components avoid delimiter collisions without a
 * clock, random value, attempt number, run ID, or adapter-owned state.
 */
export function deriveWorkflowId(
  workflow: SupportedWorkflowVersion,
  identity: ProgramBranchIdentity,
): string {
  assertSupportedWorkflow(workflow);
  assertProgramBranchIdentity(identity);
  return [
    'mammoth',
    encodeIdComponent(workflow.name),
    `v${String(workflow.version)}`,
    encodeIdComponent(identity.programId),
    encodeIdComponent(identity.criterionVersion),
    encodeIdComponent(identity.branchId),
  ].join(':');
}

export const RESEARCH_PROGRAM_STAGE_IDS = [
  'commit-budget',
  'snapshot-source',
  'assess-claims',
  'persist-ledger',
  'compile-report',
  'commit-receipt',
] as const;

export type ResearchProgramStageId =
  (typeof RESEARCH_PROGRAM_STAGE_IDS)[number];

export interface DeterministicWorkflowStep<StageId extends string = string> {
  readonly stageId: StageId;
  readonly activityType: string;
  readonly taskQueue: P3TaskQueue;
}

export interface ContinueAsNewPolicy {
  readonly maxCyclesPerRun: number;
  readonly maxHistoryEvents: number;
}

export const RESEARCH_PROGRAM_CONTINUE_AS_NEW_POLICY = {
  maxCyclesPerRun: 1,
  maxHistoryEvents: 128,
} as const satisfies ContinueAsNewPolicy;

export const RESEARCH_PROGRAM_WORKFLOW_V1 = {
  workflow: supportedWorkflowVersion('research-program', 1),
  continueAsNewPolicy: RESEARCH_PROGRAM_CONTINUE_AS_NEW_POLICY,
  steps: [
    stage('commit-budget', 'CommitBudgetActivity', 'research-control'),
    stage('snapshot-source', 'SnapshotSourceActivity', 'retrieval'),
    stage('assess-claims', 'AssessClaimsActivity', 'research-control'),
    stage('persist-ledger', 'PersistLedgerActivity', 'research-control'),
    stage('compile-report', 'CompileReportActivity', 'research-control'),
    stage('commit-receipt', 'CommitReceiptActivity', 'research-control'),
  ],
} as const;

export const RESEARCH_PROGRAM_SUPPORTED_VERSIONS = [1] as const;
export type ResearchProgramWorkflowVersion =
  (typeof RESEARCH_PROGRAM_SUPPORTED_VERSIONS)[number];

export interface ResearchProgramReplayInput {
  readonly identity: ProgramBranchIdentity;
  readonly workflowVersion: ResearchProgramWorkflowVersion;
  readonly cycle: number;
}

export interface ResearchProgramReplayEvent {
  readonly sequence: number;
  readonly type: 'activity-completed';
  readonly stageId: ResearchProgramStageId;
  readonly resultDigest: string;
  /** Stable identifier of authoritative Postgres/CAS state, not the state itself. */
  readonly productRevisionId: string;
}

export interface ResearchProgramReplayResult {
  readonly workflowId: string;
  readonly workflow: SupportedWorkflowVersion;
  readonly identity: ProgramBranchIdentity;
  readonly cycle: number;
  readonly completedStages: readonly ResearchProgramStageId[];
  readonly terminalStage: ResearchProgramStageId;
  readonly lastResultDigest: string;
  readonly productRevisionId: string;
}

export function replayResearchProgramWorkflow(
  input: ResearchProgramReplayInput,
  history: readonly ResearchProgramReplayEvent[],
): ResearchProgramReplayResult {
  requireExactKeys(
    requireRecord(input, 'replay input'),
    ['identity', 'workflowVersion', 'cycle'],
    'replay input',
  );
  assertProgramBranchIdentity(input.identity);
  const workflow = supportedWorkflowVersion(
    'research-program',
    input.workflowVersion,
  );
  requireNonNegativeInteger(input.cycle, 'cycle');
  if (history.length !== RESEARCH_PROGRAM_WORKFLOW_V1.steps.length) {
    throw new Error(
      `replay history length ${String(history.length)} does not match ${workflow.name}@${String(workflow.version)} step count ${String(RESEARCH_PROGRAM_WORKFLOW_V1.steps.length)}`,
    );
  }

  const completedStages: ResearchProgramStageId[] = [];
  let lastResultDigest: string | undefined;
  let productRevisionId: string | undefined;
  for (const [
    index,
    definition,
  ] of RESEARCH_PROGRAM_WORKFLOW_V1.steps.entries()) {
    const event = history[index];
    if (!event)
      throw new Error(`missing replay event at index ${String(index)}`);
    const eventRecord = requireRecord(event, 'replay event');
    requireExactKeys(
      eventRecord,
      ['sequence', 'type', 'stageId', 'resultDigest', 'productRevisionId'],
      'replay event',
    );
    const sequence = requireNonNegativeInteger(
      eventRecord.sequence,
      'replay event sequence',
    );
    if (sequence !== index + 1) {
      throw new Error(
        `replay event sequence mismatch at index ${String(index)}: expected ${String(index + 1)}, received ${String(sequence)}`,
      );
    }
    if (eventRecord.type !== 'activity-completed') {
      throw new Error(
        `unsupported replay event type at sequence ${String(sequence)}`,
      );
    }
    if (eventRecord.stageId !== definition.stageId) {
      throw new Error(
        `replay event stage mismatch at sequence ${String(sequence)}: expected ${definition.stageId}, received ${String(eventRecord.stageId)}`,
      );
    }
    const resultDigest = requireIdentifier(
      eventRecord.resultDigest,
      'resultDigest',
    );
    assertDigest(resultDigest);
    const revisionId = requireIdentifier(
      eventRecord.productRevisionId,
      'productRevisionId',
    );
    completedStages.push(definition.stageId);
    lastResultDigest = resultDigest;
    productRevisionId = revisionId;
  }

  const terminalStage = completedStages.at(-1);
  if (!terminalStage || !lastResultDigest || !productRevisionId) {
    throw new Error('replay produced no terminal stage');
  }
  return {
    workflowId: deriveWorkflowId(workflow, input.identity),
    workflow,
    identity: { ...input.identity },
    cycle: input.cycle,
    completedStages,
    terminalStage,
    lastResultDigest,
    productRevisionId,
  };
}

export type WorkflowControlSignal =
  | SignalBase<'pause'>
  | SignalBase<'resume'>
  | (SignalBase<'cancel'> & { readonly reason?: string })
  | (SignalBase<'criterion-branch'> & {
      readonly criterionVersion: string;
      readonly branchId: string;
    })
  | (SignalBase<'human-gate-decision'> & {
      readonly gateId: string;
      readonly decision: 'approve' | 'reject';
      readonly receiptId: string;
    });

interface SignalBase<Kind extends string> {
  readonly signalId: string;
  readonly expectedRevision: number;
  readonly kind: Kind;
}

export type WorkflowControlStatus =
  | 'running'
  | 'paused'
  | 'cancelled'
  | 'completed';

export interface WorkflowControlState {
  readonly revision: number;
  readonly status: WorkflowControlStatus;
  readonly processedSignalIds: readonly string[];
  readonly activeBranch: ProgramBranchIdentity;
  readonly lastHumanGateDecision?: {
    readonly gateId: string;
    readonly decision: 'approve' | 'reject';
    readonly receiptId: string;
  };
}

export type SignalApplication =
  | { readonly outcome: 'applied'; readonly state: WorkflowControlState }
  | {
      readonly outcome: 'duplicate' | 'stale' | 'rejected';
      readonly state: WorkflowControlState;
    };

export function parseWorkflowControlSignal(
  value: unknown,
): WorkflowControlSignal {
  const signal = requireRecord(value, 'workflow control signal');
  const signalId = requireIdentifier(signal.signalId, 'signalId');
  const expectedRevision = requireNonNegativeInteger(
    signal.expectedRevision,
    'expectedRevision',
  );
  if (signal.kind === 'pause' || signal.kind === 'resume') {
    requireExactKeys(
      signal,
      ['signalId', 'expectedRevision', 'kind'],
      'signal',
    );
    return { signalId, expectedRevision, kind: signal.kind };
  }
  if (signal.kind === 'cancel') {
    requireExactKeys(
      signal,
      ['signalId', 'expectedRevision', 'kind', 'reason'],
      'signal',
      ['reason'],
    );
    if (signal.reason !== undefined && typeof signal.reason !== 'string') {
      throw new Error('reason must be a string');
    }
    return {
      signalId,
      expectedRevision,
      kind: signal.kind,
      ...(signal.reason === undefined ? {} : { reason: signal.reason }),
    };
  }
  if (signal.kind === 'criterion-branch') {
    requireExactKeys(
      signal,
      ['signalId', 'expectedRevision', 'kind', 'criterionVersion', 'branchId'],
      'signal',
    );
    return {
      signalId,
      expectedRevision,
      kind: signal.kind,
      criterionVersion: requireIdentifier(
        signal.criterionVersion,
        'criterionVersion',
      ),
      branchId: requireIdentifier(signal.branchId, 'branchId'),
    };
  }
  if (signal.kind === 'human-gate-decision') {
    requireExactKeys(
      signal,
      [
        'signalId',
        'expectedRevision',
        'kind',
        'gateId',
        'decision',
        'receiptId',
      ],
      'signal',
    );
    if (signal.decision !== 'approve' && signal.decision !== 'reject') {
      throw new Error('invalid human gate decision');
    }
    return {
      signalId,
      expectedRevision,
      kind: signal.kind,
      gateId: requireIdentifier(signal.gateId, 'gateId'),
      decision: signal.decision,
      receiptId: requireIdentifier(signal.receiptId, 'receiptId'),
    };
  }
  throw new Error('invalid workflow control signal kind');
}

export function applyWorkflowControlSignal(
  state: WorkflowControlState,
  value: unknown,
): SignalApplication {
  assertWorkflowControlState(state);
  const signal = parseWorkflowControlSignal(value);
  if (state.processedSignalIds.includes(signal.signalId)) {
    return { outcome: 'duplicate', state };
  }
  if (signal.expectedRevision !== state.revision) {
    return { outcome: 'stale', state };
  }
  if (state.status === 'cancelled' || state.status === 'completed') {
    return { outcome: 'stale', state };
  }
  if (
    (signal.kind === 'pause' && state.status !== 'running') ||
    (signal.kind === 'resume' && state.status !== 'paused')
  ) {
    return { outcome: 'rejected', state };
  }

  const status =
    signal.kind === 'pause'
      ? 'paused'
      : signal.kind === 'resume'
        ? 'running'
        : signal.kind === 'cancel'
          ? 'cancelled'
          : state.status;
  const activeBranch =
    signal.kind === 'criterion-branch'
      ? {
          programId: state.activeBranch.programId,
          criterionVersion: signal.criterionVersion,
          branchId: signal.branchId,
        }
      : state.activeBranch;
  const lastHumanGateDecision =
    signal.kind === 'human-gate-decision'
      ? {
          gateId: signal.gateId,
          decision: signal.decision,
          receiptId: signal.receiptId,
        }
      : state.lastHumanGateDecision;
  return {
    outcome: 'applied',
    state: {
      revision: state.revision + 1,
      status,
      processedSignalIds: [...state.processedSignalIds, signal.signalId],
      activeBranch,
      ...(lastHumanGateDecision === undefined ? {} : { lastHumanGateDecision }),
    },
  };
}

export const WORKFLOW_QUERY_KINDS = [
  'program-state',
  'current-durable-step',
  'pending-gates',
  'cancellation-state',
  'retry-state',
  'receipt-references',
] as const;

export type WorkflowQueryKind = (typeof WORKFLOW_QUERY_KINDS)[number];
export interface WorkflowQuery {
  readonly kind: WorkflowQueryKind;
}

export function parseWorkflowQuery(value: unknown): WorkflowQuery {
  const query = requireRecord(value, 'workflow query');
  requireExactKeys(query, ['kind'], 'query');
  if (
    typeof query.kind !== 'string' ||
    !WORKFLOW_QUERY_KINDS.includes(query.kind as WorkflowQueryKind)
  ) {
    throw new Error('invalid workflow query kind');
  }
  return { kind: query.kind as WorkflowQueryKind };
}

/** The only values allowed to cross a continue-as-new boundary. */
export interface ContinueAsNewCarry {
  readonly workflowId: string;
  readonly workflowKind: P3WorkflowKind;
  readonly workflowVersion: number;
  readonly programId: string;
  readonly criterionVersion: string;
  readonly branchId: string;
}

export interface ProgramBranchStatePort<ProductState> {
  load(identity: ProgramBranchIdentity): Promise<ProductState>;
}

export function createContinueAsNewCarry(
  workflow: SupportedWorkflowVersion,
  identity: ProgramBranchIdentity,
): ContinueAsNewCarry {
  return {
    workflowId: deriveWorkflowId(workflow, identity),
    workflowKind: workflow.kind,
    workflowVersion: workflow.version,
    programId: identity.programId,
    criterionVersion: identity.criterionVersion,
    branchId: identity.branchId,
  };
}

export async function reconstructAfterContinueAsNew<ProductState>(
  value: unknown,
  productState: ProgramBranchStatePort<ProductState>,
): Promise<ProductState> {
  const carry = parseContinueAsNewCarry(value);
  return productState.load({
    programId: carry.programId,
    criterionVersion: carry.criterionVersion,
    branchId: carry.branchId,
  });
}

export function parseContinueAsNewCarry(value: unknown): ContinueAsNewCarry {
  const carry = requireRecord(value, 'continue-as-new carry');
  requireExactKeys(
    carry,
    [
      'workflowId',
      'workflowKind',
      'workflowVersion',
      'programId',
      'criterionVersion',
      'branchId',
    ],
    'continue-as-new carry',
  );
  if (
    typeof carry.workflowKind !== 'string' ||
    !(carry.workflowKind in P3_WORKFLOW_CONTRACTS)
  ) {
    throw new Error('unsupported workflow kind');
  }
  const workflow = supportedWorkflowVersion(
    carry.workflowKind as P3WorkflowKind,
    requireNonNegativeInteger(carry.workflowVersion, 'workflowVersion'),
  );
  const identity = parseProgramBranchIdentity({
    programId: carry.programId,
    criterionVersion: carry.criterionVersion,
    branchId: carry.branchId,
  });
  const workflowId = requireIdentifier(carry.workflowId, 'workflowId');
  if (workflowId !== deriveWorkflowId(workflow, identity)) {
    throw new Error('continue-as-new workflow identity mismatch');
  }
  return {
    workflowId,
    workflowKind: workflow.kind,
    workflowVersion: workflow.version,
    ...identity,
  };
}

function stage(
  stageId: ResearchProgramStageId,
  activityType: string,
  taskQueue: P3TaskQueue,
): DeterministicWorkflowStep<ResearchProgramStageId> {
  return { stageId, activityType, taskQueue };
}

function assertSupportedWorkflow(workflow: SupportedWorkflowVersion): void {
  const parsed = parseSupportedWorkflow(workflow);
  if (
    parsed.kind !== workflow.kind ||
    parsed.name !== workflow.name ||
    parsed.version !== workflow.version ||
    parsed.taskQueue !== workflow.taskQueue
  ) {
    throw new Error('workflow contract does not match its registered kind');
  }
}

function parseSupportedWorkflow(value: unknown): SupportedWorkflowVersion {
  const workflow = requireRecord(value, 'workflow contract');
  requireExactKeys(
    workflow,
    ['contractMajor', 'kind', 'name', 'version', 'taskQueue'],
    'workflow contract',
  );
  if (workflow.contractMajor !== P3_WORKFLOW_CONTRACT_MAJOR) {
    throw new Error('unsupported workflow contract major');
  }
  if (
    typeof workflow.kind !== 'string' ||
    !(workflow.kind in P3_WORKFLOW_CONTRACTS)
  ) {
    throw new Error('unsupported workflow kind');
  }
  const supported = supportedWorkflowVersion(
    workflow.kind as P3WorkflowKind,
    requireNonNegativeInteger(workflow.version, 'workflow version'),
  );
  if (
    workflow.name !== supported.name ||
    workflow.taskQueue !== supported.taskQueue
  ) {
    throw new Error('workflow contract does not match its registered kind');
  }
  return supported;
}

function parseProgramBranchIdentity(value: unknown): ProgramBranchIdentity {
  const identity = requireRecord(value, 'program branch identity');
  assertProgramBranchIdentity(identity as unknown as ProgramBranchIdentity);
  return {
    programId: identity.programId as string,
    criterionVersion: identity.criterionVersion as string,
    branchId: identity.branchId as string,
  };
}

function assertProgramBranchIdentity(identity: ProgramBranchIdentity): void {
  const record = requireRecord(identity, 'program branch identity');
  requireExactKeys(
    record,
    ['programId', 'criterionVersion', 'branchId'],
    'program branch identity',
  );
  requireIdentifier(record.programId, 'programId');
  requireIdentifier(record.criterionVersion, 'criterionVersion');
  requireIdentifier(record.branchId, 'branchId');
}

function assertWorkflowControlState(state: WorkflowControlState): void {
  requireNonNegativeInteger(state.revision, 'revision');
  assertProgramBranchIdentity(state.activeBranch);
  if (
    new Set(state.processedSignalIds).size !== state.processedSignalIds.length
  ) {
    throw new Error('processedSignalIds must be unique');
  }
  for (const signalId of state.processedSignalIds) {
    requireIdentifier(signalId, 'processed signal ID');
  }
}

function encodeIdComponent(value: string): string {
  return `${String(value.length)}-${encodeURIComponent(value)}`;
}

function assertDigest(value: string): void {
  if (!/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new Error(`invalid replay result digest: ${value}`);
  }
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

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function requireNonNegativeInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
  return value as number;
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
  optional: readonly string[] = [],
): void {
  const record = value as Record<string, unknown>;
  const extras = Object.keys(record).filter((key) => !allowed.includes(key));
  const required = allowed.filter(
    (key) => !optional.includes(key) && !(key in record),
  );
  if (extras.length > 0 || required.length > 0) {
    throw new Error(`${name} has invalid fields`);
  }
}
