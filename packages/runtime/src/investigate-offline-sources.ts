import { z } from 'zod';
import { SourceClassTargetSchema } from '@mammoth/domain';
import { canonicalizeAcquisitionUrl } from '@mammoth/retrieval';
import type {
  GovernedDiscoveryHint,
  GovernedNoEffectAdapters,
} from './investigate-governed-execution.js';

/**
 * Operator-supplied offline source catalog. This is the only source universe
 * a governed offline execution may touch: every candidate URL, source class,
 * and body is declared here up front, so execution performs no network,
 * provider, or paid effect. The catalog is content-generic; nothing in the
 * runtime branches on its topics.
 */
export const OfflineSourceCatalogSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    catalogId: z.string().min(1),
    sourceClasses: z.array(SourceClassTargetSchema).min(1),
    sources: z
      .array(
        z
          .object({
            url: z.string().url(),
            sourceClass: z.string().min(1),
            title: z.string().min(1).optional(),
            mediaType: z.enum(['text/plain', 'text/html', 'application/json']),
            body: z.string().min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
export type OfflineSourceCatalog = z.infer<typeof OfflineSourceCatalogSchema>;

/**
 * Builds strictly no-effect search/retrieval adapters over a validated
 * offline catalog. Search returns the full declared universe for every
 * planned query (plan-bound discovery deterministically rejects duplicates
 * and unplanned source classes as inspectable residue); retrieval only ever
 * returns bytes that were declared in the catalog.
 */
export function buildOfflineNoEffectAdapters(
  catalogInput: unknown,
): GovernedNoEffectAdapters {
  const catalog = OfflineSourceCatalogSchema.parse(catalogInput);
  const bodies = new Map<string, { bytes: Uint8Array; mediaType: string }>();
  const hints: GovernedDiscoveryHint[] = [];
  for (const source of catalog.sources) {
    const canonical = canonicalizeAcquisitionUrl(source.url).href;
    if (!bodies.has(canonical)) {
      bodies.set(canonical, {
        bytes: new TextEncoder().encode(source.body),
        mediaType: source.mediaType,
      });
    }
    hints.push({
      url: source.url,
      sourceClass: source.sourceClass,
      ...(source.title === undefined ? {} : { title: source.title }),
    });
  }
  return {
    sourceClassTargets: catalog.sourceClasses,
    search: () => [...hints],
    retrieve: (url) => {
      const found = bodies.get(canonicalizeAcquisitionUrl(url).href);
      return found ? { bytes: found.bytes, mediaType: found.mediaType } : null;
    },
  };
}
