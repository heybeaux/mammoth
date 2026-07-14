import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export type P6GateStatus = 'passed' | 'failed' | 'missing' | 'blocked';

export interface P6GateSpec {
  readonly id: string;
  readonly description: string;
  readonly requiredPath: string;
  readonly command?: readonly [string, ...string[]];
  readonly dependency?: string;
}

export interface P6GateResult extends P6GateSpec {
  readonly status: P6GateStatus;
  readonly exitCode?: number;
  readonly diagnostic?: string;
  readonly caseIds?: readonly string[];
}

export interface P6VerificationResult {
  readonly ok: boolean;
  readonly verifier: 'mammoth-p6-acceptance-v1';
  readonly fixtureManifest: typeof P6_FIXTURE_MANIFEST;
  readonly gates: readonly P6GateResult[];
}

export interface P6VerifierDependencies {
  readonly exists: (path: string) => Promise<boolean>;
  readonly validateTarget: (
    target: P6GateSpec,
    absolutePath: string,
    repository: string,
  ) => Promise<string | undefined>;
  readonly run: (
    command: readonly [string, ...string[]],
    cwd: string,
  ) => Promise<{ exitCode: number; diagnostic?: string }>;
}

export const P6_FIXTURE_MANIFEST =
  'evals/fixtures/p6/adversarial-manifest.json' as const;

export const REQUIRED_P6_CASES = [
  'topology-cycle',
  'topology-missing-dependency-node',
  'topology-unknown-template-version',
  'topology-unbounded-concurrency-or-budget',
  'topology-duplicate-stable-node-identities',
  'criterion-drift-parent-child',
  'landscape-output-missing-claim-or-evidence-ids',
  'divergence-agreement-over-unsupported-claims',
  'correlated-consensus-presented-as-independent-support',
  'valid-dissent-retained-through-synthesis',
  'adversarial-dissent-with-admissible-contradictory-evidence',
  'prior-art-novelty-statuses-without-universal-novelty',
  'falsification-preserves-counterexamples-and-invalid-critiques',
  'experiment-hidden-holdout-invalid-failed-cancelled-valid',
  'evidence-aware-synthesis-invalid-inputs-and-admitted-only',
  'scheduler-idle-blocked-concurrency-budget-distinct',
  'duplicate-topology-child-budget-effect-cancellation-receipts',
  'budget-starvation-before-dispatch-and-mid-topology',
  'cancellation-before-during-after-child-synthesis-settlement',
  'worker-activity-client-service-death-parent-child-boundaries',
  'continue-as-new-and-replay-supported-p6-versions',
  'migration-fencing-digest-broken-future-projection-write-digest',
  'clean-multi-cell-acceptance-run-manifest-shape',
] as const;

export const P6_CASE_EXECUTION_GATES: Readonly<
  Record<(typeof REQUIRED_P6_CASES)[number], readonly string[]>
> = {
  'topology-cycle': ['topology-contract-planner'],
  'topology-missing-dependency-node': ['topology-contract-planner'],
  'topology-unknown-template-version': ['topology-contract-planner'],
  'topology-unbounded-concurrency-or-budget': ['topology-contract-planner'],
  'topology-duplicate-stable-node-identities': ['topology-contract-planner'],
  'criterion-drift-parent-child': ['topology-contract-planner'],
  'landscape-output-missing-claim-or-evidence-ids': [
    'topology-contract-planner',
  ],
  'divergence-agreement-over-unsupported-claims': ['synthesis-provenance'],
  'correlated-consensus-presented-as-independent-support': [
    'synthesis-provenance',
  ],
  'valid-dissent-retained-through-synthesis': ['synthesis-provenance'],
  'adversarial-dissent-with-admissible-contradictory-evidence': [
    'synthesis-provenance',
  ],
  'prior-art-novelty-statuses-without-universal-novelty': [
    'topology-contract-planner',
  ],
  'falsification-preserves-counterexamples-and-invalid-critiques': [
    'topology-contract-planner',
  ],
  'experiment-hidden-holdout-invalid-failed-cancelled-valid': [
    'synthesis-provenance',
  ],
  'evidence-aware-synthesis-invalid-inputs-and-admitted-only': [
    'synthesis-provenance',
  ],
  'scheduler-idle-blocked-concurrency-budget-distinct': [
    'scheduler-budget-policy',
  ],
  'duplicate-topology-child-budget-effect-cancellation-receipts': [
    'persistence-budget-lifecycle',
    'postgres-topology-migration',
  ],
  'budget-starvation-before-dispatch-and-mid-topology': [
    'scheduler-budget-policy',
  ],
  'cancellation-before-during-after-child-synthesis-settlement': [
    'temporal-execution-recovery',
  ],
  'worker-activity-client-service-death-parent-child-boundaries': [
    'temporal-execution-recovery',
  ],
  'continue-as-new-and-replay-supported-p6-versions': [
    'temporal-execution-recovery',
  ],
  'migration-fencing-digest-broken-future-projection-write-digest': [
    'postgres-topology-migration',
    'production-profile-p6-lifecycle',
    'projection-operator-inspection',
  ],
  'clean-multi-cell-acceptance-run-manifest-shape': ['fixture-manifest'],
};

