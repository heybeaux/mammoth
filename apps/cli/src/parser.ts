import { resolve } from 'node:path';
import { CliError, type CliCommand } from './types.js';

const commands = new Set(['run', 'status', 'resume', 'cancel', 'inspect']);

export function parseArgs(argv: readonly string[], cwd: string): CliCommand {
  const [name, subject, ...tail] = argv;
  if (!name || !commands.has(name)) throw new CliError('USAGE', usage());
  if (!subject || subject.startsWith('-'))
    throw new CliError('USAGE', `${name} requires one subject`);
  let root = resolve(cwd, '.mammoth');
  let json = false;
  let maxSteps: number | undefined;
  for (let index = 0; index < tail.length; index += 1) {
    const flag = tail[index];
    if (flag === '--json') {
      if (json) throw new CliError('USAGE', 'duplicate --json');
      json = true;
    } else if (flag === '--root') {
      const value = tail[++index];
      if (!value || value.startsWith('-'))
        throw new CliError('USAGE', '--root requires a path');
      root = resolve(cwd, value);
    } else if (flag === '--max-steps') {
      const value = tail[++index];
      maxSteps = Number(value);
      if (!Number.isSafeInteger(maxSteps) || maxSteps <= 0)
        throw new CliError('USAGE', '--max-steps requires a positive integer');
    } else {
      throw new CliError('USAGE', `unknown option: ${String(flag)}`);
    }
  }
  if (name !== 'run' && name !== 'resume' && maxSteps !== undefined)
    throw new CliError('USAGE', '--max-steps is valid only for run and resume');
  if (name === 'run') {
    return {
      name,
      charterPath: resolve(cwd, subject),
      root,
      json,
      ...(maxSteps === undefined ? {} : { maxSteps }),
    };
  }
  assertProgramId(subject);
  return {
    name: name as 'status' | 'resume' | 'cancel' | 'inspect',
    programId: subject,
    root,
    json,
    ...(maxSteps === undefined ? {} : { maxSteps }),
  };
}

export function assertProgramId(value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value))
    throw new CliError('INVALID_PROGRAM_ID', 'program id is not path-safe');
}

export function usage(): string {
  return 'usage: mammoth <run|status|resume|cancel|inspect> <subject> [--root PATH] [--json] [--max-steps N]';
}
