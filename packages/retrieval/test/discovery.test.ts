import { describe, expect, it } from 'vitest';
import {
  P9RetrievalResidueLedger,
  PlannedDiscoveryError,
  selectPlannedAcquisitionCandidates,
  unservedPlannedSourceClasses,
  type DiscoveredSourceHint,
  type PlannedDiscoveryScope,
} from '../src/index.js';

const SELECTED_AT = '2026-07-16T05:00:00.000Z';

const SCOPE: PlannedDiscoveryScope = {
  searchQueries: [
    {
      queryId: 'query-1',
      query: 'planned query one',
      subquestionIds: ['sq-1'],
    },
    {
      queryId: 'query-2',
      query: 'planned query two',
      subquestionIds: ['sq-2'],
    },
  ],
  sourceClassTargets: [
    { sourceClass: 'class-a', minimumIndependentSources: 2, mandatory: true },
    { sourceClass: 'class-b', minimumIndependentSources: 1, mandatory: false },
  ],
};

function hint(overrides: Partial<DiscoveredSourceHint>): DiscoveredSourceHint {
  return {
    queryId: 'query-1',
    url: 'https://example.com/a',
    sourceClass: 'class-a',
    ...overrides,
  };
}

describe('selectPlannedAcquisitionCandidates', () => {
  it('selects only plan-traceable candidates and preserves rejection residue', () => {
    const selection = selectPlannedAcquisitionCandidates({
      scope: SCOPE,
      hints: [
        hint({ url: 'https://example.com/a' }),
        hint({ queryId: 'unplanned-query', url: 'https://example.com/b' }),
        hint({ sourceClass: 'unplanned-class', url: 'https://example.com/c' }),
        hint({ url: 'http://example.com/insecure' }),
        hint({ url: 'not a url' }),
      ],
      selectedAt: SELECTED_AT,
    });
    expect(selection.candidates).toHaveLength(1);
    expect(selection.candidates[0]?.requestedUrl).toBe('https://example.com/a');
    expect(selection.rejected.map((entry) => entry.reason)).toStrictEqual([
      'query_not_planned',
      'source_class_not_planned',
      'url_not_permitted',
      'url_not_permitted',
    ]);
  });

  it('deduplicates by canonical URL identity', () => {
    const selection = selectPlannedAcquisitionCandidates({
      scope: SCOPE,
      hints: [
        hint({ url: 'https://example.com/a#section' }),
        hint({ url: 'https://example.com./a' }),
        hint({ url: 'https://example.com/a' }),
      ],
      selectedAt: SELECTED_AT,
    });
    expect(selection.candidates).toHaveLength(1);
    expect(
      selection.rejected.every((entry) => entry.reason === 'duplicate_source'),
    ).toBe(true);
  });

  it('derives deterministic content-bound candidate identities', () => {
    const run = () =>
      selectPlannedAcquisitionCandidates({
        scope: SCOPE,
        hints: [hint({ url: 'https://example.com/a' })],
        selectedAt: SELECTED_AT,
      });
    const [first] = run().candidates;
    const [second] = run().candidates;
    expect(first?.candidateId).toBe(second?.candidateId);
    expect(first?.candidateId).toMatch(/^discovered:[0-9a-f]{16}$/u);
  });

  it('enforces the optional per-source-class capacity as residue', () => {
    const selection = selectPlannedAcquisitionCandidates({
      scope: SCOPE,
      hints: [
        hint({ url: 'https://example.com/1' }),
        hint({ url: 'https://example.com/2' }),
        hint({ url: 'https://example.com/3' }),
        hint({ url: 'https://example.org/1', sourceClass: 'class-b' }),
      ],
      selectedAt: SELECTED_AT,
      maxCandidatesPerSourceClass: 2,
    });
    expect(selection.candidates).toHaveLength(3);
    expect(selection.rejected).toStrictEqual([
      {
        hint: hint({ url: 'https://example.com/3' }),
        reason: 'source_class_capacity_exhausted',
      },
    ]);
  });

  it('composes with the retrieval residue ledger without rework', () => {
    const selection = selectPlannedAcquisitionCandidates({
      scope: SCOPE,
      hints: [
        hint({ url: 'https://example.com/a' }),
        hint({ url: 'https://example.org/b', sourceClass: 'class-b' }),
      ],
      selectedAt: SELECTED_AT,
    });
    const ledger = new P9RetrievalResidueLedger();
    for (const candidate of selection.candidates) {
      expect(() => {
        ledger.select(candidate);
      }).not.toThrow();
    }
  });

  it('reports unserved planned source classes as a plan-relative gap', () => {
    const selection = selectPlannedAcquisitionCandidates({
      scope: SCOPE,
      hints: [hint({ url: 'https://example.com/a' })],
      selectedAt: SELECTED_AT,
    });
    expect(unservedPlannedSourceClasses(SCOPE, selection)).toStrictEqual([
      'class-b',
    ]);
  });

  it('rejects invalid selection inputs', () => {
    expect(() =>
      selectPlannedAcquisitionCandidates({
        scope: SCOPE,
        hints: [],
        selectedAt: '  ',
      }),
    ).toThrow(PlannedDiscoveryError);
    expect(() =>
      selectPlannedAcquisitionCandidates({
        scope: SCOPE,
        hints: [],
        selectedAt: SELECTED_AT,
        maxCandidatesPerSourceClass: 0,
      }),
    ).toThrow(PlannedDiscoveryError);
  });
});
