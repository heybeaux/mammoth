import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  inspectP8Bundle,
  runP8TurnkeyResearch,
  type P8ResearchAskInput,
} from '@mammoth/runtime';
import { P8DepthSchema } from '@mammoth/domain';
import { evaluateP9LiveAuthority } from './p9-live-authority.js';

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
      try {
        await rememberRun(summary.runId, summary.outputDirectory);
      } catch (error) {
        io.stderr(
          JSON.stringify({
            warning: 'p8_run_index_write_failed',
            retryable: false,
            message: error instanceof Error ? error.message : String(error),
          }),
        );
      }
      io.stdout(JSON.stringify(summary));
      return 0;
    }
    if (command === 'p9-live') {
      io.stderr(
        JSON.stringify({
          command: 'p9-live',
          phase: 'p9',
          status: 'blocked_before_effects',
          blockers: ['live_executor_unavailable'],
        }),
      );
      return 3;
    }
    if (
      command === 'inspect' ||
      command === 'status' ||
      command === 'resume' ||
      command === 'export'
    ) {
      const subject = tail[0];
      if (!subject || subject.startsWith('-')) {
        throw new Error(`research ${command} requires an output directory`);
      }
      const outputDirectory = await resolveRunSubject(subject);
      const summary = await inspectP8Bundle(outputDirectory);
      io.stdout(JSON.stringify({ ...summary, command }));
      return 0;
    }
    if (command === 'cancel') {
      const subject = tail[0];
      if (!subject || subject.startsWith('-')) {
        throw new Error('research cancel requires an output directory');
      }
      const outputDirectory = await resolveRunSubject(subject);
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
      const p9LiveAuthority = evaluateP9LiveAuthority(process.env);
      const liveSearchCredential = process.env.MAMMOTH_SEARCH_BRAVE_API_KEY;
      const liveBillingAuthorization =
        process.env.MAMMOTH_SEARCH_BRAVE_BILLING_AUTHORIZATION;
      const liveModelBaseUrl = process.env.MAMMOTH_P8_PROVIDER_BASE_URL;
      const liveModel = process.env.MAMMOTH_P8_PROVIDER_MODEL;
      const liveExplicitAuthorization =
        process.env.MAMMOTH_P8_LIVE_RESEARCH === 'authorized';
      const liveReady =
        liveExplicitAuthorization &&
        Boolean(liveSearchCredential) &&
        liveBillingAuthorization === 'authorized' &&
        Boolean(liveModelBaseUrl) &&
        Boolean(liveModel);
      io.stdout(
        JSON.stringify({
          command,
          status: liveReady ? 'ok' : 'blocked_live_exhibition',
          localProfile: 'ok',
          liveAuthorization: liveExplicitAuthorization
            ? 'MAMMOTH_P8_LIVE_RESEARCH=authorized'
            : 'MAMMOTH_P8_LIVE_RESEARCH=authorized missing; deterministic fixture mode remains active',
          liveSearch: liveSearchCredential
            ? 'brave-search/v1 credential present'
            : 'MAMMOTH_SEARCH_BRAVE_API_KEY missing; T8 live exhibition is credential-gated',
          liveBilling:
            liveBillingAuthorization === 'authorized'
              ? 'Brave Search API billing explicitly authorized'
              : 'MAMMOTH_SEARCH_BRAVE_BILLING_AUTHORIZATION=authorized missing; T8 live exhibition cannot spend provider budget',
          liveModelProvider:
            liveModelBaseUrl && liveModel
              ? 'OpenAI-compatible P8 synthesis provider configured'
              : 'MAMMOTH_P8_PROVIDER_BASE_URL and MAMMOTH_P8_PROVIDER_MODEL required for live synthesis',
          p9LiveAuthority,
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
  let mode: 'report' | 'explore' = 'report';
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
      mode = value;
    } else {
      throw new Error(`unknown research ask option: ${String(flag)}`);
    }
  }
  return {
    question,
    depth: P8DepthSchema.parse(depth),
    budgetUsd,
    outputDirectory,
    mode,
  };
}

async function rememberRun(
  runId: string,
  outputDirectory: string,
): Promise<void> {
  const indexPath = runIndexPath(runId);
  await mkdir(dirname(indexPath), { recursive: true });
  await writeFile(
    indexPath,
    `${JSON.stringify({ runId, outputDirectory: resolve(outputDirectory) })}\n`,
  );
}

async function resolveRunSubject(subject: string): Promise<string> {
  if (!subject.startsWith('p8-run:')) return subject;
  const raw = await readFile(runIndexPath(subject), 'utf8');
  const parsed = JSON.parse(raw) as { readonly outputDirectory?: unknown };
  if (typeof parsed.outputDirectory !== 'string') {
    throw new Error(`P8 run index for ${subject} is invalid`);
  }
  return parsed.outputDirectory;
}

function runIndexPath(runId: string): string {
  const safeRunId = runId.replace(/[^a-zA-Z0-9._:-]/gu, '_');
  const configuredRoot = process.env.MAMMOTH_P8_RUN_INDEX_DIR;
  const indexRoot = configuredRoot
    ? resolve(configuredRoot)
    : join(homedir(), '.mammoth/p8-runs');
  return join(indexRoot, `${safeRunId}.json`);
}

function p8Usage(): string {
  return 'usage: mammoth research ask <question> [--depth quick|standard|comprehensive] [--budget-usd N] [--output PATH]';
}
