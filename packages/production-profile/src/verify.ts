import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  RESEARCH_CELL_CONTRACT_VERSION,
  cellInputDigest,
  modelProfileVersionDigest,
  researchPositionDigest,
  type ModelProfileVersion,
  type ResearchPosition,
} from '@mammoth/domain';
import {
  PostgresEpistemicLedger,
  PostgresActivityEffectStore,
  PostgresLifecycle,
  PostgresModelLineageRepository,
  PostgresResearchCellRepository,
  PostgresWorkState,
  foundationMigrations,
  type PostgresConnection,
} from '@mammoth/postgres-adapter';
import {
  P4_ADMISSION_POLICY_DIGEST,
  P4_ADMISSION_POLICY_VERSION,
} from '@mammoth/persistence';
import {
  canonicalDigest,
  effectIdempotencyKey,
  type ActivityInvocationV1,
  type CompletedEffectV1,
} from '@mammoth/work-queue';
import type { ProfileConfig } from './config.js';
import { run } from './commands.js';
import { NodePostgresDriver } from './driver.js';
import {
  buildManifest,
  verifyManifest,
  writeArtifact,
  type IntegrityManifest,
} from './integrity.js';
import { NativePostgresService } from './service.js';
import { postgresTool } from './tools.js';

const lifecycleConfig = {
  applicationName: 'mammoth-production-profile',
  connectionTimeoutMs: 5_000,
  statementTimeoutMs: 10_000,
  transactionTimeoutMs: 15_000,
  shutdownTimeoutMs: 10_000,
} as const;

const p4Fixture = {
  now: '2026-07-13T19:00:00.000Z',
  programId: 'p4-profile-program',
  workItemId: 'p4-profile-work',
  modelProfileId: 'p4-profile-model',
  modelProfileVersionId: 'p4-profile-model-version-1',
  cellPlanId: 'p4-profile-cell-plan',
  positionId: 'p4-profile-position',
  rejectedResidueId: 'p4-profile-rejected-residue',
  receiptId: 'p4-profile-receipt',
} as const;

export async function verifyLifecycle(
  config: ProfileConfig,
): Promise<IntegrityManifest> {
  const service = new NativePostgresService(config);
  let active:
    | { lifecycle: PostgresLifecycle; connection: PostgresConnection }
    | undefined;
  try {
    if (await service.ready()) await service.stop();
    if (await service.ready())
      throw new Error(
        'unready-startup gate failed: Postgres still accepts connections after bounded stop',
      );
    await service.start();
    active = await connect(service);
    const readiness = await active.lifecycle.readiness();
    if (!readiness.ready)
      throw new Error(`readiness gate failed: ${readiness.detail}`);
    const ledger = new PostgresEpistemicLedger(active.connection, {
      transaction: { statementTimeoutMs: 10_000, transactionTimeoutMs: 15_000 },
    });
    if ((await ledger.read()).revision === 0)
      await ledger.transact(() => undefined);
    await seedCompletedEffect(active.connection);
    const activityFixture = await seedActivityEffect(active.connection);
    await writeArtifact(
      config.root,
      new TextEncoder().encode('mammoth-production-profile-fixture-v1'),
    );
    const before = await buildManifest(active.connection, config.root);
    await active.lifecycle.shutdown();
    active = undefined;
    await service.kill();
    if (await service.ready())
      throw new Error('forced-kill gate failed: Postgres remained ready');
    await service.start();
    active = await connect(service);
    await verifyActivityEffect(active.connection, activityFixture);
    verifyManifest(before, await buildManifest(active.connection, config.root));
    return before;
  } finally {
    if (active) await active.lifecycle.shutdown().catch(() => undefined);
    await service.stop().catch(() => undefined);
  }
}

