import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export type P4GateStatus = 'passed' | 'failed' | 'missing';

export interface P4GateSpec {
  readonly id: string;
  readonly description: string;
  readonly requiredPath: string;
  readonly command: readonly [string, ...string[]];
}

export interface P4GateResult extends P4GateSpec {
  readonly status: P4GateStatus;
  readonly exitCode?: number;
  readonly diagnostic?: string;
}

export interface P4VerificationResult {
  readonly ok: boolean;
  readonly verifier: 'mammoth-p4-acceptance-v1';
  readonly fixtureManifest: 'evals/fixtures/p4/adversarial-manifest.json';
  readonly gates: readonly P4GateResult[];
}

export interface P4VerifierDependencies {
  readonly exists: (path: string) => Promise<boolean>;
  readonly validateTarget: (
    target: P4GateSpec,
    absolutePath: string,
  ) => Promise<string | undefined>;
  readonly run: (
    command: readonly [string, ...string[]],
    cwd: string,
  ) => Promise<{ exitCode: number; diagnostic?: string }>;
}

export const P4_FIXTURE_MANIFEST =
  'evals/fixtures/p4/adversarial-manifest.json' as const;

export const REQUIRED_P4_CASES = [
  'unsupported-agreement-one',
  'unsupported-agreement-hundred',
  'alias-checkpoint-correlation',
  'unknown-lineage-independence',
  'same-profile-same-role-self-review',
  'shared-derivation-review',
  'valid-cross-family-review',
  'silent-criterion-edit',
  'explicit-criterion-branch',
  'missing-proposal-references',
  'cyclic-and-dangling-lineage',
  'rejected-position-audit-residue',
  'future-authority-and-digest-mismatch',
  'projection-restart-determinism',
] as const;

const REQUIRED_P4_OUTCOMES: Readonly<
  Record<(typeof REQUIRED_P4_CASES)[number], string>
> = {
  'unsupported-agreement-one': 'unsupported',
  'unsupported-agreement-hundred': 'unsupported',
  'alias-checkpoint-correlation': 'correlated_review',
  'unknown-lineage-independence': 'correlated_review',
  'same-profile-same-role-self-review': 'self_review',
  'shared-derivation-review': 'correlated_review',
  'valid-cross-family-review': 'admitted',
  'silent-criterion-edit': 'criterion_drift',
  'explicit-criterion-branch': 'admitted_on_branch',
  'missing-proposal-references': 'missing_references',
  'cyclic-and-dangling-lineage': 'lineage_rejected',
  'rejected-position-audit-residue': 'retained',
  'future-authority-and-digest-mismatch': 'projection_rejected',
  'projection-restart-determinism': 'deterministic',
};

export const P4_GATES: readonly P4GateSpec[] = [
  {
    id: 'fixture-manifest',
    description: 'Frozen adversarial fixture manifest and verifier invariants',
    requiredPath: 'evals/p4-acceptance/package.json',
    command: ['pnpm', '--filter', '@mammoth/p4-acceptance', 'test'],
  },
  {
    id: 'domain-policy',
    description:
      'Versioned research-cell contracts, model lineage, correlation, and admission policy',
    requiredPath: 'packages/domain/package.json',
    command: ['pnpm', '--filter', '@mammoth/domain', 'test'],
  },
  {
    id: 'persistence-contracts',
    description:
      'Authoritative persistence ports, canonical digests, and restart reconstruction',
    requiredPath: 'packages/persistence/package.json',
    command: ['pnpm', '--filter', '@mammoth/persistence', 'test'],
  },
  {
    id: 'postgres-repositories',
    description:
      'P4 migration, immutable rows, optimistic revision, fencing, integrity, and reconstruction',
    requiredPath: 'packages/postgres-adapter/package.json',
    command: ['pnpm', '--filter', '@mammoth/postgres-adapter', 'test'],
  },
  {
    id: 'native-postgres-restart',
    description:
      'Empty install, forward migration, readiness, forced restart, and durable reconstruction',
    requiredPath: 'packages/production-profile/package.json',
    command: ['pnpm', '--filter', '@mammoth/production-profile', 'verify:p4'],
  },
  {
    id: 'workflow-carriage',
    description:
      'Stable identifiers, bounded continue-as-new carry, and authoritative reconstruction ports',
    requiredPath: 'packages/workflow/package.json',
    command: ['pnpm', '--filter', '@mammoth/workflow', 'test'],
  },
  {
    id: 'observatory-projection',
    description:
      'Read-only P4 topology, fail-closed references, and deterministic projection digest',
    requiredPath: 'packages/observatory-projection/package.json',
    command: ['pnpm', '--filter', '@mammoth/observatory-projection', 'test'],
  },
  {
    id: 'operator-inspection',
    description: 'Read-only CLI inspection of the validated P4 projection',
    requiredPath: 'apps/cli/package.json',
    command: ['pnpm', '--filter', '@mammoth/cli', 'test'],
  },
] as const;

