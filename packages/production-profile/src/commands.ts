import { spawn } from 'node:child_process';

export interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
}

export async function run(
  command: string,
  args: readonly string[],
  options: {
    readonly env?: NodeJS.ProcessEnv;
    readonly timeoutMs: number;
    readonly allowFailure?: boolean;
  },
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${command} exceeded ${String(options.timeoutMs)}ms`));
    }, options.timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(new Error(`cannot execute ${command}: ${error.message}`));
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0 || options.allowFailure === true)
        resolve({ stdout, stderr });
      else
        reject(
          new Error(
            `${command} exited ${String(code)}: ${(stderr || stdout).trim()}`,
          ),
        );
    });
  });
}