export interface P4LifecycleVerification {
  readonly schemaVersion: 1;
  readonly migrationVersion: 5;
  readonly programId: string;
  readonly modelProfileVersionId: string;
  readonly modelProfileVersionDigest: string;
  readonly cellPlanId: string;
  readonly cellInputDigest: string;
  readonly positionId: string;
  readonly positionDigest: string;
  readonly rejectedResidueId: string;
  readonly rejectedResidueDigest: string;
  readonly receiptId: string;
  readonly receiptDigest: string;
}

/** P4 authority gate; deliberately independent from P2 and Temporal/P3. */
export async function verifyP4Lifecycle(
  config: ProfileConfig,
): Promise<P4LifecycleVerification> {
  const service = new NativePostgresService(config);
  let active:
    | { lifecycle: PostgresLifecycle; connection: PostgresConnection }
    | undefined;
  try {
    if (await service.ready()) await service.stop();
    if (await service.ready())
      throw new Error(
        'P4 unready-startup gate failed: Postgres still accepts connections after bounded stop',
      );
    await service.start();
    active = await connect(service);
    const readiness = await active.lifecycle.readiness();
    if (!readiness.ready)
      throw new Error(`P4 readiness gate failed: ${readiness.detail}`);

    const fixture = await seedResearchCell(active.connection);
    const expected = p4LifecycleVerification(fixture.state);
    await active.lifecycle.shutdown();
    active = undefined;
    await service.kill();
    if (await service.ready())
      throw new Error('P4 forced-kill gate failed: Postgres remained ready');

    await service.start();
    active = await connect(service);
    const reconstructed = await verifyResearchCell(active.connection, fixture);
    const actual = p4LifecycleVerification(reconstructed);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(
        'P4 deterministic verification result changed on restart',
      );
    }
    return actual;
  } finally {
    if (active) await active.lifecycle.shutdown().catch(() => undefined);
    await service.stop().catch(() => undefined);
  }
}

type ReconstructedResearchCellState = Awaited<
  ReturnType<PostgresResearchCellRepository['reconstructProgram']>
>;

interface ResearchCellFixture {
  readonly state: ReconstructedResearchCellState;
  readonly positionDigest: string;
}

