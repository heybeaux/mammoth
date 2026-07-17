import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  createInvestigationPreview,
  INVESTIGATION_ARTIFACT_NAMES,
} from '@mammoth/runtime';

export interface InvestigateCliIo {
  readonly stdout: (value: string) => void;
  readonly stderr: (value: string) => void;
}

export interface InvestigateCliDependencies {
  readonly cwd?: () => string;
}

export async function executeInvestigateCli(
  argv: readonly string[],
  io: InvestigateCliIo,
  dependencies: InvestigateCliDependencies = {},
): Promise<number> {
  try {
    const question = argv[1]?.trim();
    if (!question || question.startsWith('-')) {
      throw new Error(investigateUsage());
    }
    let outputOption: string | undefined;
    for (let index = 2; index < argv.length; index += 1) {
      const option = argv[index];
      if (option !== '--output') {
        throw new Error(`unknown investigate option: ${String(option)}`);
      }
      if (outputOption !== undefined) {
        throw new Error('duplicate --output');
      }
      const value = argv[++index];
      if (!value || value.startsWith('-')) {
        throw new Error('--output requires a path');
      }
      outputOption = value;
    }

    const result = createInvestigationPreview(question);
    const cwd = dependencies.cwd?.() ?? process.cwd();
    const outputDirectory = resolve(
      cwd,
      outputOption ??
        join(
          'investigations',
          `${slug(question)}-${result.preview.investigationId.slice(-8)}`,
        ),
    );
    await mkdir(dirname(outputDirectory), { recursive: true });
    await mkdir(outputDirectory);
    for (const name of INVESTIGATION_ARTIFACT_NAMES) {
      const artifact = result.artifacts[name];
      await writeFile(
        join(outputDirectory, name),
        typeof artifact === 'string'
          ? artifact
          : `${JSON.stringify(artifact, null, 2)}\n`,
        { encoding: 'utf8', flag: 'wx' },
      );
    }
    io.stdout(
      JSON.stringify({
        command: 'investigate',
        status: 'awaiting_approval',
        outputDirectory,
        artifacts: INVESTIGATION_ARTIFACT_NAMES,
        previewDigest: result.preview.previewDigest,
        externalEffectsExecuted: false,
      }),
    );
    return 0;
  } catch (error) {
    io.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

function slug(value: string): string {
  const normalized = value
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '')
    .slice(0, 48);
  return normalized || 'question';
}

function investigateUsage(): string {
  return 'usage: mammoth investigate "QUESTION OR THEORY" [--output PATH]';
}