export const P6_GATES: readonly P6GateSpec[] = [
  {
    id: 'fixture-manifest',
    description: 'Frozen P6 adversarial fixture manifest and verifier shape',
    requiredPath: 'evals/p6-acceptance/test/verifier-smoke.ts',
    command: [
      'pnpm',
      'exec',
      'tsx',
      'evals/p6-acceptance/test/verifier-smoke.ts',
    ],
  },
  {
    id: 'topology-contract-planner',
    description: 'Lane A topology templates, planner policy, and validation',
    requiredPath: 'packages/domain/test/topology.test.ts',
    command: ['pnpm', '--filter', '@mammoth/domain', 'test'],
  },
  {
    id: 'scheduler-budget-policy',
    description:
      'Lane A deterministic scheduler state and budget starvation policy',
    requiredPath: 'packages/workflow/test/p6-contract.test.ts',
    command: ['pnpm', '--filter', '@mammoth/workflow', 'test'],
  },
  {
    id: 'persistence-budget-lifecycle',
    description:
      'Lane B authoritative topology persistence and budget lifecycle',
    requiredPath: 'packages/persistence/test/p6-topology.test.ts',
    command: ['pnpm', '--filter', '@mammoth/persistence', 'test'],
  },
  {
    id: 'postgres-topology-migration',
    description: 'Lane B Postgres migration 7, constraints, and budget guards',
    requiredPath: 'packages/postgres-adapter/src/p6-topology.ts',
    command: ['pnpm', '--filter', '@mammoth/postgres-adapter', 'test'],
  },
  {
    id: 'production-profile-p6-lifecycle',
    description:
      'Lane B production-profile P6 lifecycle and restart reconstruction',
    requiredPath: 'packages/production-profile/src/verify.ts',
    command: ['pnpm', '--filter', '@mammoth/production-profile', 'test'],
  },
  {
    id: 'temporal-execution-recovery',
    description: 'Lane B parent/child Temporal execution, recovery, and replay',
    requiredPath: 'packages/temporal-adapter/test/p6-live-workflow.test.ts',
    command: ['pnpm', '--filter', '@mammoth/temporal-adapter', 'test:p6-live'],
  },
  {
    id: 'synthesis-provenance',
    description: 'Lane C evidence-aware synthesis over admitted claims only',
    requiredPath: 'packages/report-compiler/package.json',
    command: ['pnpm', '--filter', '@mammoth/report-compiler', 'test'],
  },
  {
    id: 'projection-operator-inspection',
    description: 'Lane C read-only fail-closed P6 topology projection',
    requiredPath: 'packages/observatory-projection/package.json',
    command: ['pnpm', '--filter', '@mammoth/observatory-projection', 'test'],
  },
];

