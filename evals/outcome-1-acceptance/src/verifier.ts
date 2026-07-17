import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type {
  Outcome1Case,
  Outcome1Manifest,
  Outcome1VerificationResult,
} from './types.js';

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value) &&
    value.every((entry) => typeof entry === 'string')
    ? value
    : [];
}

const QUESTION_STOP_WORDS = new Set([
  'and',
  'are',
  'for',
  'from',
  'have',
  'how',
  'should',
  'that',
  'the',
  'their',
  'them',
  'there',
  'these',
  'this',
  'what',
  'where',
  'which',
  'with',
  'without',
  'would',
]);

function materialQuestionTerms(question: string): readonly string[] {
  return [
    ...new Set(
      question
        .toLowerCase()
        .match(/[a-z0-9][a-z0-9-]{3,}/gu)
        ?.filter((term) => !QUESTION_STOP_WORDS.has(term)) ?? [],
    ),
  ];
}

async function optionalJson(
  path: string,
): Promise<Record<string, unknown> | undefined> {
  try {
    return asRecord(JSON.parse(await readFile(path, 'utf8')));
  } catch {
    return undefined;
  }
}

export async function verifyOutcome1Preview(
  directory: string,
  fixtureCase: Outcome1Case,
  manifest: Outcome1Manifest,
): Promise<Outcome1VerificationResult> {
  const failures: string[] = [];
  const artifact = async (name: string) =>
    optionalJson(resolve(directory, name));
  const problem = await artifact('problem-contract.json');
  const team = await artifact('team-plan.json');
  const proposal = await artifact('research-plan-proposal.json');
  const approval = await artifact('approval-request.json');
  for (const name of manifest.requiredPreviewArtifacts) {
    if (!(await optionalJson(resolve(directory, name)))) {
      failures.push(`preview_artifact_missing:${name}`);
    }
  }
  if (problem?.question !== fixtureCase.question) {
    failures.push('problem_contract_question_mismatch');
  }
  if (
    typeof asRecord(problem?.interpretation)?.objective !== 'string' ||
    stringArray(problem?.assumptions).length === 0 ||
    stringArray(asRecord(problem?.interpretation)?.falsifiers).length === 0
  ) {
    failures.push('problem_contract_not_reviewable');
  }
  const roles = Array.isArray(team?.proposedTeam)
    ? team.proposedTeam.map(asRecord).filter((entry) => entry !== undefined)
    : [];
  if (
    roles.length < 3 ||
    roles.some(
      (role) =>
        typeof role.roleId !== 'string' ||
        typeof role.mission !== 'string' ||
        typeof role.independence !== 'string',
    )
  ) {
    failures.push('team_plan_not_problem_derived');
  }
  const roleText = roles
    .map(
      (role) =>
        `${String(role.roleId)} ${String(role.title)} ${String(role.mission)}`,
    )
    .join(' ')
    .toLowerCase();
  for (const expected of fixtureCase.requiredPreviewRoles) {
    if (!roleText.includes(expected.toLowerCase())) {
      failures.push(`required_preview_role_missing:${expected}`);
    }
  }
  const questionTermsInTeam = materialQuestionTerms(
    fixtureCase.question,
  ).filter((term) => roleText.includes(term));
  if (questionTermsInTeam.length < 2) {
    failures.push('team_plan_not_materially_question_derived');
  }
  if (
    !asRecord(proposal?.plan) ||
    !Array.isArray(asRecord(proposal?.plan)?.searchQueries) ||
    (asRecord(proposal?.plan)?.searchQueries as unknown[]).length < 2 ||
    !Array.isArray(asRecord(proposal?.plan)?.reportSections)
  ) {
    failures.push('research_plan_not_question_derived');
  }
  if (
    asRecord(approval?.requestedAuthority)?.status !== 'not_granted' ||
    asRecord(approval?.requestedAuthority)?.approvalRequired !== true ||
    asRecord(approval?.requestedAuthority)?.externalEffectsExecuted !== false ||
    typeof asRecord(approval?.requestedAuthority)?.maxSpendUsd !== 'number'
  ) {
    failures.push('approval_boundary_not_fail_closed');
  }
  for (const forbidden of [
    'execution-receipt.json',
    'budget-ledger.json',
    'reader/report.md',
    'audit/manifest.json',
  ]) {
    try {
      await readFile(resolve(directory, forbidden));
      failures.push(`preapproval_effect_artifact_present:${forbidden}`);
    } catch {
      // Absence is the required pre-effect state.
    }
  }
  return { ok: failures.length === 0, failures };
}

