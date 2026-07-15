import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join, resolve } from 'node:path';
import {
  canonicalDigest,
  RobotsDecisionSchema,
  type P9BudgetVector,
} from '../packages/domain/src/index.js';
import {
  GovernanceError,
  P9BudgetAuthority,
  priceCatalogDigest,
} from '../packages/governance/src/index.js';
import {
  buildTruthfulRetrievalAttempt,
  AcquisitionFailure,
  BoundedParserRegistry,
  makeNotCheckedRobotsDecision,
  makeUnknownRightsStatus,
  NodePinnedSourceTransport,
  ParserPolicyError,
  P9RetrievalResidueLedger,
  retrieveSource,
  type SourceTransport,
  type SourceTransportRequest,
  type TransportResponse,
} from '../packages/retrieval/src/index.js';

const root = resolve(import.meta.dirname, '..');
const fixtureRoot = join(root, 'evals/fixtures/p9');

async function json(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(fixtureRoot, path), 'utf8')) as Record<
    string,
    unknown
  >;
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`P9_BASELINE_INVALID: ${message}`);
}

function hasZodIssue(error: unknown, message: string): boolean {
  if (!(error instanceof Error) || error.name !== 'ZodError') return false;
  const issues = (error as Error & { issues?: unknown }).issues;
  return (
    Array.isArray(issues) &&
    issues.some((issue) => {
      if (typeof issue !== 'object' || issue === null) return false;
      return (issue as Record<string, unknown>).message === message;
    })
  );
}

const manifest = await json('verifier-manifest.json');
invariant(manifest.contractFamily === 'p9.v1', 'manifest contract family');
const inputs = manifest.inputs;
invariant(
  Array.isArray(inputs) && inputs.length === 10,
  'ten frozen verifier inputs',
);
const inputDigests = manifest.inputDigests;
invariant(inputDigests && typeof inputDigests === 'object', 'input digest map');
await Promise.all(
  inputs.map(async (path) => {
    const relativePath = String(path);
    const bytes = await readFile(join(fixtureRoot, relativePath));
    const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    invariant(
      (inputDigests as Record<string, unknown>)[relativePath] === digest,
      `${relativePath} digest`,
    );
    return json(relativePath);
  }),
);

const planPaths = inputs.filter((path) => String(path).startsWith('plans/'));
invariant(planPaths.length === 4, 'four plan fixtures');
const plans = await Promise.all(planPaths.map((path) => json(String(path))));
const domainPacks = new Set(
  plans.map((plan) => plan.domainPack).filter(Boolean),
);
invariant(domainPacks.size === 3, 'three unrelated domain packs');
for (const plan of plans.filter((candidate) => candidate.domainPack)) {
  invariant(
    Array.isArray(plan.subquestions) && plan.subquestions.length >= 4,
    `${String(plan.fixtureId)} subquestions`,
  );
  invariant(
    Array.isArray(plan.requiredSourceClasses) &&
      plan.requiredSourceClasses.length >= 5,
    `${String(plan.fixtureId)} source classes`,
  );
  invariant(
    Array.isArray(plan.requiredContradictions) &&
      plan.requiredContradictions.length >= 2,
    `${String(plan.fixtureId)} contradictions`,
  );
}

const hostile = await json('hostile-manifest.json');
const cases = hostile.cases;
invariant(Array.isArray(cases) && cases.length >= 20, 'hostile corpus size');
const hostileClasses = new Set(
  cases.map((entry) => (entry as { class?: string }).class),
);
for (const required of [
  'budget',
  'network',
  'parser',
  'metadata',
  'entailment',
  'prompt_injection',
  'retention',
  'future_schema',
  'verifier_gaming',
]) {
  invariant(hostileClasses.has(required), `hostile class ${required}`);
}
const hostileIds = new Set(
  cases.map((entry) => (entry as { id?: string }).id).filter(Boolean),
);
for (const required of [
  'budget-concurrent-remainder',
  'budget-unknown-cost',
  'budget-retry-split',
  'budget-settlement-lost',
  'budget-cancel-race',
  'budget-bound-breach',
  'metadata-retrieval-as-publication',
  'metadata-robots-unchecked',
]) {
  invariant(hostileIds.has(required), `T1 hostile fixture ${required}`);
}
for (const required of [
  'network-obfuscated-loopback',
  'network-ipv6-mapped-private',
  'network-rebinding',
  'network-public-private-redirect',
  'network-env-proxy-bypass',
  'parser-binary-pdf-as-text',
  'parser-bomb-malformed-encrypted',
]) {
  invariant(hostileIds.has(required), `T2 hostile fixture ${required}`);
}

