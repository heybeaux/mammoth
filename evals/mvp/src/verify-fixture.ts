import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type JsonRecord = Record<string, unknown>;

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ORACLE = {
  fixtureDigest:
    'sha256:a5bc9525ca686b3cf41fa0b4d389891fb5f3fd0f9bb07e82dff21bbb5ce0110d',
  charterDigest:
    'sha256:7d7fa5a08b6d48ff60cddffff3dbce9ab95cb580de7bc7685eee31147697d09d',
  schemaDigest:
    'sha256:0a99e398f1ed4e2d3a2950d26b8b589c21bb435f0360122ae01076ed6beb3d46',
} as const;

export const defaultFixtureRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../fixtures/mvp',
);

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`INVALID_MVP_FIXTURE:${message}`);
}

function object(value: unknown, path: string): JsonRecord {
  invariant(
    typeof value === 'object' && value !== null && !Array.isArray(value),
    `${path} must be an object`,
  );
  return value as JsonRecord;
}

function array(value: unknown, path: string): unknown[] {
  invariant(Array.isArray(value), `${path} must be an array`);
  return value;
}

function string(value: unknown, path: string): string {
  invariant(
    typeof value === 'string' && value.length > 0,
    `${path} must be a non-empty string`,
  );
  return value;
}

function integer(value: unknown, path: string): number {
  invariant(Number.isInteger(value), `${path} must be an integer`);
  return value as number;
}

function exactKeys(
  value: JsonRecord,
  expected: readonly string[],
  path: string,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  invariant(
    actual.length === wanted.length &&
      actual.every((key, index) => key === wanted[index]),
    `${path} keys must be exactly ${wanted.join(',')}; got ${actual.join(',')}`,
  );
}

