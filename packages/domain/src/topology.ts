import { z } from 'zod';
import { canonicalDigest } from './digest.js';
import {
  CellInputSchema,
  CellOutputContractSchema,
  CriterionReferenceSchema,
  RESEARCH_CELL_CONTRACT_VERSION,
  cellInputDigest,
  type CriterionReference,
} from './research-cell.js';
import {
  DigestSchema,
  EntityIdSchema,
  NonEmptyStringSchema,
  TimestampSchema,
  type Digest,
} from './primitives.js';

export const TOPOLOGY_PLAN_SCHEMA_VERSION = '1.0.0';
export const CELL_TEMPLATE_CATALOG_SCHEMA_VERSION = '1.0.0';
export const TOPOLOGY_PLANNER_POLICY_VERSION = '1.0.0';

export const TOPOLOGY_CELL_KINDS = [
  'landscape',
  'divergence',
  'prior_art',
  'falsification',
  'experiment',
  'synthesis',
] as const;

export const TopologyCellKindSchema = z.enum(TOPOLOGY_CELL_KINDS);

export const DependencyArtifactKindSchema = z.enum([
  'claim_ids',
  'evidence_ids',
  'hypothesis_ids',
  'artifact_ids',
  'position_ids',
  'dissent_report_ids',
  'synthesis_artifact_id',
]);

export const FailurePolicySchema = z.enum([
  'fail_topology',
  'retain_residue_and_continue',
  'block_dependents',
]);

export const RetryPolicySchema = z
  .object({
    maxAttempts: z.number().int().positive().max(10),
    retryableFailureCodes: z.array(NonEmptyStringSchema),
  })
  .strict();

export const CancellationPolicySchema = z
  .object({
    cancellationReceiptRequired: z.boolean(),
    retainPartialArtifacts: z.boolean(),
  })
  .strict();

export const CellTemplateCatalogEntrySchema = z
  .object({
    id: EntityIdSchema,
    schemaVersion: z.literal(CELL_TEMPLATE_CATALOG_SCHEMA_VERSION),
    templateVersion: z.number().int().positive(),
    kind: TopologyCellKindSchema,
    role: NonEmptyStringSchema,
    requiredOutput: CellOutputContractSchema,
    promptTemplateDigest: DigestSchema,
    allowedInputKinds: z
      .array(z.enum(['claim', 'evidence', 'hypothesis', 'artifact']))
      .min(1),
    stageOrder: z.number().int().nonnegative(),
  })
  .strict();

export const CellTemplateCatalogSchema = z
  .object({
    schemaVersion: z.literal(CELL_TEMPLATE_CATALOG_SCHEMA_VERSION),
    catalogVersion: z.literal(CELL_TEMPLATE_CATALOG_SCHEMA_VERSION),
    entries: z.array(CellTemplateCatalogEntrySchema).min(1),
    catalogDigest: DigestSchema,
  })
  .strict()
  .superRefine((catalog, ctx) => {
    const seen = new Set<string>();
    for (const entry of catalog.entries) {
      const key = templateKey(entry.id, entry.templateVersion);
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['entries'],
          message: `duplicate template ${key}`,
        });
      }
      seen.add(key);
    }
    if (catalog.catalogDigest !== cellTemplateCatalogDigest(catalog)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['catalogDigest'],
        message: 'cell template catalog digest is not canonical',
      });
    }
  });

export const TopologyBudgetSchema = z
  .object({
    maxCloudSpendUsd: z.number().positive().finite(),
    maxLocalComputeHours: z.number().positive().finite(),
    maxExternalRequests: z.number().int().positive(),
    maxExperimentRuns: z.number().int().positive(),
  })
  .strict();

export const TopologyNodeDependencySchema = z
  .object({
    nodeId: EntityIdSchema,
    artifactKinds: z.array(DependencyArtifactKindSchema).min(1),
  })
  .strict();

export const TopologyNodeSchema = z
  .object({
    nodeId: EntityIdSchema,
    templateId: EntityIdSchema,
    templateVersion: z.number().int().positive(),
    dependencies: z.array(TopologyNodeDependencySchema),
    input: CellInputSchema,
    outputContract: CellOutputContractSchema,
    retryPolicy: RetryPolicySchema,
    cancellationPolicy: CancellationPolicySchema,
    failurePolicy: FailurePolicySchema,
    maxAttempts: z.number().int().positive().max(10),
    budgetCeiling: TopologyBudgetSchema,
  })
  .strict()
  .superRefine((node, ctx) => {
    if (node.maxAttempts !== node.retryPolicy.maxAttempts) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['maxAttempts'],
        message: 'node maxAttempts must match retry policy maxAttempts',
      });
    }
  });