export const P6_EXECUTABLE_CASE_PROOFS: readonly {
  readonly caseId: (typeof REQUIRED_P6_CASES)[number];
  readonly path: string;
  readonly snippets: readonly string[];
}[] = [
  {
    caseId: 'topology-cycle',
    path: 'packages/domain/test/topology.test.ts',
    snippets: ['cycle', 'cyclic_dependency'],
  },
  {
    caseId: 'topology-missing-dependency-node',
    path: 'packages/domain/test/topology.test.ts',
    snippets: ['missing_dependency', "nodeId: 'missing'"],
  },
  {
    caseId: 'topology-unknown-template-version',
    path: 'packages/domain/test/topology.test.ts',
    snippets: ['unknown-template', 'unknown_template'],
  },
  {
    caseId: 'topology-unbounded-concurrency-or-budget',
    path: 'packages/domain/test/topology.test.ts',
    snippets: ['maxConcurrentCells', 'budgetCeiling'],
  },
  {
    caseId: 'topology-duplicate-stable-node-identities',
    path: 'packages/domain/test/topology.test.ts',
    snippets: ['duplicate', 'duplicate_node'],
  },
  {
    caseId: 'criterion-drift-parent-child',
    path: 'packages/domain/test/topology.test.ts',
    snippets: ['criterion', 'branch'],
  },
  {
    caseId: 'landscape-output-missing-claim-or-evidence-ids',
    path: 'packages/domain/test/topology.test.ts',
    snippets: ['landscape', 'invalid_dependency_artifact'],
  },
  {
    caseId: 'divergence-agreement-over-unsupported-claims',
    path: 'packages/report-compiler/test/p6-synthesis.test.ts',
    snippets: ['UNADMITTED_CLAIM', 'claim-unadmitted'],
  },
  {
    caseId: 'correlated-consensus-presented-as-independent-support',
    path: 'packages/report-compiler/test/p6-synthesis.test.ts',
    snippets: ['correlated', 'nonAuthoritative: true'],
  },
  {
    caseId: 'valid-dissent-retained-through-synthesis',
    path: 'packages/report-compiler/test/p6-synthesis.test.ts',
    snippets: ['preservedDissentIds', 'dissent-minority'],
  },
  {
    caseId: 'adversarial-dissent-with-admissible-contradictory-evidence',
    path: 'packages/report-compiler/test/p6-synthesis.test.ts',
    snippets: ['unresolvedIssueIds', 'issue-boundary'],
  },
  {
    caseId: 'prior-art-novelty-statuses-without-universal-novelty',
    path: 'packages/domain/src/topology.ts',
    snippets: ['prior_art', 'Novelty Challenger'],
  },
  {
    caseId: 'falsification-preserves-counterexamples-and-invalid-critiques',
    path: 'packages/domain/src/topology.ts',
    snippets: ['falsification', 'Boundary-Condition Analyst'],
  },
  {
    caseId: 'experiment-hidden-holdout-invalid-failed-cancelled-valid',
    path: 'packages/report-compiler/src/p6-synthesis.ts',
    snippets: ['hidden_holdout_leakage', 'invalid_environment_digest'],
  },
  {
    caseId: 'evidence-aware-synthesis-invalid-inputs-and-admitted-only',
    path: 'packages/report-compiler/test/p6-synthesis.test.ts',
    snippets: ['MISSING_EVIDENCE', 'INVALID_POLICY_VERDICT'],
  },
  {
    caseId: 'scheduler-idle-blocked-concurrency-budget-distinct',
    path: 'packages/domain/test/topology.test.ts',
    snippets: ['budget_starved', 'blocked_dependencies'],
  },
  {
    caseId: 'duplicate-topology-child-budget-effect-cancellation-receipts',
    path: 'packages/postgres-adapter/test/research-cells.test.ts',
    snippets: ['duplicate settlement stable identity', 'different payload'],
  },
  {
    caseId: 'budget-starvation-before-dispatch-and-mid-topology',
    path: 'packages/domain/test/topology.test.ts',
    snippets: ['budget_starved', 'idle_complete'],
  },
  {
    caseId: 'cancellation-before-during-after-child-synthesis-settlement',
    path: 'packages/temporal-adapter/test/p6-live-workflow.test.ts',
    snippets: ['after_child_before_synthesis', 'during_synthesis'],
  },
  {
    caseId: 'worker-activity-client-service-death-parent-child-boundaries',
    path: 'packages/temporal-adapter/test/p6-live-workflow.test.ts',
    snippets: ['worker replacement', 'client handle loss'],
  },
  {
    caseId: 'continue-as-new-and-replay-supported-p6-versions',
    path: 'packages/temporal-adapter/test/p6-live-workflow.test.ts',
    snippets: ['continue-as-new', 'runReplayHistory'],
  },
  {
    caseId: 'migration-fencing-digest-broken-future-projection-write-digest',
    path: 'packages/postgres-adapter/src/migrations.ts',
    snippets: [
      'P6 topology authority rows are immutable',
      'P6 topology cancellation amount exceeds reservation ceiling',
    ],
  },
  {
    caseId: 'clean-multi-cell-acceptance-run-manifest-shape',
    path: 'evals/fixtures/p6/adversarial-manifest.json',
    snippets: ['clean-multi-cell-acceptance-run-manifest-shape'],
  },
];