const expected = await json('expected-artifacts.json');
invariant(
  expected.baselineStatus === 'frozen_implementation_blocked',
  'T0 cannot claim implementation',
);
invariant(
  Array.isArray(expected.requiredImplementationGates) &&
    expected.requiredImplementationGates.length === 6,
  'six successor implementation gates',
);

const receipt = await json('receipt-schema.json');
invariant(receipt.additionalProperties === false, 'closed receipt schema');

await verifyT1BudgetAndMetadata();
await verifyT2AcquisitionAndParsers();

console.log(
  'P9 acceptance ok — T0 fixtures=10 plans=4 hostile=21; T1 budget_metadata=pass; T2 acquisition_parsers=pass; T3-T6=blocked',
);

function budgetVector(currencyUsd: number): P9BudgetVector {
  return {
    currencyUsd,
    requests: 20,
    inputTokens: 20_000,
    outputTokens: 20_000,
    bytes: 20_000_000,
    durationMs: 1_200_000,
  };
}

function makeBudget(limitUsd: number): P9BudgetAuthority {
  const identity = {
    schemaVersion: '1.0.0' as const,
    contractFamily: 'p9.v1' as const,
    catalogId: 'p9-verifier-catalog',
    version: '2026-07-15',
    entries: [
      {
        id: 'search-v1',
        provider: 'fixture-search/v1',
        effectKind: 'search' as const,
        parserClass: null,
        flatCostUsd: 0,
        costPerRequestUsd: 0.6,
        costPerInputTokenUsd: 0,
        costPerOutputTokenUsd: 0,
        costPerByteUsd: 0,
      },
    ],
  };
  return new P9BudgetAuthority(
    {
      accountId: 'verify-p9-budget',
      programId: 'verify-p9-program',
      catalog: {
        ...identity,
        catalogDigest: priceCatalogDigest(identity),
      },
      limit: budgetVector(limitUsd),
    },
    () => '2026-07-15T02:00:00.000Z',
  );
}

function reserve(authority: P9BudgetAuthority, id: string, attempts = 1): void {
  authority.reserve({
    reservationId: `reservation-${id}`,
    workItemId: `work-${id}`,
    effectId: `effect-${id}`,
    idempotencyKey: `key-${id}`,
    catalogEntryId: 'search-v1',
    ceiling: {
      requests: 1,
      inputTokens: 0,
      outputTokens: 0,
      bytes: 0,
      durationMs: 1_000,
      attempts,
      parserClass: null,
    },
    actorId: 'p9-verifier',
  });
}

