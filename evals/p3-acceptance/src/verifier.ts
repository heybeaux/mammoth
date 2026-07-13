import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export type P3GateStatus = 'passed' | 'failed' | 'missing';

export interface P3GateTarget {
  readonly requiredPath: string;
  readonly command: readonly [string, ...string[]];
}

export interface P3GateSpec extends P3GateTarget {
  readonly id: string;
  readonly description: string;
}

export interface P3GateResult {
  readonly id: string;
  readonly status: P3GateStatus;
  readonly description: string;
  readonly requiredPath: string;
  readonly command: readonly string[];
  readonly exitCode?: number;
  readonly diagnostic?: string;
}

export interface P3VerificationResult {
  readonly ok: boolean;
  readonly verifier: 'mammoth-p3-acceptance-v1';
  readonly gates: readonly P3GateResult[];
}

export interface P3VerifierDependencies {
  readonly exists: (path: string) => Promise<boolean>;
  readonly validateTarget: (
    target: P3GateTarget,
    absolutePath: string,
  ) => Promise<string | undefined>;
  readonly run: (
    command: readonly [string, ...string[]],
    cwd: string,
  ) => Promise<{ exitCode: number; diagnostic?: string }>;
}

export const P3_GATES: readonly P3GateSpec[] = [
  {
    id: 'adapter-startup',
    description:
      'Fail-closed Temporal config, service lifecycle, health, and readiness',
    requiredPath: 'packages/temporal-adapter/package.json',
    command: ['pnpm', '--filter', '@mammoth/temporal-adapter', 'test'],
  },
  {
    id: 'live-sdk-control-plane',
    description:
      'Real SDK signals, queries, timers, retries, cancellation, continue-as-new, history, and replay',
    requiredPath: 'packages/temporal-adapter/package.json',
    command: ['pnpm', '--filter', '@mammoth/temporal-adapter', 'test:live'],
  },
  {
    id: 'process-and-service-recovery',
    description:
      'Workflow/Activity/client process kills, stale signals, duplicate-effect prevention, and persistent service restart',
    requiredPath: 'packages/temporal-adapter/package.json',
    command: ['pnpm', '--filter', '@mammoth/temporal-adapter', 'test:recovery'],
  },
  {
    id: 'temporal-observatory-linkage',
    description:
      'Deterministic read-only Temporal timeline, metrics, authority linkage, and projection digest',
    requiredPath: 'packages/observatory-projection/package.json',
    command: ['pnpm', '--filter', '@mammoth/observatory-projection', 'test'],
  },
] as const;

export async function verifyP3(
  repository: string,
  dependencies: P3VerifierDependencies = systemDependencies,
  gates: readonly P3GateSpec[] = P3_GATES,
): Promise<P3VerificationResult> {
  assertUniqueGateIds(gates);
  const results: P3GateResult[] = [];
  for (const gate of gates) {
    const absolutePath = resolve(repository, gate.requiredPath);
    if (!(await dependencies.exists(absolutePath))) {
      results.push({
        id: gate.id,
        status: 'missing',
        description: gate.description,
        requiredPath: gate.requiredPath,
        command: gate.command,
        diagnostic: `required acceptance target is absent: ${gate.requiredPath}`,
      });
      continue;
    }
    const invalid = await dependencies.validateTarget(gate, absolutePath);
    if (invalid !== undefined) {
      results.push({
        id: gate.id,
        status: 'missing',
        description: gate.description,
        requiredPath: gate.requiredPath,
        command: gate.command,
        diagnostic: invalid,
      });
      continue;
    }
    const execution = await dependencies.run(gate.command, repository);
    results.push({
      id: gate.id,
      status: execution.exitCode === 0 ? 'passed' : 'failed',
      description: gate.description,
      requiredPath: gate.requiredPath,
      command: gate.command,
      exitCode: execution.exitCode,
      ...(execution.diagnostic === undefined
        ? {}
        : { diagnostic: execution.diagnostic }),
    });
  }
  return {
    ok:
      results.length > 0 && results.every(({ status }) => status === 'passed'),
    verifier: 'mammoth-p3-acceptance-v1',
    gates: results,
  };
}

function assertUniqueGateIds(gates: readonly P3GateSpec[]): void {
  const ids = new Set<string>();
  for (const gate of gates) {
    if (ids.has(gate.id))
      throw new Error(`P3_VERIFIER_DUPLICATE_GATE:${gate.id}`);
    ids.add(gate.id);
  }
}

const systemDependencies: P3VerifierDependencies = {
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
