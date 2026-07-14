import { open } from 'node:fs/promises';
import {
  parseP7ResearchRunRequest,
  type P7ResearchApplicationPort,
} from '@mammoth/workflow';

const MAX_P7_REQUEST_BYTES = 1024 * 1024;

export interface P7CliIo {
  stdout(value: string): void;
  stderr(value: string): void;
}

export async function executeP7ResearchCli(
  argv: readonly string[],
  application: P7ResearchApplicationPort,
  io: P7CliIo,
): Promise<number> {
  try {
    const [scope, command, argument, ...rest] = argv;
    if (
      scope !== 'research' ||
      !['run', 'resume', 'cancel', 'status', 'inspect'].includes(
        command ?? '',
      ) ||
      argument === undefined ||
      rest.length > 0
    ) {
      throw new Error(p7ResearchUsage());
    }
    const result =
      command === 'run'
        ? await application.run(await readRequest(argument))
        : command === 'resume'
          ? await application.resume(argument)
          : command === 'cancel'
            ? await application.cancel(argument)
            : command === 'status'
              ? await application.status(argument)
              : await application.inspect(argument);
    io.stdout(JSON.stringify({ command: `research ${command}`, ...result }));
    return 0;
  } catch (error: unknown) {
    io.stderr(
      JSON.stringify({
        error: 'P7_RESEARCH_COMMAND_FAILED',
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return 2;
  }
}

export function p7ResearchUsage(): string {
  return [
    'mammoth research run <request.json>',
    'mammoth research status <run-id>',
    'mammoth research inspect <run-id>',
    'mammoth research resume <run-id>',
    'mammoth research cancel <run-id>',
  ].join('\n');
}

async function readRequest(path: string) {
  const handle = await open(path, 'r');
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile())
      throw new Error('P7 request must be a regular file');
    if (metadata.size > MAX_P7_REQUEST_BYTES)
      throw new Error('P7 request exceeds 1 MiB');
    const bytes = await handle.readFile();
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return parseP7ResearchRunRequest(JSON.parse(text));
  } finally {
    await handle.close();
  }
}
