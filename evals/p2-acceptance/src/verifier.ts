import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

export type GateStatus = 'passed' | 'failed' | 'missing';

export interface GateSpec {
  readonly id: string;
  readonly description: string;
  readonly defaultTarget?: GateTarget;
}

export interface GateTarget {
  readonly requiredPath: string;
  readonly command: readonly [string, ...string[]];
}

export interface GateResult {
  readonly id: string;
  readonly status: GateStatus;
  readonly description: string;
  readonly requiredPath: string;
  readonly command: readonly string[];
  readonly exitCode?: number;
  readonly diagnostic?: string;
}

export interface VerificationResult {
  readonly ok: boolean;
  readonly verifier: 'mammoth-p2-acceptance-v1';
  readonly gates: readonly GateResult[];
}

export interface VerifierDependencies {
  readonly exists: (absolutePath: string) => Promise<boolean>;
  readonly validateTarget: (
    target: GateTarget,
    absolutePath: string,
  ) => Promise<string | undefined>;
  readonly resolveTarget: (
    gate: GateSpec,
    repository: string,
  ) => Promise<GateTarget | undefined>;
  readonly run: (
    command: readonly [string, ...string[]],
    cwd: string,
  ) => Promise<{ exitCode: number; diagnostic?: string }>;
}

/**
 * Static gate definitions are intentionally code-owned. The verifier never trusts
 * a receipt or adapter-supplied `passed: true` field as acceptance evidence.
 */
export const P2_GATES: readonly GateSpec[] = [
  {
    id: 'p1-adapter-contract-freeze',
    description: 'Frozen major-v1 adapter contracts and local conformance',
    defaultTarget: {
      requiredPath: 'packages/adapter-contracts/package.json',
      command: ['pnpm', '--filter', '@mammoth/adapter-contracts', 'test'],
    },
  },
  {
    id: 'd1-postgres-migrations',
    description:
      'Empty, upgrade, interruption, checksum-drift, and restart migrations',
    defaultTarget: {
      requiredPath: 'packages/postgres-adapter/package.json',
      command: [
        'pnpm',
        '--filter',
        '@mammoth/postgres-adapter',
        'test:migrations',
      ],
    },
  },
  {
    id: 'd2-transactional-ledger',
    description:
      'Concurrent revisions, rollback, references, and atomic audit/outbox',
    defaultTarget: {
      requiredPath: 'packages/postgres-adapter/package.json',
      command: ['pnpm', '--filter', '@mammoth/postgres-adapter', 'test:ledger'],
    },
  },
  {
    id: 'd3-content-addressed-artifacts',
    description:
      'Dedupe, tamper/collision rejection, truncation, and orphan reconciliation',
  },
  {
    id: 'd4-work-effects-outbox',
    description:
      'Fencing, crash windows, duplicate delivery, cancellation, and poison rows',
    defaultTarget: {
      requiredPath: 'packages/postgres-adapter/package.json',
      command: [
        'pnpm',
        '--filter',
        '@mammoth/postgres-adapter',
        'test:work-effects',
      ],
    },
  },
  {
    id: 'd5-service-lifecycle',
    description:
      'Unready startup, forced restart, bounded shutdown, and persistence',
  },
  {
    id: 'd5-backup-restore',
    description:
      'Restore followed by ledger, audit, receipt, and artifact integrity checks',
  },
  {
    id: 'd6-observatory-projection',
    description:
      'Deterministic complete read-only projection, digest, and provenance',
  },
] as const;

export async function verifyP2(
  repository: string,
  dependencies: VerifierDependencies = systemDependencies,
  gates: readonly GateSpec[] = P2_GATES,
): Promise<VerificationResult> {
  assertUniqueGateIds(gates);
  const results: GateResult[] = [];
  for (const gate of gates) {
    const target = await dependencies.resolveTarget(gate, repository);
    if (target === undefined) {
      results.push({
        id: gate.id,
        status: 'missing',
        description: gate.description,
        requiredPath: '<unregistered>',
        command: [],
        diagnostic: `no executable capability registered for gate: ${gate.id}`,
      });
      continue;
    }
    const absolutePath = resolve(repository, target.requiredPath);
    if (!(await dependencies.exists(absolutePath))) {
      results.push({
        id: gate.id,
        status: 'missing',
        description: gate.description,
        requiredPath: target.requiredPath,
        command: target.command,
        diagnostic: `required adapter or harness is absent: ${target.requiredPath}`,
      });
      continue;
    }
    const invalid = await dependencies.validateTarget(target, absolutePath);
    if (invalid !== undefined) {
      results.push({
        id: gate.id,
        status: 'missing',
        description: gate.description,
        requiredPath: target.requiredPath,
        command: target.command,
        diagnostic: invalid,
      });
      continue;
    }
    const execution = await dependencies.run(target.command, repository);
    results.push({
      id: gate.id,
      status: execution.exitCode === 0 ? 'passed' : 'failed',
      description: gate.description,
      requiredPath: target.requiredPath,
      command: target.command,
      exitCode: execution.exitCode,
      ...(execution.diagnostic === undefined
        ? {}
        : { diagnostic: execution.diagnostic }),
    });
  }
  return {
    ok:
      results.length > 0 && results.every(({ status }) => status === 'passed'),
    verifier: 'mammoth-p2-acceptance-v1',
    gates: results,
  };
}

function assertUniqueGateIds(gates: readonly GateSpec[]): void {
  const ids = new Set<string>();
  for (const gate of gates) {
    if (ids.has(gate.id)) {
      throw new Error(`P2_VERIFIER_DUPLICATE_GATE:${gate.id}`);
    }
    ids.add(gate.id);
  }
}

const systemDependencies: VerifierDependencies = {
  exists: async (path) =>
    access(path, constants.R_OK)
      .then(() => true)
      .catch(() => false),
  validateTarget: async (target, absolutePath) => {
    if (!absolutePath.endsWith('package.json')) return undefined;
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
  resolveTarget: async (gate, repository) => {
    if (gate.defaultTarget !== undefined) return gate.defaultTarget;
    const path = resolve(repository, 'evals/p2-acceptance/capabilities.json');
    const document = await readFile(path, 'utf8').catch(() => undefined);
    if (document === undefined) return undefined;
    const parsed: unknown = JSON.parse(document);
    if (!isRecord(parsed) || !isRecord(parsed.gates)) return undefined;
    const candidate = parsed.gates[gate.id];
    if (!isRecord(candidate) || typeof candidate.requiredPath !== 'string')
      return undefined;
    if (!Array.isArray(candidate.command) || candidate.command.length === 0)
      return undefined;
    if (
      !candidate.command.every(
        (part) => typeof part === 'string' && part.length > 0,
      )
    )
      return undefined;
    if (candidate.command[0] !== 'pnpm') {
      throw new Error(`P2_VERIFIER_UNSAFE_COMMAND:${gate.id}`);
    }
    return {
      requiredPath: candidate.requiredPath,
      command: candidate.command as [string, ...string[]],
    };
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
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
      });
      child.on('error', (error) => {
        settle({ exitCode: 127, diagnostic: error.message });
      });
      child.on('close', (code) => {
        settle({
          exitCode: code ?? 1,
          ...(stderr.trim() === ''
            ? {}
            : { diagnostic: stderr.trim().slice(-4000) }),
        });
      });
    }),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
