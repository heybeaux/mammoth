import { access } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { run } from './commands.js';

export async function postgresTool(name: string): Promise<string> {
  const bindir = await run('pg_config', ['--bindir'], {
    timeoutMs: 5_000,
    allowFailure: true,
  }).catch(() => undefined);
  if (bindir) {
    const candidate = join(bindir.stdout.trim(), name);
    if (await exists(candidate)) return candidate;
  }
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    const candidate = join(dir, name);
    if (await exists(candidate)) return candidate;
  }
  throw new Error(
    `Postgres prerequisite '${name}' is missing. Install the PostgreSQL server and client tools; pg_config --bindir must expose ${name}.`,
  );
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}