export const TopologyPlannerPolicySchema = z
  .object({
    policyVersion: z.literal(TOPOLOGY_PLANNER_POLICY_VERSION),
    maxConcurrentCells: z.number().int().positive().max(100),
    defaultRetryPolicy: RetryPolicySchema,
    defaultCancellationPolicy: CancellationPolicySchema,
    defaultFailurePolicy: FailurePolicySchema,
  })
  .strict();

export const TopologyPlanSchema = z
  .object({
    id: EntityIdSchema,
    schemaVersion: z.literal(TOPOLOGY_PLAN_SCHEMA_VERSION),
    plannerPolicyVersion: z.literal(TOPOLOGY_PLANNER_POLICY_VERSION),
    templateCatalogVersion: z.literal(CELL_TEMPLATE_CATALOG_SCHEMA_VERSION),
    programId: EntityIdSchema,
    workItemId: EntityIdSchema,
    criterionRef: CriterionReferenceSchema,
    branchId: EntityIdSchema,
    nodes: z.array(TopologyNodeSchema).min(1),
    maxConcurrentCells: z.number().int().positive().max(100),
    budgetCeiling: TopologyBudgetSchema,
    plannedAt: TimestampSchema,
    dependencyDigest: DigestSchema,
    canonicalDigest: DigestSchema,
  })
  .strict()
  .superRefine((plan, ctx) => {
    if (plan.branchId !== plan.criterionRef.branchId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['branchId'],
        message: 'topology branch must match criterion reference branch',
      });
    }
    if (plan.dependencyDigest !== topologyDependencyDigest(plan.nodes)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dependencyDigest'],
        message: 'topology dependency digest is not canonical',
      });
    }
    if (plan.canonicalDigest !== topologyPlanDigest(plan)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['canonicalDigest'],
        message: 'topology plan digest is not canonical',
      });
    }
  });

export const PlannedTopologyCellSchema = z
  .object({
    topologyId: EntityIdSchema,
    cellId: EntityIdSchema,
    nodeId: EntityIdSchema,
    templateId: EntityIdSchema,
    templateVersion: z.number().int().positive(),
    kind: TopologyCellKindSchema,
    criterionRef: CriterionReferenceSchema,
    inputDigest: DigestSchema,
    dependencyDigest: DigestSchema,
    stableCellIdentityDigest: DigestSchema,
  })
  .strict();

export const PlannedTopologySchema = z
  .object({
    topologyId: EntityIdSchema,
    topologyDigest: DigestSchema,
    dependencyDigest: DigestSchema,
    cells: z.array(PlannedTopologyCellSchema).min(1),
  })
  .strict();

export const SchedulerCellStatusSchema = z.enum([
  'pending',
  'running',
  'succeeded',
  'failed',
  'cancelled',
]);

export const SchedulerCellSnapshotSchema = z
  .object({
    nodeId: EntityIdSchema,
    status: SchedulerCellStatusSchema,
    attempt: z.number().int().nonnegative(),
    spentBudget: TopologyBudgetSchema.partial().default({}),
    failureCode: NonEmptyStringSchema.optional(),
  })
  .strict();

export const SchedulerBudgetRemainingSchema = z
  .object({
    cloudSpendUsd: z.number().nonnegative().finite(),
    localComputeHours: z.number().nonnegative().finite(),
    externalRequests: z.number().int().nonnegative(),
    experimentRuns: z.number().int().nonnegative(),
  })
  .strict();

export const SchedulerSnapshotSchema = z
  .object({
    plan: TopologyPlanSchema,
    cells: z.array(SchedulerCellSnapshotSchema),
    runningNodeIds: z.array(EntityIdSchema),
    budgetRemaining: SchedulerBudgetRemainingSchema,
  })
  .strict();

export type TopologyCellKind = z.infer<typeof TopologyCellKindSchema>;
export type DependencyArtifactKind = z.infer<
  typeof DependencyArtifactKindSchema