async function verifyT1BudgetAndMetadata(): Promise<void> {
  const concurrent = makeBudget(1);
  const race = await Promise.allSettled([
    Promise.resolve().then(() => {
      reserve(concurrent, 'concurrent-a');
    }),
    Promise.resolve().then(() => {
      reserve(concurrent, 'concurrent-b');
    }),
  ]);
  invariant(
    race.filter((result) => result.status === 'fulfilled').length === 1 &&
      race.filter((result) => result.status === 'rejected').length === 1,
    'T1 concurrent reservations cannot spend the same remainder',
  );

  const unknown = makeBudget(2);
  reserve(unknown, 'unknown');
  unknown.markTransportStarted('reservation-unknown', 'p9-verifier');
  const unknownReceipt = unknown.settle('reservation-unknown', {
    costState: 'unknown',
    actorId: 'p9-verifier',
  });
  invariant(
    unknownReceipt.state === 'ambiguous' &&
      unknownReceipt.charged.currencyUsd === 0.6,
    'T1 unknown cost is conservative and never zero',
  );

  const retries = makeBudget(1.3);
  reserve(retries, 'retry', 2);
  let splitDenied = false;
  try {
    reserve(retries, 'split');
  } catch (error) {
    splitDenied =
      error instanceof GovernanceError && error.code === 'budget_exhausted';
  }
  invariant(splitDenied, 'T1 retry or split is denied before transport');

  const lost = makeBudget(2);
  reserve(lost, 'lost');
  lost.markTransportStarted('reservation-lost', 'p9-verifier');
  const lostReceipt = lost.settle('reservation-lost', {
    costState: 'settlement_lost',
    actorId: 'p9-verifier',
  });
  invariant(
    lostReceipt.state === 'ambiguous' &&
      lostReceipt.settlementCostState === 'settlement_lost',
    'T1 lost settlement remains visible and conservatively charged',
  );

  const cancellation = makeBudget(2);
  reserve(cancellation, 'cancel');
  cancellation.markTransportStarted('reservation-cancel', 'p9-verifier');
  cancellation.cancel(
    'reservation-cancel',
    'p9-verifier',
    'cancellation raced transport',
  );
  let secondTerminalDenied = false;
  try {
    cancellation.settle('reservation-cancel', {
      costState: 'unknown',
      actorId: 'p9-verifier',
    });
  } catch (error) {
    secondTerminalDenied =
      error instanceof GovernanceError &&
      error.code === 'terminal_settlement_conflict';
  }
  invariant(
    secondTerminalDenied && cancellation.snapshot().reservations.length === 1,
    'T1 cancellation race has one terminal settlement',
  );

  const breached = makeBudget(2);
  reserve(breached, 'breach');
  breached.markTransportStarted('reservation-breach', 'p9-verifier');
  let breachStopped = false;
  try {
    breached.settle('reservation-breach', {
      costState: 'known',
      actual: {
        currencyUsd: 0.8,
        requests: 1,
        inputTokens: 0,
        outputTokens: 0,
        bytes: 0,
        durationMs: 500,
      },
      actorId: 'p9-verifier',
    });
  } catch (error) {
    breachStopped =
      error instanceof GovernanceError &&
      error.code === 'provider_bound_breached';
  }
  invariant(
    breachStopped && breached.isCatalogEntryQuarantined('search-v1'),
    'T1 provider bound breach is recorded and catalog entry quarantined',
  );
  invariant(
    canonicalDigest(
      P9BudgetAuthority.restore(unknown.snapshot()).snapshot(),
    ) === canonicalDigest(unknown.snapshot()),
    'T1 budget authority restores without rewriting unknown cost',
  );

  const now = '2026-07-15T02:00:00.000Z';
  const requestedUrl = 'https://example.com/p9';
  const robots = makeNotCheckedRobotsDecision({
    requestedUrl,
    userAgent: 'MammothP9/0.9',
    policyId: 'robots-policy/v1',
    evaluatedAt: now,
  });
  const rights = makeUnknownRightsStatus({
    policyId: 'rights-policy/v1',
    observedAt: now,
  });
  const attempt = buildTruthfulRetrievalAttempt({
    attemptId: 'attempt-p9',
    candidateId: 'candidate-p9',
    effectId: 'effect-p9',
    requestedUrl,
    finalUrl: requestedUrl,
    status: 'admitted',
    startedAt: now,
    finishedAt: now,
    retrievedAt: now,
    robotsDecision: robots,
    rightsStatus: rights,
    bytes: 100,
  });
  invariant(
    attempt.publishedAt === null &&
      attempt.robotsDecision.status === 'not_checked' &&
      attempt.rightsStatus.status === 'unknown',
    'T1 unobserved source metadata remains absent or explicit unknown',
  );
  let falseRobotsClaimRejected = false;
  try {
    RobotsDecisionSchema.parse({
      ...robots,
      status: 'allowed',
      decisionPath: [],
    });
  } catch (error) {
    falseRobotsClaimRejected = hasZodIssue(
      error,
      'allowed or denied robots status requires evaluated bytes/receipt and a decision path',
    );
  }
  invariant(
    falseRobotsClaimRejected,
    'T1 robots allowed/denied requires evaluated receipt and decision path',
  );

  const residue = new P9RetrievalResidueLedger();
  residue.select({
    candidateId: 'candidate-p9',
    sourceClass: 'independent_analysis',
    requestedUrl,
    selectedAt: now,
  });
  residue.recordTerminal(attempt);
  const complete = residue.assertComplete({
    missingSourceClasses: ['security_audit'],
    assessedAt: now,
  });
  invariant(
    complete.missingCandidateIds.length === 0 &&
      complete.missingSourceClasses.includes('security_audit'),
    'T1 terminal retrieval residue distinguishes acquisition from coverage gaps',
  );
}

