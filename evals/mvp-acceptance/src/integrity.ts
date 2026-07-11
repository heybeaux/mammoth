import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

export interface LedgerArtifact {
  id: string;
  programId: string;
  contentDigest: string;
  storageUri: string;
  byteLength: number;
}

export interface LedgerClaim {
  id: string;
  programId: string;
  status: string;
  assessmentId?: string;
}

export interface LedgerAssessment {
  id: string;
  claimId: string;
  policyId: string;
  policyVersion: string;
  verdict: string;
  evidenceIds: string[];
}

export interface LedgerEdge {
  claimId: string;
  evidenceId: string;
  locator: { startOffset?: number; endOffset?: number };
}

export interface Ledger {
  claims: LedgerClaim[];
  assessments: LedgerAssessment[];
  evidence: LedgerArtifact[];
  claimEvidenceEdges: LedgerEdge[];
}

interface TraceBinding {
  claimId: string;
  assessmentId: string;
  policyId: string;
  policyVersion: string;
  evidenceId: string;
  snapshotDigest: string;
  locator: { startOffset?: number; endOffset?: number };
}

interface Trace {
  sentence: string;
  bindings: TraceBinding[];
}

interface Manifest {
  programId: string;
  claimIds: string[];
  unresolvedIssueIds: string[];
  receiptId: string;
}

interface CompletedReceiptBody {
  id: string;
  programId: string;
  executionId: string;
  status: string;
  publicationStatus: string;
  snapshotDigest: string;
  supportedClaimIds: string[];
  unresolvedClaimIds: string[];
  artifacts: Record<string, string>;
  issuedAt: string;
}

interface CompletedReceipt extends CompletedReceiptBody {
  integrityHash: string;
}

