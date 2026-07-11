import { createHash } from 'node:crypto';
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { PostgresConnection } from '@mammoth/postgres-adapter';

export interface IntegrityManifest {
  readonly schemaVersion: 1;
  readonly ledgerRevision: number;
  readonly auditRows: number;
  readonly outboxRows: number;
  readonly migrations: readonly {
    readonly version: number;
    readonly checksum: string;
  }[];
  readonly artifacts: readonly {
    readonly digest: string;
    readonly size: number;
  }[];
}

export async function writeArtifact(
  root: string,
  bytes: Uint8Array,
): Promise<string> {
  const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  const path = join(root, 'cas', digest.slice(7, 9), digest.slice(7));
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${String(process.pid)}.staged`;
  await writeFile(temporary, bytes, { flag: 'wx' });
  await rename(temporary, path).catch(async (error: unknown) => {
    await rm(temporary, { force: true });
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  });
  return digest;
}

export async function buildManifest(
  connection: PostgresConnection,
  root: string,
): Promise<IntegrityManifest> {
  const [ledger, audit, outbox, migrations] = await Promise.all([
    connection.query<{ revision: string | number }>(
      'select revision from mammoth_epistemic_ledger where singleton = true',
    ),
    connection.query<{ count: string }>(
      'select count(*)::text as count from mammoth_audit_log',
    ),
    connection.query<{ count: string }>(
      'select count(*)::text as count from mammoth_outbox',
    ),
    connection.query<{ version: number; checksum: string }>(
      'select version, checksum from mammoth_schema_migrations order by version',
    ),
  ]);
  return {
    schemaVersion: 1,
    ledgerRevision: Number(ledger.rows[0]?.revision ?? -1),
    auditRows: Number(audit.rows[0]?.count ?? -1),
    outboxRows: Number(outbox.rows[0]?.count ?? -1),
    migrations: migrations.rows,
    artifacts: await scanArtifacts(root),
  };
}

export function verifyManifest(
  expected: IntegrityManifest,
  actual: IntegrityManifest,
): void {
  const left = JSON.stringify(expected);
  const right = JSON.stringify(actual);
  if (left !== right)
    throw new Error(
      `restored integrity differs\nexpected ${left}\nactual   ${right}`,
    );
}

async function scanArtifacts(
  root: string,
): Promise<readonly { digest: string; size: number }[]> {
  const cas = join(root, 'cas');
  const shards = await readdir(cas).catch(() => []);
  const output: { digest: string; size: number }[] = [];
  for (const shard of shards.sort()) {
    const names = await readdir(join(cas, shard));
    for (const name of names.sort()) {
      const bytes = await readFile(join(cas, shard, name));
      const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
      if (digest.slice(7) !== name)
        throw new Error(`CAS integrity failure: ${name} hashes as ${digest}`);
      output.push({ digest, size: bytes.byteLength });
    }
  }
  return output;
}
