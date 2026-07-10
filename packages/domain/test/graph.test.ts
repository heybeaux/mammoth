import { describe, expect, it } from 'vitest';
import {
  buildClaimGraph,
  dependencyClosure,
  sourceLineageRoots,
  validateSourceLineageGraph,
  type ClaimDependency,
  type SourceLineage,
} from '../src/index.js';

describe('claim graph', () => {
  const edges: ClaimDependency[] = [
    {
      id: 'edge-1',
      claimId: 'conclusion',
      dependsOnClaimId: 'premise',
      kind: 'derives_from',
    },
    {
      id: 'edge-2',
      claimId: 'premise',
      dependsOnClaimId: 'observation',
      kind: 'requires',
    },
  ];

  it('finds the transitive lineage of a claim', () => {
    const graph = buildClaimGraph(
      ['conclusion', 'premise', 'observation'],
      edges,
    );
    expect([...dependencyClosure(graph, 'conclusion')].sort()).toEqual([
      'observation',
      'premise',
    ]);
  });

  it('rejects dangling references and causal cycles', () => {
    expect(() => buildClaimGraph(['conclusion'], edges)).toThrow(
      'unknown claim',
    );
    expect(() =>
      buildClaimGraph(
        ['a', 'b'],
        [
          { id: 'a-b', claimId: 'a', dependsOnClaimId: 'b', kind: 'requires' },
          { id: 'b-a', claimId: 'b', dependsOnClaimId: 'a', kind: 'requires' },
        ],
      ),
    ).toThrow('cycle');
  });

  it('allows contradiction pairs without treating them as causal cycles', () => {
    expect(() =>
      buildClaimGraph(
        ['a', 'b'],
        [
          {
            id: 'a-b',
            claimId: 'a',
            dependsOnClaimId: 'b',
            kind: 'contradicts',
          },
          {
            id: 'b-a',
            claimId: 'b',
            dependsOnClaimId: 'a',
            kind: 'contradicts',
          },
        ],
      ),
    ).not.toThrow();
  });
});

describe('source lineage', () => {
  const lineage: SourceLineage[] = [
    {
      id: 'announcement',
      lineageType: 'primary',
      parentLineageIds: [],
      independenceScore: 1,
    },
    {
      id: 'wire-story',
      lineageType: 'press_release_derivative',
      parentLineageIds: ['announcement'],
      independenceScore: 0.1,
    },
    {
      id: 'syndication',
      lineageType: 'syndicated',
      parentLineageIds: ['wire-story'],
      independenceScore: 0,
    },
  ];

  it('collapses derivative sources to their actual root', () => {
    validateSourceLineageGraph(lineage);
    expect(
      sourceLineageRoots('syndication', new Map(lineage.map((x) => [x.id, x]))),
    ).toEqual(new Set(['announcement']));
  });

  it('rejects lineage cycles', () => {
    const announcement = lineage[0];
    const wireStory = lineage[1];
    if (!announcement || !wireStory) throw new Error('invalid test fixture');
    expect(() => {
      validateSourceLineageGraph([
        { ...announcement, parentLineageIds: ['wire-story'] },
        wireStory,
      ]);
    }).toThrow('cycle');
  });
});