async function seedResearchCell(
  connection: PostgresConnection,
): Promise<ResearchCellFixture> {
  const repositories = researchCellRepositories(connection);
  const existing = await repositories.cells.reconstructProgram(
    p4Fixture.programId,
  );
  if (existing.cellPlans.length > 0) return verifySeededResearchCell(existing);

  const work = new PostgresWorkState(connection, {
    transaction: lifecycleConfig,
    now: () => p4Fixture.now,
    id: () => 'p4-profile-work-event',
  });
  await work.enqueue({
    id: p4Fixture.workItemId,
    payload: { kind: 'research-cell', programId: p4Fixture.programId },
    maxAttempts: 3,
  });

  const profileContract = {
    id: p4Fixture.modelProfileId,
    provider: 'p4-profile-provider',
    family: 'p4-profile-family',
    displayName: 'p4-profile-model',
    activeVersionId: p4Fixture.modelProfileVersionId,
  };
  await repositories.lineage.upsertModelProfile({
    id: profileContract.id,
    provider: profileContract.provider,
    canonicalName: profileContract.displayName,
    familyId: profileContract.family,
    contract: profileContract,
    active: true,
    aliases: ['p4-profile-model-alias'],
    expectedRevision: 0,
  });

  const modelVersionBase = {
    id: p4Fixture.modelProfileVersionId,
    profileId: p4Fixture.modelProfileId,
    schemaVersion: RESEARCH_CELL_CONTRACT_VERSION as '1.0.0',
    provider: profileContract.provider,
    providerModelId: 'p4-profile-provider-model-v1',
    family: profileContract.family,
    checkpoint: 'p4-profile-checkpoint-v1',
    contextWindow: 128_000,
    modalities: ['text'],
    locality: 'cloud' as const,
    dataPolicyId: 'p4-profile-data-policy',
    costProfileId: 'p4-profile-cost-policy',
    lineage: {
      kind: 'known' as const,
      trainingLineageIds: ['p4-profile-training-lineage'],
      fineTuneLineageIds: [],
      sharedDerivationIds: [],
      parentVersionIds: [],
    },
    immutableDigest: canonicalDigest('placeholder'),
    recordedAt: p4Fixture.now,
  };
  const modelVersionContract = {
    ...modelVersionBase,
    immutableDigest: modelProfileVersionDigest(
      modelVersionBase as ModelProfileVersion,
    ),
  };
  await repositories.lineage.appendModelProfileVersion({
    contract: modelVersionContract,
    id: p4Fixture.modelProfileVersionId,
    profileId: p4Fixture.modelProfileId,
    profileRevision: 1,
    provider: profileContract.provider,
    modelName: modelVersionContract.providerModelId,
    checkpoint: modelVersionContract.checkpoint,
    familyId: profileContract.family,
    lineageStatus: 'known',
    trainingLineageIds: modelVersionContract.lineage.trainingLineageIds,
    fineTuneLineageIds: [],
    sharedDerivationIds: [],
    locality: 'cloud',
    modalities: ['text'],
    contextWindow: modelVersionContract.contextWindow,
    dataPolicyId: modelVersionContract.dataPolicyId,
    costProfileId: modelVersionContract.costProfileId,
    declaredAt: p4Fixture.now,
    metadata: { acceptanceFixture: 'p4-native-postgres-restart' },
  });

  const criterionDigest = canonicalDigest({
    criterionId: 'p4-profile-criterion',
    version: 1,
  });
  const cellInput = {
    schemaVersion: RESEARCH_CELL_CONTRACT_VERSION as '1.0.0',
    claimIds: ['p4-profile-claim'],
    evidenceIds: ['p4-profile-evidence'],
    hypothesisIds: ['p4-profile-hypothesis'],
    artifactIds: [],
  };
  const inputDigest = cellInputDigest(cellInput);
  const criterionRef = {
    criterionId: 'p4-profile-criterion',
    criterionVersion: 1,
    criterionDigest,
    branchId: 'p4-profile-main',
  };
  const cellPlanContract = {
    id: p4Fixture.cellPlanId,
    schemaVersion: RESEARCH_CELL_CONTRACT_VERSION as '1.0.0',
    programId: p4Fixture.programId,
    workItemId: p4Fixture.workItemId,
    templateId: 'p4-profile-template',
    templateVersion: 1,
    criterionRef,
    branchId: criterionRef.branchId,
    input: cellInput,
    inputDigest,
    outputContract: {
      kind: 'positions' as const,
      minimumCount: 1,
      schemaVersion: RESEARCH_CELL_CONTRACT_VERSION as '1.0.0',
    },
    plannedAt: p4Fixture.now,
  };
  await repositories.cells.createCellPlan({
    contract: cellPlanContract,
    id: p4Fixture.cellPlanId,
    programId: p4Fixture.programId,
    workItemId: p4Fixture.workItemId,
    criterionId: criterionRef.criterionId,
    criterionDigest,
    planVersion: 'cell-plan@1',
    templateVersion: '1',
    branchId: criterionRef.branchId,
    role: 'lateralist',
    inputDigest,
    outputContractVersion: RESEARCH_CELL_CONTRACT_VERSION,
    status: 'planned',
    revision: 0,
    fencingToken: 0,
    createdAt: p4Fixture.now,
    updatedAt: p4Fixture.now,
  });

  const positionBase = {
    id: p4Fixture.positionId,
    schemaVersion: RESEARCH_CELL_CONTRACT_VERSION as '1.0.0',
    programId: p4Fixture.programId,
    cellPlanId: p4Fixture.cellPlanId,
    workItemId: p4Fixture.workItemId,
    authorAgentId: 'p4-profile-agent',
    role: 'lateralist',
    criterionRef,
    modelProfileVersionId: p4Fixture.modelProfileVersionId,
    inputDigest,
    outputSchemaVersion: '1.0.0',
    answer: 'P4 authoritative restart reconstruction fixture.',
    claimIds: ['p4-profile-claim'],
    evidenceIds: ['p4-profile-evidence'],
    hypothesisIds: ['p4-profile-hypothesis'],
    artifactIds: [],
    proposalRefs: [{ kind: 'claim' as const, id: 'p4-profile-claim' }],
    assumptions: [],
    dissent: [],
    proposedFalsifiers: ['restart the authority service'],
    usage: {
      inputTokens: 10,
      outputTokens: 20,
      costUsd: 0.01,
      latencyMs: 50,
    },
    uncertaintyCodes: [],
    failureCodes: [],
    receiptRefs: [],
    canonicalDigest: canonicalDigest('placeholder'),
    createdAt: p4Fixture.now,
  };
  const positionContract = {
    ...positionBase,
    canonicalDigest: researchPositionDigest(positionBase as ResearchPosition),
  };
  await repositories.cells.recordPosition({
    contract: positionContract,
    admission: {
      decision: 'admitted',
      policyVersion: P4_ADMISSION_POLICY_VERSION,
      policyDigest: P4_ADMISSION_POLICY_DIGEST,
      subjectDigest: positionContract.canonicalDigest,
      reasonCodes: ['admitted'],
      decidedAt: p4Fixture.now,
    },
    id: p4Fixture.positionId,
    cellPlanId: p4Fixture.cellPlanId,
    programId: p4Fixture.programId,
    workItemId: p4Fixture.workItemId,
    criterionId: criterionRef.criterionId,
    criterionDigest,
    modelProfileId: p4Fixture.modelProfileId,
    modelProfileVersionId: p4Fixture.modelProfileVersionId,
    inputDigest,
    outputSchemaVersion: positionContract.outputSchemaVersion,
    positionDigest: positionContract.canonicalDigest,
    claimIds: positionContract.claimIds,
    evidenceIds: positionContract.evidenceIds,
    hypothesisIds: positionContract.hypothesisIds,
    proposalRefs: positionContract.proposalRefs,
    usage: positionContract.usage,
    uncertaintyCodes: positionContract.uncertaintyCodes,
    failureCodes: positionContract.failureCodes,
    body: positionContract,
    recordedAt: p4Fixture.now,
  });

  const rejectedPayload = {
    positionId: p4Fixture.positionId,
    reason: 'fixture-retains-rejected-proposal',
  };
  await repositories.cells.recordRejectedResidue({
    id: p4Fixture.rejectedResidueId,
    decision: 'rejected',
    programId: p4Fixture.programId,
    subjectType: 'position',
    subjectId: p4Fixture.positionId,
    reasonCode: 'p4-profile-fixture-rejection',
    policyVersion: P4_ADMISSION_POLICY_VERSION,
    policyDigest: P4_ADMISSION_POLICY_DIGEST,
    reasonCodes: ['p4-profile-fixture-rejection'],
    payloadDigest: canonicalDigest(rejectedPayload),
    payload: rejectedPayload,
    recordedAt: p4Fixture.now,
  });
  const receiptPayload = {
    positionId: p4Fixture.positionId,
    positionDigest: positionContract.canonicalDigest,
  };
  await repositories.cells.recordReceipt({
    id: p4Fixture.receiptId,
    programId: p4Fixture.programId,
    subjectType: 'position',
    subjectId: p4Fixture.positionId,
    workItemId: p4Fixture.workItemId,
    receiptKind: 'position-recorded',
    receiptDigest: canonicalDigest(receiptPayload),
    payload: receiptPayload,
    createdAt: p4Fixture.now,
  });

  return verifySeededResearchCell(
    await repositories.cells.reconstructProgram(p4Fixture.programId),
  );
}

