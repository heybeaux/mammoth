import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export type P7GateStatus = 'passed' | 'failed' | 'missing';

export interface P7GateSpec {
  readonly id: string;
  readonly description: string;
  readonly requiredPath: string;
  readonly command: readonly [string, ...string[]];
}

export interface P7GateResult extends P7GateSpec {
  readonly status: P7GateStatus;
  readonly exitCode?: number;
  readonly diagnostic?: string;
  readonly caseIds: readonly string[];
}

export interface P7VerificationResult {
  readonly ok: boolean;
  readonly verifier: 'mammoth-p7-acceptance-v1';
  readonly fixtureManifest: typeof P7_FIXTURE_MANIFEST;
  readonly gates: readonly P7GateResult[];
}

export interface P7VerifierDependencies {
  readonly exists: (path: string) => Promise<boolean>;
  readonly run: (
    command: readonly [string, ...string[]],
    cwd: string,
  ) => Promise<{ readonly exitCode: number; readonly diagnostic?: string }>;
}

export const P7_FIXTURE_MANIFEST =
  'evals/fixtures/p7/adversarial/manifest.json' as const;

export const REQUIRED_P7_CASES = [
  'contract-manifest-drift',
  'provider-alias-or-checkpoint-drift',
  'provider-hostile-transport-and-egress',
  'provider-malformed-oversized-or-truncated-output',
  'prompt-tool-policy-or-schema-drift',
  'secret-in-prompt-or-egress',
  'unknown-provider-capability-or-profile',
  'duplicate-dispatch-at-durable-boundaries',
  'ambiguous-delivery-reconciliation',
  'usage-cost-budget-exhaustion',
  'cancellation-and-late-response-fencing',
  'migration-8-empty-upgrade-duplicate-interrupted',
  'postgres-cas-restart-reconstruction',
  'raw-cas-digest-corruption',
  'offline-cli-complete-dossier',
  'offline-cli-partial-dossier',
  'process-kill-status-resume-no-duplicate-effects',
  'temporal-worker-client-service-recovery',
  'temporal-history-excludes-provider-bytes',
  'unsupported-provider-claim-cannot-render',
  'evidence-bound-claim-provenance',
  'dissent-assumption-failure-cancellation-residue',
  'secret-bearing-dossier-fact',
  'projection-future-authority',
  'projection-broken-reference',
  'projection-raw-content-secret-leakage',
  'projection-write-attempt',
] as const;

export const P7_GATES: readonly P7GateSpec[] = [
  gate(
    'fixture-manifest',
    'Frozen P7 contract and adversarial manifest',
    'evals/p7-acceptance/test/verifier-smoke.ts',
    ['pnpm', '--filter', '@mammoth/p7-acceptance', 'test'],
  ),
  gate(
    'provider-conformance',
    'Provider conformance and hostile transport',
    'evals/fixtures/p7/provider/hostile-cases.json',
    [
      'pnpm',
      '--filter',
      '@mammoth/provider-port',
      '--filter',
      '@mammoth/openai-compatible-provider',
      'test',
    ],
  ),
  gate(
    'model-work-authority',
    'Model identity, capability, egress, and secret policy',
    'packages/p7-application-service/test/governed-cell-executor.test.ts',
    [
      'pnpm',
      '--filter',
      '@mammoth/domain',
      '--filter',
      '@mammoth/governance',
      '--filter',
      '@mammoth/p7-application-service',
      'test',
    ],
  ),
  gate(
    'activity-effects',
    'Activity idempotency, CAS, budget, and cancellation',
    'packages/persistence/test/p7-model-work.test.ts',
    [
      'pnpm',
      '--filter',
      '@mammoth/persistence',
      '--filter',
      '@mammoth/p7-application-service',
      'test',
    ],
  ),
  gate(
    'postgres-reconstruction',
    'Migration 8 and Postgres reconstruction',
    'packages/postgres-adapter/test/p7-model-work.test.ts',
    ['pnpm', '--filter', '@mammoth/postgres-adapter', 'test'],
  ),
  gate(
    'offline-cli-dossier',
    'Offline CLI complete, partial, kill, and resume paths',
    'apps/cli/test/p7-local-blackbox.test.ts',
    ['pnpm', '--filter', '@mammoth/cli', 'test', '--', 'p7'],
  ),
  gate(
    'temporal-provider-recovery',
    'Live local-Temporal provider recovery and replay',
    'packages/temporal-adapter/test/p7-governed-live-workflow.test.ts',
    ['pnpm', '--filter', '@mammoth/temporal-adapter', 'test:p7-live'],
  ),
  gate(
    'dossier-provenance',
    'Dossier provenance and unsupported-claim rejection',
    'packages/report-compiler/test/p7-dossier.test.ts',
    ['pnpm', '--filter', '@mammoth/report-compiler', 'test'],
  ),
  gate(
    'readonly-projection',
    'Read-only projection integrity and leakage',
    'packages/observatory-projection/test/p7-live-research.test.ts',
    ['pnpm', '--filter', '@mammoth/observatory-projection', 'test'],
  ),
];

const CASE_GATES: Readonly<Record<string, readonly string[]>> = {
  'fixture-manifest': REQUIRED_P7_CASES.slice(0, 1),
  'provider-conformance': REQUIRED_P7_CASES.slice(1, 4),
  'model-work-authority': REQUIRED_P7_CASES.slice(4, 7),
  'activity-effects': REQUIRED_P7_CASES.slice(7, 11),
  'postgres-reconstruction': REQUIRED_P7_CASES.slice(11, 14),
  'offline-cli-dossier': REQUIRED_P7_CASES.slice(14, 17),
  'temporal-provider-recovery': REQUIRED_P7_CASES.slice(17, 19),
  'dossier-provenance': REQUIRED_P7_CASES.slice(19, 23),
  'readonly-projection': REQUIRED_P7_CASES.slice(23),
};

