import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export type P5GateStatus = 'passed' | 'failed' | 'missing';

export interface P5GateSpec {
  readonly id: string;
  readonly description: string;
  readonly requiredPath: string;
  readonly command: readonly [string, ...string[]];
}

export interface P5GateResult extends P5GateSpec {
  readonly status: P5GateStatus;
  readonly exitCode?: number;
  readonly diagnostic?: string;
}

export interface P5VerificationResult {
  readonly ok: boolean;
  readonly verifier: 'mammoth-p5-acceptance-v1';
  readonly fixtureManifest: 'evals/fixtures/p5/adversarial-manifest.json';
  readonly gates: readonly P5GateResult[];
}

export interface P5VerifierDependencies {
  readonly exists: (path: string) => Promise<boolean>;
  readonly validateTarget: (
    target: P5GateSpec,
    absolutePath: string,
    repository: string,
  ) => Promise<string | undefined>;
  readonly run: (
    command: readonly [string, ...string[]],
    cwd: string,
  ) => Promise<{ exitCode: number; diagnostic?: string }>;
}

export const P5_FIXTURE_MANIFEST =
  'evals/fixtures/p5/adversarial-manifest.json' as const;

export const REQUIRED_P5_CASES = [
  'early-peer-read-before-commit',
  'reveal-without-durable-commit',
  'reveal-mismatched-digest',
  'reveal-stale-criterion',
  'valid-commit-then-peer-reveal',
  'reviewer-context-prohibited-fields',
  'reviewer-context-nested-future-fields',
  'reviewer-context-digest-confusion',
  'authoritative-attribution-retained-while-reviewer-input-sanitized',
  'same-profile-same-role-self-review',
  'alias-checkpoint-equivalent-self-review',
  'correlated-unknown-and-valid-panels',
  'minority-and-unresolved-conflict-survive',
  'abstained-invalid-rejected-timed-out-never-started-reviews-retained',
  'duplicate-position-review-budget-effect-cancellation-delivery',
  'overspend-settlement-beyond-reservation-release-after-settlement',
  'cancellation-before-dispatch-through-settlement',
  'worker-client-and-service-death-at-durable-boundaries',
  'continue-as-new-and-replay-supported-versions',
  'migration-interruption-stale-fencing-digest-corruption-broken-references',
  'future-projection-authority-and-deterministic-restart-digest',
] as const;

export const P5_GATES: readonly P5GateSpec[] = [
  {
    id: 'fixture-manifest',
    description:
      'Frozen P5 adversarial fixture manifest and verifier invariants',
    requiredPath: 'evals/p5-acceptance/package.json',
    command: ['pnpm', '--filter', '@mammoth/p5-acceptance', 'test'],
  },
  {
    id: 'domain-isolation-policy',
    description:
      'Commit-before-reveal isolation, sanitized review context, assignment, dissent, and residue policy',
    requiredPath: 'packages/domain/package.json',
    command: ['pnpm', '--filter', '@mammoth/domain', 'test'],
  },
  {
    id: 'persistence-budget-lifecycle',
    description:
      'Authoritative P5 persistence ports, budget settlement, cancellation receipts, and restart reconstruction',
    requiredPath: 'packages/persistence/package.json',
    command: ['pnpm', '--filter', '@mammoth/persistence', 'test'],
  },
  {
    id: 'postgres-p5-migration',
    description:
      'Forward-only production Postgres migration after P4 version 5',
    requiredPath: 'packages/postgres-adapter/src/migrations.ts',
    command: ['pnpm', '--filter', '@mammoth/postgres-adapter', 'test'],
  },
  {
    id: 'workflow-contracts',
    description:
      'Divergence/review workflow IDs, carry, continue-as-new reconstruction, and replay contracts',
    requiredPath: 'packages/workflow/package.json',
    command: ['pnpm', '--filter', '@mammoth/workflow', 'test'],
  },
  {
    id: 'temporal-execution-recovery',
    description:
      'Temporal divergence/review shell, idempotent Activities, cancellation, and recovery fixtures',
    requiredPath: 'packages/temporal-adapter/package.json',
    command: ['pnpm', '--filter', '@mammoth/temporal-adapter', 'test'],
  },
  {
    id: 'projection-operator-inspection',
    description:
      'Read-only fail-closed P5 Observatory projection and operator inspection',
    requiredPath: 'packages/observatory-projection/package.json',
    command: ['pnpm', '--filter', '@mammoth/observatory-projection', 'test'],
  },
];

