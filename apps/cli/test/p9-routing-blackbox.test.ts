import { execFile } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { runP8TurnkeyResearch } from '@mammoth/runtime';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

describe('research command routing black box', () => {
  it('keeps a P8 bundle with execution-receipt.json on the P8 inspect path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mammoth-p8-routing-'));
    const outputDirectory = join(root, 'bundle');
    const summary = await runP8TurnkeyResearch({
      question:
        'What impacts do data centers have on the communities and environment around them?',
      depth: 'quick',
      budgetUsd: 0,
      outputDirectory,
      fixturesRoot: repoRoot,
      mode: 'report',
    });
    const result = await execFileAsync(
      process.execPath,
      [
        '--import',
        'tsx',
        join(repoRoot, 'apps/cli/src/bin.ts'),
        'research',
        'inspect',
        outputDirectory,
      ],
      { cwd: repoRoot, timeout: 30_000 },
    );
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({
      command: 'inspect',
      runId: summary.runId,
      status: 'completed',
      outputDirectory,
    });
  });
});
