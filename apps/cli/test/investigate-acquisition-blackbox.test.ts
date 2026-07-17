import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { type InvestigationPlan } from '@mammoth/domain';
import {
  bindApprovedInvestigationPlan,
  recordInvestigationApproval,
} from '@mammoth/governance';
import { planInvestigation } from '@mammoth/runtime';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

function boundPlan(question: string): InvestigationPlan {
  const preview = planInvestigation(question);
  const approval = recordInvestigationApproval({
    approvalId: `approval:${preview.investigationId}`,
    investigationId: preview.investigationId,
    previewDigest: preview.previewDigest,
    decision: 'approve',
    actorId: 'operator:test',
    actorKind: 'human_operator',
    reason: 'test approval for CLI composition',
    decidedAt: '2026-07-16T00:00:00.000Z',
  });
  const result = bindApprovedInvestigationPlan({ preview, approval });
  if (!result.plan) throw new Error('plan binding rejected');
  return result.plan;
}

async function runInvestigate(
  args: readonly string[],
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(
    process.execPath,
    ['--import', 'tsx', join(repoRoot, 'apps/cli/src/bin.ts'), ...args],
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
}

describe('mammoth investigate --plan black box', () => {
  it('composes an accepted plan into no-effect acquisition intents through the public path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mammoth-acquisition-'));
    const plan = boundPlan(
      'How can rural clinics keep vaccine cold chains reliable during extended power outages?',
    );
    const planPath = join(root, 'investigation-plan.json');
    await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
    const output = join(root, 'acquisition');
    const result = await runInvestigate([
      'investigate',
      '--plan',
      planPath,
      '--output',
      output,
    ]);
    expect(result.stderr).toBe('');
    const report = JSON.parse(result.stdout) as {
      status: string;
      decision: string;
      reasonCodes: string[];
      intentCount: number;
      planDigest: string;
      executionAuthorized: boolean;
      externalEffectsExecuted: boolean;
    };
    expect(report).toMatchObject({
      command: 'investigate',
      status: 'awaiting_effect_authority',
      outputDirectory: output,
      decision: 'refused',
      reasonCodes: ['no_scoped_effect_authority'],
      planDigest: plan.planDigest,
      executionAuthorized: false,
      externalEffectsExecuted: false,
    });
    expect(report.intentCount).toBeGreaterThanOrEqual(2);
    await Promise.all(
      ['acquisition-intents.json', 'acquisition-release.json'].map((name) =>
        access(join(output, name)),
      ),
    );
    const intents = JSON.parse(
      await readFile(join(output, 'acquisition-intents.json'), 'utf8'),
    ) as {
      planDigest: string;
      effectAuthority: string;
      executionAuthorized: boolean;
      intents: { kind: string; subject: string }[];
    };
    expect(intents.planDigest).toBe(plan.planDigest);
    expect(intents.effectAuthority).toBe('none_granted');
    expect(intents.executionAuthorized).toBe(false);
    expect(
      intents.intents
        .filter((intent) => intent.kind === 'discovery.search')
        .map((intent) => intent.subject),
    ).toEqual([...plan.plan.searchQueries]);
  });

  it('rejects a drifted plan file instead of deriving intents', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mammoth-acquisition-drift-'));
    const plan = boundPlan(
      'What would it take for community land trusts to stabilize housing costs in mid-sized cities?',
    );
    const tampered = { ...plan, question: `${plan.question} tampered` };
    const planPath = join(root, 'investigation-plan.json');
    await writeFile(planPath, JSON.stringify(tampered), 'utf8');
    await expect(
      runInvestigate(['investigate', '--plan', planPath]),
    ).rejects.toMatchObject({ code: 1 });
  });

  it('refuses a scoped authority through the public path because no issuer is pinned', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mammoth-acquisition-auth-'));
    const plan = boundPlan(
      'Do seagrass restoration projects meaningfully offset coastal carbon emissions at scale?',
    );
    const planPath = join(root, 'investigation-plan.json');
    await writeFile(planPath, JSON.stringify(plan), 'utf8');
    const authorityPath = join(root, 'authority.json');
    await writeFile(
      authorityPath,
      JSON.stringify({ forged: 'not-a-scoped-authority' }),
      'utf8',
    );
    const output = join(root, 'acquisition');
    const result = await runInvestigate([
      'investigate',
      '--plan',
      planPath,
      '--authority',
      authorityPath,
      '--output',
      output,
    ]);
    const report = JSON.parse(result.stdout) as {
      status: string;
      decision: string;
      reasonCodes: string[];
    };
    expect(report.status).toBe('awaiting_effect_authority');
    expect(report.decision).toBe('refused');
    expect(report.reasonCodes).toEqual(['invalid_effect_authority_receipt']);
    const release = JSON.parse(
      await readFile(join(output, 'acquisition-release.json'), 'utf8'),
    ) as { authorityReceiptDigest: string | null };
    expect(release.authorityReceiptDigest).toBeNull();
  });

  it('fails closed rather than overwriting an existing acquisition directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mammoth-acquisition-existing-'));
    const plan = boundPlan(
      'How can rural clinics keep vaccine cold chains reliable during extended power outages?',
    );
    const planPath = join(root, 'investigation-plan.json');
    await writeFile(planPath, JSON.stringify(plan), 'utf8');
    const output = join(root, 'acquisition');
    await runInvestigate([
      'investigate',
      '--plan',
      planPath,
      '--output',
      output,
    ]);
    await expect(
      runInvestigate(['investigate', '--plan', planPath, '--output', output]),
    ).rejects.toMatchObject({ code: 1 });
  });
});
