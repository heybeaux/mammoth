import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  PostgresEpistemicLedger,
  PostgresActivityEffectStore,
  PostgresLifecycle,
  PostgresWorkState,
  foundationMigrations,
  type PostgresConnection,
} from '@mammoth/postgres-adapter';
import {
  canonicalDigest,
  effectIdempotencyKey,
  executeActivityEffect,
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

async function seedActivityEffect(connection: PostgresConnection): Promise<{
  readonly provider: string;
  readonly idempotencyKey: CompletedEffectV1['idempotencyKey'];
  readonly resultDigest: CompletedEffectV1['resultDigest'];
  readonly invocation: ActivityInvocationV1;
  readonly result: {
    readonly artifactDigest: CompletedEffectV1['resultDigest'];
  };
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
  const invocationBase: ActivityInvocationV1<typeof semanticInput> = {
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
    lease: { owner: 'p3-profile-worker', fencingToken: 1 },
  };
  const existing = await connection.query(
    `select result_digest from mammoth_activity_effects
     where provider = $1 and idempotency_key = $2 and state = 'completed'`,
    [provider, idempotencyKey],
  );
  if (existing.rowCount === 1)
    return {
      provider,
      idempotencyKey,
      resultDigest,
      invocation: invocationBase,
      result,
    };

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
  const fencingToken = Number(claimed.fencingToken);
  if (!Number.isSafeInteger(fencingToken) || fencingToken < 1)
    throw new Error('P3 Activity fixture received an invalid Postgres fence');
  const invocation: ActivityInvocationV1<typeof semanticInput> = {
    ...invocationBase,
    lease: {
      owner: 'p3-profile-worker',
      fencingToken,
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
  let providerCalls = 0;
  const completed = await executeActivityEffect({
    invocation,
    provider: {
      name: provider,
      execute: async (key) => {
        providerCalls += 1;
        if (key !== idempotencyKey) throw new Error('provider key drifted');
        return {
          receipt: { providerOperationId: 'p3-profile-operation' },
          result,
        };
      },
    },
    store: effects,
    resolveWork: (candidate) => effects.resolveWork(candidate),
    resultSchema: 'retrieval-result@1',
    validateResult: (value) => {
      if (
        !value ||
        typeof value !== 'object' ||
        (value as { artifactDigest?: unknown }).artifactDigest !==
          result.artifactDigest
      ) {
        throw new Error('invalid retrieval result');
      }
      return result;
    },
    now: common.now,
    id: common.id,
    advanceWork: (advance) => effects.completeWorkFromEffect(advance),
  });
  if (providerCalls !== 1 || canonicalDigest(completed) !== resultDigest)
    throw new Error(
      'P3 Activity provider effect did not complete exactly once',
    );
  return { provider, idempotencyKey, resultDigest, invocation, result };
}

async function verifyActivityEffect(
  connection: PostgresConnection,
  fixture: {
    readonly provider: string;
    readonly idempotencyKey: CompletedEffectV1['idempotencyKey'];
    readonly resultDigest: CompletedEffectV1['resultDigest'];
    readonly invocation: ActivityInvocationV1;
    readonly result: {
      readonly artifactDigest: CompletedEffectV1['resultDigest'];
    };
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
  let duplicateProviderCalls = 0;
  const duplicateInvocation: ActivityInvocationV1 = {
    ...fixture.invocation,
    workflow: {
      ...fixture.invocation.workflow,
      runId: 'p3-profile-run-after-restart',
      activityId: 'p3-profile-activity-redelivery',
      attempt: 2,
    },
  };
  const replayed = await executeActivityEffect({
    invocation: duplicateInvocation,
    provider: {
      name: fixture.provider,
      execute: async () => {
        duplicateProviderCalls += 1;
        throw new Error('duplicate provider effect');
      },
    },
    store: effects,
    resolveWork: (candidate) => effects.resolveWork(candidate),
    resultSchema: 'retrieval-result@1',
    validateResult: () => fixture.result,
    now: () => '2026-07-13T00:01:00.000Z',
    id: () => 'must-not-create-a-second-effect',
    advanceWork: (advance) => effects.completeWorkFromEffect(advance),
  });
  const attempts = await connection.query<{ count: string }>(
    'select count(*)::text as count from mammoth_activity_attempts where work_id = $1',
    [fixture.invocation.workItemId],
  );
  const effectsForWork = await connection.query<{ count: string }>(
    'select count(*)::text as count from mammoth_activity_effects where work_id = $1',
    [fixture.invocation.workItemId],
  );
  if (
    duplicateProviderCalls !== 0 ||
    canonicalDigest(replayed) !== fixture.resultDigest ||
    attempts.rows[0]?.count !== '2' ||
    effectsForWork.rows[0]?.count !== '1'
  ) {
    throw new Error(
      'P3 duplicate Activity delivery did not reuse its durable completion',
    );
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
