import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ObservatoryProjectionV1Schema,
  buildObservatoryProjectionV1,
} from '../src/index.js';

const fixturePath = fileURLToPath(
  new URL(
    '../../../evals/fixtures/p2/observatory-projection-input.json',
    import.meta.url,
  ),
);
const projectionPath = fileURLToPath(
  new URL(
    '../../../evals/fixtures/p2/observatory-projection.json',
    import.meta.url,
  ),
);

async function fixture(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(fixturePath, 'utf8')) as Record<
    string,
    unknown
  >;
}

describe('ObservatoryProjectionV1', () => {
  it('matches the checked-in deterministic projection fixture', async () => {
    const projection = buildObservatoryProjectionV1(await fixture());
    const expected = JSON.parse(
      await readFile(projectionPath, 'utf8'),
    ) as unknown;
    expect(projection).toEqual(expected);
    expect(ObservatoryProjectionV1Schema.parse(projection)).toEqual(projection);
  });

  it('is deterministic across authoritative input ordering', async () => {
    const input = await fixture();
    const reordered = {
      ...input,
      claims: [...(input.claims as unknown[])].reverse(),
      evidence: [...(input.evidence as unknown[])].reverse(),
      claimEvidenceEdges: [
        ...(input.claimEvidenceEdges as unknown[]),
      ].reverse(),
      auditEvents: [...(input.auditEvents as unknown[])].reverse(),
    };
    expect(buildObservatoryProjectionV1(reordered)).toEqual(
      buildObservatoryProjectionV1(input),
    );
  });

  it('preserves contradicted and unresolved claims without promoting them', async () => {
    const projection = buildObservatoryProjectionV1(await fixture());
    const claims = projection.nodes.filter((node) => node.kind === 'claim');
    expect(claims.map(({ id, status }) => [id, status])).toEqual([
      ['claim-contradicted', 'contradicted'],
      ['claim-supported', 'supported'],
      ['claim-unresolved', 'unresolved'],
    ]);
    expect(
      projection.dossier.excludedClaims.map(({ claimId }) => claimId),
    ).toEqual(['claim-contradicted', 'claim-unresolved']);
  });

  it('keeps dossier sentences on their authoritative provenance chain', async () => {
    const projection = buildObservatoryProjectionV1(await fixture());
    expect(projection.dossier.sentences[0]?.bindings[0]).toMatchObject({
      claimId: 'claim-supported',
      assessmentId: 'assessment-supported',
      policyId: 'policy-1',
      evidenceId: 'evidence-support',
      snapshotDigest:
        'sha256:1111111111111111111111111111111111111111111111111111111111111111',
      locator: { lineStart: 4, lineEnd: 4 },
    });
  });

  it('fails closed on invalid schema and dangling provenance', async () => {
    const input = await fixture();
    expect(() =>
      buildObservatoryProjectionV1({ ...input, schemaVersion: 2 }),
    ).toThrow();
    const edges = input.claimEvidenceEdges as Record<string, unknown>[];
    expect(() =>
      buildObservatoryProjectionV1({
        ...input,
        claimEvidenceEdges: [{ ...edges[0], evidenceId: 'missing' }],
      }),
    ).toThrow(/dangling/);
  });

  it('rejects authority mismatches outside dossier traces', async () => {
    const input = await fixture();
    const claims = input.claims as Record<string, unknown>[];
    expect(() =>
      buildObservatoryProjectionV1({
        ...input,
        claims: claims.map((claim) =>
          claim.id === 'claim-supported'
            ? { ...claim, status: 'unresolved' }
            : claim,
        ),
      }),
    ).toThrow(/disagrees with its assessment/);

    const evidence = input.evidence as Record<string, unknown>[];
    expect(() =>
      buildObservatoryProjectionV1({
        ...input,
        evidence: evidence.map((artifact) => ({
          ...artifact,
          sourceLineageId: 'missing-lineage',
        })),
      }),
    ).toThrow(/unknown lineage/);
  });
});
