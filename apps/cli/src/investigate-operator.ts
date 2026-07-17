import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { canonicalDigest, P9LiveAuthorityReceiptSchema } from '@mammoth/domain';
import {
  bindApprovedInvestigationPlan,
  recordInvestigationApproval,
} from '@mammoth/governance';
import {
  buildInvestigateLivePriceCatalog,
  buildOfflineNoEffectAdapters,
  composeGovernedInvestigationBundle,
  createInvestigationPreview,
  deriveAcquisitionIntents,
  evaluateAcquisitionRelease,
  executeGovernedAcquisition,
  executeGovernedLiveAcquisition,
  INVESTIGATION_ARTIFACT_NAMES,
  mintOfflineFixtureAuthorityReceipt,
  OFFLINE_FIXTURE_ISSUER_ID,
} from '@mammoth/runtime';

const PUBLIC_WEB_RETRIEVAL_AUTHORITY_ORIGIN = 'https://public-web.invalid';

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
    if (argv[1] === '--execute') {
      return await executeGovernedOfflineRun(argv, io, dependencies);
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
  let trustedIssuerOption: string | undefined;
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
    } else if (option === '--trusted-issuer') {
      if (trustedIssuerOption !== undefined) {
        throw new Error('duplicate --trusted-issuer');
      }
      const value = argv[++index];
      if (!value || value.startsWith('-')) {
        throw new Error('--trusted-issuer requires an issuer id');
      }
      trustedIssuerOption = value;
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
  // The public path never pins an issuer by default: unless the operator
  // explicitly passes --trusted-issuer, every release evaluation fails
  // closed and acquisition stays strictly no-effect.
  const release = evaluateAcquisitionRelease({
    intentSet,
    effectAuthority,
    ...(trustedIssuerOption === undefined
      ? {}
      : { trustedIssuerId: trustedIssuerOption }),
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

/**
 * The complete governed offline path: question → preview → recorded human
 * approval → immutable plan → derived intents → release under an explicitly
 * pinned trusted issuer → governed no-effect execution → cited reader report
 * plus a complete audit projection. A refused release writes its refusal
 * artifacts and executes nothing; no step here performs a network, provider,
 * or paid effect.
 */
async function executeGovernedOfflineRun(
  argv: readonly string[],
  io: InvestigateCliIo,
  dependencies: InvestigateCliDependencies,
): Promise<number> {
  const cwd = dependencies.cwd?.() ?? process.cwd();
  const question = argv[2]?.trim();
  if (!question || question.startsWith('-')) {
    throw new Error(investigateUsage());
  }
  let outputOption: string | undefined;
  let sourcesOption: string | undefined;
  let trustedIssuerOption: string | undefined;
  let actorOption: string | undefined;
  let live = false;
  let budgetJournalOption: string | undefined;
  let searchProviderOption: 'brave' | 'tavily' = 'brave';
  let searchEnvOption = 'MAMMOTH_SEARCH_BRAVE_API_KEY';
  let modelEnvOption = 'OPENROUTER_API_KEY';
  let modelBaseUrlOption = 'https://openrouter.ai/api/v1';
  let modelIdOption = 'openai/gpt-4o-mini';
  const authorizedRetrievalOrigins: string[] = [];
  let approve = false;
  for (let index = 3; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === '--approve') {
      if (approve) throw new Error('duplicate --approve');
      approve = true;
      continue;
    }
    if (option === '--live') {
      if (live) throw new Error('duplicate --live');
      live = true;
      continue;
    }
    const value = argv[index + 1];
    if (option === '--output') {
      if (outputOption !== undefined) throw new Error('duplicate --output');
      if (!value || value.startsWith('-')) {
        throw new Error('--output requires a path');
      }
      outputOption = value;
    } else if (option === '--offline-sources') {
      if (sourcesOption !== undefined) {
        throw new Error('duplicate --offline-sources');
      }
      if (!value || value.startsWith('-')) {
        throw new Error('--offline-sources requires a path');
      }
      sourcesOption = value;
    } else if (option === '--trusted-issuer') {
      if (trustedIssuerOption !== undefined) {
        throw new Error('duplicate --trusted-issuer');
      }
      if (!value || value.startsWith('-')) {
        throw new Error('--trusted-issuer requires an issuer id');
      }
      trustedIssuerOption = value;
    } else if (option === '--actor') {
      if (actorOption !== undefined) throw new Error('duplicate --actor');
      if (!value || value.startsWith('-')) {
        throw new Error('--actor requires an operator id');
      }
      actorOption = value;
    } else if (option === '--budget-journal') {
      if (budgetJournalOption !== undefined) {
        throw new Error('duplicate --budget-journal');
      }
      if (!value || value.startsWith('-')) {
        throw new Error('--budget-journal requires a path');
      }
      budgetJournalOption = value;
    } else if (option === '--brave-env') {
      if (!value || value.startsWith('-')) {
        throw new Error('--brave-env requires an environment variable name');
      }
      searchEnvOption = value;
    } else if (option === '--search-provider') {
      if (value !== 'brave' && value !== 'tavily') {
        throw new Error('--search-provider must be brave or tavily');
      }
      searchProviderOption = value;
      if (
        value === 'tavily' &&
        searchEnvOption === 'MAMMOTH_SEARCH_BRAVE_API_KEY'
      ) {
        searchEnvOption = 'TAVILY_API_KEY';
      }
    } else if (option === '--search-env') {
      if (!value || value.startsWith('-')) {
        throw new Error('--search-env requires an environment variable name');
      }
      searchEnvOption = value;
    } else if (option === '--model-env') {
      if (!value || value.startsWith('-')) {
        throw new Error('--model-env requires an environment variable name');
      }
      modelEnvOption = value;
    } else if (option === '--model-base-url') {
      if (!value || value.startsWith('-')) {
        throw new Error('--model-base-url requires a URL');
      }
      modelBaseUrlOption = value;
    } else if (option === '--model') {
      if (!value || value.startsWith('-')) {
        throw new Error('--model requires a model id');
      }
      modelIdOption = value;
    } else if (option === '--authorized-retrieval-origin') {
      if (!value || value.startsWith('-')) {
        throw new Error('--authorized-retrieval-origin requires an origin URL');
      }
      authorizedRetrievalOrigins.push(new URL(value).origin);
    } else {
      throw new Error(`unknown investigate option: ${String(option)}`);
    }
    index += 1;
  }
  if (!approve) {
    throw new Error(
      'governed execution requires an explicit operator approval: pass --approve to approve the previewed plan',
    );
  }
  if (!live && !sourcesOption) {
    throw new Error(
      'governed offline execution requires --offline-sources CATALOG.json declaring the complete source universe',
    );
  }
  if (live && !budgetJournalOption) {
    throw new Error(
      'governed live execution requires --budget-journal PATH for the durable spend journal',
    );
  }
  const now = dependencies.now?.() ?? new Date().toISOString();
  const actorId = actorOption ?? 'operator:local';

  const previewResult = createInvestigationPreview(question);
  const preview = previewResult.preview;
  const approval = recordInvestigationApproval({
    approvalId: `approval:${preview.investigationId}`,
    investigationId: preview.investigationId,
    previewDigest: preview.previewDigest,
    decision: 'approve',
    actorId,
    actorKind: 'human_operator',
    reason:
      'operator explicitly approved governed offline execution of the previewed plan',
    decidedAt: now,
  });
  const binding = bindApprovedInvestigationPlan({ preview, approval });
  if (!binding.plan) {
    throw new Error(
      `plan binding was rejected: ${binding.receipt.reasonCodes.join(', ')}`,
    );
  }
  const plan = binding.plan;
  const intentSet = deriveAcquisitionIntents(plan);
  const budgetJournalPath =
    budgetJournalOption === undefined
      ? undefined
      : resolve(cwd, budgetJournalOption);
  const effectAuthority = live
    ? mintLoopLiveAuthorityReceipt({
        plan,
        bindingReceiptDigest: binding.receipt.receiptDigest,
        actorId,
        authorizedAt: now,
        budgetJournalPath: budgetJournalPath ?? '',
        modelBaseUrl: modelBaseUrlOption,
        authorizedRetrievalOrigins,
      })
    : mintOfflineFixtureAuthorityReceipt({
        planId: plan.planId,
        planDigest: plan.planDigest,
        question: plan.question,
        actorId,
        authorizedAt: now,
      });
  const release = evaluateAcquisitionRelease({
    intentSet,
    effectAuthority,
    ...(trustedIssuerOption === undefined
      ? {}
      : { trustedIssuerId: trustedIssuerOption }),
    now,
  });

  const outputDirectory = resolve(
    cwd,
    outputOption ??
      join(
        'investigations',
        `${slug(question)}-${preview.investigationId.slice(-8)}-run`,
      ),
  );
  await mkdir(dirname(outputDirectory), { recursive: true });
  await mkdir(outputDirectory);
  const writeArtifact = async (name: string, content: string) => {
    const path = join(outputDirectory, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, { encoding: 'utf8', flag: 'wx' });
  };
  const writeJsonArtifact = (name: string, value: unknown) =>
    writeArtifact(name, `${JSON.stringify(value, null, 2)}\n`);

  for (const name of INVESTIGATION_ARTIFACT_NAMES) {
    const artifact = previewResult.artifacts[name];
    await writeArtifact(
      name,
      typeof artifact === 'string'
        ? artifact
        : `${JSON.stringify(artifact, null, 2)}\n`,
    );
  }
  await writeJsonArtifact('investigation-approval.json', approval);
  await writeJsonArtifact('plan-binding-receipt.json', binding.receipt);
  await writeJsonArtifact('investigation-plan.json', plan);
  await writeJsonArtifact('acquisition-intents.json', intentSet);
  await writeJsonArtifact('acquisition-release.json', release);
  await writeJsonArtifact('effect-authority.json', effectAuthority);

  if (release.decision !== 'authorized') {
    io.stdout(
      JSON.stringify({
        command: 'investigate',
        status: 'acquisition_release_refused',
        outputDirectory,
        planDigest: plan.planDigest,
        intentSetDigest: intentSet.intentSetDigest,
        decision: release.decision,
        reasonCodes: release.reasonCodes,
        executionAuthorized: false,
        externalEffectsExecuted: false,
      }),
    );
    return 0;
  }

  const execution = live
    ? await executeGovernedLiveAcquisition({
        intentSet,
        release,
        effectAuthority,
        trustedIssuerId: trustedIssuerOption,
        now,
        budgetJournalPath: budgetJournalPath ?? '',
        searchProvider: searchProviderOption,
        searchApiKeyEnvVar: searchEnvOption,
        modelApiKeyEnvVar: modelEnvOption,
        modelBaseUrl: modelBaseUrlOption,
        modelId: modelIdOption,
      })
    : executeGovernedAcquisition({
        intentSet,
        release,
        effectAuthority,
        trustedIssuerId: trustedIssuerOption,
        adapters: buildOfflineNoEffectAdapters(
          await readJson(
            resolve(cwd, sourcesOption ?? ''),
            'offline source catalog',
          ),
        ),
        now,
      });
  const bundle = composeGovernedInvestigationBundle({
    plan,
    intentSet,
    release,
    execution,
    now,
  });
  for (const [name, content] of Object.entries(bundle.files)) {
    await writeArtifact(name, content);
  }
  await writeJsonArtifact(
    'live-price-catalog.json',
    buildInvestigateLivePriceCatalog(),
  );
  if (live && budgetJournalPath) {
    await writeArtifact(
      'audit/durable-budget-journal.jsonl',
      await readFile(budgetJournalPath, 'utf8'),
    );
  }
  io.stdout(
    JSON.stringify({
      command: 'investigate',
      status: live
        ? 'governed_live_execution_complete'
        : 'governed_execution_complete',
      outputDirectory,
      runId: bundle.runId,
      planDigest: plan.planDigest,
      intentSetDigest: intentSet.intentSetDigest,
      releaseDigest: release.releaseDigest,
      trustedIssuerId: trustedIssuerOption,
      offlineFixtureIssuerId: OFFLINE_FIXTURE_ISSUER_ID,
      executionMode: execution.executionMode,
      decision: release.decision,
      reasonCodes: release.reasonCodes,
      admittedClaims: execution.claims.filter(
        (claim) => claim.decision === 'admitted',
      ).length,
      rejectedClaims: execution.claims.filter(
        (claim) => claim.decision !== 'admitted',
      ).length,
      snapshots: execution.snapshots.length,
      executionAuthorized: true,
      externalEffectsExecuted: execution.externalEffectsExecuted,
    }),
  );
  return 0;
}

function mintLoopLiveAuthorityReceipt(input: {
  readonly plan: {
    readonly planId: string;
    readonly planDigest: string;
    readonly question: string;
    readonly sourcePreviewDigest: string;
  };
  readonly bindingReceiptDigest: string;
  readonly actorId: string;
  readonly authorizedAt: string;
  readonly budgetJournalPath: string;
  readonly modelBaseUrl: string;
  readonly authorizedRetrievalOrigins: readonly string[];
}) {
  if (!input.budgetJournalPath.trim()) {
    throw new Error('live authority requires a budget journal path');
  }
  const consumptionNonce = `loop-live-${randomUUID()}`;
  const executionId = `investigate-live:${canonicalDigest({
    planDigest: input.plan.planDigest,
    consumptionNonce,
  }).slice(7, 23)}`;
  const budgetLimit = {
    currencyUsd: 15,
    requests: 10_000,
    inputTokens: 2_000_000,
    outputTokens: 500_000,
    bytes: 2_000_000_000,
    durationMs: 7_200_000,
  };
  const priceCatalog = buildInvestigateLivePriceCatalog();
  const modelOrigin = new URL(input.modelBaseUrl).origin;
  if (modelOrigin !== 'https://openrouter.ai') {
    throw new Error(
      'governed live investigate currently authorizes only the OpenRouter model destination',
    );
  }
  const consumptionStoreDigest = canonicalDigest({
    kind: 'p9-consumption-store/v1',
    id: input.budgetJournalPath,
  });
  const planScope = {
    proposalId: `proposal:${input.plan.planId}`,
    proposalDigest: input.plan.sourcePreviewDigest,
    planId: input.plan.planId,
    planDigest: input.plan.planDigest,
    acceptanceReceiptDigest: input.bindingReceiptDigest,
    question: input.plan.question,
    questionDigest: canonicalDigest(input.plan.question),
    domainPackId: 'general-web/v1' as const,
    packDigest: canonicalDigest({
      kind: 'investigate-live-general-web-pack/v1',
    }),
    budgetAllocation: {
      currencyUsd: 15,
      searchUsd: 4,
      retrievalParsingUsd: 1,
      modelsUsd: 10,
    },
  };
  const identity = {
    schemaVersion: '1.0.0' as const,
    contractFamily: 'p9.v1' as const,
    authorityId: `authority:${executionId}`,
    issuerId: 'mammoth-core-loop-live-authority/v1',
    decision: 'authorized' as const,
    reason:
      'Active live-effect authority in AGENTS.md granted 2026-07-17 for Outcome 1 normal-path holdouts under a USD 15 aggregate ceiling.',
    executionId,
    executionDigest: canonicalDigest({
      executionId,
      planDigest: input.plan.planDigest,
      questionDigest: canonicalDigest(input.plan.question),
      consumptionNonce,
    }),
    consumptionNonce,
    consumptionStoreId: input.budgetJournalPath,
    consumptionStoreDigest,
    maximumExecutions: 1 as const,
    planScope,
    priceCatalogId: priceCatalog.catalogId,
    priceCatalogVersion: priceCatalog.version,
    priceCatalogDigest: priceCatalog.catalogDigest,
    providerProfileCatalogId: 'investigate-live-provider-profiles/v1',
    providerProfileCatalogVersion: '1.0.0',
    providerProfileCatalogDigest: canonicalDigest({
      kind: 'investigate-live-provider-profiles/v1',
      modelOrigin,
    }),
    sourceClassificationPolicyDigest: canonicalDigest({
      kind: 'investigate-live-source-classification/v1',
      sourceClasses: ['public_web', 'counterevidence'],
    }),
    authorizedProfileIds: [
      'brave-search-live',
      'public-retrieval-live',
      'bounded-parser-live',
      'openai-compatible-review-live',
    ],
    proposerProfileId: 'openai-compatible-review-live',
    evaluatorProfileId: 'openai-compatible-review-live',
    budgetLimit,
    authorizedEffectKinds: ['search', 'retrieval', 'parser', 'model'] as const,
    authorizedDestinationOrigins: [
      'https://api.search.brave.com',
      'https://api.tavily.com',
      modelOrigin,
    ],
    authorizedRetrievalOrigins:
      input.authorizedRetrievalOrigins.length > 0
        ? [...new Set(input.authorizedRetrievalOrigins)]
        : [PUBLIC_WEB_RETRIEVAL_AUTHORITY_ORIGIN],
    authorizedBillingAccountIds: ['mammoth-core-loop-live'],
    actorId: input.actorId,
    authorizedAt: input.authorizedAt,
    notBeforeAt: input.authorizedAt,
    expiresAt: new Date(
      Date.parse(input.authorizedAt) + 48 * 60 * 60 * 1000,
    ).toISOString(),
  };
  return P9LiveAuthorityReceiptSchema.parse({
    ...identity,
    receiptDigest: canonicalDigest(identity),
  });
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
  return 'usage: mammoth investigate "QUESTION OR THEORY" [--output PATH]\n       mammoth investigate --plan PLAN.json [--authority RECEIPT.json] [--trusted-issuer ISSUER_ID] [--output PATH]\n       mammoth investigate --execute "QUESTION OR THEORY" --offline-sources CATALOG.json --approve [--trusted-issuer ISSUER_ID] [--actor OPERATOR_ID] [--output PATH]\n       mammoth investigate --execute "QUESTION OR THEORY" --live --approve --trusted-issuer mammoth-core-loop-live-authority/v1 --budget-journal PATH [--search-provider brave|tavily] [--authorized-retrieval-origin ORIGIN] [--model MODEL] [--output PATH]';
}
