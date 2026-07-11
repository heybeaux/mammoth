import { createHash } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runResearchProgram, type RuntimeCharter } from '@mammoth/runtime';
import {
  defaultFixtureRoot,
  verifyFixtureRoot,
  type FixtureVerification,
} from './verify-fixture.js';

interface FixtureSource {
  id: string;
  sourceUri: string;
  snapshotPath: string;
  contentDigest: string;
}

interface FixtureClaim {
  id: string;
  canonicalText: string;
  subject: string;
  predicate: string;
  object: string;
  expectedVerdict: 'supported' | 'contradicted' | 'unresolved';
}

interface FixtureLocator {
  claimId: string;
  sourceId: string;
  startOffset: number;
  endOffset: number;
  exactText: string;
  stance: 'supports' | 'contradicts';
  entailment: 'direct';
}

interface FixtureDocument {
  fixtureId: string;
  clock: string;
  sources: FixtureSource[];
  claims: FixtureClaim[];
  hostileInstructions: { exactText: string }[];
  expected: {
    locators: FixtureLocator[];
    renderedClaimIds: string[];
    excludedClaimIds: string[];
  };
}

interface FixtureCharter {
  id: string;
  title: string;
  question: string;
  criterion: { id: string; version: number };
  evidencePolicyId: string;
}

type Json = Record<string, unknown>;

export interface RuntimeBridgeVerification extends FixtureVerification {
  outputRoot: string;
  programDirectory: string;
  transportCalls: number;
  traceCount: number;
  receiptDigest: string;
}

