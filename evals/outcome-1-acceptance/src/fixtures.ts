import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type {
  Outcome1Case,
  Outcome1Corpus,
  Outcome1Manifest,
} from './types.js';

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('OUTCOME1_FIXTURE_INVALID: expected an object');
  }
  return value as Record<string, unknown>;
}

function strings(value: unknown, label: string): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((entry) => typeof entry !== 'string' || entry.length === 0)
  ) {
    throw new Error(`OUTCOME1_FIXTURE_INVALID: ${label}`);
  }
  return value as readonly string[];
}

export async function loadOutcome1Manifest(
  fixtureRoot: string,
): Promise<Outcome1Manifest> {
  const parsed = record(
    JSON.parse(await readFile(resolve(fixtureRoot, 'manifest.json'), 'utf8')),
  );
  if (
    parsed.schemaVersion !== '1.0.0' ||
    parsed.contractFamily !== 'outcome-1.v1' ||
    parsed.publicCommand !== 'research investigate' ||
    parsed.expectedPreviewExitCode !== 2 ||
    parsed.expectedPreviewStatus !== 'approval_required'
  ) {
    throw new Error('OUTCOME1_FIXTURE_INVALID: manifest authority');
  }
  strings(parsed.requiredPreviewArtifacts, 'requiredPreviewArtifacts');
  strings(parsed.requiredReaderArtifacts, 'requiredReaderArtifacts');
  strings(parsed.requiredAuditArtifacts, 'requiredAuditArtifacts');
  strings(parsed.genericSourceTargets, 'genericSourceTargets');
  strings(parsed.legacyForbiddenFingerprints, 'legacyForbiddenFingerprints');
  if (!Array.isArray(parsed.cases) || parsed.cases.length !== 4) {
    throw new Error(
      'OUTCOME1_FIXTURE_INVALID: exactly four visible cases required',
    );
  }
  const cases = parsed.cases.map((value) => {
    const candidate = record(value);
    if (
      typeof candidate.caseId !== 'string' ||
      !['technical', 'policy', 'scientific'].includes(
        String(candidate.domain),
      ) ||
      typeof candidate.question !== 'string' ||
      typeof candidate.corpusFile !== 'string' ||
      typeof candidate.uniqueSourceCanary !== 'string'
    ) {
      throw new Error('OUTCOME1_FIXTURE_INVALID: malformed case');
    }
    strings(
      candidate.answerObligations,
      `${candidate.caseId}.answerObligations`,
    );
    strings(
      candidate.requiredPreviewRoles,
      `${candidate.caseId}.requiredPreviewRoles`,
    );
    strings(
      candidate.forbiddenCrossFixtureFingerprints,
      `${candidate.caseId}.forbiddenCrossFixtureFingerprints`,
    );
    return candidate as unknown as Outcome1Case;
  });
  if (new Set(cases.map(({ caseId }) => caseId)).size !== cases.length) {
    throw new Error('OUTCOME1_FIXTURE_INVALID: duplicate case identity');
  }
  if (
    new Set(cases.map(({ uniqueSourceCanary }) => uniqueSourceCanary)).size !==
    cases.length
  ) {
    throw new Error('OUTCOME1_FIXTURE_INVALID: duplicate source canary');
  }
  return { ...(parsed as unknown as Outcome1Manifest), cases };
}

export async function loadOutcome1Corpus(
  fixtureRoot: string,
  fixtureCase: Outcome1Case,
): Promise<Outcome1Corpus> {
  const path = resolve(fixtureRoot, fixtureCase.corpusFile);
  const parsed = record(JSON.parse(await readFile(path, 'utf8')));
  if (
    parsed.schemaVersion !== '1.0.0' ||
    parsed.caseId !== fixtureCase.caseId ||
    typeof parsed.corpusId !== 'string' ||
    typeof parsed.falsifier !== 'string' ||
    typeof parsed.decoyClaim !== 'string' ||
    !Array.isArray(parsed.sources) ||
    parsed.sources.length < 3 ||
    !Array.isArray(parsed.contradictionPairs) ||
    parsed.contradictionPairs.length < 1
  ) {
    throw new Error(`OUTCOME1_FIXTURE_INVALID: ${fixtureCase.caseId} corpus`);
  }
  const sourceIds = new Set<string>();
  let canaryObserved = false;
  for (const value of parsed.sources) {
    const source = record(value);
    if (
      typeof source.sourceId !== 'string' ||
      typeof source.sourceClass !== 'string' ||
      typeof source.sourceFamily !== 'string' ||
      typeof source.bodyFile !== 'string' ||
      !['supporting', 'contradicting', 'context'].includes(
        String(source.position),
      )
    ) {
      throw new Error(`OUTCOME1_FIXTURE_INVALID: ${fixtureCase.caseId} source`);
    }
    sourceIds.add(source.sourceId);
    const body = await readFile(
      resolve(dirname(path), source.bodyFile),
      'utf8',
    );
    if (body.includes(fixtureCase.uniqueSourceCanary)) canaryObserved = true;
  }
  for (const value of parsed.contradictionPairs) {
    const pair = record(value);
    if (
      typeof pair.leftSourceId !== 'string' ||
      typeof pair.rightSourceId !== 'string' ||
      typeof pair.issue !== 'string' ||
      !sourceIds.has(pair.leftSourceId) ||
      !sourceIds.has(pair.rightSourceId)
    ) {
      throw new Error(
        `OUTCOME1_FIXTURE_INVALID: ${fixtureCase.caseId} contradiction`,
      );
    }
  }
  if (!canaryObserved) {
    throw new Error(
      `OUTCOME1_FIXTURE_INVALID: ${fixtureCase.caseId} canary absent`,
    );
  }
  return parsed as unknown as Outcome1Corpus;
}