async function verifyResearchCell(
  connection: PostgresConnection,
  fixture: ResearchCellFixture,
): Promise<ReconstructedResearchCellState> {
  const migration = await connection.query<{ version: number; name: string }>(
    'select version, name from mammoth_schema_migrations where version = 5 and applied_at is not null',
  );
  if (
    migration.rowCount !== 1 ||
    Number(migration.rows[0]?.version) !== 5 ||
    migration.rows[0]?.name !== 'research_cell_persistence'
  ) {
    throw new Error('P4 migration v5 was not durably applied');
  }
  const policyMetadata = await connection.query<{
    position_policy_version: string;
    position_policy_digest: string;
    residue_policy_version: string;
    residue_policy_digest: string;
  }>(
    `select recorded_position.admission_policy_version as position_policy_version,
            recorded_position.admission_policy_digest as position_policy_digest,
            residue.policy_version as residue_policy_version,
            residue.policy_digest as residue_policy_digest
       from mammoth_research_positions recorded_position
       join mammoth_rejected_audit_residue residue on residue.id = $2
      where recorded_position.id = $1`,
    [p4Fixture.positionId, p4Fixture.rejectedResidueId],
  );
  const persistedPolicy = policyMetadata.rows[0];
  if (
    policyMetadata.rowCount !== 1 ||
    persistedPolicy?.position_policy_version !== P4_ADMISSION_POLICY_VERSION ||
    persistedPolicy.position_policy_digest !== P4_ADMISSION_POLICY_DIGEST ||
    persistedPolicy.residue_policy_version !== P4_ADMISSION_POLICY_VERSION ||
    persistedPolicy.residue_policy_digest !== P4_ADMISSION_POLICY_DIGEST
  ) {
    throw new Error(
      'P4 persisted admission metadata drifted from the frozen policy',
    );
  }
  const reconstructed = await researchCellRepositories(
    connection,
  ).cells.reconstructProgram(p4Fixture.programId);
  const verified = verifySeededResearchCell(reconstructed);
  if (JSON.stringify(verified.state) !== JSON.stringify(fixture.state)) {
    throw new Error(
      'P4 authoritative research-cell state changed across Postgres restart',
    );
  }
  if (verified.positionDigest !== fixture.positionDigest) {
    throw new Error('P4 canonical position digest changed across restart');
  }
  return verified.state;
}