export async function verifyP5FixtureManifest(
  repository: string,
): Promise<void> {
  const parsed: unknown = JSON.parse(
    await readFile(resolve(repository, P5_FIXTURE_MANIFEST), 'utf8'),
  );
  if (!isRecord(parsed) || parsed.schemaVersion !== 1)
    throw new Error('P5_FIXTURE_MANIFEST_VERSION');
  for (const [field, expected] of [
    ['checkpoint', 'v0.5.0-isolated-divergence'],
    ['isolationProtocolVersion', '1.0.0'],
    ['sanitizedReviewContextVersion', '1.0.0'],
    ['reviewAssignmentPolicyVersion', '1.0.0'],
    ['budgetCancellationContractVersion', '1.0.0'],
  ] as const) {
    if (parsed[field] !== expected)
      throw new Error(`P5_FIXTURE_MANIFEST_POLICY:${field}`);
  }
  if (parsed.workflowApplicationContractMajor !== 1)
    throw new Error('P5_FIXTURE_MANIFEST_WORKFLOW_MAJOR');
  if (!Array.isArray(parsed.cases))
    throw new Error('P5_FIXTURE_MANIFEST_CASES');
  const ids = parsed.cases.map((value) => {
    if (
      !isRecord(value) ||
      typeof value.id !== 'string' ||
      typeof value.gate !== 'string' ||
      typeof value.expected !== 'string'
    )
      throw new Error('P5_FIXTURE_MANIFEST_CASE_ID');
    return value.id;
  });
  if (new Set(ids).size !== ids.length)
    throw new Error('P5_FIXTURE_MANIFEST_DUPLICATE_CASE');
  const missing = REQUIRED_P5_CASES.filter((id) => !ids.includes(id));
  const extra = ids.filter(
    (id) => !(REQUIRED_P5_CASES as readonly string[]).includes(id),
  );
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `P5_FIXTURE_MANIFEST_DRIFT:missing=${missing.join(',')};extra=${extra.join(',')}`,
    );
  }
}

export async function verifyP5(
  repository: string,
  dependencies: P5VerifierDependencies = systemDependencies,
  gates: readonly P5GateSpec[] = P5_GATES,
): Promise<P5VerificationResult> {
  assertUniqueGateIds(gates);
  await verifyP5FixtureManifest(repository);
  const results: P5GateResult[] = [];
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
    const execution = await dependencies.run(gate.command, repository);
    results.push({
      ...gate,
      status: execution.exitCode === 0 ? 'passed' : 'failed',
      exitCode: execution.exitCode,
      ...(execution.diagnostic === undefined
        ? {}
        : { diagnostic: execution.diagnostic }),
    });
  }
  return {
    ok:
      results.length > 0 && results.every(({ status }) => status === 'passed'),
    verifier: 'mammoth-p5-acceptance-v1',
    fixtureManifest: P5_FIXTURE_MANIFEST,
    gates: results,
  };
}

function assertUniqueGateIds(gates: readonly P5GateSpec[]): void {
  const ids = new Set<string>();
  for (const gate of gates) {
    if (ids.has(gate.id))
      throw new Error(`P5_VERIFIER_DUPLICATE_GATE:${gate.id}`);
    ids.add(gate.id);
  }
}

const systemDependencies: P5VerifierDependencies = {
  exists: async (path) =>
    access(path, constants.R_OK)
      .then(() => true)
      .catch(() => false),
  validateTarget: async (target, absolutePath, repository) => {
    if (target.id === 'fixture-manifest') {
      const document: unknown = JSON.parse(
        await readFile(absolutePath, 'utf8'),
      );
      if (
        !isRecord(document) ||
        !isRecord(document.scripts) ||
        document.scripts.test !== 'vitest run'
      )
        return 'P5 acceptance package must expose a vitest test script';
    }
    if (target.id === 'postgres-p5-migration') {
      const source = await readFile(absolutePath, 'utf8');
      if (
        !source.includes('version: 6') ||
        !source.includes("name: 'p5_isolated_divergence'")
      )
        return 'production Postgres migration registry lacks P5 version 6';
      const testSource = await readFile(
        resolve(
          repository,
          'packages/postgres-adapter/test/research-cells.test.ts',
        ),
        'utf8',
      );
      if (!testSource.includes('p5_isolated_divergence'))
        return 'Postgres lifecycle tests do not cover the P5 migration';
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
        output += chunk;
      });
      child.stderr.on('data', (chunk) => {
        output += chunk;
      });
      child.on('error', (error) => {
        resolveRun({ exitCode: 127, diagnostic: error.message });
      });
      child.on('close', (code) => {
        resolveRun({
          exitCode: code ?? 1,
          ...(code === 0
            ? {}
            : {
                diagnostic: output.slice(-4000),
              }),
        });
      });
    }),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
