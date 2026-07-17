import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  createInvestigationPreview,
  deriveAcquisitionIntents,
  evaluateAcquisitionRelease,
  INVESTIGATION_ARTIFACT_NAMES,
} from '@mammoth/runtime';

export interface InvestigateCliIo {
  readonly stdout: (value: string) => void;
  readonly stderr: (value: string) => void;
}

export interface InvestigateCliDependencies {
  readonly cwd?: () => string;
  readonly now?: () => string;
}

export async function executeInvestigateCli(
  argv: readonly string[],
  io: InvestigateCliIo,
  dependencies: InvestigateCliDependencies = {},
): Promise<number> {
  try {
    if (argv[1] === '--plan') {
      return await executePlanComposition(argv, io, dependencies);
    }
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

async function executePlanComposition(
  argv: readonly string[],
  io: InvestigateCliIo,
  dependencies: InvestigateCliDependencies,
): Promise<number> {
  const cwd = dependencies.cwd?.() ?? process.cwd();
  const planPath = argv[2];
  if (!planPath || planPath.startsWith('-')) {
    throw new Error(investigateUsage());
  }
  let outputOption: string | undefined;
  let authorityOption: string | undefined;
  for (let index = 3; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === '--output') {
      if (outputOption !== undefined) throw new Error('duplicate --output');
      const value = argv[++index];
      if (!value || value.startsWith('-')) {
        throw new Error('--output requires a path');
      }
      outputOption = value;
    } else if (option === '--authority') {
      if (authorityOption !== undefined) {
        throw new Error('duplicate --authority');
      }
      const value = argv[++index];
      if (!value || value.startsWith('-')) {
        throw new Error('--authority requires a path');
      }
      authorityOption = value;
    } else {
      throw new Error(`unknown investigate option: ${String(option)}`);
    }
  }
  const intentSet = deriveAcquisitionIntents(
    await readJson(resolve(cwd, planPath), 'investigation plan'),
  );
  const effectAuthority =
    authorityOption === undefined
      ? undefined
      : await readJson(resolve(cwd, authorityOption), 'effect authority');
  // No trusted issuer is pinned in the public path yet, so every release
  // evaluation fails closed; acquisition stays strictly no-effect.
  const release = evaluateAcquisitionRelease({
    intentSet,
    effectAuthority,
    now: dependencies.now?.() ?? new Date().toISOString(),
  });
  const outputDirectory = resolve(
    cwd,
    outputOption ??
      join(
        'investigations',
        `${slug(intentSet.question)}-${intentSet.investigationId.slice(-8)}-acquisition`,
      ),
  );
  await mkdir(dirname(outputDirectory), { recursive: true });
  await mkdir(outputDirectory);
  const artifacts = {
    'acquisition-intents.json': intentSet,
    'acquisition-release.json': release,
  } as const;
  for (const [name, artifact] of Object.entries(artifacts)) {
    await writeFile(
      join(outputDirectory, name),
      `${JSON.stringify(artifact, null, 2)}\n`,
      { encoding: 'utf8', flag: 'wx' },
    );
  }
  io.stdout(
    JSON.stringify({
      command: 'investigate',
      status:
        release.decision === 'authorized'
          ? 'acquisition_release_authorized'
          : 'awaiting_effect_authority',
      outputDirectory,
      artifacts: Object.keys(artifacts),
      planId: intentSet.planId,
      planDigest: intentSet.planDigest,
      intentSetDigest: intentSet.intentSetDigest,
      intentCount: intentSet.intents.length,
      decision: release.decision,
      reasonCodes: release.reasonCodes,
      executionAuthorized: release.decision === 'authorized',
      externalEffectsExecuted: false,
    }),
  );
  return 0;
}

async function readJson(path: string, label: string): Promise<unknown> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    throw new Error(`${label} file is not readable: ${path}`);
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`${label} file is not valid JSON: ${path}`);
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
  return 'usage: mammoth investigate "QUESTION OR THEORY" [--output PATH]\n       mammoth investigate --plan PLAN.json [--authority RECEIPT.json] [--output PATH]';
}
