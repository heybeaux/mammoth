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
import {
  mintOfflineFixtureAuthorityReceipt,
  OFFLINE_FIXTURE_ISSUER_ID,
  planInvestigation,
} from '@mammoth/runtime';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

const QUESTION =
  'What storage and rotation practices best protect a community seed library from viability loss across humid summers?';

const CATALOG = {
  schemaVersion: '1.0.0',
  catalogId: 'cli-blackbox-catalog/v1',
  sourceClasses: [
    { sourceClass: 'primary', minimumIndependentSources: 1, mandatory: true },
    {
      sourceClass: 'secondary',
      minimumIndependentSources: 1,
      mandatory: false,
    },
  ],
  sources: [
    {
      url: 'https://extension.example.org/bulletins/seed-storage-trial',
      sourceClass: 'primary',
      title: 'Seed storage trial bulletin',
      mediaType: 'text/plain',
      body: 'The extension trial measured germination above eighty percent after two years for seed lots kept below forty percent relative humidity. Lots stored in unsealed envelopes in the same building fell below fifty percent germination in the second summer. The bulletin recommended silica desiccant with airtight jars as the lowest-cost effective control.',
    },
    {
      url: 'https://cooperative.example.org/notes/rotation-ledger',
      sourceClass: 'secondary',
      title: 'Rotation ledger notes',
      mediaType: 'text/plain',
      body: 'Cooperative records show that lots regrown on a three-year rotation retained catalog viability without repeated cold storage. Volunteers flagged mislabeled envelopes as the most common cause of lost accessions in the shared ledger.',
    },
  ],
};

async function runInvestigate(
  args: readonly string[],
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(
    process.execPath,
    ['--import', 'tsx', join(repoRoot, 'apps/cli/src/bin.ts'), ...args],
    {
      cwd: repoRoot,
      timeout: 60_000,
      env: {
        ...process.env,
        MAMMOTH_P9_SEARCH_API_KEY: 'must-not-be-used',
        MAMMOTH_P9_MODEL_API_KEY: 'must-not-be-used',
      },
    },
  );
}

async function writeCatalog(root: string): Promise<string> {
  const path = join(root, 'catalog.json');
  await writeFile(path, `${JSON.stringify(CATALOG, null, 2)}\n`, 'utf8');
  return path;
}

function boundPlan(question: string): InvestigationPlan {
  const preview = planInvestigation(question);
  const approval = recordInvestigationApproval({
    approvalId: `approval:${preview.investigationId}`,
    investigationId: preview.investigationId,
    previewDigest: preview.previewDigest,
    decision: 'approve',
    actorId: 'operator:test',
    actorKind: 'human_operator',
    reason: 'test approval for governed CLI composition',
    decidedAt: '2026-07-16T00:00:00.000Z',
  });
  const result = bindApprovedInvestigationPlan({ preview, approval });
  if (!result.plan) throw new Error('plan binding rejected');
  return result.plan;
}