>;
export type FailurePolicy = z.infer<typeof FailurePolicySchema>;
export type RetryPolicy = z.infer<typeof RetryPolicySchema>;
export type CancellationPolicy = z.infer<typeof CancellationPolicySchema>;
export type CellTemplateCatalogEntry = z.infer<
  typeof CellTemplateCatalogEntrySchema
>;
export type CellTemplateCatalog = z.infer<typeof CellTemplateCatalogSchema>;
export type TopologyBudget = z.infer<typeof TopologyBudgetSchema>;
export type TopologyNodeDependency = z.infer<
  typeof TopologyNodeDependencySchema
>;
export type TopologyNode = z.infer<typeof TopologyNodeSchema>;
export type TopologyPlannerPolicy = z.infer<typeof TopologyPlannerPolicySchema>;
export type TopologyPlan = z.infer<typeof TopologyPlanSchema>;
export type PlannedTopologyCell = z.infer<typeof PlannedTopologyCellSchema>;
export type PlannedTopology = z.infer<typeof PlannedTopologySchema>;
export type SchedulerCellStatus = z.infer<typeof SchedulerCellStatusSchema>;
export type SchedulerCellSnapshot = z.input<typeof SchedulerCellSnapshotSchema>;
export type SchedulerBudgetRemaining = z.infer<
  typeof SchedulerBudgetRemainingSchema
>;
export type SchedulerSnapshot = z.input<typeof SchedulerSnapshotSchema>;

export type TopologyValidationErrorCode =
  | 'invalid_schema'
  | 'duplicate_node'
  | 'missing_dependency'
  | 'cyclic_dependency'
  | 'unknown_template'
  | 'template_kind_mismatch'
  | 'criterion_drift'
  | 'invalid_dependency_artifact'
  | 'unbounded_concurrency'
  | 'unbounded_budget'
  | 'unknown_failure_policy';

export type TopologyValidationResult =
  | { ok: true }
  | {
      ok: false;
      code: TopologyValidationErrorCode;
      message: string;
    };

export type SchedulerDecision =
  | { state: 'ready'; nodeIds: readonly string[] }
  | { state: 'idle_complete'; completedNodeIds: readonly string[] }
  | { state: 'blocked_dependencies'; blockedNodeIds: readonly string[] }
  | { state: 'concurrency_saturated'; runningNodeIds: readonly string[] }
  | { state: 'budget_starved'; starvedNodeIds: readonly string[] };

export const DEFAULT_P6_TOPOLOGY_TEMPLATE_CATALOG: CellTemplateCatalog =
  makeDefaultCatalog();

export function cellTemplateCatalogDigest(
  catalog: Omit<CellTemplateCatalog, 'catalogDigest'> | CellTemplateCatalog,
): Digest {
  const rest = { ...(catalog as Record<string, unknown>) };
  delete rest.catalogDigest;
  return canonicalDigest({
    kind: 'p6-cell-template-catalog',
    schemaVersion: CELL_TEMPLATE_CATALOG_SCHEMA_VERSION,
    value: {
      ...rest,
      entries: sortTemplateEntries(
        rest.entries as readonly CellTemplateCatalogEntry[],
      ),
    },
  });
}

export function topologyDependencyDigest(
  nodes: readonly TopologyNode[],
): Digest {
  return canonicalDigest({
    kind: 'p6-topology-dependencies',
    schemaVersion: TOPOLOGY_PLAN_SCHEMA_VERSION,
    value: normalizeNodes(nodes).map((node) => ({
      nodeId: node.nodeId,
      dependencies: normalizeDependencies(node.dependencies),
    })),
  });
}

export function topologyPlanDigest(
  plan: Omit<TopologyPlan, 'canonicalDigest'> | TopologyPlan,
): Digest {
  const rest = { ...(plan as Record<string, unknown>) };
  delete rest.canonicalDigest;
  return canonicalDigest({
    kind: 'p6-topology-plan',
    schemaVersion: TOPOLOGY_PLAN_SCHEMA_VERSION,
    value: {
      ...rest,
      nodes: normalizeNodes(rest.nodes as readonly TopologyNode[]),
    },
  });
}

