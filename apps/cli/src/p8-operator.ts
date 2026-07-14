import { resolve } from 'node:path';
import {
  inspectP8Bundle,
  runP8TurnkeyResearch,
  type P8ResearchAskInput,
} from '@mammoth/runtime';
import { P8DepthSchema } from '@mammoth/domain';

export interface P8CliIo {
  readonly stdout: (value: string) => void;
  readonly stderr: (value: string) => void;
}

export async function executeP8ResearchCli(
  argv: readonly string[],
  io: P8CliIo,
): Promise<number> {
  const [, command, ...tail] = argv;
  try {
    if (command === 'ask') {
      const parsed = parseAsk(tail);
      const summary = await runP8TurnkeyResearch(parsed);
      io.stdout(JSON.stringify(summary));
      return 0;
    }
    if (
      command === 'inspect' ||
      command === 'status' ||
      command === 'resume' ||
      command === 'export'
    ) {
      const outputDirectory = tail[0];
      if (!outputDirectory || outputDirectory.startsWith('-')) {
        throw new Error(`research ${command} requires an output directory`);
      }
      const summary = await inspectP8Bundle(outputDirectory);
      io.stdout(JSON.stringify({ ...summary, command }));
      return 0;
    }
    if (command === 'cancel') {
      const outputDirectory = tail[0];
      if (!outputDirectory || outputDirectory.startsWith('-')) {
        throw new Error('research cancel requires an output directory');
      }
      const summary = await inspectP8Bundle(outputDirectory);
      io.stdout(
        JSON.stringify({
          ...summary,
          command,
          cancellationReceipt: 'honest_partial_output_available',
        }),
      );
      return 0;
    }
    if (command === 'init' || command === 'up') {
      io.stdout(
        JSON.stringify({
          command,
          status: 'ok',
          profile: 'local-fixture',
          note: 'P8 local fixture profile requires no secrets.',
        }),
      );
      return 0;
    }
    if (command === 'doctor') {
      io.stdout(
        JSON.stringify({
          command,
          status: process.env.MAMMOTH_SEARCH_BRAVE_API_KEY
            ? 'ok'
            : 'blocked_live_exhibition',
          localProfile: 'ok',
          liveSearch: process.env.MAMMOTH_SEARCH_BRAVE_API_KEY
            ? 'brave-search/v1 credential present'
            : 'MAMMOTH_SEARCH_BRAVE_API_KEY missing; T8 live exhibition is credential-gated',
        }),
      );
      return 0;
    }
    io.stderr(p8Usage());
    return 2;
  } catch (error) {
    io.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

function parseAsk(argv: readonly string[]): P8ResearchAskInput {
  const [question, ...tail] = argv;
  if (!question || question.startsWith('-'))
    throw new Error('research ask requires a question');
  let depth = 'standard';
  let budgetUsd = 12;
  let outputDirectory = resolve(process.cwd(), 'research/p8-output');
  for (let index = 0; index < tail.length; index += 1) {
    const flag = tail[index];
    if (flag === '--depth') {
      const value = tail[++index];
      if (!value) throw new Error('--depth requires a value');
      depth = value;
    } else if (flag === '--budget-usd') {
      const value = Number(tail[++index]);
      if (!Number.isFinite(value) || value < 0)
        throw new Error('--budget-usd requires a non-negative number');
      budgetUsd = value;
    } else if (flag === '--output') {
      const value = tail[++index];
      if (!value || value.startsWith('-'))
        throw new Error('--output requires a path');
      outputDirectory = resolve(process.cwd(), value);
    } else if (flag === '--mode') {
      const value = tail[++index];
      if (value !== 'report' && value !== 'explore')
        throw new Error('--mode must be report or explore');
    } else {
      throw new Error(`unknown research ask option: ${String(flag)}`);
    }
  }
  return {
    question,
    depth: P8DepthSchema.parse(depth),
    budgetUsd,
    outputDirectory,
  };
}

function p8Usage(): string {
  return 'usage: mammoth research ask <question> [--depth quick|standard|comprehensive] [--budget-usd N] [--output PATH]';
}
