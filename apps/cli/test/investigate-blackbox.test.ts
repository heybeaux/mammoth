import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

describe('mammoth investigate black box', () => {
  it('writes a readable preview and separate typed artifacts without external effects', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mammoth-investigate-'));
    const output = join(root, 'preview');
    const question =
      'Where do the strongest opportunities lie for private local world models trained on consumer hardware?';
    const result = await execFileAsync(
      process.execPath,
      [
        '--import',
        'tsx',
        join(repoRoot, 'apps/cli/src/bin.ts'),
        'investigate',
        question,
        '--output',
        output,
      ],
      {
        cwd: repoRoot,
        timeout: 30_000,
        env: {
          ...process.env,
          MAMMOTH_P9_SEARCH_API_KEY: 'must-not-be-used',
          MAMMOTH_P9_MODEL_API_KEY: 'must-not-be-used',
        },
      },
    );
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({
      command: 'investigate',
      status: 'awaiting_approval',
      outputDirectory: output,
      externalEffectsExecuted: false,
    });
    const expected = [
      'problem-contract.json',
      'team-plan.json',
      'research-plan-proposal.json',
      'approval-request.json',
      'preview.md',
    ];
    await Promise.all(expected.map((name) => access(join(output, name))));
    const approval = JSON.parse(
      await readFile(join(output, 'approval-request.json'), 'utf8'),
    ) as {
      requestedAuthority: {
        status: string;
        externalEffectsExecuted: boolean;
      };
    };
    expect(approval.requestedAuthority).toEqual(
      expect.objectContaining({
        status: 'not_granted',
        externalEffectsExecuted: false,
      }),
    );
    const report = await readFile(join(output, 'preview.md'), 'utf8');
    expect(report.indexOf('## Interpretation')).toBeLessThan(
      report.indexOf('## Requested authority'),
    );
    expect(report).toContain('experiment execution remain blocked');
  });

  it('fails closed rather than overwriting an existing preview directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mammoth-investigate-existing-'));
    const output = join(root, 'preview');
    const args = [
      '--import',
      'tsx',
      join(repoRoot, 'apps/cli/src/bin.ts'),
      'investigate',
      'How should an unfamiliar question be researched with auditable evidence?',
      '--output',
      output,
    ];
    await execFileAsync(process.execPath, args, { cwd: repoRoot });
    await expect(
      execFileAsync(process.execPath, args, { cwd: repoRoot }),
    ).rejects.toMatchObject({ code: 1 });
  });
});