function p4LifecycleVerification(
  state: ReconstructedResearchCellState,
): P4LifecycleVerification {
  const verified = verifySeededResearchCell(state).state;
  const version = requiredFirst(
    verified.modelProfileVersions,
    'model profile version',
  );
  const plan = requiredFirst(verified.cellPlans, 'cell plan');
  const position = requiredFirst(verified.positions, 'position');
  const rejected = requiredFirst(verified.rejectedResidue, 'rejected residue');
  const receipt = requiredFirst(verified.receipts, 'receipt');
  return {
    schemaVersion: 1,
    migrationVersion: 5,
    programId: verified.programId,
    modelProfileVersionId: version.id,
    modelProfileVersionDigest: version.contract.immutableDigest,
    cellPlanId: plan.id,
    cellInputDigest: plan.inputDigest,
    positionId: position.id,
    positionDigest: position.positionDigest,
    rejectedResidueId: rejected.id,
    rejectedResidueDigest: rejected.payloadDigest,
    receiptId: receipt.id,
    receiptDigest: receipt.receiptDigest,
  };
}

function requiredFirst<T>(values: readonly T[], subject: string): T {
  const value = values[0];
  if (value === undefined)
    throw new Error(`P4 reconstruction is missing ${subject}`);
  return value;
}

function verifySeededResearchCell(
  state: ReconstructedResearchCellState,
): ResearchCellFixture {
  const profile = state.modelProfiles[0];
  const version = state.modelProfileVersions[0];
  const plan = state.cellPlans[0];
  const position = state.positions[0];
  const rejected = state.rejectedResidue[0];
  const receipt = state.receipts[0];
  if (
    state.programId !== p4Fixture.programId ||
    state.modelProfiles.length !== 1 ||
    profile?.id !== p4Fixture.modelProfileId ||
    state.modelProfileVersions.length !== 1 ||
    version?.id !== p4Fixture.modelProfileVersionId ||
    version.contract.immutableDigest !==
      modelProfileVersionDigest(version.contract) ||
    state.cellPlans.length !== 1 ||
    plan?.id !== p4Fixture.cellPlanId ||
    plan.inputDigest !== cellInputDigest(plan.contract.input) ||
    state.positions.length !== 1 ||
    position?.id !== p4Fixture.positionId ||
    position.positionDigest !== researchPositionDigest(position.contract) ||
    state.rejectedResidue.length !== 1 ||
    rejected?.id !== p4Fixture.rejectedResidueId ||
    rejected.payloadDigest !== canonicalDigest(rejected.payload) ||
    state.receipts.length !== 1 ||
    receipt?.id !== p4Fixture.receiptId ||
    receipt.receiptDigest !== canonicalDigest(receipt.payload)
  ) {
    throw new Error(
      'P4 research-cell reconstruction did not preserve canonical contracts and IDs',
    );
  }
  return { state, positionDigest: position.positionDigest };
}

