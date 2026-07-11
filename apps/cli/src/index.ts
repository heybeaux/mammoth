import { lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import {
  cancelResearchProgram,
  getResearchProgramStatus,
  inspectResearchProgram,
  resumeResearchProgram,
  runResearchProgram,
  RuntimeExecutionError,
  type RuntimeCharter,
  type RuntimeOptions,
} from '@mammoth/runtime';

const PROGRAM_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const OPERATOR_CHARTER = 'operator-charter.json';

export const ExitCode = {
  success: 0,
  input: 2,
  notFound: 3,
  conflict: 4,
  execution: 5,
} as const;

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  cwd: string;
  environment: Readonly<Record<string, string | undefined>>;
}

interface ParsedArguments {
  command: string | undefined;
  operand: string | undefined;
  rootDirectory: string;
  json: boolean;
}

interface OperatorCharter extends RuntimeCharter {
  sourcePath?: string;
}

interface CliSuccess {
  schemaVersion: '1.0.0';
  ok: true;
  command: string;
  programId: string;
  status: string;
  result: unknown;
}

interface CliFailure {
  schemaVersion: '1.0.0';
  ok: false;
  error: { code: string; message: string };
}

const defaultIo = (): CliIo => ({
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  cwd: process.cwd(),
  environment: process.env,
});

/** Execute one CLI invocation. Exported so embedding shells can preserve exit semantics. */
export async function runCli(
  argv: readonly string[],
  io: CliIo = defaultIo(),
): Promise<number> {
  let parsed: ParsedArguments;
  try {
    parsed = parseArguments(argv, io);
  } catch (error: unknown) {
    return fail(io, false, ExitCode.input, 'USAGE', messageOf(error));
  }
  const { command, operand, rootDirectory, json } = parsed;
  if (!command || command === 'help') {
    io.stdout(`${usage()}\n`);
    return ExitCode.success;
  }
  if (!operand)
    return fail(
      io,
      json,
      ExitCode.input,
      'USAGE',
      `${command} requires an operand`,
    );

  try {
    if (command === 'run') {
      const charterPath = resolve(io.cwd, operand);
      const charter = await readOperatorCharter(charterPath);
      requireProgramId(charter.programId);
      await persistOperatorCharter(rootDirectory, charter);
      const result = await runResearchProgram({
        rootDirectory,
        charter,
        transport: transportFor(charter),
        ...(charter.sourcePath ? { resolveHost: documentationResolver } : {}),
      });
      success(io, json, command, charter.programId, result);
      return ExitCode.success;
    }

    requireProgramId(operand);
    const programId = operand;
    await assertProgramDirectorySafe(rootDirectory, programId);
    if (command === 'status') {
      const result = await getResearchProgramStatus({
        rootDirectory,
        programId,
      });
      success(io, json, command, programId, result);
      return ExitCode.success;
    }
    if (command === 'inspect') {
      const result = await inspectResearchProgram({ rootDirectory, programId });
      success(io, json, command, programId, result);
      return ExitCode.success;
    }
    if (command === 'resume') {
      const charter = await readPersistedOperatorCharter(
        rootDirectory,
        programId,
      );
      const result = await resumeResearchProgram({
        rootDirectory,
        programId,
        transport: transportFor(charter),
        ...(charter.sourcePath ? { resolveHost: documentationResolver } : {}),
      });
      success(io, json, command, programId, result);
      return ExitCode.success;
    }
    if (command === 'cancel') {
      const result = await cancelResearchProgram({ rootDirectory, programId });
      success(io, json, command, programId, result);
      return ExitCode.success;
    }
    return fail(
      io,
      json,
      ExitCode.input,
      'UNKNOWN_COMMAND',
      `unknown command: ${command}`,
    );
  } catch (error: unknown) {
    const classified = classifyError(error);
    return fail(
      io,
      json,
      classified.exitCode,
      classified.code,
      classified.message,
    );
  }
}

function parseArguments(argv: readonly string[], io: CliIo): ParsedArguments {
  let root = io.environment.MAMMOTH_HOME ?? join(io.cwd, '.mammoth');
  let json = false;
  const positional: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') {
      json = true;
    } else if (argument === '--root') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--'))
        throw new Error('--root requires a directory');
      root = value;
      index += 1;
    } else if (argument?.startsWith('--root=')) {
      root = argument.slice('--root='.length);
      if (!root) throw new Error('--root requires a directory');
    } else if (argument?.startsWith('-')) {
      throw new Error(`unknown option: ${argument}`);
    } else if (argument !== undefined) {
      positional.push(argument);
    }
  }
  if (positional.length > 2) throw new Error('too many positional arguments');
  return {
    command: positional[0],
    operand: positional[1],
    rootDirectory: resolve(io.cwd, root),
    json,
  };
}

