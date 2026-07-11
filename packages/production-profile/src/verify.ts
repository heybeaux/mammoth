import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  PostgresEpistemicLedger,
  PostgresLifecycle,
  foundationMigrations,
  type PostgresConnection,
} from '@mammoth/postgres-adapter';
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
    verifyManifest(before, await buildManifest(active.connection, config.root));
    return before;
  } finally {
    if (active) await active.lifecycle.shutdown().catch(() => undefined);
    await service.stop().catch(() => undefined);
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