/** Executes the exact checked fixture and independently verifies every emitted boundary. */
export async function verifyRuntimeBridge(
  fixtureRoot = defaultFixtureRoot,
  outputRoot?: string,
): Promise<RuntimeBridgeVerification> {
  const oracle = await verifyFixtureRoot(fixtureRoot);
  const fixture = JSON.parse(
    await readFile(resolve(fixtureRoot, 'fixture.json'), 'utf8'),
  ) as FixtureDocument;
  const source = fixture.sources.find(
    ({ id }) =>
      oracle.sourceDigests[id] !== undefined &&
      fixture.expected.locators.some(({ sourceId }) => sourceId === id),
  );
  invariant(source, 'oracle has no locator-bound source');
  const sourceBytes = await readFile(resolve(fixtureRoot, source.snapshotPath));
  invariant(
    digestBytes(sourceBytes) === source.contentDigest,
    'source bytes drifted',
  );
  const checkedCharter = JSON.parse(
    await readFile(resolve(fixtureRoot, 'charter.json'), 'utf8'),
  ) as FixtureCharter;
  const locatorByClaim = new Map(
    fixture.expected.locators.map((locator) => [locator.claimId, locator]),
  );

  // Entailment is not inferred here. Only a locator already pinned and validated
  // by the independent fixture oracle is allowed to become supporting input.
  const runtimeCharter: RuntimeCharter = {
    programId: pathSafeId(checkedCharter.id),
    criterionId: `${checkedCharter.criterion.id}@${String(checkedCharter.criterion.version)}`,
    title: checkedCharter.title,
    question: checkedCharter.question,
    sourceUrl: source.sourceUri,
    evidencePolicyId: checkedCharter.evidencePolicyId,
    evidencePolicyVersion: '1.0.0',
    proposals: fixture.claims.map((claim) => {
      const locator = locatorByClaim.get(claim.id);
      invariant(
        !locator ||
          (locator.sourceId === source.id && locator.stance === 'supports'),
        `claim ${claim.id} lacks pinned direct support`,
      );
      return {
        id: claim.id,
        canonicalText: claim.canonicalText,
        subject: claim.subject,
        predicate: claim.predicate,
        object: claim.object,
        supportingQuote: locator?.exactText ?? `UNSUPPORTED:${claim.id}`,
        ...(locator
          ? {
              locator: {
                startOffset: locator.startOffset,
                endOffset: locator.endOffset,
              },
            }
          : {}),
      };
    }),
  };

  let transportCalls = 0;
  const root = outputRoot ?? (await mkdtemp(join(tmpdir(), 'mammoth-m2-')));
  const result = await runResearchProgram({
    rootDirectory: root,
    charter: runtimeCharter,
    now: () => new Date(fixture.clock),
    resolveHost: () => Promise.resolve(['203.0.113.10']),
    verifyEntailment: ({ claim, quote, locator, snapshotDigest }) => {
      const pinned = locatorByClaim.get(claim.id);
      invariant(pinned, `entailment requested for unpinned claim ${claim.id}`);
      invariant(
        quote === pinned.exactText,
        `entailment quote drifted: ${claim.id}`,
      );
      invariant(
        locator.startOffset === pinned.startOffset &&
          locator.endOffset === pinned.endOffset,
        `entailment locator drifted: ${claim.id}`,
      );
      invariant(
        snapshotDigest === source.contentDigest,
        `entailment snapshot drifted: ${claim.id}`,
      );
      return {
        entails: true,
        receiptId: `fixture-oracle:${fixture.fixtureId}:${claim.id}`,
        verifierId: 'mammoth-m2-pinned-fixture-oracle',
        verifierVersion: '1.0.0',
      };
    },
    transport: (request) => {
      transportCalls += 1;
      invariant(
        request.href === source.sourceUri,
        'runtime requested an unpinned URL',
      );
      return Promise.resolve({
        status: 200,
        headers: new Headers({ 'content-type': 'text/plain' }),
        body: new Response(sourceBytes).body,
      });
    },
  });

  invariant(
    transportCalls <= 1,
    'fixture transport was invoked more than once',
  );
  invariant(
    result.snapshotDigest === source.contentDigest,
    'snapshot digest differs from oracle',
  );
  sameSet(
    result.supportedClaimIds,
    oracle.supportedClaimIds,
    'supported result claims',
  );
  sameSet(
    result.unresolvedClaimIds,
    oracle.nonSupportedClaimIds,
    'non-supported result claims',
  );

  const [report, manifest, traces, ledger, receipt] = await Promise.all([
    readFile(result.paths.report, 'utf8'),
    readJson(result.paths.manifest),
    readJsonArray(result.paths.traces),
    readJson(result.paths.ledger),
    readJson(result.paths.receipt),
  ]);
  const claims = records(ledger.claims, 'ledger.claims');
  const assessments = records(ledger.assessments, 'ledger.assessments');
  const evidence = records(ledger.evidence, 'ledger.evidence');
  const edges = records(ledger.claimEvidenceEdges, 'ledger.claimEvidenceEdges');
  const runtimeEvidence = evidence.find(
    (item) => item.contentDigest === source.contentDigest,
  );
  invariant(runtimeEvidence, 'ledger omits oracle evidence digest');

  for (const claim of fixture.claims) {
    const actual = claims.find((item) => item.id === claim.id);
    invariant(
      actual?.status === claim.expectedVerdict,
      `claim verdict drifted: ${claim.id}`,
    );
    const assessment = assessments.find((item) => item.claimId === claim.id);
    invariant(
      assessment?.policyId === checkedCharter.evidencePolicyId,
      `policy drifted: ${claim.id}`,
    );
    invariant(
      assessment.verdict === claim.expectedVerdict,
      `assessment drifted: ${claim.id}`,
    );
    const locator = locatorByClaim.get(claim.id);
    if (locator) {
      const edge = edges.find((item) => item.claimId === claim.id);
      invariant(edge, `missing edge: ${claim.id}`);
      const actualLocator = record(edge.locator, `edge locator ${claim.id}`);
      invariant(
        actualLocator.startOffset === locator.startOffset,
        `locator start drifted: ${claim.id}`,
      );
      invariant(
        actualLocator.endOffset === locator.endOffset,
        `locator end drifted: ${claim.id}`,
      );
      invariant(
        new TextDecoder()
          .decode(sourceBytes)
          .slice(locator.startOffset, locator.endOffset) === locator.exactText,
        `locator bytes drifted: ${claim.id}`,
      );
    }
  }

  sameSet(
    strings(manifest.claimIds, 'manifest.claimIds'),
    fixture.claims.map(({ id }) => id),
    'manifest claims',
  );
  sameSet(
    strings(manifest.unresolvedIssueIds, 'manifest.unresolvedIssueIds'),
    oracle.nonSupportedClaimIds,
    'manifest unresolved claims',
  );
  for (const id of oracle.supportedClaimIds) {
    const claim = fixture.claims.find((item) => item.id === id);
    invariant(
      claim && report.includes(claim.canonicalText),
      `report omits supported claim ${id}`,
    );
  }
  for (const id of oracle.nonSupportedClaimIds) {
    const claim = fixture.claims.find((item) => item.id === id);
    invariant(
      claim && !report.includes(claim.canonicalText),
      `report rendered unsupported claim ${id}`,
    );
  }
  for (const { exactText } of fixture.hostileInstructions)
    invariant(
      !report.includes(exactText),
      'hostile source instruction reached report',
    );

  invariant(
    traces.length === oracle.supportedClaimIds.length,
    'trace count differs from supported claims',
  );
  for (const trace of traces) {
    const bindings = records(trace.bindings, 'trace.bindings');
    invariant(bindings.length > 0, 'trace has no evidence binding');
    for (const binding of bindings) {
      invariant(
        oracle.supportedClaimIds.includes(String(binding.claimId)),
        'trace binds non-supported claim',
      );
      invariant(
        binding.snapshotDigest === source.contentDigest,
        'trace digest differs from oracle',
      );
      invariant(
        binding.policyId === checkedCharter.evidencePolicyId,
        'trace policy differs from charter',
      );
    }
  }

  const hex = source.contentDigest.slice('sha256:'.length);
  const casBytes = await readFile(
    join(
      result.paths.programDirectory,
      'cas',
      'sha256',
      hex.slice(0, 2),
      hex.slice(2),
    ),
  );
  invariant(
    digestBytes(casBytes) === source.contentDigest,
    'CAS bytes fail independent digest',
  );

  const integrityHash = string(receipt.integrityHash, 'receipt.integrityHash');
  const receiptBody = { ...receipt };
  delete receiptBody.integrityHash;
  invariant(
    digestValue(receiptBody) === integrityHash,
    'completion receipt integrity failed',
  );
  const artifactDigests = record(receipt.artifacts, 'receipt.artifacts');
  invariant(
    artifactDigests.manifest === digestValue(manifest),
    'receipt manifest digest failed',
  );
  invariant(
    artifactDigests.traces === digestValue(traces),
    'receipt trace digest failed',
  );
  invariant(
    artifactDigests.ledger === digestValue(ledger),
    'receipt ledger digest failed',
  );
  invariant(
    artifactDigests.report === digestValue(report.trimEnd()),
    'receipt report digest failed',
  );

  return {
    ...oracle,
    outputRoot: root,
    programDirectory: result.paths.programDirectory,
    transportCalls,
    traceCount: traces.length,
    receiptDigest: integrityHash,
  };
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`M2_RUNTIME_VERIFICATION_FAILED:${message}`);
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const item = value as Json;
  return `{${Object.keys(item)
    .sort()
    .filter((key) => item[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonical(item[key])}`)
    .join(',')}}`;
}

function digestBytes(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function digestValue(value: unknown): string {
  return digestBytes(new TextEncoder().encode(canonical(value)));
}

async function readJson(path: string): Promise<Json> {
  return record(JSON.parse(await readFile(path, 'utf8')), path);
}

async function readJsonArray(path: string): Promise<Json[]> {
  return records(JSON.parse(await readFile(path, 'utf8')), path);
}

function record(value: unknown, path: string): Json {
  invariant(
    typeof value === 'object' && value !== null && !Array.isArray(value),
    `${path} is not an object`,
  );
  return value as Json;
}

function records(value: unknown, path: string): Json[] {
  invariant(Array.isArray(value), `${path} is not an array`);
  return value.map((item, index) => record(item, `${path}[${String(index)}]`));
}

function string(value: unknown, path: string): string {
  invariant(
    typeof value === 'string' && value.length > 0,
    `${path} is not a string`,
  );
  return value;
}

function strings(value: unknown, path: string): string[] {
  invariant(Array.isArray(value), `${path} is not an array`);
  return value.map((item, index) => string(item, `${path}[${String(index)}]`));
}

function sameSet(
  actual: readonly string[],
  expected: readonly string[],
  label: string,
): void {
  invariant(
    actual.length === expected.length &&
      expected.every((item) => actual.includes(item)),
    `${label} differ`,
  );
}

function pathSafeId(value: string): string {
  const mapped = value.replace(/[^A-Za-z0-9._-]/g, '-');
  invariant(
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(mapped),
    'checked charter id cannot map to a runtime program id',
  );
  return mapped;
}