function researchCellRepositories(connection: PostgresConnection): {
  readonly lineage: PostgresModelLineageRepository;
  readonly cells: PostgresResearchCellRepository;
} {
  const options = { transaction: lifecycleConfig, now: () => p4Fixture.now };
  return {
    lineage: new PostgresModelLineageRepository(connection, options),
    cells: new PostgresResearchCellRepository(connection, options),
  };
}

async function seedActivityEffect(connection: PostgresConnection): Promise<{
  readonly provider: string;
  readonly idempotencyKey: CompletedEffectV1['idempotencyKey'];
  readonly resultDigest: CompletedEffectV1['resultDigest'];
}> {
  const workId = 'p3-profile-activity-effect-v2';
  const provider = 'p3-profile-idempotent-provider';
  const semanticInput = {
    governedTarget: 'https://example.test/p3-fixture',
    policyVersion: 'fixture-policy-v1',
  };
  const inputDigest = canonicalDigest(semanticInput);
  const identity = {
    schemaVersion: 1 as const,
    programId: 'p3-profile-program',
    workItemId: workId,
    contractVersion: '2.0.0',
    inputDigest,
    operationKind: 'retrieval.fetch' as const,
  };
  const idempotencyKey = effectIdempotencyKey(identity);
  const result = { artifactDigest: canonicalDigest('p3-profile-artifact') };
  const resultDigest = canonicalDigest(result);
  const existing = await connection.query(
    `select result_digest from mammoth_activity_effects
     where provider = $1 and idempotency_key = $2 and state = 'completed'`,
    [provider, idempotencyKey],
  );
  if (existing.rowCount === 1)
    return { provider, idempotencyKey, resultDigest };

  let sequence = 0;
  const common = {
    transaction: { statementTimeoutMs: 10_000, transactionTimeoutMs: 15_000 },
    now: () => '2026-07-13T00:00:00.000Z',
    id: () => `p3-profile-${String(++sequence)}`,
  };
  const work = new PostgresWorkState(connection, common);
  await work.enqueue({
    id: workId,
    payload: { activityType: 'retrieval', inputDigest },
    maxAttempts: 5,
    authoritativeRevision: 1,
  });
  const claimed = await work.claim({
    owner: 'p3-profile-worker',
    now: common.now(),
    leaseExpiresAt: '2026-07-13T00:05:00.000Z',
  });
  if (!claimed) throw new Error('P3 Activity fixture was not claimable');
  const invocation: ActivityInvocationV1<typeof semanticInput> = {
    schemaVersion: 1,
    activityType: 'retrieval',
    operationKind: identity.operationKind,
    contractVersion: identity.contractVersion,
    programId: identity.programId,
    workItemId: identity.workItemId,
    input: semanticInput,
    inputDigest,
    workflow: {
      workflowId: 'p3-profile-workflow',
      runId: 'p3-profile-run',
      activityId: 'p3-profile-activity',
      attempt: 1,
      taskQueue: 'retrieval',
      workerId: 'p3-profile-worker',
    },
    lease: {
      owner: 'p3-profile-worker',
      fencingToken: claimed.fencingToken,
    },
  };
  const effects = new PostgresActivityEffectStore(connection, common);
  await effects.registerWork({
    id: workId,
    programId: identity.programId,
    activityType: 'retrieval',
    contractVersion: identity.contractVersion,
    inputDigest,
    state: 'leased',
  });
  await effects.appendAttempt({ invocation, idempotencyKey });
  await effects.begin({
    invocation,
    idempotencyKey,
    provider,
    identity,
    startedAt: common.now(),
  });
  await effects.complete({
    ...identity,
    id: 'p3-profile-effect',
    provider,
    idempotencyKey,
    state: 'completed',
    originalAttribution: {
      ...invocation.workflow,
      leaseOwner: 'p3-profile-worker',
      fencingToken: claimed.fencingToken,
    },
    providerReceipt: { providerOperationId: 'p3-profile-operation' },
    resultSchema: 'retrieval-result@1',
    resultDigest,
    result,
    startedAt: common.now(),
    completedAt: common.now(),
  });
  await effects.completeWorkFromEffect({
    invocation,
    provider,
    idempotencyKey,
  });
  return { provider, idempotencyKey, resultDigest };
}