export async function verifyP6FixtureManifest(
  repository: string,
): Promise<void> {
  const parsed: unknown = JSON.parse(
    await readFile(resolve(repository, P6_FIXTURE_MANIFEST), 'utf8'),
  );
  if (!isRecord(parsed) || parsed.schemaVersion !== 1)
    throw new Error('P6_FIXTURE_MANIFEST_VERSION');
  for (const [field, expected] of [
    ['checkpoint', 'v0.6.0-research-topology'],
    ['topologyPlanSchemaVersion', '1.0.0'],
    ['cellTemplateCatalogSchemaVersion', '1.0.0'],
    ['plannerPolicyVersion', '1.0.0'],
    ['budgetPolicyVersion', '1.0.0'],
    ['synthesisContractVersion', '1.0.0'],
    ['topologyProjectionExtensionVersion', '1.0.0'],
  ] as const) {
    if (parsed[field] !== expected)
      throw new Error(`P6_FIXTURE_MANIFEST_POLICY:${field}`);
  }
  if (parsed.workflowApplicationContractMajor !== 1)
    throw new Error('P6_FIXTURE_MANIFEST_WORKFLOW_MAJOR');
  if (parsed.workflowVersion !== 1)
    throw new Error('P6_FIXTURE_MANIFEST_WORKFLOW_VERSION');
  if (!Array.isArray(parsed.cases))
    throw new Error('P6_FIXTURE_MANIFEST_CASES');
  const ids = parsed.cases.map((value) => {
    if (
      !isRecord(value) ||
      typeof value.id !== 'string' ||
      typeof value.gate !== 'string' ||
      typeof value.expected !== 'string'
    )
      throw new Error('P6_FIXTURE_MANIFEST_CASE_ID');
    return value.id;
  });
  if (new Set(ids).size !== ids.length)
    throw new Error('P6_FIXTURE_MANIFEST_DUPLICATE_CASE');
  const missing = REQUIRED_P6_CASES.filter((id) => !ids.includes(id));
  const extra = ids.filter(
    (id) => !(REQUIRED_P6_CASES as readonly string[]).includes(id),
  );
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `P6_FIXTURE_MANIFEST_DRIFT:missing=${missing.join(',')};extra=${extra.join(',')}`,
    );
  }
  const gates = new Set(P6_GATES.map(({ id }) => id));
  for (const value of parsed.cases) {
    const gate = (value as { gate: string }).gate;
    if (!gates.has(gate)) throw new Error(`P6_FIXTURE_UNKNOWN_GATE:${gate}`);
  }
}

