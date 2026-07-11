import { spawn } from 'node:child_process';

export interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export interface CommandRunner {
  run(
    command: string,
    args: readonly string[],
    options: {
      readonly timeoutMs: number;
      readonly allowFailure?: boolean;
      readonly env?: NodeJS.ProcessEnv;
    },
  ): Promise<CommandResult>;
}

export class ProcessCommandRunner implements CommandRunner {
  run(
    command: string,
    args: readonly string[],
    options: {
      readonly timeoutMs: number;
      readonly allowFailure?: boolean;
      readonly env?: NodeJS.ProcessEnv;
    },
  ): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        env: options.env ?? process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(
          new Error(
            `${command} ${args.join(' ')} exceeded ${String(options.timeoutMs)}ms`,
          ),
        );
      }, options.timeoutMs);
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
      });
      child.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.on('close', (exitCode) => {
        clearTimeout(timeout);
        const result = { stdout, stderr, exitCode: exitCode ?? 1 };
        if (result.exitCode !== 0 && options.allowFailure !== true) {
          reject(
            new Error(
              `${command} ${args.join(' ')} failed with ${String(result.exitCode)}: ${stderr || stdout}`,
            ),
          );
          return;
        }
        resolve(result);
      });
    });
  }
}