export function deriveTopologyId(input: {
  readonly programId: string;
  readonly criterionRef: CriterionReference;
  readonly planVersion: string;
  readonly plannerPolicyVersion: string;
  readonly templateCatalogVersion: string;
  readonly inputDigest: Digest;
}): string {
  return [
    'mammoth',
    'topology',
    `v${TOPOLOGY_PLAN_SCHEMA_VERSION}`,
    encodeComponent(input.programId),
    encodeComponent(input.criterionRef.criterionId),
    encodeComponent(String(input.criterionRef.criterionVersion)),
    encodeComponent(input.criterionRef.criterionDigest),
    encodeComponent(input.criterionRef.branchId),
    encodeComponent(input.planVersion),
    encodeComponent(input.plannerPolicyVersion),
    encodeComponent(input.templateCatalogVersion),
    encodeComponent(input.inputDigest),
  ].join(':');
}

export function deriveTopologyCellId(input: {
  readonly topologyId: string;
  readonly nodeId: string;
  readonly templateId: string;
  readonly templateVersion: number;
  readonly inputDigest: Digest;
}): string {
  return [
    'mammoth',
    'topology-cell',
    `v${TOPOLOGY_PLAN_SCHEMA_VERSION}`,
    encodeComponent(input.topologyId),
    encodeComponent(input.nodeId),
    encodeComponent(input.templateId),
    encodeComponent(String(input.templateVersion)),
    encodeComponent(input.inputDigest),
  ].join(':');
}

export function topologyCellIdentityDigest(cell: {
  readonly topologyId: string;
  readonly nodeId: string;
  readonly templateId: string;
  readonly templateVersion: number;
  readonly criterionRef: CriterionReference;
  readonly inputDigest: Digest;
}): Digest {
  return canonicalDigest({
    kind: 'p6-topology-cell-identity',
    schemaVersion: TOPOLOGY_PLAN_SCHEMA_VERSION,
    value: cell,
  });
}

export function buildTopologyPlan(input: {
  readonly programId: string;
  readonly workItemId: string;
  readonly criterionRef: CriterionReference;
  readonly branchId: string;
  readonly planVersion: string;
  readonly nodes: readonly TopologyNode[];
  readonly maxConcurrentCells: number;
  readonly budgetCeiling: TopologyBudget;
  readonly plannedAt: string;
  readonly plannerPolicy?: TopologyPlannerPolicy;
  readonly catalog?: CellTemplateCatalog;
}): TopologyPlan {
  const catalog = input.catalog ?? DEFAULT_P6_TOPOLOGY_TEMPLATE_CATALOG;
  const plannerPolicy =
    input.plannerPolicy ?? DEFAULT_P6_TOPOLOGY_PLANNER_POLICY;
  const nodes = normalizeNodes(input.nodes);
  const inputDigest = canonicalDigest({
    kind: 'p6-topology-input',
    schemaVersion: TOPOLOGY_PLAN_SCHEMA_VERSION,
    value: {
      workItemId: input.workItemId,
      nodes: nodes.map((node) => ({
        nodeId: node.nodeId,
        templateId: node.templateId,
        templateVersion: node.templateVersion,
        inputDigest: cellInputDigest(node.input),
      })),
    },
  });
  const dependencyDigest = topologyDependencyDigest(nodes);
  const partial: Omit<TopologyPlan, 'canonicalDigest'> = {
    id: deriveTopologyId({
      programId: input.programId,
      criterionRef: input.criterionRef,
      planVersion: input.planVersion,
      plannerPolicyVersion: plannerPolicy.policyVersion,
      templateCatalogVersion: catalog.catalogVersion,
      inputDigest,
    }),
    schemaVersion: TOPOLOGY_PLAN_SCHEMA_VERSION,
    plannerPolicyVersion: plannerPolicy.policyVersion,
    templateCatalogVersion: catalog.catalogVersion,
    programId: input.programId,
    workItemId: input.workItemId,
    criterionRef: input.criterionRef,
    branchId: input.branchId,
    nodes,
    maxConcurrentCells: input.maxConcurrentCells,
    budgetCeiling: input.budgetCeiling,
    plannedAt: input.plannedAt,
    dependencyDigest,
  };
  return {
    ...partial,
    canonicalDigest: topologyPlanDigest(partial),
  };
}

