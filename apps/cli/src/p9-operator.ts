import { constants } from 'node:fs';
import { mkdir, open, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import {
  canonicalDigest,
  P9LiveAuthorityReceiptSchema,
  P9ProviderProfileCatalogSchema,
  type P9LiveAuthorityReceipt,
  type P9ProviderProfile,
  type P9ProviderProfileCatalog,
  type PlanAcceptanceReceipt,
  PlanAcceptanceReceiptSchema,
  type ProviderPriceCatalog,
  ProviderPriceCatalogSchema,
  type ResearchPlan,
  ResearchPlanProposalSchema,
  ResearchPlanSchema,
} from '@mammoth/domain';
import {
  acceptResearchPlan,
  assertP9LiveAuthorityLineage,
  FileP9DurableJournalStore,
  GovernanceError,
  P9_DOMAIN_POLICY_PACKS,
  previewResearchPlan,
  reviseResearchPlan,
  type PlanAcceptanceThresholds,
} from '@mammoth/governance';
import {
  assertP9AcceptedPlanChain,
  BraveP9LiveSearchAdapter,
  OpenAICompatibleP9LiveModelAdapter,
  P9OfflineCorpusSchema,
  P9_LIVE_EXHIBITION_QUESTION,
  P9_LIVE_SOURCE_CLASSIFICATION_POLICY_DIGEST,
  buildAcceptedP9LivePlan,
  runP9LiveApplication,
  resealP9LiveArtifacts,
  runP9PlanDrivenResearch,
  verifyP9ExactBundle,
  verifyP9LiveBundle,
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
  readonly providerProfileCatalogDigest: string | null;
  readonly liveAuthorityReceiptDigest: string | null;
}

export interface P9CliDependencies {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly now?: () => string;
  readonly fetchImpl?: typeof fetch;
}

export function evaluateP9LiveExhibitionSufficiency(input: {
  readonly coverageVerdict: 'covered' | 'insufficient';
  readonly verifiedCitationCount: number;
  readonly stopCriterionStatuses: readonly {
    readonly stopId: string;
    readonly status: 'met' | 'not_met';
  }[];
}): {
  readonly succeeded: boolean;
  readonly unmetStopCriteria: readonly string[];
} {
  const unmetStopCriteria = input.stopCriterionStatuses
    .filter((criterion) => criterion.status !== 'met')
    .map((criterion) => criterion.stopId);
  return {
    succeeded:
      input.coverageVerdict === 'covered' &&
      input.verifiedCitationCount > 0 &&
      unmetStopCriteria.length === 0,
    unmetStopCriteria,
  };
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
  expected: {
    readonly plan?: ResearchPlan;
    readonly acceptanceReceipt?: PlanAcceptanceReceipt;
    readonly executionId?: string;
    readonly question?: string;
    readonly sourceClassificationPolicyDigest?: string;
    readonly now?: string;
  } = {},
): Promise<P9LiveReadiness> {
  const blockers: string[] = [];
  let priceCatalogDigest: string | null = null;
  let providerProfileCatalogDigest: string | null = null;
  let liveAuthorityReceiptDigest: string | null = null;
  let proposerFamily: string | null = null;
  let evaluatorFamily: string | null = null;
  const catalogPath = env.MAMMOTH_P9_PRICE_CATALOG_PATH;
  const profileCatalogPath = env.MAMMOTH_P9_PROVIDER_PROFILE_CATALOG_PATH;
  const authorityPath = env.MAMMOTH_P9_LIVE_AUTHORITY_RECEIPT_PATH;
  const journalPath = env.MAMMOTH_P9_BUDGET_JOURNAL_PATH;
  const expectedAuthorityDigest = env.MAMMOTH_P9_EXPECTED_AUTHORITY_DIGEST;
  const trustedIssuerId = env.MAMMOTH_P9_TRUSTED_AUTHORIZER_ID;
  if (!expectedAuthorityDigest) blockers.push('authority_trust_anchor_missing');
  if (!trustedIssuerId) blockers.push('trusted_authorizer_missing');
  if (!journalPath) {
    blockers.push('authority_consumption_store_missing');
  }
  let catalog: ProviderPriceCatalog | null = null;
  let profileCatalog: P9ProviderProfileCatalog | null = null;
  let authority: P9LiveAuthorityReceipt | null = null;
  if (!catalogPath) {
    blockers.push('immutable_price_catalog_missing');
  } else {
    try {
      catalog = ProviderPriceCatalogSchema.parse(
        JSON.parse(await readFile(resolve(catalogPath), 'utf8')),
      );
      priceCatalogDigest = catalog.catalogDigest;
    } catch {
      blockers.push('immutable_price_catalog_invalid');
    }
  }
  if (!profileCatalogPath) {
    blockers.push('immutable_provider_profile_catalog_missing');
  } else {
    try {
      profileCatalog = P9ProviderProfileCatalogSchema.parse(
        JSON.parse(await readFile(resolve(profileCatalogPath), 'utf8')),
      );
      providerProfileCatalogDigest = profileCatalog.catalogDigest;
    } catch {
      blockers.push('immutable_provider_profile_catalog_invalid');
    }
  }
  if (!authorityPath) {
    blockers.push('scoped_live_authority_receipt_missing');
  } else {
    try {
      authority = P9LiveAuthorityReceiptSchema.parse(
        JSON.parse(await readFile(resolve(authorityPath), 'utf8')),
      );
      liveAuthorityReceiptDigest = authority.receiptDigest;
    } catch {
      blockers.push('scoped_live_authority_receipt_invalid');
    }
  }
  if (authority && journalPath) {
    const resolvedJournalPath = resolve(journalPath);
    if (
      authority.consumptionStoreId !== resolvedJournalPath ||
      authority.consumptionStoreDigest !==
        canonicalDigest({
          kind: 'p9-consumption-store/v1',
          id: resolvedJournalPath,
        })
    ) {
      blockers.push('authorization_consumption_store_mismatch');
    }
  }
  if (!expected.plan) blockers.push('accepted_plan_missing');
  if (!expected.acceptanceReceipt)
    blockers.push('plan_acceptance_receipt_missing');
  if (!expected.executionId) blockers.push('execution_identity_missing');
  if (!expected.question) blockers.push('authorized_question_missing');
  if (!expected.sourceClassificationPolicyDigest) {
    blockers.push('source_classification_policy_missing');
  }
  if (
    catalog &&
    profileCatalog &&
    authority &&
    expectedAuthorityDigest &&
    trustedIssuerId &&
    expected.plan &&
    expected.acceptanceReceipt &&
    expected.executionId &&
    expected.question &&
    expected.sourceClassificationPolicyDigest
  ) {
    try {
      const lineage = assertP9LiveAuthorityLineage({
        receipt: authority,
        profileCatalog,
        priceCatalog: catalog,
        expectedAuthorityDigest,
        trustedIssuerId,
        executionId: expected.executionId,
        question: expected.question,
        sourceClassificationPolicyDigest:
          expected.sourceClassificationPolicyDigest,
        plan: expected.plan,
        acceptanceReceipt: expected.acceptanceReceipt,
        now: expected.now ?? new Date().toISOString(),
      });
      proposerFamily = lineage.proposerProfile.profileFamilyId;
      evaluatorFamily = lineage.evaluatorProfile.profileFamilyId;
      if (
        lineage.proposerProfile.destinationOrigin !==
          lineage.evaluatorProfile.destinationOrigin ||
        lineage.proposerProfile.credentialEnvVar !==
          lineage.evaluatorProfile.credentialEnvVar ||
        lineage.proposerProfile.billingAccountId !==
          lineage.evaluatorProfile.billingAccountId ||
        lineage.proposerProfile.provider !== lineage.evaluatorProfile.provider
      ) {
        blockers.push('model_transport_profiles_not_cohosted');
      }
      for (const profile of lineage.profiles) {
        if (
          profile.credentialEnvVar &&
          !env[profile.credentialEnvVar]?.trim()
        ) {
          blockers.push(`provider_credential_missing:${profile.profileId}`);
        }
      }
    } catch (error) {
      blockers.push(
        error instanceof GovernanceError
          ? error.code
          : 'live_authority_lineage_invalid',
      );
    }
  }
  return {
    ready: blockers.length === 0,
    blockers,
    proposerProfileFamily: proposerFamily ?? null,
    evaluatorProfileFamily: evaluatorFamily ?? null,
    priceCatalogDigest,
    providerProfileCatalogDigest,
    liveAuthorityReceiptDigest,
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
      assertOptions(tail, ['--output', '--max-candidates']);
      return await liveCommand(tail, io, env, dependencies, now());
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
      assertOptions(tail.slice(1), [
        '--output',
        '--offline-corpus',
        '--execution-id',
      ]);
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
    const executionId = option(argv.slice(1), '--execution-id');
    const sourceClassificationPolicyDigest =
      env.MAMMOTH_P9_EXPECTED_SOURCE_POLICY_DIGEST;
    const readiness = await inspectP9LiveReadiness(env, {
      plan,
      acceptanceReceipt: receipt,
      question: plan.question,
      now: timestamp,
      ...(executionId ? { executionId } : {}),
      ...(sourceClassificationPolicyDigest
        ? { sourceClassificationPolicyDigest }
        : {}),
    });
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

async function liveCommand(
  argv: readonly string[],
  io: P9CliIo,
  env: Readonly<Record<string, string | undefined>>,
  dependencies: P9CliDependencies,
  timestamp: string,
): Promise<number> {
  const configurationReadiness = await inspectP9LiveReadiness(env);
  const deferredLineageBlockers = new Set([
    'accepted_plan_missing',
    'plan_acceptance_receipt_missing',
    'execution_identity_missing',
    'authorized_question_missing',
    'source_classification_policy_missing',
  ]);
  const configurationBlockers = configurationReadiness.blockers.filter(
    (blocker) => !deferredLineageBlockers.has(blocker),
  );
  if (configurationBlockers.length > 0) {
    io.stderr(
      JSON.stringify({
        command: 'p9-live',
        phase: 'p9',
        status: 'blocked_before_effects',
        ...configurationReadiness,
        blockers: configurationBlockers,
        ready: false,
      }),
    );
    return 3;
  }
  const catalog = await readJson(
    requiredEnv(env, 'MAMMOTH_P9_PRICE_CATALOG_PATH'),
    ProviderPriceCatalogSchema,
  );
  const profileCatalog = await readJson(
    requiredEnv(env, 'MAMMOTH_P9_PROVIDER_PROFILE_CATALOG_PATH'),
    P9ProviderProfileCatalogSchema,
  );
  const authorityReceipt = await readJson(
    requiredEnv(env, 'MAMMOTH_P9_LIVE_AUTHORITY_RECEIPT_PATH'),
    P9LiveAuthorityReceiptSchema,
  );
  const proposerProfile = requiredProfile(
    profileCatalog,
    authorityReceipt.proposerProfileId,
  );
  const evaluatorProfile = requiredProfile(
    profileCatalog,
    authorityReceipt.evaluatorProfileId,
  );
  const planBundle = buildAcceptedP9LivePlan({
    budgetUsd: authorityReceipt.planScope.budgetAllocation.currencyUsd,
    now: authorityReceipt.authorizedAt,
    proposerProfile: toModelProfile(proposerProfile),
  });
  const readiness = await inspectP9LiveReadiness(env, {
    plan: planBundle.plan,
    acceptanceReceipt: planBundle.acceptanceReceipt,
    executionId: authorityReceipt.executionId,
    question: P9_LIVE_EXHIBITION_QUESTION,
    sourceClassificationPolicyDigest:
      P9_LIVE_SOURCE_CLASSIFICATION_POLICY_DIGEST,
    now: timestamp,
  });
  if (!readiness.ready) {
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
  const searchProfile = requiredRoleProfile(profileCatalog, 'search');
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const dependencyNow = dependencies.now;
  const liveNow = dependencyNow ? () => new Date(dependencyNow()) : undefined;
  const maxCandidates = numericOption(argv, '--max-candidates');
  const journal = new FileP9DurableJournalStore(
    resolve(requiredEnv(env, 'MAMMOTH_P9_BUDGET_JOURNAL_PATH')),
  );
  const run = await runP9LiveApplication({
    executionId: authorityReceipt.executionId,
    budgetUsd: authorityReceipt.budgetLimit.currencyUsd,
    authorizationReceipt: authorityReceipt,
    catalog,
    providerProfileCatalog: profileCatalog,
    expectedAuthorityDigest: requiredEnv(
      env,
      'MAMMOTH_P9_EXPECTED_AUTHORITY_DIGEST',
    ),
    trustedIssuerId: requiredEnv(env, 'MAMMOTH_P9_TRUSTED_AUTHORIZER_ID'),
    sourceClassificationPolicyDigest:
      P9_LIVE_SOURCE_CLASSIFICATION_POLICY_DIGEST,
    journal,
    search: new BraveP9LiveSearchAdapter({
      apiKeyEnvironmentVariable: requiredCredentialEnv(searchProfile),
      environment: env,
      fetchImpl,
      ...(liveNow ? { now: liveNow } : {}),
    }),
    model: new OpenAICompatibleP9LiveModelAdapter({
      baseUrl: proposerProfile.destinationOrigin,
      apiKeyEnvironmentVariable: requiredCredentialEnv(proposerProfile),
      proposerProfile: toModelProfile(proposerProfile),
      evaluatorProfile: toModelProfile(evaluatorProfile),
      proposerMaxOutputTokens: proposerProfile.requestCeiling.outputTokens,
      evaluatorMaxOutputTokens: evaluatorProfile.requestCeiling.outputTokens,
      environment: env,
      fetchImpl,
      ...(liveNow ? { now: liveNow } : {}),
    }),
    ...(liveNow ? { now: liveNow } : {}),
    ...(maxCandidates !== undefined ? { maxCandidates } : {}),
  });
  const artifacts = resealP9LiveArtifacts({
    ...run.artifacts,
    'live-authority-receipt.json': JSON.stringify(
      run.authorizationReceipt,
      null,
      2,
    ),
    'live-price-catalog.json': JSON.stringify(catalog, null, 2),
    'live-provider-profile-catalog.json': JSON.stringify(
      profileCatalog,
      null,
      2,
    ),
    'live-effect-receipts.jsonl': toJsonLines(run.effectReceipts),
    'live-recovered-reservations.jsonl': toJsonLines(run.recoveredReservations),
    'live-budget-journal.jsonl': `${journal.readLines().join('\n')}\n`,
  });
  const outputDirectory = resolve(
    option(argv, '--output') ?? `research/p9-live-${slug(timestamp)}`,
  );
  await writeFreshP9Bundle(outputDirectory, artifacts);
  const verification = verifyP9LiveBundle(
    await loadP9BundleDirectory(outputDirectory),
    {
      expectedAuthorityDigest: requiredEnv(
        env,
        'MAMMOTH_P9_EXPECTED_AUTHORITY_DIGEST',
      ),
      trustedIssuerId: requiredEnv(env, 'MAMMOTH_P9_TRUSTED_AUTHORIZER_ID'),
    },
  );
  const sufficiency = evaluateP9LiveExhibitionSufficiency({
    coverageVerdict: run.assessment.verdict,
    verifiedCitationCount: verification.verifiedCitationCount,
    stopCriterionStatuses: run.assessment.stopCriterionStatuses,
  });
  io.stdout(
    JSON.stringify({
      command: 'p9-live',
      status: sufficiency.succeeded ? 'sufficient' : 'insufficient_exhibition',
      outputDirectory,
      manifestId: verification.manifest.manifestId,
      verifiedCitationCount: verification.verifiedCitationCount,
      effectReceiptCount: run.effectReceipts.length,
      coverageVerdict: run.assessment.verdict,
      unmetStopCriteria: sufficiency.unmetStopCriteria,
    }),
  );
  return sufficiency.succeeded ? 0 : 1;
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

function requiredProfile(
  catalog: P9ProviderProfileCatalog,
  profileId: string,
): P9ProviderProfile {
  const profile = catalog.profiles.find(
    (entry) => entry.profileId === profileId,
  );
  if (!profile) throw new Error(`provider profile not found: ${profileId}`);
  return profile;
}

function requiredRoleProfile(
  catalog: P9ProviderProfileCatalog,
  role: P9ProviderProfile['role'],
): P9ProviderProfile {
  const profile = catalog.profiles.find((entry) => entry.role === role);
  if (!profile) throw new Error(`provider profile role not found: ${role}`);
  return profile;
}

function requiredCredentialEnv(profile: P9ProviderProfile): string {
  if (!profile.credentialEnvVar) {
    throw new Error(
      `provider profile ${profile.profileId} has no credential env var`,
    );
  }
  return profile.credentialEnvVar;
}

function toModelProfile(profile: P9ProviderProfile): {
  readonly profileVersionId: string;
  readonly profileFamilyId: string;
  readonly modelId: string;
} {
  if (!profile.modelId) {
    throw new Error(
      `provider profile ${profile.profileId} has no model identity`,
    );
  }
  return {
    profileVersionId: profile.profileId,
    profileFamilyId: profile.profileFamilyId,
    modelId: profile.modelId,
  };
}

function toJsonLines(values: readonly unknown[]): string {
  return values.map((value) => JSON.stringify(value)).join('\n') + '\n';
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

function numericOption(
  argv: readonly string[],
  name: string,
): number | undefined {
  const value = option(argv, name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} requires a positive integer`);
  }
  return parsed;
}

function requiredEnv(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
): string {
  const value = env[name];
  if (!value?.trim()) throw new Error(`${name} is required`);
  return value.trim();
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