async function readOperatorCharter(path: string): Promise<OperatorCharter> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, 'utf8'));
  } catch (error: unknown) {
    throw new CliInputError(
      'CHARTER_READ_FAILED',
      `${path}: ${messageOf(error)}`,
    );
  }
  if (!isRecord(value))
    throw new CliInputError('INVALID_CHARTER', 'charter must be a JSON object');
  const proposals = value.proposals;
  const required = [
    'programId',
    'criterionId',
    'title',
    'question',
    'sourceUrl',
    'evidencePolicyId',
    'evidencePolicyVersion',
  ] as const;
  for (const field of required) {
    if (typeof value[field] !== 'string' || value[field].trim() === '')
      throw new CliInputError(
        'INVALID_CHARTER',
        `charter.${field} must be a non-empty string`,
      );
  }
  if (!Array.isArray(proposals) || proposals.length === 0)
    throw new CliInputError(
      'INVALID_CHARTER',
      'charter.proposals must be a non-empty array',
    );
  if (value.sourcePath !== undefined && typeof value.sourcePath !== 'string')
    throw new CliInputError(
      'INVALID_CHARTER',
      'charter.sourcePath must be a string',
    );
  const charter = value as unknown as OperatorCharter;
  return {
    ...charter,
    ...(charter.sourcePath
      ? { sourcePath: resolve(dirname(path), charter.sourcePath) }
      : {}),
  };
}

