import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const executeFile = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, '../../..');
const verifier = resolve(repositoryRoot, 'scripts/verify-mvp.ts');

/**
 * Run the canonical M4 black-box verifier. The verifier launches the bundled
 * CLI in fresh Node processes and independently checks every durable artifact.
 */
export async function verifyMvp(): Promise<void> {
  const result = await executeFile(
    process.execPath,
    ['--import', 'tsx', verifier],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  assert.equal(result.stderr, '');
  const lines = result.stdout.trim().split('\n');
  assert.equal(lines.length, 1);
  const receipt = JSON.parse(lines[0] ?? '') as {
    ok?: unknown;
    verifier?: unknown;
    checks?: unknown;
  };
  assert.equal(receipt.ok, true);
  assert.equal(receipt.verifier, 'mammoth-mvp-blackbox-v1');
  assert.ok(Array.isArray(receipt.checks));
  assert.equal(receipt.checks.length, 13);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await verifyMvp();
  process.stdout.write('Mammoth MVP black-box acceptance passed.\n');
}