async function verifyT2AcquisitionAndParsers(): Promise<void> {
  const publicAddress = '93.184.216.34';
  const now = () => new Date('2026-07-15T03:30:00.000Z');
  const encoder = new TextEncoder();
  const response = (
    input: SourceTransportRequest,
    options: {
      status?: number;
      headers?: Readonly<Record<string, string>>;
      connectedAddress?: string;
    } = {},
  ): TransportResponse => ({
    status: options.status ?? 200,
    headers: { 'content-type': 'text/plain', ...options.headers },
    body: encoder.encode('evidence'),
    connectedAddress: options.connectedAddress ?? input.approvedAddress,
  });
  const transport = (
    handler: (input: SourceTransportRequest) => TransportResponse,
  ): SourceTransport => ({
    request: (input) => Promise.resolve(handler(input)),
  });

  for (const url of [
    'https://127.0.0.1/secret',
    'https://2130706433/secret',
    'https://0x7f000001/secret',
  ]) {
    let connected = false;
    try {
      await retrieveSource(
        { url },
        {
          resolveHost: () => Promise.resolve(['127.0.0.1']),
          transport: transport((input) => {
            connected = true;
            return response(input);
          }),
        },
      );
      throw new Error('obfuscated loopback unexpectedly connected');
    } catch (error: unknown) {
      invariant(
        error instanceof AcquisitionFailure && !connected,
        'T2 obfuscated loopback is blocked before connect',
      );
    }
  }

  let mappedConnected = false;
  try {
    await retrieveSource(
      { url: 'https://mapped.example/secret' },
      {
        resolveHost: () => Promise.resolve(['::ffff:127.0.0.1']),
        transport: transport((input) => {
          mappedConnected = true;
          return response(input);
        }),
      },
    );
    throw new Error('mapped private address unexpectedly connected');
  } catch (error: unknown) {
    invariant(
      error instanceof AcquisitionFailure && !mappedConnected,
      'T2 IPv6-mapped private address is blocked before connect',
    );
  }

  let resolutions = 0;
  try {
    await retrieveSource(
      { url: 'https://example.com/start' },
      {
        resolveHost: () =>
          Promise.resolve([resolutions++ === 0 ? publicAddress : '8.8.8.8']),
        transport: transport((input) =>
          response(input, { status: 302, headers: { location: '/finish' } }),
        ),
        now,
      },
    );
    throw new Error('DNS answer change unexpectedly accepted');
  } catch (error: unknown) {
    invariant(
      error instanceof AcquisitionFailure &&
        error.code === 'DNS_ANSWER_CHANGED' &&
        error.networkReceipts.length === 1,
      'T2 DNS rebinding is blocked with redirect residue',
    );
  }

  try {
    await retrieveSource(
      { url: 'https://public.example/start' },
      {
        resolveHost: (hostname) =>
          Promise.resolve(
            hostname === 'public.example' ? [publicAddress] : ['10.0.0.2'],
          ),
        transport: transport((input) =>
          response(input, {
            status: 302,
            headers: { location: 'https://private.example/secret' },
          }),
        ),
        now,
      },
    );
    throw new Error('public-to-private redirect unexpectedly accepted');
  } catch (error: unknown) {
    invariant(
      error instanceof AcquisitionFailure &&
        error.code === 'REDIRECT_ORIGIN_NOT_ALLOWED' &&
        error.networkReceipts.length === 1,
      'T2 public-to-private redirect is blocked with chain retained',
    );
  }

  const server = createServer((request, outgoing) => {
    outgoing.writeHead(200, { 'content-type': 'text/plain' });
    outgoing.end(
      request.headers.host?.startsWith('source.invalid') ? 'direct' : 'bad',
    );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as AddressInfo).port;
  const previousProxy = process.env.HTTPS_PROXY;
  process.env.HTTPS_PROXY = 'http://127.0.0.1:1';
  try {
    const direct = await new NodePinnedSourceTransport().request({
      url: new URL(`http://source.invalid:${String(port)}/evidence`),
      approvedAddress: '127.0.0.1',
      headers: {},
      signal: new AbortController().signal,
      maximumResponseBytes: 100,
    });
    invariant(
      new TextDecoder().decode(direct.body) === 'direct' &&
        direct.connectedAddress === '127.0.0.1',
      'T2 pinned transport ignores ambient proxy routing',
    );
  } finally {
    if (previousProxy === undefined) delete process.env.HTTPS_PROXY;
    else process.env.HTTPS_PROXY = previousProxy;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  const registry = new BoundedParserRegistry();
  for (const bytes of [
    encoder.encode('%PDF-1.7\nencrypted'),
    Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 1, 2]),
  ]) {
    try {
      registry.parse(bytes, 'text/plain', { now });
      throw new Error('binary bytes unexpectedly decoded as text');
    } catch (error: unknown) {
      invariant(
        error instanceof ParserPolicyError &&
          error.code === 'PARSER_MEDIA_TYPE_CONFLICT',
        'T2 binary or PDF bytes cannot enter the text parser',
      );
    }
  }
  try {
    registry.parse(encoder.encode('%PDF-1.7\nmalformed'), 'application/pdf', {
      now,
    });
    throw new Error('unsupported PDF unexpectedly parsed');
  } catch (error: unknown) {
    invariant(
      error instanceof ParserPolicyError &&
        error.code === 'PARSER_UNSUPPORTED_PDF' &&
        error.decision.reasonCode === 'pdf_explicitly_unsupported',
      'T2 unsupported PDF has an explicit media decision',
    );
  }
  try {
    registry.parse(encoder.encode('{not-json'), 'application/json', { now });
    throw new Error('malformed JSON unexpectedly parsed');
  } catch (error: unknown) {
    invariant(
      error instanceof ParserPolicyError &&
        error.receipt?.status === 'failed' &&
        error.receipt.failureCode === 'parser_malformed_input',
      'T2 malformed parser input retains typed failure receipt',
    );
  }
}