async function persistOperatorCharter(
  root: string,
  charter: OperatorCharter,
): Promise<void> {
  const directory = programDirectory(root, charter.programId);
  await mkdir(resolve(root), { recursive: true });
  await rejectSymlink(resolve(root), 'Mammoth home');
  await mkdir(directory).catch((error: unknown) => {
    if (!isErrorCode(error, 'EEXIST')) throw error;
  });
  await rejectSymlink(directory, 'program directory');
  const operatorPath = join(directory, OPERATOR_CHARTER);
  if (await pathExists(operatorPath))
    await rejectSymlink(operatorPath, 'operator charter');
  await writeFile(operatorPath, `${JSON.stringify(charter)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  }).catch(async (error: unknown) => {
    if (isErrorCode(error, 'EEXIST')) {
      const existing = await readPersistedOperatorCharter(
        root,
        charter.programId,
      );
      if (JSON.stringify(existing) === JSON.stringify(charter)) return;
      throw new CliConflictError(
        'PROGRAM_EXISTS',
        `program ${charter.programId} already has a different charter`,
      );
    }
    throw error;
  });
}

async function rejectSymlink(path: string, label: string): Promise<void> {
  const info = await lstat(path);
  if (info.isSymbolicLink())
    throw new Error(`${label} must not be a symbolic link`);
  if (label.endsWith('directory') || label === 'Mammoth home') {
    if (!info.isDirectory()) throw new Error(`${label} must be a directory`);
  }
}

async function assertProgramDirectorySafe(
  root: string,
  programId: string,
): Promise<void> {
  const resolvedRoot = resolve(root);
  await rejectSymlink(resolvedRoot, 'Mammoth home');
  const directory = programDirectory(resolvedRoot, programId);
  await rejectSymlink(directory, 'program directory');
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink())
      throw new Error(
        `program artifact must not be a symbolic link: ${entry.name}`,
      );
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error: unknown) {
    if (isErrorCode(error, 'ENOENT')) return false;
    throw error;
  }
}

async function readPersistedOperatorCharter(
  root: string,
  programId: string,
): Promise<OperatorCharter> {
  const path = join(programDirectory(root, programId), OPERATOR_CHARTER);
  return readOperatorCharter(path);
}

function transportFor(charter: OperatorCharter): RuntimeOptions['transport'] {
  if (charter.sourcePath) {
    const sourcePath = charter.sourcePath;
    return async () => {
      const bytes = await readFile(sourcePath);
      return {
        status: 200,
        headers: new Headers({
          'content-type': mediaTypeFor(sourcePath),
        }),
        body: new Response(bytes).body,
      };
    };
  }
  return async (url, init) => {
    const response = await fetch(url, {
      headers: init.headers,
      signal: init.signal,
      redirect: 'manual',
    });
    return {
      status: response.status,
      headers: response.headers,
      body: response.body,
    };
  };
}

function mediaTypeFor(path: string): string {
  return path.toLowerCase().endsWith('.html') ? 'text/html' : 'text/plain';
}

function documentationResolver(): Promise<readonly string[]> {
  // Offline sources still pass retrieval's SSRF boundary using an RFC 5737 address.
  return Promise.resolve(['203.0.113.10']);
}

function requireProgramId(programId: string): void {
  if (
    !PROGRAM_PATTERN.test(programId) ||
    programId === '.' ||
    programId === '..'
  )
    throw new CliInputError(
      'INVALID_PROGRAM_ID',
      'program ID must be 1-128 safe identifier characters and contain no path separators',
    );
}

function programDirectory(root: string, programId: string): string {
  requireProgramId(programId);
  const resolvedRoot = resolve(root);
  const directory = resolve(resolvedRoot, programId);
  const child = relative(resolvedRoot, directory);
  if (child.startsWith('..') || isAbsolute(child))
    throw new CliInputError(
      'PATH_ESCAPE',
      'program path escapes the configured root',
    );
  return directory;
}

function success(
  io: CliIo,
  json: boolean,
  command: string,
  programId: string,
  result: unknown,
): void {
  const status =
    isRecord(result) && typeof result.status === 'string'
      ? result.status
      : isRecord(result) &&
          isRecord(result.status) &&
          typeof result.status.status === 'string'
        ? result.status.status
        : 'accepted';
  const envelope: CliSuccess = {
    schemaVersion: '1.0.0',
    ok: true,
    command,
    programId,
    status,
    result,
  };
  if (json) io.stdout(`${JSON.stringify(envelope)}\n`);
  else io.stdout(`${humanSuccess(command, programId, result)}\n`);
}

function humanSuccess(
  command: string,
  programId: string,
  result: unknown,
): string {
  const status =
    isRecord(result) && typeof result.status === 'string'
      ? `: ${result.status}`
      : '';
  if (command === 'inspect')
    return `Program ${programId} inspection\n${JSON.stringify(result, null, 2)}`;
  return `Program ${programId} ${command}${status}`;
}

function fail(
  io: CliIo,
  json: boolean,
  exitCode: number,
  code: string,
  message: string,
): number {
  const envelope: CliFailure = {
    schemaVersion: '1.0.0',
    ok: false,
    error: { code, message },
  };
  if (json) io.stdout(`${JSON.stringify(envelope)}\n`);
  io.stderr(`mammoth: ${code}: ${message}\n`);
  return exitCode;
}

function classifyError(error: unknown): {
  exitCode: number;
  code: string;
  message: string;
} {
  if (error instanceof CliInputError)
    return {
      exitCode: ExitCode.input,
      code: error.code,
      message: error.message,
    };
  if (error instanceof CliConflictError)
    return {
      exitCode: ExitCode.conflict,
      code: error.code,
      message: error.message,
    };
  if (error instanceof RuntimeExecutionError)
    return {
      exitCode:
        error.code === 'PROGRAM_NOT_FOUND'
          ? ExitCode.notFound
          : error.code === 'PROGRAM_CANCELLED' ||
              error.code === 'PROGRAM_NOT_RESUMABLE'
            ? ExitCode.conflict
            : ExitCode.execution,
      code: error.code,
      message: error.message,
    };
  const message = messageOf(error);
  if (/not found|ENOENT|does not exist/i.test(message))
    return { exitCode: ExitCode.notFound, code: 'PROGRAM_NOT_FOUND', message };
  if (
    /cannot|only .* may|already (completed|cancelled)|terminal|conflict/i.test(
      message,
    )
  )
    return { exitCode: ExitCode.conflict, code: 'STATE_CONFLICT', message };
  return { exitCode: ExitCode.execution, code: 'OPERATION_FAILED', message };
}

class CliInputError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

class CliConflictError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isErrorCode(error: unknown, code: string): boolean {
  return isRecord(error) && error.code === code;
}

function usage(): string {
  return [
    'Usage:',
    '  mammoth run <charter> [--root <directory>] [--json]',
    '  mammoth status <program> [--root <directory>] [--json]',
    '  mammoth resume <program> [--root <directory>] [--json]',
    '  mammoth cancel <program> [--root <directory>] [--json]',
    '  mammoth inspect <program> [--root <directory>] [--json]',
  ].join('\n');
}