export interface VerifiedProgram {
  programId: string;
  semanticDigests: Record<string, string>;
  receiptHash: string;
  snapshotDigest: string;
  supportedClaimIds: string[];
  unresolvedClaimIds: string[];
  effectReceiptCount: number;
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`MVP_INTEGRITY:${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalize(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(normalize);
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .filter((key) => record[key] !== undefined)
      .map((key) => [key, normalize(record[key])]),
  );
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function canonicalDigest(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

export function byteDigest(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

async function json<T>(path: string): Promise<T> {
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
  invariant(
    isRecord(parsed) || Array.isArray(parsed),
    `${path} is not JSON data`,
  );
  return parsed as T;
}

function contained(root: string, path: string): boolean {
  const child = relative(resolve(root), resolve(path));
  return child === '' || (!child.startsWith('..') && !isAbsolute(child));
}

async function findCasObject(
  programDirectory: string,
  digest: string,
): Promise<string> {
  const hex = digest.replace(/^sha256:/, '');
  const candidates = [
    join(programDirectory, 'cas', 'sha256', hex.slice(0, 2), hex.slice(2)),
    join(programDirectory, 'cas', hex.slice(0, 2), hex),
    join(programDirectory, 'cas', hex),
  ];
  for (const candidate of candidates) {
    try {
      const info = await lstat(candidate);
      if (info.isFile() && !info.isSymbolicLink()) return candidate;
    } catch (error: unknown) {
      if (!isRecord(error) || error.code !== 'ENOENT') throw error;
    }
  }
  throw new Error(`MVP_INTEGRITY:CAS object missing for ${digest}`);
}

/** Independently verifies durable output. This deliberately imports no Mammoth package. */
export async function verifyCompletedProgram(
  programDirectory: string,
): Promise<VerifiedProgram> {
  const root = resolve(programDirectory);
  const info = await lstat(root);
  invariant(
    info.isDirectory() && !info.isSymbolicLink(),
    'program path is not a real directory',
  );
  const entries = await readdir(root, { withFileTypes: true });
  invariant(
    !entries.some((entry) => entry.isSymbolicLink()),
    'program contains a symlink',
  );
  invariant(
    !entries.some((entry) => entry.name.endsWith('.tmp')),
    'program contains a temporary file',
  );

  const ledger = await json<Ledger>(join(root, 'ledger.json'));
  const manifest = await json<Manifest>(join(root, 'manifest.json'));
  const traces = await json<Trace[]>(join(root, 'traces.json'));
  const receipt = await json<CompletedReceipt>(join(root, 'receipt.json'));
  const queue = await json<{
    receipts: {
      idempotencyKey: string;
      state: string;
      providerReceiptId: string;
      result: { contentDigest?: string };
    }[];
  }>(join(root, 'queue.json'));
  const governance = await json<{
    budgets: {
      accounts: {
        limit: { costUsd: number; tokens: number; durationMs: number };
      }[];
      audit: { sequence: number }[];
    };
    revalidation: {
      schedules: { subjectId: string; dueAt: string; state: string }[];
      audit: { sequence: number }[];
    };
  }>(join(root, 'governance.json'));
  const report = (await readFile(join(root, 'dossier.md'), 'utf8')).trim();

  invariant(receipt.status === 'completed', 'receipt is not completed');
  invariant(
    receipt.publicationStatus === 'evidence_complete',
    'publication status is false',
  );
  invariant(
    receipt.programId === manifest.programId,
    'manifest/receipt program mismatch',
  );
  invariant(
    receipt.id === manifest.receiptId,
    'manifest points to a different receipt',
  );
  const { integrityHash, ...body } = receipt;
  invariant(
    canonicalDigest(body) === integrityHash,
    'receipt integrity hash mismatch',
  );

  const semanticValues: Record<string, unknown> = {
    ledger,
    manifest,
    report,
    traces,
  };
  for (const [name, expected] of Object.entries(receipt.artifacts)) {
    invariant(
      name in semanticValues,
      `receipt declares unknown artifact ${name}`,
    );
    invariant(
      canonicalDigest(semanticValues[name]) === expected,
      `${name} digest mismatch`,
    );
  }

  const claims = new Map(ledger.claims.map((claim) => [claim.id, claim]));
  const assessments = new Map(
    ledger.assessments.map((assessment) => [assessment.id, assessment]),
  );
  const evidence = new Map(
    ledger.evidence.map((artifact) => [artifact.id, artifact]),
  );
  invariant(
    new Set(ledger.claims.map(({ id }) => id)).size === ledger.claims.length,
    'duplicate claim ID',
  );
  invariant(
    new Set(ledger.assessments.map(({ id }) => id)).size ===
      ledger.assessments.length,
    'duplicate assessment ID',
  );
  invariant(
    new Set(ledger.evidence.map(({ id }) => id)).size ===
      ledger.evidence.length,
    'duplicate evidence ID',
  );

  for (const artifact of ledger.evidence) {
    invariant(
      artifact.programId === manifest.programId,
      'foreign evidence program',
    );
    invariant(
      artifact.storageUri === `cas://${artifact.contentDigest}`,
      'evidence storage URI/digest mismatch',
    );
    const casPath = await findCasObject(root, artifact.contentDigest);
    invariant(contained(root, casPath), 'CAS path escaped program directory');
    const bytes = await readFile(casPath);
    invariant(
      byteDigest(bytes) === artifact.contentDigest,
      'CAS content digest mismatch',
    );
    invariant(
      bytes.byteLength === artifact.byteLength,
      'CAS byte length mismatch',
    );
  }

  const rendered = new Set<string>();
  for (const trace of traces) {
    invariant(
      trace.sentence.length > 0 && report.includes(trace.sentence),
      'trace sentence absent from report',
    );
    invariant(trace.bindings.length > 0, 'factual sentence has no binding');
    for (const binding of trace.bindings) {
      const claim = claims.get(binding.claimId);
      const assessment = assessments.get(binding.assessmentId);
      const artifact = evidence.get(binding.evidenceId);
      invariant(
        claim?.status === 'supported',
        'unsupported claim rendered as fact',
      );
      invariant(
        claim.assessmentId === binding.assessmentId,
        'claim assessment pointer mismatch',
      );
      invariant(
        assessment?.claimId === claim.id && assessment.verdict === 'supported',
        'assessment does not support claim',
      );
      invariant(
        assessment.policyId === binding.policyId &&
          assessment.policyVersion === binding.policyVersion,
        'trace policy mismatch',
      );
      invariant(
        assessment.evidenceIds.includes(binding.evidenceId),
        'assessment did not accept bound evidence',
      );
      invariant(
        artifact?.contentDigest === binding.snapshotDigest,
        'trace snapshot digest mismatch',
      );
      const edge = ledger.claimEvidenceEdges.find(
        (candidate) =>
          candidate.claimId === claim.id &&
          candidate.evidenceId === artifact.id,
      );
      invariant(edge !== undefined, 'trace has no ledger edge');
      invariant(
        canonicalJson(edge.locator) === canonicalJson(binding.locator),
        'trace locator mismatch',
      );
      const start = binding.locator.startOffset;
      const end = binding.locator.endOffset;
      invariant(
        typeof start === 'number' &&
          typeof end === 'number' &&
          start >= 0 &&
          end > start,
        'locator is not exact',
      );
      const cas = await readFile(
        await findCasObject(root, artifact.contentDigest),
        'utf8',
      );
      invariant(
        end <= cas.length && cas.slice(start, end).length > 0,
        'locator is out of bounds',
      );
      rendered.add(claim.id);
    }
  }

  invariant(
    canonicalJson([...rendered].sort()) ===
      canonicalJson([...receipt.supportedClaimIds].sort()),
    'supported receipt set differs from rendered set',
  );
  for (const id of receipt.unresolvedClaimIds) {
    invariant(!rendered.has(id), `unresolved claim ${id} rendered`);
    invariant(
      manifest.unresolvedIssueIds.includes(id),
      `unresolved claim ${id} absent from manifest`,
    );
    invariant(
      claims.get(id)?.status !== 'supported',
      `unresolved claim ${id} is supported in ledger`,
    );
  }
  invariant(
    manifest.claimIds.every((id) => claims.has(id)),
    'manifest references missing claim',
  );
  invariant(
    queue.receipts.length === 1,
    'external effect was not exactly-once',
  );
  const effect = queue.receipts[0];
  invariant(
    effect?.state === 'completed',
    'external effect receipt is incomplete',
  );
  invariant(
    effect.providerReceiptId ===
      `local:${canonicalDigest(effect.idempotencyKey)}`,
    'provider receipt does not bind its idempotency key',
  );
  invariant(
    effect.result.contentDigest === receipt.snapshotDigest,
    'external effect receipt points to another snapshot',
  );
  for (const journal of [
    governance.budgets.audit,
    governance.revalidation.audit,
  ]) {
    invariant(
      journal.every(({ sequence }, index) => sequence === index),
      'governance audit sequence has a gap',
    );
  }
  invariant(
    governance.budgets.accounts.length === 1,
    'budget account is missing',
  );
  const schedule = governance.revalidation.schedules.find(
    ({ subjectId }) => subjectId === ledger.evidence[0]?.id,
  );
  invariant(
    schedule?.state === 'scheduled',
    'evidence revalidation is not scheduled',
  );
  invariant(
    Date.parse(schedule.dueAt) > Date.parse(receipt.issuedAt),
    'revalidation is not scheduled after evidence capture',
  );
  invariant(
    receipt.snapshotDigest === ledger.evidence[0]?.contentDigest,
    'terminal snapshot digest mismatch',
  );

  return {
    programId: receipt.programId,
    semanticDigests: Object.fromEntries(
      Object.entries(semanticValues).map(([name, value]) => [
        name,
        canonicalDigest(value),
      ]),
    ),
    receiptHash: integrityHash,
    snapshotDigest: receipt.snapshotDigest,
    supportedClaimIds: [...receipt.supportedClaimIds].sort(),
    unresolvedClaimIds: [...receipt.unresolvedClaimIds].sort(),
    effectReceiptCount: queue.receipts.length,
  };
}

export async function verifyPartialReceipt(
  programDirectory: string,
): Promise<void> {
  const receipt = await json<Record<string, unknown>>(
    join(programDirectory, 'receipt.json'),
  );
  invariant(receipt.status === 'cancelled', 'partial receipt is not cancelled');
  invariant(
    receipt.publicationStatus === 'partial',
    'cancelled receipt claims publication',
  );
  invariant(
    isRecord(receipt.completedArtifacts),
    'partial receipt lacks completed artifacts',
  );
  invariant(
    Array.isArray(receipt.missingArtifacts),
    'partial receipt lacks missing artifacts',
  );
  invariant(
    typeof receipt.integrityHash === 'string',
    'partial receipt lacks integrity hash',
  );
  const { integrityHash, ...body } = receipt;
  invariant(
    canonicalDigest(body) === integrityHash,
    'partial receipt integrity mismatch',
  );
  invariant(
    (receipt.missingArtifacts as unknown[]).length > 0,
    'partial receipt dishonestly claims completeness',
  );
}