export function validateTopologyPlan(
  plan: unknown,
  catalog: CellTemplateCatalog = DEFAULT_P6_TOPOLOGY_TEMPLATE_CATALOG,
): TopologyValidationResult {
  const preflight = preflightTopologyBounds(plan);
  if (preflight) return preflight;
  const catalogParsed = CellTemplateCatalogSchema.safeParse(catalog);
  if (!catalogParsed.success) {
    return {
      ok: false,
      code: 'unknown_template',
      message: catalogParsed.error.issues
        .map((issue) => issue.message)
        .join('; '),
    };
  }
  const parsed = TopologyPlanSchema.safeParse(plan);
  if (!parsed.success) {
    return classifySchemaIssue(parsed.error.issues);
  }
  const topology = parsed.data;
  if (
    topology.maxConcurrentCells <= 0 ||
    !Number.isFinite(topology.maxConcurrentCells)
  ) {
    return {
      ok: false,
      code: 'unbounded_concurrency',
      message: 'topology concurrency must be finite and positive',
    };
  }
  if (!isBoundedBudget(topology.budgetCeiling)) {
    return {
      ok: false,
      code: 'unbounded_budget',
      message: 'topology budget ceiling must be finite and positive',
    };
  }
  const nodes = new Map<string, TopologyNode>();
  for (const node of topology.nodes) {
    if (nodes.has(node.nodeId)) {
      return {
        ok: false,
        code: 'duplicate_node',
        message: `duplicate topology node ${node.nodeId}`,
      };
    }
    nodes.set(node.nodeId, node);
    if (!isBoundedBudget(node.budgetCeiling)) {
      return {
        ok: false,
        code: 'unbounded_budget',
        message: `node ${node.nodeId} budget ceiling must be finite and positive`,
      };
    }
    const template = findTemplate(
      catalogParsed.data,
      node.templateId,
      node.templateVersion,
    );
    if (!template) {
      return {
        ok: false,
        code: 'unknown_template',
        message: `unknown template ${templateKey(node.templateId, node.templateVersion)}`,
      };
    }
    if (template.requiredOutput.kind !== node.outputContract.kind) {
      return {
        ok: false,
        code: 'template_kind_mismatch',
        message: `node ${node.nodeId} output contract does not match template`,
      };
    }
  }
  for (const node of topology.nodes) {
    for (const dep of node.dependencies) {
      if (!nodes.has(dep.nodeId)) {
        return {
          ok: false,
          code: 'missing_dependency',
          message: `node ${node.nodeId} depends on missing node ${dep.nodeId}`,
        };
      }
      for (const kind of dep.artifactKinds) {
        if (!DependencyArtifactKindSchema.safeParse(kind).success) {
          return {
            ok: false,
            code: 'invalid_dependency_artifact',
            message: `node ${node.nodeId} has invalid dependency artifact kind ${String(kind)}`,
          };
        }
      }
    }
  }
  return validateAcyclic(topology.nodes);
}

function preflightTopologyBounds(
  plan: unknown,
): TopologyValidationResult | null {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return null;
  const record = plan as Record<string, unknown>;
  const maxConcurrentCells = record.maxConcurrentCells;
  if (
    typeof maxConcurrentCells === 'number' &&
    (!Number.isFinite(maxConcurrentCells) || maxConcurrentCells <= 0)
  ) {
    return {
      ok: false,
      code: 'unbounded_concurrency',
      message: 'topology concurrency must be finite and positive',
    };
  }
  if (hasUnboundedBudget(record.budgetCeiling)) {
    return {
      ok: false,
      code: 'unbounded_budget',
      message: 'topology budget ceiling must be finite and positive',
    };
  }
  const nodes = record.nodes;
  if (Array.isArray(nodes)) {
    for (const node of nodes) {
      if (!node || typeof node !== 'object' || Array.isArray(node)) continue;
      const nodeRecord = node as Record<string, unknown>;
      if (hasUnboundedBudget(nodeRecord.budgetCeiling)) {
        return {
          ok: false,
          code: 'unbounded_budget',
          message: 'node budget ceiling must be finite and positive',
        };
      }
      if (
        nodeRecord.failurePolicy !== undefined &&
        !FailurePolicySchema.safeParse(nodeRecord.failurePolicy).success
      ) {
        return {
          ok: false,
          code: 'unknown_failure_policy',
          message: 'node failure policy is not supported',
        };
      }
      const dependencies = nodeRecord.dependencies;
      if (Array.isArray(dependencies)) {
        for (const dependency of dependencies) {
          if (
            !dependency ||
            typeof dependency !== 'object' ||
            Array.isArray(dependency)
          )
            continue;
          const artifactKinds = (dependency as Record<string, unknown>)
            .artifactKinds;
          if (
            Array.isArray(artifactKinds) &&
            artifactKinds.some(
              (kind) => !DependencyArtifactKindSchema.safeParse(kind).success,
            )
          ) {
            return {
              ok: false,
              code: 'invalid_dependency_artifact',
              message: 'dependency artifact kind is not supported',
            };
          }
        }
      }
    }
  }
  return null;
}