async function verifyActivityEffect(
  connection: PostgresConnection,
  fixture: {
    readonly provider: string;
    readonly idempotencyKey: CompletedEffectV1['idempotencyKey'];
    readonly resultDigest: CompletedEffectV1['resultDigest'];
  },
): Promise<void> {
  const effects = new PostgresActivityEffectStore(connection, {
    transaction: { statementTimeoutMs: 10_000, transactionTimeoutMs: 15_000 },
    now: () => '2026-07-13T00:00:00.000Z',
    id: () => 'unused-after-restart',
  });
  const completed = await effects.lookup(
    fixture.provider,
    fixture.idempotencyKey,
  );
  if (
    completed?.state !== 'completed' ||
    completed.resultDigest !== fixture.resultDigest
  ) {
    throw new Error('P3 completed Activity effect did not survive restart');
  }
}

export async function verifyBackupRestore(
  config: ProfileConfig,
): Promise<IntegrityManifest> {
  const service = new NativePostgresService(config);
  let source:
    | { lifecycle: PostgresLifecycle; connection: PostgresConnection }
    | undefined;
  let restored:
    | { lifecycle: PostgresLifecycle; connection: PostgresConnection }
    | undefined;
  const restoredDatabase = `${config.database}_restore`;
  const backupRoot = join(config.root, 'backup');
  const dump = join(backupRoot, 'database.dump');
  const restoredCasRoot = join(config.root, 'restore-verification');
  try {
    await service.start();
    source = await connect(service);
    const ledger = new PostgresEpistemicLedger(source.connection, {
      transaction: { statementTimeoutMs: 10_000, transactionTimeoutMs: 15_000 },
    });
    if ((await ledger.read()).revision === 0)
      await ledger.transact(() => undefined);
    await seedCompletedEffect(source.connection);
    await writeArtifact(
      config.root,
      new TextEncoder().encode('mammoth-production-profile-fixture-v1'),
    );
    const expected = await buildManifest(source.connection, config.root);
    await mkdir(backupRoot, { recursive: true });
    const pgDump = await postgresTool('pg_dump');
    await run(
      pgDump,
      [
        '-h',
        config.host,
        '-p',
        String(config.port),
        '-U',
        config.user,
        '-d',
        config.database,
        '--format=custom',
        '--file',
        dump,
      ],
      { env: service.pgEnv(), timeoutMs: 60_000 },
    );
    await rm(join(backupRoot, 'cas'), { recursive: true, force: true });
    await cp(join(config.root, 'cas'), join(backupRoot, 'cas'), {
      recursive: true,
      errorOnExist: true,
    });
    await writeFile(
      join(backupRoot, 'manifest.json'),
      `${JSON.stringify(expected, null, 2)}\n`,
      { mode: 0o600 },
    );
    await source.lifecycle.shutdown();
    source = undefined;

    const dropdb = await postgresTool('dropdb');
    const createdb = await postgresTool('createdb');
    const pgRestore = await postgresTool('pg_restore');
    const common = [
      '-h',
      config.host,
      '-p',
      String(config.port),
      '-U',
      config.user,
    ];
    await run(dropdb, [...common, '--if-exists', restoredDatabase], {
      env: service.pgEnv(),
      timeoutMs: 15_000,
    });
    await run(createdb, [...common, restoredDatabase], {
      env: service.pgEnv(),
      timeoutMs: 15_000,
    });
    await run(
      pgRestore,
      [...common, '-d', restoredDatabase, '--exit-on-error', dump],
      { env: service.pgEnv(), timeoutMs: 60_000 },
    );
    await rm(restoredCasRoot, { recursive: true, force: true });
    await cp(join(backupRoot, 'cas'), join(restoredCasRoot, 'cas'), {
      recursive: true,
    });

    const restoredService = new NativePostgresService({
      ...config,
      database: restoredDatabase,
      root: restoredCasRoot,
    });
    restored = await connect(restoredService);
    const actual = await buildManifest(restored.connection, restoredCasRoot);
    verifyManifest(expected, actual);
    return actual;
  } finally {
    if (source) await source.lifecycle.shutdown().catch(() => undefined);
    if (restored) await restored.lifecycle.shutdown().catch(() => undefined);
    await service.stop().catch(() => undefined);
  }
}

