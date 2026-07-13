import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { verifyP5 } from '../evals/p5-acceptance/src/verifier.js';

const profileRoot = await mkdtemp(join(tmpdir(), 'mammoth-p5-profile-'));
process.env.MAMMOTH_PROFILE_ROOT = profileRoot;
process.env.MAMMOTH_PG_PASSWORD = randomBytes(24).toString('hex');
try {
  const result = await verifyP5(resolve(process.cwd()));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
} finally {
  await rm(profileRoot, { recursive: true, force: true });
}