export async function verifyP4FixtureManifest(
  repository: string,
): Promise<void> {
  const path = resolve(repository, P4_FIXTURE_MANIFEST);
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (!isRecord(parsed) || parsed.schemaVersion !== 1) {
    throw new Error('P4_FIXTURE_MANIFEST_VERSION');
  }
  for (const field of [
    'contractVersion',
    'lineagePolicyVersion',
    'admissionPolicyVersion',
  ] as const) {
    if (parsed[field] !== '1.0.0') {
      throw new Error(`P4_FIXTURE_MANIFEST_POLICY:${field}`);
    }
  }
  if (!Array.isArray(parsed.cases))
    throw new Error('P4_FIXTURE_MANIFEST_CASES');
  const ids = parsed.cases.map((value) => {
    if (
      !isRecord(value) ||
      typeof value.id !== 'string' ||
      typeof value.expected !== 'string'
    ) {
      throw new Error('P4_FIXTURE_MANIFEST_CASE_ID');
    }
    if (
      (REQUIRED_P4_CASES as readonly string[]).includes(value.id) &&
      REQUIRED_P4_OUTCOMES[value.id as (typeof REQUIRED_P4_CASES)[number]] !==
        value.expected
    ) {
      throw new Error(`P4_FIXTURE_MANIFEST_OUTCOME:${value.id}`);
    }
    return value.id;
  });
  if (new Set(ids).size !== ids.length) {
    throw new Error('P4_FIXTURE_MANIFEST_DUPLICATE_CASE');
  }
  const missing = REQUIRED_P4_CASES.filter((id) => !ids.includes(id));
  const extra = ids.filter(
    (id) => !(REQUIRED_P4_CASES as readonly string[]).includes(id),
  );
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `P4_FIXTURE_MANIFEST_DRIFT:missing=${missing.join(',')};extra=${extra.join(',')}`,
    );
  }
}

export async function verifyP4(
  repository: string,
  dependencies: P4VerifierDependencies = systemDependencies,
  gates: readonly P4GateSpec[] = P4_GATES,
): Promise<P4VerificationResult> {
  assertUniqueGateIds(gates);
  await verifyP4FixtureManifest(repository);
  const results: P4GateResult[] = [];
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
    const invalid = await dependencies.validateTarget(gate, absolutePath);
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
    verifier: 'mammoth-p4-acceptance-v1',
    fixtureManifest: P4_FIXTURE_MANIFEST,
    gates: results,
  };
}

function assertUniqueGateIds(gates: readonly P4GateSpec[]): void {
  const ids = new Set<string>();
  for (const gate of gates) {
    if (ids.has(gate.id))
      throw new Error(`P4_VERIFIER_DUPLICATE_GATE:${gate.id}`);
    ids.add(gate.id);
  }
}

const systemDependencies: P4VerifierDependencies = {
  exists: async (path) =>
    access(path, constants.R_OK)
      .then(() => true)
      .catch(() => false),
  validateTarget: async (target, absolutePath) => {
    const document: unknown = JSON.parse(await readFile(absolutePath, 'utf8'));
    const script = target.command.at(-1);
    if (
      script === undefined ||
      !isRecord(document) ||
      !isRecord(document.scripts) ||
      typeof document.scripts[script] !== 'string'
    ) {
      return `required executable package script is absent: ${script ?? '<none>'}`;
    }
    return undefined;
  },
  run: (command, cwd) =>
    new Promise((settle) => {
      const [file, ...args] = command;
      const child = spawn(file, args, {
        cwd,
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let stderr = '';
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => (stderr += chunk));
      child.on('error', (error) => {
        settle({ exitCode: 127, diagnostic: error.message });
      });
      child.on('close', (code) => {
        settle({
          exitCode: code ?? 1,
          ...(code === 0 || stderr.trim() === ''
            ? {}
            : { diagnostic: stderr.trim().slice(-4_000) }),
        });
      });
    }),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