function hasUnboundedBudget(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const budget = value as Record<string, unknown>;
  return [
    budget.maxCloudSpendUsd,
    budget.maxLocalComputeHours,
    budget.maxExternalRequests,
    budget.maxExperimentRuns,
  ].some(
    (entry) =>
      typeof entry === 'number' && (!Number.isFinite(entry) || entry <= 0),
  );
}

export function planTopology(
  plan: TopologyPlan,
  catalog: CellTemplateCatalog = DEFAULT_P6_TOPOLOGY_TEMPLATE_CATALOG,
): PlannedTopology {
  const validation = validateTopologyPlan(plan, catalog);
  if (!validation.ok) throw new Error(validation.message);
  const catalogParsed = CellTemplateCatalogSchema.parse(catalog);
  const cells = normalizeNodes(plan.nodes).map((node) => {
    const inputDigest = cellInputDigest(node.input);
    const template = findTemplate(
      catalogParsed,
      node.templateId,
      node.templateVersion,
    );
    if (!template)
      throw new Error('validated topology referenced unknown template');
    const cellId = deriveTopologyCellId({
      topologyId: plan.id,
      nodeId: node.nodeId,
      templateId: node.templateId,
      templateVersion: node.templateVersion,
      inputDigest,
    });
    return {
      topologyId: plan.id,
      cellId,
      nodeId: node.nodeId,
      templateId: node.templateId,
      templateVersion: node.templateVersion,
      kind: template.kind,
      criterionRef: plan.criterionRef,
      inputDigest,
      dependencyDigest: topologyDependencyDigest([node]),
      stableCellIdentityDigest: topologyCellIdentityDigest({
        topologyId: plan.id,
        nodeId: node.nodeId,
        templateId: node.templateId,
        templateVersion: node.templateVersion,
        criterionRef: plan.criterionRef,
        inputDigest,
      }),
    };
  });
  return {
    topologyId: plan.id,
    topologyDigest: plan.canonicalDigest,
    dependencyDigest: plan.dependencyDigest,
    cells,
  };
}

export function decideNextSchedulerState(
  snapshot: SchedulerSnapshot,
): SchedulerDecision {
  const parsed = SchedulerSnapshotSchema.parse(snapshot);
  const byNode = new Map(parsed.cells.map((cell) => [cell.nodeId, cell]));
  const runningNodeIds = [...parsed.runningNodeIds].sort();
  if (runningNodeIds.length >= parsed.plan.maxConcurrentCells) {
    return { state: 'concurrency_saturated', runningNodeIds };
  }
  const ready: string[] = [];
  const blocked: string[] = [];
  const starved: string[] = [];
  for (const node of normalizeNodes(parsed.plan.nodes)) {
    const cell = byNode.get(node.nodeId);
    if (cell && cell.status !== 'pending') continue;
    const dependencyStatuses = node.dependencies.map((dep) =>
      byNode.get(dep.nodeId),
    );
    if (
      dependencyStatuses.some(
        (dep) =>
          !dep ||
          dep.status === 'pending' ||
          dep.status === 'running' ||
          dep.status === 'failed' ||
          dep.status === 'cancelled',
      )
    ) {
      blocked.push(node.nodeId);
      continue;
    }
    if (!canAfford(node.budgetCeiling, parsed.budgetRemaining)) {
      starved.push(node.nodeId);
      continue;
    }
    ready.push(node.nodeId);
  }
  if (ready.length > 0) {
    return {
      state: 'ready',
      nodeIds: ready.slice(
        0,
        parsed.plan.maxConcurrentCells - runningNodeIds.length,
      ),
    };
  }
  if (starved.length > 0)
    return { state: 'budget_starved', starvedNodeIds: starved };
  if (blocked.length > 0)
    return { state: 'blocked_dependencies', blockedNodeIds: blocked };
  return {
    state: 'idle_complete',
    completedNodeIds: parsed.cells
      .filter((cell) => cell.status === 'succeeded')
      .map((cell) => cell.nodeId)
      .sort(),
  };
}

