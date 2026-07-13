import { readFile } from 'node:fs/promises';
import type { ProgramBranchIdentity } from '@mammoth/workflow';
import {
  connectTemporalResearchProgramClient,
  type TemporalResearchProgramClient,
} from '@mammoth/temporal-adapter/research-client';
import { loadTemporalAdapterConfig } from '@mammoth/temporal-adapter/config';
import { inspectObservatoryProjection } from './operator.js';
import { assertProgramId, parseArgs } from './parser.js';
import { CliError, type CliIo } from './types.js';

export type TemporalOperatorPort = Pick<
  TemporalResearchProgramClient,
  'run' | 'status' | 'inspect' | 'resume' | 'cancel'
>;

export interface TemporalCliDependencies {
  readonly io: CliIo;
  readonly operator: TemporalOperatorPort;
  cwd(): string;
  identity(programId: string): ProgramBranchIdentity;
}

export async function executeTemporalCli(
  argv: readonly string[],
  dependencies: TemporalCliDependencies,
): Promise<number> {
  try {
    const command = parseArgs(argv, dependencies.cwd());
    if (command.maxSteps !== undefined) {
      throw new CliError(
        'USAGE',
        'Temporal execution does not support --max-steps',
      );
    }
    let output: unknown;
    if (command.name === 'projection-inspect') {
      output = await inspectObservatoryProjection(command.projectionPath);
    } else if (command.name === 'run') {
      const programId = await readProgramId(command.charterPath);
      const identity = dependencies.identity(programId);
      output = {
        command: 'run',
        ...(await dependencies.operator.run({
          identity,
          workflowVersion: 1,
        })),
        identity,
      };
    } else {
      const identity = dependencies.identity(command.programId);
      if (command.name === 'status') {
        output = {
          command: 'status',
          ...(await dependencies.operator.status(identity)),
        };
      } else if (command.name === 'inspect') {
        output = {
          command: 'inspect',
          ...(await dependencies.operator.inspect(identity)),
        };
      } else if (command.name === 'resume') {
        await dependencies.operator.resume(
          identity,
          operatorSignalId('resume', identity),
        );
        output = {
          command: 'resume',
          ...(await dependencies.operator.status(identity)),
        };
      } else {
        await dependencies.operator.cancel(
          identity,
          operatorSignalId('cancel', identity),
          'operator request',
        );
        output = {
          command: 'cancel',
          ...(await dependencies.operator.status(identity)),
        };
      }
    }
    dependencies.io.stdout(
      command.json ? JSON.stringify(output) : JSON.stringify(output, null, 2),
    );
    return 0;
  } catch (error: unknown) {
    dependencies.io.stderr(
      JSON.stringify({
        error:
          error instanceof CliError ? error.code : 'TEMPORAL_COMMAND_FAILED',
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return error instanceof CliError ? 2 : 5;
  }
}

export async function executeNodeTemporalCli(
  argv: readonly string[],
  io: CliIo,
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const connection = await connectTemporalResearchProgramClient(
    loadTemporalAdapterConfig(env),
  );
  try {
    return await executeTemporalCli(argv, {
      io,
      operator: connection.operator,
      cwd: () => process.cwd(),
      identity: (programId) => ({
        programId,
        criterionVersion: env.MAMMOTH_CRITERION_VERSION ?? 'criterion-v1',
        branchId: env.MAMMOTH_BRANCH_ID ?? 'main',
      }),
    });
  } finally {
    await connection.close();
  }
}

async function readProgramId(path: string): Promise<string> {
  try {
    const bytes = await readFile(path);
    if (bytes.byteLength > 1024 * 1024) {
      throw new CliError('INVALID_CHARTER', 'charter exceeds 1 MiB');
    }
    const input: unknown = JSON.parse(bytes.toString('utf8'));
    if (
      !isRecord(input) ||
      !isRecord(input.charter) ||
      typeof input.charter.programId !== 'string'
    ) {
      throw new CliError('INVALID_CHARTER', 'charter programId is required');
    }
    assertProgramId(input.charter.programId);
    return input.charter.programId;
  } catch (error: unknown) {
    if (error instanceof CliError) throw error;
    throw new CliError(
      'INVALID_CHARTER',
      `cannot read charter: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function operatorSignalId(
  operation: 'resume' | 'cancel',
  identity: ProgramBranchIdentity,
): string {
  return `operator:${operation}:${identity.programId}:${identity.criterionVersion}:${identity.branchId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
