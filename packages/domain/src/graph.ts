import { z } from 'zod';
import { EntityIdSchema, NonEmptyStringSchema } from './primitives.js';

export const ClaimDependencyKindSchema = z.enum([
  'derives_from',
  'requires',
  'refines',
  'contradicts',
]);

export const ClaimDependencySchema = z
  .object({
    id: EntityIdSchema,
    claimId: EntityIdSchema,
    dependsOnClaimId: EntityIdSchema,
    kind: ClaimDependencyKindSchema,
    rationale: NonEmptyStringSchema.optional(),
  })
  .strict()
  .superRefine((edge, ctx) => {
    if (edge.claimId === edge.dependsOnClaimId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dependsOnClaimId'],
        message: 'a claim cannot depend on itself',
      });
    }
  });

export type ClaimDependencyKind = z.infer<typeof ClaimDependencyKindSchema>;
export type ClaimDependency = z.infer<typeof ClaimDependencySchema>;

export interface ClaimGraphView {
  claimIds: readonly string[];
  dependencies: readonly ClaimDependency[];
  outgoing: ReadonlyMap<string, readonly ClaimDependency[]>;
  incoming: ReadonlyMap<string, readonly ClaimDependency[]>;
}

/** Builds an immutable query view and rejects dangling edges and causal cycles. */
export function buildClaimGraph(
  claimIds: Iterable<string>,
  dependencies: Iterable<ClaimDependency>,
): ClaimGraphView {
  const ids = [...new Set(claimIds)];
  const known = new Set(ids);
  const parsed = [...dependencies].map((edge) =>
    ClaimDependencySchema.parse(edge),
  );
  const outgoing = new Map<string, ClaimDependency[]>();
  const incoming = new Map<string, ClaimDependency[]>();

  for (const edge of parsed) {
    if (!known.has(edge.claimId) || !known.has(edge.dependsOnClaimId)) {
      throw new Error(
        `claim dependency ${edge.id} references an unknown claim`,
      );
    }
    appendEdge(outgoing, edge.claimId, edge);
    appendEdge(incoming, edge.dependsOnClaimId, edge);
  }

  assertAcyclic(ids, outgoing);
  return { claimIds: ids, dependencies: parsed, outgoing, incoming };
}

function appendEdge(
  index: Map<string, ClaimDependency[]>,
  claimId: string,
  edge: ClaimDependency,
): void {
  const existing = index.get(claimId);
  if (existing) existing.push(edge);
  else index.set(claimId, [edge]);
}

function assertAcyclic(
  claimIds: readonly string[],
  outgoing: ReadonlyMap<string, readonly ClaimDependency[]>,
): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id))
      throw new Error(`claim dependency cycle includes ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const edge of outgoing.get(id) ?? []) {
      if (edge.kind !== 'contradicts') visit(edge.dependsOnClaimId);
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of claimIds) visit(id);
}

export function dependencyClosure(
  graph: ClaimGraphView,
  claimId: string,
): ReadonlySet<string> {
  if (!graph.claimIds.includes(claimId))
    throw new Error(`unknown claim ${claimId}`);
  const result = new Set<string>();
  const visit = (id: string): void => {
    for (const edge of graph.outgoing.get(id) ?? []) {
      if (edge.kind === 'contradicts' || result.has(edge.dependsOnClaimId))
        continue;
      result.add(edge.dependsOnClaimId);
      visit(edge.dependsOnClaimId);
    }
  };
  visit(claimId);
  return result;
}