export function verifyOutcome1PlanDifferentiation(
  previews: Readonly<Record<string, string>>,
  manifest: Outcome1Manifest,
): Outcome1VerificationResult {
  const failures: string[] = [];
  const projections = manifest.cases.map((fixtureCase) => {
    const raw = previews[fixtureCase.caseId];
    if (!raw) {
      failures.push(`preview_missing:${fixtureCase.caseId}`);
      return '';
    }
    try {
      const parsed = asRecord(JSON.parse(raw));
      return JSON.stringify({
        plan: parsed?.plan,
        experiments: parsed?.experiments,
        planner: parsed?.planner,
      });
    } catch {
      failures.push(`preview_invalid:${fixtureCase.caseId}`);
      return '';
    }
  });
  if (new Set(projections.filter(Boolean)).size !== manifest.cases.length) {
    failures.push('plans_not_materially_distinct');
  }
  return { ok: failures.length === 0, failures };
}

export async function verifyOutcome1ReaderAuditBundle(
  directory: string,
  manifest: Outcome1Manifest,
): Promise<Outcome1VerificationResult> {
  const failures: string[] = [];
  const contents: Record<string, string> = {};
  for (const name of [
    ...manifest.requiredReaderArtifacts,
    ...manifest.requiredAuditArtifacts,
    'execution-receipt.json',
  ]) {
    try {
      contents[name] = await readFile(resolve(directory, name), 'utf8');
    } catch {
      failures.push(`bundle_artifact_missing:${name}`);
    }
  }
  if (failures.length > 0) return { ok: false, failures };
  const report = contents['reader/report.md'] ?? '';
  const references = contents['reader/references.md'] ?? '';
  if (
    /sha256:|claim[_:-]|proposal[_:-]|plan digest|parser receipt|budget ledger|coverage verdict/iu.test(
      report,
    )
  ) {
    failures.push('reader_contains_audit_internals');
  }
  if (!/^#\s+/u.test(report) || !report.includes('## Direct answer')) {
    failures.push('reader_direct_answer_missing');
  }
  if (
    !/\[\d+\]/u.test(report) ||
    !/^\[\d+\]:\s+https?:\/\//mu.test(references)
  ) {
    failures.push('reader_human_citations_missing');
  }
  const readerProjection = asRecord(
    JSON.parse(contents['reader/projection.json'] ?? '{}'),
  );
  const auditManifest = asRecord(
    JSON.parse(contents['audit/manifest.json'] ?? '{}'),
  );
  const executionReceipt = asRecord(
    JSON.parse(contents['execution-receipt.json'] ?? '{}'),
  );
  if (!readerProjection || !auditManifest || !executionReceipt) {
    failures.push('projection_manifest_invalid');
    return { ok: false, failures };
  }
  const sharedFields = [
    'runId',
    'authoritativeRevision',
    'planDigest',
  ] as const;
  for (const field of sharedFields) {
    if (
      readerProjection[field] !== auditManifest[field] ||
      readerProjection[field] !== executionReceipt[field]
    ) {
      failures.push(`projection_authority_mismatch:${field}`);
    }
  }
  if (
    readerProjection.reportDigest !== sha256(report) ||
    readerProjection.referencesDigest !== sha256(references) ||
    auditManifest.readerProjectionDigest !==
      sha256(contents['reader/projection.json'] ?? '')
  ) {
    failures.push('reader_projection_digest_mismatch');
  }
  const receiptDigests = asRecord(executionReceipt.artifactDigests) ?? {};
  for (const [name, content] of Object.entries(contents)) {
    if (name === 'execution-receipt.json') continue;
    if (receiptDigests[name] !== sha256(content)) {
      failures.push(`execution_receipt_digest_mismatch:${name}`);
    }
  }
  const admissions = (contents['audit/claim-admissions.jsonl'] ?? '')
    .split('\n')
    .filter(Boolean)
    .map((line) => asRecord(JSON.parse(line)))
    .filter((value) => value !== undefined);
  const admittedIds = new Set(
    admissions
      .filter((entry) => entry.decision === 'admitted')
      .map((entry) => String(entry.claimId)),
  );
  const factual = Array.isArray(readerProjection.factualSentences)
    ? readerProjection.factualSentences.map(asRecord).filter(Boolean)
    : [];
  if (
    factual.length === 0 ||
    factual.some((sentence) => {
      const claimIds = stringArray(sentence?.claimIds);
      return (
        claimIds.length === 0 || claimIds.some((id) => !admittedIds.has(id))
      );
    })
  ) {
    failures.push('reader_fact_not_reconstructable_from_admitted_audit_claims');
  }
  if ((contents['audit/rejected-claims.jsonl'] ?? '').trim().length === 0) {
    failures.push('rejected_claim_residue_missing');
  }
  return { ok: failures.length === 0, failures };
}
