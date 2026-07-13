import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { verifyP4 } from '../evals/p4-acceptance/src/verifier.js';

const profileRoot = await mkdtemp(join(tmpdir(), 'mammoth-p4-profile-'));
process.env.MAMMOTH_PROFILE_ROOT = profileRoot;
process.env.MAMMOTH_PG_PASSWORD = randomBytes(24).toString('hex');
try {
  const result = await verifyP4(resolve(process.cwd()));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
} finally {
  await rm(profileRoot, { recursive: true, force: true });
}
