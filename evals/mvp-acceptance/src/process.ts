import { spawn } from 'node:child_process';

export interface ProcessResult {
  status: number;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

export interface CliEnvelope {
  schemaVersion: string;
  ok: boolean;
  command?: string;
  programId?: string;
  status?: string;
  result?: Record<string, unknown>;
  error?: { code: string; message: string };
}

export async function invokeCli(
  executable: string,
  cwd: string,
  root: string,
  ...arguments_: string[]
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [executable, ...arguments_, '--json'],
      {
        cwd,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          TMPDIR: process.env.TMPDIR,
          MAMMOTH_HOME: root,
          NO_COLOR: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout
      .setEncoding('utf8')
      .on('data', (chunk: string) => (stdout += chunk));
    child.stderr
      .setEncoding('utf8')
      .on('data', (chunk: string) => (stderr += chunk));
    child.once('error', reject);
    child.once('close', (status, signal) => {
      resolve({ status: status ?? -1, signal, stdout, stderr });
    });
  });
}

export function parseEnvelope(result: ProcessResult): CliEnvelope {
  if (!result.stdout.endsWith('\n'))
    throw new Error('CLI stdout is not newline terminated');
  const lines = result.stdout.trimEnd().split('\n');
  if (lines.length !== 1)
    throw new Error('CLI stdout is not exactly one JSON object');
  return JSON.parse(lines[0] ?? '') as CliEnvelope;
}