async function seedCompletedEffect(
  connection: PostgresConnection,
): Promise<void> {
  const workId = 'p2-profile-effect-v1';
  const existing = await connection.query(
    'select 1 from mammoth_work_items where id = $1',
    [workId],
  );
  if (existing.rowCount === 1) return;
  let sequence = 0;
  const work = new PostgresWorkState(connection, {
    transaction: { statementTimeoutMs: 10_000, transactionTimeoutMs: 15_000 },
    now: () => '2026-01-01T00:00:00.000Z',
    id: () => `p2-profile-${String(++sequence)}`,
  });
  await work.enqueue({
    id: workId,
    payload: { fixture: 'production-profile-v1' },
    maxAttempts: 3,
    authoritativeRevision: 1,
  });
  const claimed = await work.claim({
    owner: 'p2-profile-worker',
    now: '2026-01-01T00:00:00.000Z',
    leaseExpiresAt: '2026-01-01T00:05:00.000Z',
  });
  if (!claimed) throw new Error('production profile fixture was not claimable');
  await work.complete({
    workId,
    owner: 'p2-profile-worker',
    fencingToken: claimed.fencingToken,
    provider: 'p2-profile-provider',
    idempotencyKey: 'p2-profile-effect-v1',
    providerReceipt: { acknowledged: true },
  });
}

async function connect(
  service: NativePostgresService,
): Promise<{ lifecycle: PostgresLifecycle; connection: PostgresConnection }> {
  const driver = new NodePostgresDriver(service.connectionString());
  const lifecycle = new PostgresLifecycle(
    driver,
    foundationMigrations,
    lifecycleConfig,
  );
  await lifecycle.start();
  return { lifecycle, connection: driver.connection() };
}