export async function verifyP6(
  repository: string,
  dependencies: P6VerifierDependencies = systemDependencies,
  gates: readonly P6GateSpec[] = P6_GATES,
): Promise<P6VerificationResult> {
  assertUniqueGateIds(gates);
  assertFixtureExecutionGates(gates);
  await verifyP6FixtureManifest(repository);
  await verifyExecutableCaseProofs(repository);
  const results: P6GateResult[] = [];
  for (const gate of gates) {
    const absolutePath = resolve(repository, gate.requiredPath);
    if (!(await dependencies.exists(absolutePath))) {
      results.push({
        ...gate,
        status: 'missing',
        diagnostic: `required acceptance target is absent: ${gate.requiredPath}`,
      });
      continue;
    }
    const invalid = await dependencies.validateTarget(
      gate,
      absolutePath,
      repository,
    );
    if (invalid !== undefined) {
      results.push({ ...gate, status: 'missing', diagnostic: invalid });
      continue;
    }
    if (gate.command === undefined) {
      results.push({
        ...gate,
        status: 'blocked',
        diagnostic: gate.dependency ?? 'gate has no executable command yet',
        caseIds: caseIdsForGate(gate.id),
      });
      continue;
    }
    const execution = await dependencies.run(gate.command, repository);
    results.push({
      ...gate,
      status: execution.exitCode === 0 ? 'passed' : 'failed',
      exitCode: execution.exitCode,
      caseIds: caseIdsForGate(gate.id),
      ...(execution.diagnostic === undefined
        ? {}
        : { diagnostic: execution.diagnostic }),
    });
  }
  return {
    ok:
      results.length > 0 && results.every(({ status }) => status === 'passed'),
    verifier: 'mammoth-p6-acceptance-v1',
    fixtureManifest: P6_FIXTURE_MANIFEST,
    gates: results,
  };
}

async function verifyExecutableCaseProofs(repository: string): Promise<void> {
  const covered = new Set(
    P6_EXECUTABLE_CASE_PROOFS.map(({ caseId }) => caseId),
  );
  const missing = REQUIRED_P6_CASES.filter((caseId) => !covered.has(caseId));
  if (missing.length > 0)
    throw new Error(`P6_EXECUTABLE_CASE_PROOF_MISSING:${missing.join(',')}`);
  for (const proof of P6_EXECUTABLE_CASE_PROOFS) {
    const source = await readFile(resolve(repository, proof.path), 'utf8');
    for (const snippet of proof.snippets) {
      if (!source.includes(snippet))
        throw new Error(
          `P6_EXECUTABLE_CASE_PROOF_DRIFT:${proof.caseId}:${proof.path}:${snippet}`,
        );
    }
  }
}

function assertUniqueGateIds(gates: readonly P6GateSpec[]): void {
  const ids = new Set<string>();
  for (const gate of gates) {
    if (ids.has(gate.id))
      throw new Error(`P6_VERIFIER_DUPLICATE_GATE:${gate.id}`);
    ids.add(gate.id);
  }
}

function assertFixtureExecutionGates(gates: readonly P6GateSpec[]): void {
  const gateIds = new Set(gates.map(({ id }) => id));
  const missing = new Set<string>();
  for (const gateIdList of Object.values(P6_CASE_EXECUTION_GATES)) {
    for (const gateId of gateIdList) {
      if (!gateIds.has(gateId)) missing.add(gateId);
    }
  }
  if (missing.size > 0) {
    throw new Error(
      `P6_VERIFIER_CASE_GATE_MISSING:${[...missing].sort().join(',')}`,
    );
  }
}

function caseIdsForGate(gateId: string): readonly string[] {
  return REQUIRED_P6_CASES.filter((caseId) =>
    P6_CASE_EXECUTION_GATES[caseId].includes(gateId),
  );
}

const systemDependencies: P6VerifierDependencies = {
  exists: async (path) =>
    access(path, constants.R_OK)
      .then(() => true)
      .catch(() => false),
  validateTarget: async (target, absolutePath) => {
    if (target.id === 'fixture-manifest') {
      const source = await readFile(absolutePath, 'utf8');
      if (
        !source.includes('verifyP6FixtureManifest') ||
        !source.includes('P6_VERIFIER_DUPLICATE_GATE')
      )
        return 'P6 acceptance self-test must cover manifest and gate registry failures';
    }
    return undefined;
  },
  run: (command, cwd) =>
    new Promise((resolveRun) => {
      const child = spawn(command[0], command.slice(1), {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
      });
      let output = '';
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        output += String(chunk);
      });
      child.stderr.on('data', (chunk) => {
        output += String(chunk);
      });
      child.on('error', (error) => {
        resolveRun({ exitCode: 127, diagnostic: error.message });
      });
      child.on('close', (code) => {
        resolveRun({
          exitCode: code ?? 1,
          ...(code === 0 ? {} : { diagnostic: output.slice(-4000) }),
        });
      });
    }),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
