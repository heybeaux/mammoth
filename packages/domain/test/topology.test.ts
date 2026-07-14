import { describe, expect, it } from 'vitest';
import {
  CELL_TEMPLATE_CATALOG_SCHEMA_VERSION,
  DEFAULT_P6_TOPOLOGY_TEMPLATE_CATALOG,
  RESEARCH_CELL_CONTRACT_VERSION,
  TOPOLOGY_PLAN_SCHEMA_VERSION,
  TOPOLOGY_PLANNER_POLICY_VERSION,
  TopologyPlanSchema,
  buildTopologyPlan,
  decideNextSchedulerState,
  deriveTopologyCellId,
  planTopology,
  validateTopologyPlan,
  type CellInput,
  type CellOutputContract,
  type CriterionReference,
  type TopologyBudget,
  type TopologyNode,
  type TopologyPlan,
} from '../src/index.js';

const digestA =
  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const now = '2026-07-13T17:00:00.000Z';

const criterionRef: CriterionReference = {
  criterionId: 'criterion-p6',
  criterionVersion: 1,
  criterionDigest: digestA,
  branchId: 'main',
};

const budget: TopologyBudget = {
  maxCloudSpendUsd: 10,
  maxLocalComputeHours: 4,
  maxExternalRequests: 100,
  maxExperimentRuns: 3,
};

const input: CellInput = {
  schemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
  claimIds: ['claim-1'],
  evidenceIds: ['evidence-1'],
  hypothesisIds: ['hypothesis-1'],
  artifactIds: ['artifact-1'],
};

const positionsOutput: CellOutputContract = {
  kind: 'positions',
  minimumCount: 1,
  schemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
};

function node(
  nodeId: string,
  templateId: string,
  dependencies: TopologyNode['dependencies'] = [],
  outputContract: CellOutputContract = positionsOutput,
): TopologyNode {
  return {
    nodeId,
    templateId,
    templateVersion: 1,
    dependencies,
    input,
    outputContract,
    retryPolicy: {
      maxAttempts: 2,
      retryableFailureCodes: ['transient_provider_error'],
    },
    cancellationPolicy: {
      cancellationReceiptRequired: true,
      retainPartialArtifacts: true,
    },
    failurePolicy: 'block_dependents',
    maxAttempts: 2,
    budgetCeiling: {
      maxCloudSpendUsd: 1,
      maxLocalComputeHours: 1,
      maxExternalRequests: 1,
      maxExperimentRuns: 1,
    },
  };
}

function validNodes(): TopologyNode[] {
  return [
    node('landscape', 'p6-landscape'),
    node('divergence', 'p6-divergence', [
      { nodeId: 'landscape', artifactKinds: ['claim_ids', 'evidence_ids'] },
    ]),
    node('prior-art', 'p6-prior-art', [
      { nodeId: 'landscape', artifactKinds: ['claim_ids'] },
    ]),
    node(
      'falsification',
      'p6-falsification',
      [{ nodeId: 'divergence', artifactKinds: ['position_ids'] }],
      {
        kind: 'dissent',
        schemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
      },
    ),
    node('experiment', 'p6-experiment', [
      { nodeId: 'falsification', artifactKinds: ['dissent_report_ids'] },
    ]),
    node(
      'synthesis',
      'p6-synthesis',
      [
        { nodeId: 'prior-art', artifactKinds: ['position_ids'] },
        { nodeId: 'experiment', artifactKinds: ['position_ids'] },
      ],
      {
        kind: 'synthesis',
        allowedClaimIds: [],
        schemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
      },
    ),
  ];
}

function validPlan(overrides: Partial<TopologyPlan> = {}): TopologyPlan {
  return {
    ...buildTopologyPlan({
      programId: 'program-p6',
      workItemId: 'work-p6',
      criterionRef,
      branchId: 'main',
      planVersion: TOPOLOGY_PLAN_SCHEMA_VERSION,
      nodes: validNodes(),
      maxConcurrentCells: 2,
      budgetCeiling: budget,
      plannedAt: now,
    }),
    ...overrides,
  };
}