export const DEFAULT_P6_TOPOLOGY_PLANNER_POLICY: TopologyPlannerPolicy = {
  policyVersion: TOPOLOGY_PLANNER_POLICY_VERSION,
  maxConcurrentCells: 3,
  defaultRetryPolicy: {
    maxAttempts: 2,
    retryableFailureCodes: ['transient_provider_error', 'lease_lost'],
  },
  defaultCancellationPolicy: {
    cancellationReceiptRequired: true,
    retainPartialArtifacts: true,
  },
  defaultFailurePolicy: 'block_dependents',
};

function makeDefaultCatalog(): CellTemplateCatalog {
  const digestA = `sha256:${'1'.repeat(64)}`;
  const entries: CellTemplateCatalogEntry[] = [
    {
      id: 'p6-landscape',
      schemaVersion: CELL_TEMPLATE_CATALOG_SCHEMA_VERSION,
      templateVersion: 1,
      kind: 'landscape',
      role: 'Retriever -> Claim Extractor -> Lineage Analyst',
      requiredOutput: {
        kind: 'positions',
        minimumCount: 1,
        schemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
      },
      promptTemplateDigest: digestA,
      allowedInputKinds: ['claim', 'evidence', 'hypothesis', 'artifact'],
      stageOrder: 0,
    },
    {
      id: 'p6-divergence',
      schemaVersion: CELL_TEMPLATE_CATALOG_SCHEMA_VERSION,
      templateVersion: 1,
      kind: 'divergence',
      role: 'Independent blind lateralists',
      requiredOutput: {
        kind: 'positions',
        minimumCount: 2,
        schemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
      },
      promptTemplateDigest: `sha256:${'2'.repeat(64)}`,
      allowedInputKinds: ['claim', 'evidence', 'hypothesis', 'artifact'],
      stageOrder: 1,
    },
    {
      id: 'p6-prior-art',
      schemaVersion: CELL_TEMPLATE_CATALOG_SCHEMA_VERSION,
      templateVersion: 1,
      kind: 'prior_art',
      role: 'Literature Scout -> Patent/Code Scout -> Novelty Challenger',
      requiredOutput: {
        kind: 'positions',
        minimumCount: 1,
        schemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
      },
      promptTemplateDigest: `sha256:${'3'.repeat(64)}`,
      allowedInputKinds: ['claim', 'evidence', 'hypothesis', 'artifact'],
      stageOrder: 2,
    },
    {
      id: 'p6-falsification',
      schemaVersion: CELL_TEMPLATE_CATALOG_SCHEMA_VERSION,
      templateVersion: 1,
      kind: 'falsification',
      role: 'Empiricist -> Adversary -> Boundary-Condition Analyst',
      requiredOutput: {
        kind: 'dissent',
        schemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
      },
      promptTemplateDigest: `sha256:${'4'.repeat(64)}`,
      allowedInputKinds: ['claim', 'evidence', 'hypothesis', 'artifact'],
      stageOrder: 3,
    },
    {
      id: 'p6-experiment',
      schemaVersion: CELL_TEMPLATE_CATALOG_SCHEMA_VERSION,
      templateVersion: 1,
      kind: 'experiment',
      role: 'Experiment Designer -> Evaluator Author -> Reproduction Worker',
      requiredOutput: {
        kind: 'positions',
        minimumCount: 1,
        schemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
      },
      promptTemplateDigest: `sha256:${'5'.repeat(64)}`,
      allowedInputKinds: ['hypothesis', 'artifact', 'evidence'],
      stageOrder: 4,
    },
    {
      id: 'p6-synthesis',
      schemaVersion: CELL_TEMPLATE_CATALOG_SCHEMA_VERSION,
      templateVersion: 1,
      kind: 'synthesis',
      role: 'Evidence Compiler -> Dissent Reporter',
      requiredOutput: {
        kind: 'synthesis',
        allowedClaimIds: [],
        schemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
      },
      promptTemplateDigest: `sha256:${'6'.repeat(64)}`,
      allowedInputKinds: ['claim', 'evidence', 'hypothesis', 'artifact'],
      stageOrder: 5,
    },
  ];
  const partial: Omit<CellTemplateCatalog, 'catalogDigest'> = {
    schemaVersion: CELL_TEMPLATE_CATALOG_SCHEMA_VERSION,
    catalogVersion: CELL_TEMPLATE_CATALOG_SCHEMA_VERSION,
    entries,
  };
  return {
    ...partial,
    catalogDigest: cellTemplateCatalogDigest(partial),
  };
}