describe('mammoth investigate --execute black box', () => {
  it('runs the full governed offline path into a cited reader report and audit projection', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mammoth-governed-run-'));
    const catalogPath = await writeCatalog(root);
    const output = join(root, 'run');
    const result = await runInvestigate([
      'investigate',
      '--execute',
      QUESTION,
      '--offline-sources',
      catalogPath,
      '--approve',
      '--trusted-issuer',
      OFFLINE_FIXTURE_ISSUER_ID,
      '--output',
      output,
    ]);
    expect(result.stderr).toBe('');
    const report = JSON.parse(result.stdout) as {
      status: string;
      decision: string;
      admittedClaims: number;
      rejectedClaims: number;
      executionAuthorized: boolean;
      externalEffectsExecuted: boolean;
    };
    expect(report).toMatchObject({
      command: 'investigate',
      status: 'governed_execution_complete',
      outputDirectory: output,
      decision: 'authorized',
      reasonCodes: ['acquisition_release_policy_satisfied'],
      executionAuthorized: true,
      externalEffectsExecuted: false,
    });
    expect(report.admittedClaims).toBeGreaterThan(0);
    expect(report.rejectedClaims).toBeGreaterThan(0);
    await Promise.all(
      [
        'preview.md',
        'investigation-plan.json',
        'investigation-approval.json',
        'plan-binding-receipt.json',
        'acquisition-intents.json',
        'acquisition-release.json',
        'effect-authority.json',
        'reader/report.md',
        'reader/references.md',
        'reader/projection.json',
        'audit/manifest.json',
        'audit/retrieval-attempts.jsonl',
        'audit/claim-admissions.jsonl',
        'audit/rejected-claims.jsonl',
        'execution-receipt.json',
      ].map((name) => access(join(output, name))),
    );
    const readerReport = await readFile(
      join(output, 'reader/report.md'),
      'utf8',
    );
    expect(readerReport).toMatch(/^#\s+/u);
    expect(readerReport).toContain('## Direct answer');
    expect(readerReport).toMatch(/\[\d+\]/u);
    expect(readerReport).not.toMatch(
      /sha256:|claim[_:-]|proposal[_:-]|plan digest|parser receipt|budget ledger|coverage verdict/iu,
    );
    const references = await readFile(
      join(output, 'reader/references.md'),
      'utf8',
    );
    expect(references).toMatch(/^\[\d+\]:\s+https:\/\//mu);
    const release = JSON.parse(
      await readFile(join(output, 'acquisition-release.json'), 'utf8'),
    ) as { decision: string; authorityReceiptDigest: string | null };
    expect(release.decision).toBe('authorized');
    expect(release.authorityReceiptDigest).not.toBeNull();
  });

  it('refuses and executes nothing when no trusted issuer is pinned', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mammoth-governed-nopin-'));
    const catalogPath = await writeCatalog(root);
    const output = join(root, 'run');
    const result = await runInvestigate([
      'investigate',
      '--execute',
      QUESTION,
      '--offline-sources',
      catalogPath,
      '--approve',
      '--output',
      output,
    ]);
    const report = JSON.parse(result.stdout) as {
      status: string;
      reasonCodes: string[];
    };
    expect(report.status).toBe('acquisition_release_refused');
    expect(report.reasonCodes).toEqual(['no_trusted_authority_issuer']);
    await expect(access(join(output, 'reader'))).rejects.toThrow();
    await expect(
      access(join(output, 'execution-receipt.json')),
    ).rejects.toThrow();
    const release = JSON.parse(
      await readFile(join(output, 'acquisition-release.json'), 'utf8'),
    ) as { decision: string; authorityReceiptDigest: string | null };
    expect(release.decision).toBe('refused');
    expect(release.authorityReceiptDigest).toBeNull();
  });

  it('refuses an issuer other than the offline fixture issuer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mammoth-governed-wrongpin-'));
    const catalogPath = await writeCatalog(root);
    const output = join(root, 'run');
    const result = await runInvestigate([
      'investigate',
      '--execute',
      QUESTION,
      '--offline-sources',
      catalogPath,
      '--approve',
      '--trusted-issuer',
      'some-other-issuer/v1',
      '--output',
      output,
    ]);
    const report = JSON.parse(result.stdout) as {
      status: string;
      reasonCodes: string[];
    };
    expect(report.status).toBe('acquisition_release_refused');
    expect(report.reasonCodes).toEqual(['untrusted_authority_issuer']);
    await expect(access(join(output, 'reader'))).rejects.toThrow();
  });

  it('requires an explicit operator approval', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mammoth-governed-noapprove-'));
    const catalogPath = await writeCatalog(root);
    await expect(
      runInvestigate([
        'investigate',
        '--execute',
        QUESTION,
        '--offline-sources',
        catalogPath,
        '--trusted-issuer',
        OFFLINE_FIXTURE_ISSUER_ID,
      ]),
    ).rejects.toMatchObject({ code: 1 });
  });

  it('requires a declared offline source universe', async () => {
    await expect(
      runInvestigate([
        'investigate',
        '--execute',
        QUESTION,
        '--approve',
        '--trusted-issuer',
        OFFLINE_FIXTURE_ISSUER_ID,
      ]),
    ).rejects.toMatchObject({ code: 1 });
  });
});

describe('mammoth investigate --plan trusted-issuer pinning', () => {
  it('authorizes a release only when the operator pins the exact fixture issuer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mammoth-plan-pinned-'));
    const plan = boundPlan(QUESTION);
    const planPath = join(root, 'investigation-plan.json');
    await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
    const authority = mintOfflineFixtureAuthorityReceipt({
      planId: plan.planId,
      planDigest: plan.planDigest,
      question: plan.question,
      actorId: 'operator:test',
      authorizedAt: new Date().toISOString(),
    });
    const authorityPath = join(root, 'authority.json');
    await writeFile(
      authorityPath,
      `${JSON.stringify(authority, null, 2)}\n`,
      'utf8',
    );
    const output = join(root, 'acquisition');
    const result = await runInvestigate([
      'investigate',
      '--plan',
      planPath,
      '--authority',
      authorityPath,
      '--trusted-issuer',
      OFFLINE_FIXTURE_ISSUER_ID,
      '--output',
      output,
    ]);
    const report = JSON.parse(result.stdout) as {
      status: string;
      decision: string;
      reasonCodes: string[];
    };
    expect(report.status).toBe('acquisition_release_authorized');
    expect(report.decision).toBe('authorized');
    expect(report.reasonCodes).toEqual([
      'acquisition_release_policy_satisfied',
    ]);
  });

  it('keeps refusing the same authority when no issuer is pinned', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mammoth-plan-unpinned-'));
    const plan = boundPlan(QUESTION);
    const planPath = join(root, 'investigation-plan.json');
    await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
    const authority = mintOfflineFixtureAuthorityReceipt({
      planId: plan.planId,
      planDigest: plan.planDigest,
      question: plan.question,
      actorId: 'operator:test',
      authorizedAt: new Date().toISOString(),
    });
    const authorityPath = join(root, 'authority.json');
    await writeFile(
      authorityPath,
      `${JSON.stringify(authority, null, 2)}\n`,
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
      decision: string;
      reasonCodes: string[];
    };
    expect(report.decision).toBe('refused');
    expect(report.reasonCodes).toEqual(['no_trusted_authority_issuer']);
  });
});
