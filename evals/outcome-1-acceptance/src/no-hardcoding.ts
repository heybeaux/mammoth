import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Outcome1Manifest } from './types.js';

export interface HardcodingFinding {
  readonly path: string;
  readonly fingerprint: string;
  readonly reason: 'missing_generic_surface' | 'evaluation_fingerprint_present';
}

export function normalizeFingerprint(value: string): string {
  return value.toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/gu, '');
}

export async function scanOutcome1GenericSources(
  repositoryRoot: string,
  manifest: Outcome1Manifest,
): Promise<readonly HardcodingFinding[]> {
  const fingerprints = [
    ...manifest.legacyForbiddenFingerprints,
    ...manifest.cases.flatMap((entry) => [
      entry.uniqueSourceCanary,
      ...entry.forbiddenCrossFixtureFingerprints,
    ]),
  ].filter((entry) => normalizeFingerprint(entry).length >= 8);
  const findings: HardcodingFinding[] = [];
  for (const relativePath of manifest.genericSourceTargets) {
    let source: string;
    try {
      source = await readFile(resolve(repositoryRoot, relativePath), 'utf8');
    } catch {
      findings.push({
        path: relativePath,
        fingerprint: '<required generic surface>',
        reason: 'missing_generic_surface',
      });
      continue;
    }
    const normalizedSource = normalizeFingerprint(source);
    for (const fingerprint of fingerprints) {
      if (normalizedSource.includes(normalizeFingerprint(fingerprint))) {
        findings.push({
          path: relativePath,
          fingerprint,
          reason: 'evaluation_fingerprint_present',
        });
      }
    }
  }
  return findings;
}

export function scanCrossFixtureLeakage(
  manifest: Outcome1Manifest,
  renderedByCase: Readonly<Record<string, string>>,
): readonly HardcodingFinding[] {
  const findings: HardcodingFinding[] = [];
  for (const fixtureCase of manifest.cases) {
    const rendered = normalizeFingerprint(
      renderedByCase[fixtureCase.caseId] ?? '',
    );
    for (const other of manifest.cases) {
      if (other.caseId === fixtureCase.caseId) continue;
      for (const fingerprint of [
        other.uniqueSourceCanary,
        ...other.forbiddenCrossFixtureFingerprints,
      ]) {
        if (
          normalizeFingerprint(fingerprint).length >= 8 &&
          rendered.includes(normalizeFingerprint(fingerprint))
        ) {
          findings.push({
            path: fixtureCase.caseId,
            fingerprint,
            reason: 'evaluation_fingerprint_present',
          });
        }
      }
    }
  }
  return findings;
}
