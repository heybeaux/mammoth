import { constants } from 'node:fs';
import { mkdir, open, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import {
  PlanAcceptanceReceiptSchema,
  ProviderPriceCatalogSchema,
  ResearchPlanProposalSchema,
  ResearchPlanSchema,
} from '@mammoth/domain';
import {
  acceptResearchPlan,
  P9_DOMAIN_POLICY_PACKS,
  previewResearchPlan,
  reviseResearchPlan,
  type PlanAcceptanceThresholds,
} from '@mammoth/governance';
import {
  assertP9AcceptedPlanChain,
  P9OfflineCorpusSchema,
  runP9PlanDrivenResearch,
  verifyP9ExactBundle,
} from '@mammoth/runtime';
import { PlanCoverageThresholdsSchema } from '@mammoth/governance';

export interface P9CliIo {
  readonly stdout: (value: string) => void;
  readonly stderr: (value: string) => void;
}

export interface P9LiveReadiness {
  readonly ready: boolean;
  readonly blockers: readonly string[];
  readonly proposerProfileFamily: string | null;
  readonly evaluatorProfileFamily: string | null;
  readonly priceCatalogDigest: string | null;
}

export interface P9CliDependencies {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly now?: () => string;
}

const DEFAULT_ACCEPTANCE_THRESHOLDS: PlanAcceptanceThresholds = {
  minSubquestions: 4,
  minSourceClasses: 5,
  minContradictionRequirements: 2,
  maxAuthorizedUsd: 5,
  minQuestionDerivedTerms: 3,
};

const DEFAULT_COVERAGE_THRESHOLDS = PlanCoverageThresholdsSchema.parse({
  minAdmittedClaims: 10,
  minCriticalClaims: 3,
  minIndependentFamiliesPerCriticalClaim: 2,
  minMandatorySourceClassCoverageRatio: 0.8,
});

export async function inspectP9LiveReadiness(
  env: Readonly<Record<string, string | undefined>>,
): Promise<P9LiveReadiness> {
  const blockers: string[] = [];
  if (env.MAMMOTH_P9_LIVE_RESEARCH !== 'authorized') {
    blockers.push('live_authorization_missing');
  }
  if (!env.MAMMOTH_P9_SEARCH_API_KEY)
    blockers.push('search_credential_missing');
  if (env.MAMMOTH_P9_SEARCH_BILLING_AUTHORIZATION !== 'authorized') {
    blockers.push('search_billing_authorization_missing');
  }
  if (!env.MAMMOTH_P9_PROVIDER_BASE_URL) {
    blockers.push('model_provider_base_url_missing');
  }
  if (!env.MAMMOTH_P9_PROVIDER_API_KEY) {
    blockers.push('model_provider_credential_missing');
  }
  if (env.MAMMOTH_P9_MODEL_BILLING_AUTHORIZATION !== 'authorized') {
    blockers.push('model_billing_authorization_missing');
  }
  const proposerModel = env.MAMMOTH_P9_PROPOSER_MODEL;
  const evaluatorModel = env.MAMMOTH_P9_EVALUATOR_MODEL;
  const proposerFamily = env.MAMMOTH_P9_PROPOSER_PROFILE_FAMILY;
  const evaluatorFamily = env.MAMMOTH_P9_EVALUATOR_PROFILE_FAMILY;
  if (!proposerModel || !proposerFamily)
    blockers.push('proposer_profile_missing');
  if (!evaluatorModel || !evaluatorFamily)
    blockers.push('evaluator_profile_missing');
  if (proposerFamily && evaluatorFamily && proposerFamily === evaluatorFamily) {
    blockers.push('model_profile_families_not_distinct');
  }

  let priceCatalogDigest: string | null = null;
  const catalogPath = env.MAMMOTH_P9_PRICE_CATALOG_PATH;
  if (!catalogPath) {
    blockers.push('immutable_price_catalog_missing');
  } else {
    try {
      const catalog = ProviderPriceCatalogSchema.parse(
        JSON.parse(await readFile(resolve(catalogPath), 'utf8')),
      );
      const requiredEffects = new Set([
        'search',
        'retrieval',
        'parser',
        'model',
      ]);
      for (const entry of catalog.entries)
        requiredEffects.delete(entry.effectKind);
      if (requiredEffects.size > 0) blockers.push('price_catalog_incomplete');
      priceCatalogDigest = catalog.catalogDigest;
    } catch {
      blockers.push('immutable_price_catalog_invalid');
    }
  }
  // P9 live execution remains structurally unavailable until its effect ports
  // mechanically reserve every request through P9BudgetAuthority.
  blockers.push('live_executor_unavailable');
  return {
    ready: blockers.length === 0,
    blockers,
    proposerProfileFamily: proposerFamily ?? null,
    evaluatorProfileFamily: evaluatorFamily ?? null,
    priceCatalogDigest,
  };
}

export async function executeP9ResearchCli(
  argv: readonly string[],
  io: P9CliIo,
  dependencies: P9CliDependencies = {},
): Promise<number> {
  const [, command, ...tail] = argv;
  const env = dependencies.env ?? process.env;
  const now = dependencies.now ?? (() => new Date().toISOString());
  try {
    if (command === 'p9-live') {
      const readiness = await inspectP9LiveReadiness(env);
      io.stderr(
        JSON.stringify({
          command: 'p9-live',
          phase: 'p9',
          status: 'blocked_before_effects',
          ...readiness,
        }),
      );
      return 3;
    }
    if (command === 'doctor') {
      assertOptions(tail, [], ['--p9']);
      const readiness = await inspectP9LiveReadiness(env);
      io.stdout(
        JSON.stringify({
          command: 'doctor',
          phase: 'p9',
          status: readiness.ready ? 'ready' : 'blocked_before_effects',
          ...readiness,
        }),
      );
      return readiness.ready ? 0 : 3;
    }
    if (command === 'plan') {
      assertOptions(tail.slice(1), ['--proposal', '--output']);
      return await planCommand(tail, io);
    }
    if (command === 'preview') {
      assertOptions(tail.slice(1), []);
      return await previewCommand(tail, io);
    }
    if (command === 'accept') {
      assertOptions(tail.slice(1), ['--actor', '--max-authorized-usd']);
      return await acceptCommand(tail, io, now());
    }
    if (command === 'revise') {
      assertOptions(tail.slice(1), [
        '--proposal',
        '--actor',
        '--max-authorized-usd',
      ]);
      return await reviseCommand(tail, io, now());
    }
    if (command === 'run') {
      assertOptions(tail.slice(1), ['--output', '--offline-corpus']);
      return await runCommand(tail, io, env, now());
    }
    if (command === 'inspect') {
      assertOptions(tail.slice(1), []);
      return await inspectCommand(tail, io);
    }
    io.stderr(p9Usage());
    return 2;
  } catch (error) {
    io.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

async function planCommand(
  argv: readonly string[],
  io: P9CliIo,
): Promise<number> {
  const question = requireSubject(argv, 'research plan requires a question');
  const proposalPath = requiredOption(argv.slice(1), '--proposal');
  const outputDirectory = resolve(
    option(argv.slice(1), '--output') ?? `research/${slug(question)}`,
  );
  const proposal = await readJson(proposalPath, ResearchPlanProposalSchema);
  if (proposal.question !== question) {
    throw new Error('proposal question does not match the operator question');
  }
  const preview = previewResearchPlan(proposal);
  await mkdir(outputDirectory, { recursive: true });
  await writeJson(
    join(outputDirectory, 'research-plan-proposal.json'),
    proposal,
  );
  await writeJson(join(outputDirectory, 'research-plan-preview.json'), preview);
  io.stdout(
    JSON.stringify({
      command: 'plan',
      outputDirectory,
      preview,
      accepted: false,
    }),
  );
  return 0;
}

async function previewCommand(
  argv: readonly string[],
  io: P9CliIo,
): Promise<number> {
  const directory = resolve(
    requireSubject(argv, 'research preview requires a plan directory'),
  );
  const proposal = await readJson(
    join(directory, 'research-plan-proposal.json'),
    ResearchPlanProposalSchema,
  );
  io.stdout(
    JSON.stringify({
      command: 'preview',
      preview: previewResearchPlan(proposal),
    }),
  );
  return 0;
}

async function acceptCommand(
  argv: readonly string[],
  io: P9CliIo,
  decidedAt: string,
): Promise<number> {
  const directory = resolve(
    requireSubject(argv, 'research accept requires a plan directory'),
  );
  const proposal = await readJson(
    join(directory, 'research-plan-proposal.json'),
    ResearchPlanProposalSchema,
  );
  const actorId = option(argv.slice(1), '--actor') ?? 'operator:local';
  const result = acceptResearchPlan({
    proposal,
    thresholds: acceptanceThresholds(argv.slice(1)),
    decidedAt,
    actorId,
  });
  await writeJson(
    join(directory, 'plan-acceptance-receipt.json'),
    result.receipt,
  );
  if (result.plan)
    await writeJson(join(directory, 'research-plan.json'), result.plan);
  io.stdout(JSON.stringify({ command: 'accept', ...result }));
  return result.plan ? 0 : 4;
}

async function reviseCommand(
  argv: readonly string[],
  io: P9CliIo,
  decidedAt: string,
): Promise<number> {
  const directory = resolve(
    requireSubject(argv, 'research revise requires a plan directory'),
  );
  const proposalPath = requiredOption(argv.slice(1), '--proposal');
  const currentPlan = await readJson(
    join(directory, 'research-plan.json'),
    ResearchPlanSchema,
  );
  const proposal = await readJson(proposalPath, ResearchPlanProposalSchema);
  const result = reviseResearchPlan({
    currentPlan,
    proposal,
    thresholds: acceptanceThresholds(argv.slice(1)),
    decidedAt,
    actorId: option(argv.slice(1), '--actor') ?? 'operator:local',
  });
  if (result.plan) {
    await writeJson(join(directory, 'research-plan-proposal.json'), proposal);
    await writeJson(join(directory, 'research-plan.json'), result.plan);
    await writeJson(
      join(directory, 'plan-acceptance-receipt.json'),
      result.receipt,
    );
  } else {
    const rejectionId = slug(
      `${proposal.proposalId}-${result.receipt.receiptDigest}`,
    );
    await writeJson(join(directory, `rejected-revision-${rejectionId}.json`), {
      proposal,
      rejectionReceipt: result.receipt,
    });
    await writeJson(join(directory, `revision-attempt-${rejectionId}.json`), {
      status: 'rejected',
      currentPlanId: currentPlan.planId,
      currentPlanDigest: currentPlan.planDigest,
      proposedRevisionId: proposal.proposalId,
      proposedRevisionDigest: proposal.proposalDigest,
      rejectionReceiptDigest: result.receipt.receiptDigest,
      attemptedAt: decidedAt,
      actorId: option(argv.slice(1), '--actor') ?? 'operator:local',
    });
  }
  if (result.revisionRecord) {
    await writeJson(
      join(directory, 'plan-revision-record.json'),
      result.revisionRecord,
    );
  }
  io.stdout(JSON.stringify({ command: 'revise', ...result }));
  return result.plan ? 0 : 4;
}

async function runCommand(
  argv: readonly string[],
  io: P9CliIo,
  env: Readonly<Record<string, string | undefined>>,
  timestamp: string,
): Promise<number> {
  const subject = resolve(
    requireSubject(argv, 'research run requires an accepted plan'),
  );
  const planDirectory =
    basename(subject) === 'research-plan.json' ? dirname(subject) : subject;
  const outputDirectory = resolve(
    option(argv.slice(1), '--output') ?? join(planDirectory, 'run'),
  );
  const proposal = await readJson(
    join(planDirectory, 'research-plan-proposal.json'),
    ResearchPlanProposalSchema,
  );
  const plan = await readJson(
    join(planDirectory, 'research-plan.json'),
    ResearchPlanSchema,
  );
  const receipt = await readJson(
    join(planDirectory, 'plan-acceptance-receipt.json'),
    PlanAcceptanceReceiptSchema,
  );
  const chain = assertP9AcceptedPlanChain({
    planProposal: proposal,
    plan,
    acceptanceReceipt: receipt,
    pack: P9_DOMAIN_POLICY_PACKS[plan.domainPackId],
  });

  const offlineCorpusPath = option(argv.slice(1), '--offline-corpus');
  let artifacts: Readonly<Record<string, string>>;
  if (offlineCorpusPath) {
    const corpus = await readJson(offlineCorpusPath, P9OfflineCorpusSchema);
    const run = runP9PlanDrivenResearch({
      planProposal: proposal,
      plan,
      acceptanceReceipt: receipt,
      pack: chain.pack,
      corpus,
      thresholds: DEFAULT_COVERAGE_THRESHOLDS,
      executionId: `p9-run:${slug(corpus.corpusId)}`,
      now: timestamp,
    });
    artifacts = run.artifacts;
  } else {
    const readiness = await inspectP9LiveReadiness(env);
    throw new Error(
      `P9 live run blocked before effects: ${readiness.blockers.join(', ')}`,
    );
  }
  await writeFreshP9Bundle(outputDirectory, artifacts);
  const verification = verifyP9ExactBundle(
    await loadP9BundleDirectory(outputDirectory),
  );
  io.stdout(
    JSON.stringify({
      command: 'run',
      outputDirectory,
      planId: plan.planId,
      manifestId: verification.manifest.manifestId,
      verifiedCitationCount: verification.verifiedCitationCount,
    }),
  );
  return 0;
}

export async function writeFreshP9Bundle(
  outputDirectory: string,
  artifacts: Readonly<Record<string, string>>,
): Promise<void> {
  const output = resolve(outputDirectory);
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output);
  const createdDirectories = new Set<string>(['']);
  for (const [name, content] of Object.entries(artifacts).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    assertSafeArtifactName(name);
    const segments = name.split('/');
    let relativeDirectory = '';
    for (const segment of segments.slice(0, -1)) {
      relativeDirectory = relativeDirectory
        ? `${relativeDirectory}/${segment}`
        : segment;
      if (createdDirectories.has(relativeDirectory)) continue;
      await mkdir(join(output, relativeDirectory));
      createdDirectories.add(relativeDirectory);
    }
    const handle = await open(
      join(output, name),
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await handle.writeFile(content, 'utf8');
    } finally {
      await handle.close();
    }
  }
}

function assertSafeArtifactName(name: string): void {
  const segments = name.split('/');
  if (
    name.startsWith('/') ||
    name.includes('\\') ||
    segments.some(
      (segment) => segment === '' || segment === '.' || segment === '..',
    )
  ) {
    throw new Error(`P9 artifact name is not path-safe: ${name}`);
  }
}

async function inspectCommand(
  argv: readonly string[],
  io: P9CliIo,
): Promise<number> {
  const directory = resolve(
    requireSubject(argv, 'research inspect requires a bundle directory'),
  );
  const artifacts = await loadP9BundleDirectory(directory);
  const verified = verifyP9ExactBundle(artifacts);
  io.stdout(
    JSON.stringify({ command: 'inspect', status: 'verified', ...verified }),
  );
  return 0;
}

async function loadP9BundleDirectory(
  directory: string,
): Promise<Readonly<Record<string, string>>> {
  const artifacts: Record<string, string> = {};
  const visit = async (relativeDirectory: string): Promise<void> => {
    const absolute = join(directory, relativeDirectory);
    for (const entry of await readdir(absolute, { withFileTypes: true })) {
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      if (entry.isDirectory()) {
        await visit(relativePath);
      } else if (entry.isFile()) {
        artifacts[relativePath] = await readFile(
          join(directory, relativePath),
          'utf8',
        );
      } else {
        throw new Error(`P9 bundle contains unsupported entry ${relativePath}`);
      }
    }
  };
  await visit('');
  return artifacts;
}

function requireSubject(argv: readonly string[], message: string): string {
  const subject = argv[0];
  if (!subject || subject.startsWith('-')) throw new Error(message);
  return subject;
}

function option(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith('-'))
    throw new Error(`${name} requires a value`);
  return value;
}

function assertOptions(
  argv: readonly string[],
  valued: readonly string[],
  boolean: readonly string[] = [],
): void {
  const seen = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!flag?.startsWith('-'))
      throw new Error(`unexpected argument: ${String(flag)}`);
    if (seen.has(flag)) throw new Error(`duplicate option: ${flag}`);
    seen.add(flag);
    if (boolean.includes(flag)) continue;
    if (!valued.includes(flag)) throw new Error(`unknown option: ${flag}`);
    const value = argv[++index];
    if (!value || value.startsWith('-'))
      throw new Error(`${flag} requires a value`);
  }
}

function requiredOption(argv: readonly string[], name: string): string {
  const value = option(argv, name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function acceptanceThresholds(
  argv: readonly string[],
): PlanAcceptanceThresholds {
  const raw = option(argv, '--max-authorized-usd');
  if (!raw) return DEFAULT_ACCEPTANCE_THRESHOLDS;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('--max-authorized-usd requires a positive number');
  }
  return { ...DEFAULT_ACCEPTANCE_THRESHOLDS, maxAuthorizedUsd: value };
}

async function readJson<T>(
  path: string,
  schema: { parse(value: unknown): T },
): Promise<T> {
  return schema.parse(JSON.parse(await readFile(resolve(path), 'utf8')));
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, '-')
      .replace(/^-|-$/gu, '')
      .slice(0, 64) || 'p9-research'
  );
}

function p9Usage(): string {
  return 'usage: mammoth research <plan|preview|accept|revise|run|inspect|doctor> ...';
}