function normalizeNodes(nodes: readonly TopologyNode[]): TopologyNode[] {
  return [...nodes]
    .map((node) => ({
      ...node,
      dependencies: normalizeDependencies(node.dependencies),
    }))
    .sort((left, right) => left.nodeId.localeCompare(right.nodeId));
}

function normalizeDependencies(
  dependencies: readonly TopologyNodeDependency[],
): TopologyNodeDependency[] {
  return [...dependencies]
    .map((dep) => ({
      ...dep,
      artifactKinds: [...dep.artifactKinds].sort(),
    }))
    .sort((left, right) => left.nodeId.localeCompare(right.nodeId));
}

function sortTemplateEntries(
  entries: readonly CellTemplateCatalogEntry[],
): CellTemplateCatalogEntry[] {
  return [...entries].sort(
    (left, right) =>
      left.id.localeCompare(right.id) ||
      left.templateVersion - right.templateVersion,
  );
}

function templateKey(id: string, version: number): string {
  return `${id}@${String(version)}`;
}

function findTemplate(
  catalog: CellTemplateCatalog,
  id: string,
  version: number,
): CellTemplateCatalogEntry | undefined {
  return catalog.entries.find(
    (entry) => entry.id === id && entry.templateVersion === version,
  );
}

function isBoundedBudget(budget: TopologyBudget): boolean {
  return (
    budget.maxCloudSpendUsd > 0 &&
    Number.isFinite(budget.maxCloudSpendUsd) &&
    budget.maxLocalComputeHours > 0 &&
    Number.isFinite(budget.maxLocalComputeHours) &&
    budget.maxExternalRequests > 0 &&
    budget.maxExperimentRuns > 0
  );
}

function canAfford(
  ceiling: TopologyBudget,
  remaining: SchedulerBudgetRemaining,
): boolean {
  return (
    remaining.cloudSpendUsd >= ceiling.maxCloudSpendUsd &&
    remaining.localComputeHours >= ceiling.maxLocalComputeHours &&
    remaining.externalRequests >= ceiling.maxExternalRequests &&
    remaining.experimentRuns >= ceiling.maxExperimentRuns
  );
}

function validateAcyclic(
  nodes: readonly TopologyNode[],
): TopologyValidationResult {
  const nodeById = new Map(nodes.map((node) => [node.nodeId, node]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (nodeId: string): TopologyValidationResult => {
    if (visiting.has(nodeId)) {
      return {
        ok: false,
        code: 'cyclic_dependency',
        message: `topology dependency cycle includes ${nodeId}`,
      };
    }
    if (visited.has(nodeId)) return { ok: true };
    const node = nodeById.get(nodeId);
    if (!node) {
      return {
        ok: false,
        code: 'missing_dependency',
        message: `missing topology node ${nodeId}`,
      };
    }
    visiting.add(nodeId);
    for (const dep of node.dependencies) {
      const result = visit(dep.nodeId);
      if (!result.ok) return result;
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
    return { ok: true };
  };
  for (const node of nodes) {
    const result = visit(node.nodeId);
    if (!result.ok) return result;
  }
  return { ok: true };
}

function classifySchemaIssue(
  issues: readonly z.ZodIssue[],
): TopologyValidationResult {
  const message = issues.map((issue) => issue.message).join('; ');
  if (message.includes('branch must match')) {
    return { ok: false, code: 'criterion_drift', message };
  }
  if (message.includes('maxConcurrentCells')) {
    return { ok: false, code: 'unbounded_concurrency', message };
  }
  if (message.includes('budget')) {
    return { ok: false, code: 'unbounded_budget', message };
  }
  if (message.includes('failurePolicy')) {
    return { ok: false, code: 'unknown_failure_policy', message };
  }
  if (message.includes('artifactKinds')) {
    return { ok: false, code: 'invalid_dependency_artifact', message };
  }
  return { ok: false, code: 'invalid_schema', message };
}

function encodeComponent(value: string): string {
  return encodeURIComponent(value);
}