describe('P6 topology domain contracts', () => {
  it('validates and plans a deterministic multi-cell topology', () => {
    const plan = validPlan();
    expect(TopologyPlanSchema.parse(plan)).toEqual(plan);
    expect(validateTopologyPlan(plan)).toEqual({ ok: true });

    const planned = planTopology(plan);
    expect(planned.topologyId).toBe(plan.id);
    expect(planned.cells.map((cell) => cell.nodeId)).toEqual([
      'divergence',
      'experiment',
      'falsification',
      'landscape',
      'prior-art',
      'synthesis',
    ]);
    const firstCell = planned.cells[0];
    expect(firstCell).toBeDefined();
    if (!firstCell) throw new Error('planned topology did not produce cells');
    expect(planned.cells[0]?.cellId).toBe(
      deriveTopologyCellId({
        topologyId: plan.id,
        nodeId: 'divergence',
        templateId: 'p6-divergence',
        templateVersion: 1,
        inputDigest: firstCell.inputDigest,
      }),
    );

    const reordered = buildTopologyPlan({
      programId: 'program-p6',
      workItemId: 'work-p6',
      criterionRef,
      branchId: 'main',
      planVersion: TOPOLOGY_PLAN_SCHEMA_VERSION,
      nodes: [...validNodes()].reverse(),
      maxConcurrentCells: 2,
      budgetCeiling: budget,
      plannedAt: now,
    });
    expect(reordered.canonicalDigest).toBe(plan.canonicalDigest);
    expect(reordered.dependencyDigest).toBe(plan.dependencyDigest);
    expect(reordered.id).toBe(plan.id);
  });

  it('fails closed for invalid topology plans', () => {
    expect(
      validateTopologyPlan(
        buildTopologyPlan({
          programId: 'program-p6',
          workItemId: 'cycle',
          criterionRef,
          branchId: 'main',
          planVersion: TOPOLOGY_PLAN_SCHEMA_VERSION,
          nodes: [
            node('a', 'p6-landscape', [
              { nodeId: 'b', artifactKinds: ['claim_ids'] },
            ]),
            node('b', 'p6-divergence', [
              { nodeId: 'a', artifactKinds: ['claim_ids'] },
            ]),
          ],
          maxConcurrentCells: 2,
          budgetCeiling: budget,
          plannedAt: now,
        }),
      ),
    ).toMatchObject({ ok: false, code: 'cyclic_dependency' });

    expect(
      validateTopologyPlan(
        buildTopologyPlan({
          programId: 'program-p6',
          workItemId: 'missing',
          criterionRef,
          branchId: 'main',
          planVersion: TOPOLOGY_PLAN_SCHEMA_VERSION,
          nodes: [
            node('a', 'p6-landscape', [
              { nodeId: 'missing', artifactKinds: ['claim_ids'] },
            ]),
          ],
          maxConcurrentCells: 2,
          budgetCeiling: budget,
          plannedAt: now,
        }),
      ),
    ).toMatchObject({ ok: false, code: 'missing_dependency' });

    expect(
      validateTopologyPlan(
        buildTopologyPlan({
          programId: 'program-p6',
          workItemId: 'unknown-template',
          criterionRef,
          branchId: 'main',
          planVersion: TOPOLOGY_PLAN_SCHEMA_VERSION,
          nodes: [node('a', 'p6-unknown')],
          maxConcurrentCells: 2,
          budgetCeiling: budget,
          plannedAt: now,
        }),
      ),
    ).toMatchObject({ ok: false, code: 'unknown_template' });

    expect(
      validateTopologyPlan({
        ...validPlan(),
        maxConcurrentCells: Number.POSITIVE_INFINITY,
      }),
    ).toMatchObject({ ok: false, code: 'unbounded_concurrency' });

    expect(
      validateTopologyPlan({
        ...validPlan(),
        budgetCeiling: {
          ...budget,
          maxCloudSpendUsd: Number.POSITIVE_INFINITY,
        },
      }),
    ).toMatchObject({ ok: false, code: 'unbounded_budget' });

    expect(
      validateTopologyPlan(
        buildTopologyPlan({
          programId: 'program-p6',
          workItemId: 'duplicate',
          criterionRef,
          branchId: 'main',
          planVersion: TOPOLOGY_PLAN_SCHEMA_VERSION,
          nodes: [node('a', 'p6-landscape'), node('a', 'p6-divergence')],
          maxConcurrentCells: 2,
          budgetCeiling: budget,
          plannedAt: now,
        }),
      ),
    ).toMatchObject({ ok: false, code: 'duplicate_node' });

    expect(
      validateTopologyPlan({
        ...validPlan(),
        branchId: 'stale-branch',
      }),
    ).toMatchObject({ ok: false, code: 'criterion_drift' });

    expect(
      validateTopologyPlan({
        ...validPlan(),
        nodes: [
          {
            ...validPlan().nodes[0],
            dependencies: [
              {
                nodeId: 'landscape',
                artifactKinds: ['full_transcript'],
              },
            ],
          },
        ],
      }),
    ).toMatchObject({ ok: false, code: 'invalid_dependency_artifact' });

    expect(
      validateTopologyPlan({
        ...validPlan(),
        nodes: [{ ...validPlan().nodes[0], failurePolicy: 'unknown' }],
      }),
    ).toMatchObject({ ok: false, code: 'unknown_failure_policy' });
  });

  it('distinguishes scheduler idle, blocked, saturated, and budget-starved states', () => {
    const plan = validPlan();
    const baseCells = plan.nodes.map((topologyNode) => ({
      nodeId: topologyNode.nodeId,
      status: 'pending' as const,
      attempt: 0,
    }));

    expect(
      decideNextSchedulerState({
        plan,
        cells: baseCells,
        runningNodeIds: [],
        budgetRemaining: {
          cloudSpendUsd: 0,
          localComputeHours: 10,
          externalRequests: 10,
          experimentRuns: 10,
        },
      }),
    ).toEqual({ state: 'budget_starved', starvedNodeIds: ['landscape'] });

    expect(
      decideNextSchedulerState({
        plan,
        cells: baseCells,
        runningNodeIds: ['landscape', 'divergence'],
        budgetRemaining: {
          cloudSpendUsd: 10,
          localComputeHours: 10,
          externalRequests: 10,
          experimentRuns: 10,
        },
      }),
    ).toEqual({
      state: 'concurrency_saturated',
      runningNodeIds: ['divergence', 'landscape'],
    });

    expect(
      decideNextSchedulerState({
        plan,
        cells: baseCells.map((cell) =>
          cell.nodeId === 'landscape'
            ? { ...cell, status: 'running' as const, attempt: 1 }
            : cell,
        ),
        runningNodeIds: [],
        budgetRemaining: {
          cloudSpendUsd: 10,
          localComputeHours: 10,
          externalRequests: 10,
          experimentRuns: 10,
        },
      }),
    ).toEqual({
      state: 'blocked_dependencies',
      blockedNodeIds: [
        'divergence',
        'experiment',
        'falsification',
        'prior-art',
        'synthesis',
      ],
    });

    expect(
      decideNextSchedulerState({
        plan,
        cells: baseCells.map((cell) => ({
          ...cell,
          status: 'succeeded' as const,
          attempt: 1,
        })),
        runningNodeIds: [],
        budgetRemaining: {
          cloudSpendUsd: 0,
          localComputeHours: 0,
          externalRequests: 0,
          experimentRuns: 0,
        },
      }),
    ).toEqual({
      state: 'idle_complete',
      completedNodeIds: [
        'divergence',
        'experiment',
        'falsification',
        'landscape',
        'prior-art',
        'synthesis',
      ],
    });
  });

  it('keeps the default catalog versioned and canonical', () => {
    expect(DEFAULT_P6_TOPOLOGY_TEMPLATE_CATALOG.schemaVersion).toBe(
      CELL_TEMPLATE_CATALOG_SCHEMA_VERSION,
    );
    expect(DEFAULT_P6_TOPOLOGY_TEMPLATE_CATALOG.catalogVersion).toBe(
      CELL_TEMPLATE_CATALOG_SCHEMA_VERSION,
    );
    expect(
      DEFAULT_P6_TOPOLOGY_TEMPLATE_CATALOG.entries.map((entry) => entry.kind),
    ).toEqual([
      'landscape',
      'divergence',
      'prior_art',
      'falsification',
      'experiment',
      'synthesis',
    ]);
    expect(TOPOLOGY_PLANNER_POLICY_VERSION).toBe('1.0.0');
  });
});
