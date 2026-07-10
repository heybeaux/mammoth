import { z } from 'zod';
import {
  EntityIdSchema,
  NonEmptyStringSchema,
  UnitIntervalSchema,
} from './primitives.js';

export const SourceLineageSchema = z
  .object({
    id: EntityIdSchema,
    canonicalOriginId: EntityIdSchema.optional(),
    lineageType: z.enum([
      'primary',
      'independent_secondary',
      'syndicated',
      'press_release_derivative',
      'citation_derivative',
      'unknown',
    ]),
    parentLineageIds: z.array(EntityIdSchema),
    independenceScore: UnitIntervalSchema,
    notes: z.array(NonEmptyStringSchema).optional(),
  })
  .strict()
  .superRefine((lineage, ctx) => {
    if (lineage.parentLineageIds.includes(lineage.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['parentLineageIds'],
        message: 'source lineage cannot parent itself',
      });
    }
  });

export type SourceLineage = z.infer<typeof SourceLineageSchema>;

export function validateSourceLineageGraph(
  lineages: Iterable<SourceLineage>,
): void {
  const records = new Map(
    [...lineages].map((lineage) => {
      const parsed = SourceLineageSchema.parse(lineage);
      return [parsed.id, parsed] as const;
    }),
  );
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id))
      throw new Error(`source lineage cycle includes ${id}`);
    if (visited.has(id)) return;
    const lineage = records.get(id);
    if (!lineage) throw new Error(`unknown source lineage ${id}`);
    visiting.add(id);
    for (const parentId of lineage.parentLineageIds) visit(parentId);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of records.keys()) visit(id);
}

/** Returns canonical roots so derivatives can be counted as one confirmation. */
export function sourceLineageRoots(
  lineageId: string,
  lineages: ReadonlyMap<string, SourceLineage>,
): ReadonlySet<string> {
  const roots = new Set<string>();
  const visit = (id: string): void => {
    const lineage = lineages.get(id);
    if (!lineage) throw new Error(`unknown source lineage ${id}`);
    if (lineage.canonicalOriginId) {
      roots.add(lineage.canonicalOriginId);
      return;
    }
    if (lineage.parentLineageIds.length === 0) {
      roots.add(id);
      return;
    }
    for (const parentId of lineage.parentLineageIds) visit(parentId);
  };
  visit(lineageId);
  return roots;
}
