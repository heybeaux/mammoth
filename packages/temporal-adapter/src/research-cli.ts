#!/usr/bin/env node
import type { ResearchProgramStageId } from '@mammoth/workflow';
import { loadTemporalAdapterConfig } from './config.js';
import { connectTemporalResearchProgramClient } from './research-client.js';

interface ParsedCommand {
  readonly command:
    | 'run'
    | 'status'
    | 'inspect'
    | 'pause'
    | 'resume'
    | 'cancel'
    | 'approve'
    | 'reject';
  readonly identity: {
    readonly programId: string;
    readonly criterionVersion: string;
    readonly branchId: string;
  };
  readonly gateId?: string;
  readonly beforeStage?: ResearchProgramStageId;
  readonly timeoutMs?: number;
  readonly reason?: string;
  readonly receiptId?: string;
  readonly signalId: string;
}

const STAGES = new Set<ResearchProgramStageId>([
  'commit-budget',
  'snapshot-source',
  'assess-claims',
  'persist-ledger',
  'compile-report',
  'commit-receipt',
]);

export async function executeTemporalResearchCli(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<unknown> {
  const parsed = parseTemporalResearchArgs(argv);
  const connected = await connectTemporalResearchProgramClient(
    loadTemporalAdapterConfig(env),
  );
  try {
    const operator = connected.operator;
    switch (parsed.command) {
      case 'run':
        return {
          command: parsed.command,
          ...(await operator.run({
            identity: parsed.identity,
            workflowVersion: 1,
            ...(parsed.gateId === undefined
              ? {}
              : {
                  humanGate: {
                    gateId: parsed.gateId,
                    beforeStage: present(parsed.beforeStage, '--before-stage'),
                    timeoutMs: present(parsed.timeoutMs, '--timeout-ms'),
                  },
                }),
          })),
        };
      case 'status':
      case 'inspect':
        return {
          command: parsed.command,
          ...(await operator[parsed.command](parsed.identity)),
        };
      case 'pause':
      case 'resume':
        await operator[parsed.command](parsed.identity, parsed.signalId);
        return {
          command: parsed.command,
          ...(await operator.status(parsed.identity)),
        };
      case 'cancel':
        await operator.cancel(parsed.identity, parsed.signalId, parsed.reason);
        return {
          command: parsed.command,
          ...(await operator.status(parsed.identity)),
        };
      case 'approve':
      case 'reject':
        await operator.decideHumanGate(parsed.identity, {
          signalId: parsed.signalId,
          gateId: present(parsed.gateId, '--gate-id'),
          decision: parsed.command === 'approve' ? 'approve' : 'reject',
          receiptId: present(parsed.receiptId, '--receipt-id'),
        });
        return {
          command: parsed.command,
          ...(await operator.status(parsed.identity)),
        };
    }
  } finally {
    await connected.close();
  }
}

export function parseTemporalResearchArgs(
  argv: readonly string[],
): ParsedCommand {
  const [rawCommand, programId, ...tail] = argv;
  if (!isCommand(rawCommand) || !validIdentifier(programId))
    throw new Error(usage());
  const values = new Map<string, string>();
  for (let index = 0; index < tail.length; index += 2) {
    const flag = tail[index];
    const value = tail[index + 1];
    if (
      !flag?.startsWith('--') ||
      value === undefined ||
      value.startsWith('--')
    ) {
      throw new Error(usage());
    }
    if (values.has(flag)) throw new Error(`duplicate option: ${flag}`);
    values.set(flag, value);
  }
  const allowed = new Set([
    '--criterion-version',
    '--branch',
    '--signal-id',
    '--reason',
    '--gate-id',
    '--before-stage',
    '--timeout-ms',
    '--receipt-id',
  ]);
  for (const flag of values.keys()) {
    if (!allowed.has(flag)) throw new Error(`unknown option: ${flag}`);
  }
  const criterionVersion = values.get('--criterion-version') ?? 'criterion-v1';
  const branchId = values.get('--branch') ?? 'main';
  if (!validIdentifier(criterionVersion) || !validIdentifier(branchId)) {
    throw new Error(
      'criterion version and branch must be non-empty identifiers',
    );
  }
  const signalId =
    values.get('--signal-id') ??
    `operator:${rawCommand}:${programId}:${criterionVersion}:${branchId}`;
  const common = {
    command: rawCommand,
    identity: { programId, criterionVersion, branchId },
    signalId,
  } as const;
  if (rawCommand === 'run' && values.has('--gate-id')) {
    const gateId = required(values, '--gate-id');
    const beforeStage = required(
      values,
      '--before-stage',
    ) as ResearchProgramStageId;
    const timeoutMs = Number(required(values, '--timeout-ms'));
    if (!validIdentifier(gateId) || !STAGES.has(beforeStage)) {
      throw new Error('invalid human gate identifier or stage');
    }
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      throw new Error('--timeout-ms must be a positive integer');
    }
    return { ...common, gateId, beforeStage, timeoutMs };
  }
  if (rawCommand === 'approve' || rawCommand === 'reject') {
    return {
      ...common,
      gateId: required(values, '--gate-id'),
      receiptId: required(values, '--receipt-id'),
    };
  }
  if (rawCommand === 'cancel') {
    return {
      ...common,
      ...(values.has('--reason')
        ? { reason: required(values, '--reason') }
        : {}),
    };
  }
  return common;
}

function isCommand(
  value: string | undefined,
): value is ParsedCommand['command'] {
  return [
    'run',
    'status',
    'inspect',
    'pause',
    'resume',
    'cancel',
    'approve',
    'reject',
  ].includes(value ?? '');
}

function validIdentifier(value: string | undefined): value is string {
  return (
    value !== undefined && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value)
  );
}

function required(values: ReadonlyMap<string, string>, flag: string): string {
  const value = values.get(flag);
  if (value === undefined) throw new Error(`${flag} is required`);
  return value;
}

function present<Value>(value: Value | undefined, flag: string): Value {
  if (value === undefined) throw new Error(`${flag} is required`);
  return value;
}

function usage(): string {
  return 'usage: mammoth-temporal-research <run|status|inspect|pause|resume|cancel|approve|reject> <program-id> [options]';
}

if (
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
) {
  executeTemporalResearchCli(process.argv.slice(2))
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error: unknown) => {
      process.stderr.write(
        `${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n`,
      );
      process.exitCode = 1;
    });
}