export async function verifyP7FixtureManifest(
  repository: string,
): Promise<void> {
  const parsed: unknown = JSON.parse(
    await readFile(resolve(repository, P7_FIXTURE_MANIFEST), 'utf8'),
  );
  if (!isRecord(parsed) || parsed.schemaVersion !== 1)
    throw new Error('P7_FIXTURE_MANIFEST_VERSION');
  for (const [field, expected] of [
    ['checkpoint', 'v0.7.0-live-research-loop'],
    ['modelWorkRequestVersion', '1.0.0'],
    ['modelWorkResultVersion', '1.0.0'],
    ['providerErrorVersion', '1.0.0'],
    ['modelWorkPolicyVersion', '1.0.0'],
    ['capabilityManifestVersion', '1.0.0'],
    ['dossierContractVersion', '1.0.0'],
    ['projectionExtensionVersion', '1.0.0'],
  ] as const) {
    if (parsed[field] !== expected)
      throw new Error(`P7_FIXTURE_MANIFEST_POLICY:${field}`);
  }
  if (parsed.applicationContractMajor !== 1 || parsed.workflowVersion !== 1)
    throw new Error('P7_FIXTURE_MANIFEST_AUTHORITY_VERSION');
  if (!Array.isArray(parsed.cases))
    throw new Error('P7_FIXTURE_MANIFEST_CASES');
  const ids = parsed.cases.map((value) => {
    if (
      !isRecord(value) ||
      typeof value.id !== 'string' ||
      typeof value.gate !== 'string' ||
      typeof value.expected !== 'string'
    )
      throw new Error('P7_FIXTURE_MANIFEST_CASE_SHAPE');
    return value.id;
  });
  if (new Set(ids).size !== ids.length)
    throw new Error('P7_FIXTURE_MANIFEST_DUPLICATE_CASE');
  const missing = REQUIRED_P7_CASES.filter((id) => !ids.includes(id));
  const extra = ids.filter(
    (id) => !(REQUIRED_P7_CASES as readonly string[]).includes(id),
  );
  if (missing.length > 0 || extra.length > 0)
    throw new Error(
      `P7_FIXTURE_MANIFEST_DRIFT:missing=${missing.join(',')};extra=${extra.join(',')}`,
    );
  const gateIds = new Set(P7_GATES.map(({ id }) => id));
  for (const value of parsed.cases) {
    const manifestCase = value as { id: string; gate: string };
    const manifestGate = manifestCase.gate;
    if (!gateIds.has(manifestGate))
      throw new Error(`P7_FIXTURE_UNKNOWN_GATE:${manifestGate}`);
    if (!caseIdsForGate(manifestGate).includes(manifestCase.id))
      throw new Error(`P7_FIXTURE_CASE_GATE_DRIFT:${manifestCase.id}`);
  }
}

export async function verifyP7(
  repository: string,
  dependencies: P7VerifierDependencies = systemDependencies,
  gates: readonly P7GateSpec[] = P7_GATES,
): Promise<P7VerificationResult> {
  assertUniqueGateIds(gates);
  assertCaseGates(gates);
  await verifyP7FixtureManifest(repository);
  const results: P7GateResult[] = [];
  for (const target of gates) {
    if (
      !(await dependencies.exists(resolve(repository, target.requiredPath)))
    ) {
      results.push({
        ...target,
        status: 'missing',
        diagnostic: `required acceptance target is absent: ${target.requiredPath}`,
        caseIds: caseIdsForGate(target.id),
      });
      continue;
    }
    const execution = await dependencies.run(target.command, repository);
    results.push({
      ...target,
      status: execution.exitCode === 0 ? 'passed' : 'failed',
      exitCode: execution.exitCode,
      caseIds: caseIdsForGate(target.id),
      ...(execution.diagnostic === undefined
        ? {}
        : { diagnostic: execution.diagnostic }),
    });
  }
  return {
    ok:
      results.length === P7_GATES.length &&
      results.every(({ status }) => status === 'passed'),
    verifier: 'mammoth-p7-acceptance-v1',
    fixtureManifest: P7_FIXTURE_MANIFEST,
    gates: results,
  };
}

function gate(
  id: string,
  description: string,
  requiredPath: string,
  command: readonly [string, ...string[]],
): P7GateSpec {
  return { id, description, requiredPath, command };
}

function assertUniqueGateIds(gates: readonly P7GateSpec[]): void {
  const ids = new Set<string>();
  for (const target of gates) {
    if (ids.has(target.id))
      throw new Error(`P7_VERIFIER_DUPLICATE_GATE:${target.id}`);
    ids.add(target.id);
  }
}

function assertCaseGates(gates: readonly P7GateSpec[]): void {
  const ids = new Set(gates.map(({ id }) => id));
  const missing = P7_GATES.map(({ id }) => id).filter((id) => !ids.has(id));
  if (missing.length > 0)
    throw new Error(`P7_VERIFIER_CASE_GATE_MISSING:${missing.join(',')}`);
}

function caseIdsForGate(gateId: string): string[] {
  return [...(CASE_GATES[gateId] ?? [])].sort();
}

const systemDependencies: P7VerifierDependencies = {
  exists: async (path) =>
    access(path, constants.R_OK)
      .then(() => true)
      .catch(() => false),
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