function digest(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function unique(values: readonly string[], path: string): void {
  invariant(
    new Set(values).size === values.length,
    `${path} contains duplicates`,
  );
}

export interface FixtureVerification {
  fixtureId: string;
  sourceDigests: Readonly<Record<string, string>>;
  supportedClaimIds: readonly string[];
  nonSupportedClaimIds: readonly string[];
}

export async function verifyFixtureRoot(
  root = defaultFixtureRoot,
): Promise<FixtureVerification> {
  const fixtureBytes = await readFile(resolve(root, 'fixture.json'));
  const fixture = object(
    JSON.parse(new TextDecoder().decode(fixtureBytes)),
    '$',
  );
  exactKeys(
    fixture,
    [
      'schemaVersion',
      'fixtureId',
      'clock',
      'charterPath',
      'sources',
      'hostileInstructions',
      'claims',
      'expected',
    ],
    '$',
  );
  invariant(fixture.schemaVersion === '1.0.0', '$.schemaVersion must be 1.0.0');
  const fixtureId = string(fixture.fixtureId, '$.fixtureId');
  invariant(
    ISO_INSTANT.test(string(fixture.clock, '$.clock')),
    '$.clock must be a fixed UTC millisecond instant',
  );
  invariant(
    fixture.charterPath === 'charter.json',
    '$.charterPath must be charter.json',
  );

  const schemaBytes = await readFile(resolve(root, 'fixture.schema.json'));
  const schema = object(
    JSON.parse(new TextDecoder().decode(schemaBytes)),
    '$schema',
  );
  invariant(
    schema.additionalProperties === false,
    'schema root must reject additional properties',
  );
  invariant(
    object(schema.properties, '$schema.properties').schemaVersion !== undefined,
    'schema must declare schemaVersion',
  );
  const charterBytes = await readFile(resolve(root, 'charter.json'));
  const charter = object(
    JSON.parse(new TextDecoder().decode(charterBytes)),
    '$charter',
  );
  verifyCharter(charter);

  const sources = array(fixture.sources, '$.sources');
  invariant(sources.length > 0, '$.sources must not be empty');
  const sourceIds: string[] = [];
  const sourceText = new Map<string, string>();
  const sourceDigests: Record<string, string> = {};
  for (const [index, raw] of sources.entries()) {
    const path = `$.sources[${String(index)}]`;
    const source = object(raw, path);
    exactKeys(
      source,
      [
        'id',
        'sourceUri',
        'publisher',
        'mediaType',
        'snapshotPath',
        'retrievedAt',
        'contentDigest',
        'byteLength',
        'parsedTextDigest',
      ],
      path,
    );
    const id = string(source.id, `${path}.id`);
    const snapshotPath = string(source.snapshotPath, `${path}.snapshotPath`);
    invariant(
      !snapshotPath.includes('/') &&
        !snapshotPath.includes('\\') &&
        snapshotPath.startsWith('source-') &&
        snapshotPath.endsWith('.txt'),
      `${path}.snapshotPath must be a local source-*.txt file`,
    );
    invariant(
      source.mediaType === 'text/plain',
      `${path}.mediaType must be text/plain`,
    );
    invariant(
      new URL(string(source.sourceUri, `${path}.sourceUri`)).protocol ===
        'https:',
      `${path}.sourceUri must be HTTPS`,
    );
    invariant(
      ISO_INSTANT.test(string(source.retrievedAt, `${path}.retrievedAt`)),
      `${path}.retrievedAt must be UTC`,
    );
    const expectedDigest = string(
      source.contentDigest,
      `${path}.contentDigest`,
    );
    invariant(DIGEST.test(expectedDigest), `${path}.contentDigest is invalid`);
    invariant(
      source.parsedTextDigest === expectedDigest,
      `${path}.parsedTextDigest must equal contentDigest for text/plain`,
    );
    const bytes = await readFile(resolve(root, snapshotPath));
    invariant(
      bytes.byteLength === integer(source.byteLength, `${path}.byteLength`),
      `${path}.byteLength does not match snapshot bytes`,
    );
    invariant(
      digest(bytes) === expectedDigest,
      `${path}.contentDigest does not match snapshot bytes`,
    );
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    invariant(
      !text.includes('\r'),
      `${path} snapshot must use LF line endings`,
    );
    sourceIds.push(id);
    sourceText.set(id, text);
    sourceDigests[id] = expectedDigest;
  }
  unique(sourceIds, '$.sources[].id');

  const hostileInstructions = array(
    fixture.hostileInstructions,
    '$.hostileInstructions',
  );
  invariant(
    hostileInstructions.length > 0,
    '$.hostileInstructions must not be empty',
  );
  const hostileTexts: string[] = [];
  const hostileSourceIds = new Set<string>();
  for (const [index, raw] of hostileInstructions.entries()) {
    const path = `$.hostileInstructions[${String(index)}]`;
    const instruction = object(raw, path);
    exactKeys(instruction, ['sourceId', 'exactText', 'mustNotAffect'], path);
    const sourceId = string(instruction.sourceId, `${path}.sourceId`);
    hostileSourceIds.add(sourceId);
    const text = sourceText.get(sourceId);
    invariant(text !== undefined, `${path}.sourceId is unknown`);
    const exactText = string(instruction.exactText, `${path}.exactText`);
    invariant(
      text.includes(exactText),
      `${path}.exactText is absent from source`,
    );
    const effects = array(
      instruction.mustNotAffect,
      `${path}.mustNotAffect`,
    ).map((effect, effectIndex) =>
      string(effect, `${path}.mustNotAffect[${String(effectIndex)}]`),
    );
    unique(effects, `${path}.mustNotAffect`);
    const requiredEffects = [
      'criterion',
      'policy',
      'budget',
      'claimVerdicts',
      'report',
      'network',
      'filesystem',
    ];
    invariant(
      requiredEffects.every((effect) => effects.includes(effect)),
      `${path}.mustNotAffect omits a control-plane boundary`,
    );
    hostileTexts.push(exactText);
  }

  const claims = array(fixture.claims, '$.claims');
  invariant(
    claims.length >= 2,
    '$.claims must contain supported and non-supported cases',
  );
  const claimIds: string[] = [];
  const verdictByClaim = new Map<string, string>();
  for (const [index, raw] of claims.entries()) {
    const path = `$.claims[${String(index)}]`;
    const claim = object(raw, path);
    exactKeys(
      claim,
      [
        'id',
        'canonicalText',
        'subject',
        'predicate',
        'object',
        'expectedVerdict',
      ],
      path,
    );
    const id = string(claim.id, `${path}.id`);
    string(claim.canonicalText, `${path}.canonicalText`);
    string(claim.subject, `${path}.subject`);
    string(claim.predicate, `${path}.predicate`);
    string(claim.object, `${path}.object`);
    const verdict = string(claim.expectedVerdict, `${path}.expectedVerdict`);
    invariant(
      ['supported', 'contradicted', 'unresolved'].includes(verdict),
      `${path}.expectedVerdict is invalid`,
    );
    claimIds.push(id);
    verdictByClaim.set(id, verdict);
  }
  unique(claimIds, '$.claims[].id');
  invariant(
    [...verdictByClaim.values()].includes('supported'),
    'fixture must include a supported claim',
  );
  invariant(
    [...verdictByClaim.values()].some(
      (value) => value === 'unresolved' || value === 'contradicted',
    ),
    'fixture must include an unresolved or contradicted claim',
  );

  const expected = object(fixture.expected, '$.expected');
  exactKeys(
    expected,
    ['locators', 'assessments', 'renderedClaimIds', 'excludedClaimIds'],
    '$.expected',
  );
  const locatorSourcesByClaim = new Map<string, string[]>();
  for (const [index, raw] of array(
    expected.locators,
    '$.expected.locators',
  ).entries()) {
    const path = `$.expected.locators[${String(index)}]`;
    const locator = object(raw, path);
    exactKeys(
      locator,
      [
        'claimId',
        'sourceId',
        'lineStart',
        'lineEnd',
        'startOffset',
        'endOffset',
        'exactText',
        'stance',
        'entailment',
      ],
      path,
    );
    const claimId = string(locator.claimId, `${path}.claimId`);
    invariant(verdictByClaim.has(claimId), `${path}.claimId is unknown`);
    invariant(
      verdictByClaim.get(claimId) !== 'unresolved',
      `${path} unresolved claims must not have accepted locators`,
    );
    const sourceId = string(locator.sourceId, `${path}.sourceId`);
    invariant(
      !hostileSourceIds.has(sourceId),
      `${path} hostile source data cannot become accepted evidence`,
    );
    const text = sourceText.get(sourceId);
    invariant(text !== undefined, `${path}.sourceId is unknown`);
    const start = integer(locator.startOffset, `${path}.startOffset`);
    const end = integer(locator.endOffset, `${path}.endOffset`);
    const exactText = string(locator.exactText, `${path}.exactText`);
    invariant(start >= 0 && end > start, `${path} offsets are invalid`);
    invariant(
      text.slice(start, end) === exactText,
      `${path} offset slice does not match exactText`,
    );
    const lines = text
      .split('\n')
      .slice(
        integer(locator.lineStart, `${path}.lineStart`) - 1,
        integer(locator.lineEnd, `${path}.lineEnd`),
      )
      .join('\n');
    invariant(
      lines === exactText,
      `${path} line locator does not match exactText`,
    );
    invariant(
      locator.entailment === 'direct',
      `${path}.entailment must be direct`,
    );
    invariant(
      locator.stance === 'supports' || locator.stance === 'contradicts',
      `${path}.stance is invalid`,
    );
    invariant(
      (locator.stance === 'supports' &&
        verdictByClaim.get(claimId) === 'supported') ||
        (locator.stance === 'contradicts' &&
          verdictByClaim.get(claimId) === 'contradicted'),
      `${path}.stance does not match the expected claim verdict`,
    );
    locatorSourcesByClaim.set(claimId, [
      ...(locatorSourcesByClaim.get(claimId) ?? []),
      sourceId,
    ]);
  }

  const assessmentClaimIds: string[] = [];
  for (const [index, raw] of array(
    expected.assessments,
    '$.expected.assessments',
  ).entries()) {
    const path = `$.expected.assessments[${String(index)}]`;
    const assessment = object(raw, path);
    exactKeys(
      assessment,
      [
        'claimId',
        'policyId',
        'policyVersion',
        'verdict',
        'reasonCodes',
        'evidenceIds',
      ],
      path,
    );
    const claimId = string(assessment.claimId, `${path}.claimId`);
    invariant(verdictByClaim.has(claimId), `${path}.claimId is unknown`);
    invariant(
      assessment.verdict === verdictByClaim.get(claimId),
      `${path}.verdict differs from claim expectedVerdict`,
    );
    const policyId = string(assessment.policyId, `${path}.policyId`);
    invariant(
      policyId === charter.evidencePolicyId,
      `${path}.policyId differs from the pinned charter policy`,
    );
    string(assessment.policyVersion, `${path}.policyVersion`);
    const reasons = array(assessment.reasonCodes, `${path}.reasonCodes`).map(
      (reason, reasonIndex) =>
        string(reason, `${path}.reasonCodes[${String(reasonIndex)}]`),
    );
    invariant(reasons.length > 0, `${path}.reasonCodes must not be empty`);
    const evidenceIds = array(
      assessment.evidenceIds,
      `${path}.evidenceIds`,
    ).map((id, evidenceIndex) =>
      string(id, `${path}.evidenceIds[${String(evidenceIndex)}]`),
    );
    invariant(
      evidenceIds.every((id) => sourceIds.includes(id)),
      `${path}.evidenceIds contains an unknown source`,
    );
    if (assessment.verdict === 'supported')
      invariant(
        evidenceIds.length > 0 &&
          evidenceIds.every((id) =>
            (locatorSourcesByClaim.get(claimId) ?? []).includes(id),
          ),
        `${path} supported verdict requires locator-bound evidence`,
      );
    if (assessment.verdict === 'unresolved')
      invariant(
        evidenceIds.length === 0,
        `${path} unresolved fixture verdict must fail closed without accepted evidence`,
      );
    assessmentClaimIds.push(claimId);
  }
  unique(assessmentClaimIds, '$.expected.assessments[].claimId');
  invariant(
    claimIds.every((id) => assessmentClaimIds.includes(id)),
    'every claim must have an expected assessment',
  );

  const rendered = array(
    expected.renderedClaimIds,
    '$.expected.renderedClaimIds',
  ).map((id, index) =>
    string(id, `$.expected.renderedClaimIds[${String(index)}]`),
  );
  const excluded = array(
    expected.excludedClaimIds,
    '$.expected.excludedClaimIds',
  ).map((id, index) =>
    string(id, `$.expected.excludedClaimIds[${String(index)}]`),
  );
  unique(rendered, '$.expected.renderedClaimIds');
  unique(excluded, '$.expected.excludedClaimIds');
  invariant(
    rendered.every((id) => verdictByClaim.get(id) === 'supported'),
    'only supported claims may render',
  );
  invariant(
    excluded.every(
      (id) => verdictByClaim.has(id) && verdictByClaim.get(id) !== 'supported',
    ),
    'excluded claims must be known and non-supported',
  );
  invariant(
    claimIds.every((id) => rendered.includes(id) !== excluded.includes(id)),
    'every claim must be in exactly one render outcome',
  );
  const authoritativeOracle = JSON.stringify({ charter, claims, expected });
  invariant(
    hostileTexts.every((text) => !authoritativeOracle.includes(text)),
    'hostile source text leaked into authoritative fixture decisions',
  );
  invariant(
    object(charter.criterion, '$charter.criterion').id ===
      'criterion:mvp-example-domains:v1',
    'hostile input altered the pinned criterion',
  );
  invariant(
    charter.evidencePolicyId === 'policy:public-direct-locator-v1',
    'hostile input altered the pinned evidence policy',
  );

  invariant(
    digest(fixtureBytes) === ORACLE.fixtureDigest,
    'fixture.json drifted from independent oracle',
  );
  invariant(
    digest(charterBytes) === ORACLE.charterDigest,
    'charter.json drifted from independent oracle',
  );
  invariant(
    digest(schemaBytes) === ORACLE.schemaDigest,
    'fixture.schema.json drifted from independent oracle',
  );

  return {
    fixtureId,
    sourceDigests,
    supportedClaimIds: rendered,
    nonSupportedClaimIds: excluded,
  };
}

function verifyCharter(charter: JsonRecord): void {
  exactKeys(
    charter,
    [
      'schemaVersion',
      'id',
      'title',
      'question',
      'criterion',
      'evidencePolicyId',
      'budget',
      'stopConditions',
    ],
    '$charter',
  );
  invariant(
    charter.schemaVersion === '1.0.0',
    '$charter.schemaVersion must be 1.0.0',
  );
  string(charter.id, '$charter.id');
  string(charter.title, '$charter.title');
  string(charter.question, '$charter.question');
  string(charter.evidencePolicyId, '$charter.evidencePolicyId');
  const criterion = object(charter.criterion, '$charter.criterion');
  exactKeys(
    criterion,
    [
      'id',
      'version',
      'standard',
      'admissibleEvidence',
      'prohibitedEvidence',
      'tiePolicy',
    ],
    '$charter.criterion',
  );
  string(criterion.id, '$charter.criterion.id');
  invariant(
    integer(criterion.version, '$charter.criterion.version') > 0,
    '$charter.criterion.version must be positive',
  );
  string(criterion.standard, '$charter.criterion.standard');
  invariant(
    criterion.tiePolicy === 'unresolved',
    '$charter.criterion.tiePolicy must fail closed',
  );
  const budget = object(charter.budget, '$charter.budget');
  exactKeys(
    budget,
    ['maxCostUsd', 'maxTokens', 'maxDurationSeconds'],
    '$charter.budget',
  );
  invariant(
    integer(budget.maxCostUsd, '$charter.budget.maxCostUsd') === 0,
    '$charter budget must prohibit cost',
  );
  invariant(
    integer(budget.maxTokens, '$charter.budget.maxTokens') === 0,
    '$charter budget must prohibit tokens',
  );
  invariant(
    integer(budget.maxDurationSeconds, '$charter.budget.maxDurationSeconds') >
      0,
    '$charter duration must be positive',
  );
}
