import type { P9ObservedSourceSnapshot } from './p9-generic-research.js';

/**
 * Evaluator-visible snapshot window. Every governed claim span must be
 * derived from this same excerpt so the proposer span universe is always a
 * subset of what the evaluator can verify.
 */
export const P9_LIVE_MAX_SNAPSHOT_EXCERPT = 8_000;

export interface P9GovernedClaimSpan {
  readonly evidenceSpanId: string;
  readonly candidateId: string;
  readonly sourceClass: string;
  readonly sourceFamilyId: string;
  readonly quote: string;
}

export function deriveP9GovernedClaimSpans(
  snapshots: readonly P9ObservedSourceSnapshot[],
): readonly P9GovernedClaimSpan[] {
  return snapshots.flatMap((snapshot) => {
    const excerpt = snapshot.body.slice(0, P9_LIVE_MAX_SNAPSHOT_EXCERPT);
    const prose = excerpt
      .split(/(?<=[.!?])\s+|\n+/u)
      .map((quote) => quote.trim())
      .filter(
        (quote) =>
          quote.length >= 12 &&
          quote.length <= 600 &&
          !/chat_template_jinja|<\|(?:system|user|assistant|tool)|\\n\{%-|"availableInferenceProviders"/u.test(
            quote,
          ),
      );
    const metadata =
      snapshot.sourceClass === 'upstream_model_docs'
        ? [
            ...excerpt.matchAll(
              /"(?:id|pipeline_tag|library_name|task)":"[^"\r\n]{1,120}"/gu,
            ),
          ].map((match) => match[0])
        : [];
    return [...new Set([...prose, ...metadata])].map((quote, index) => ({
      evidenceSpanId: `${snapshot.candidateId}:span:${String(index)}`,
      candidateId: snapshot.candidateId,
      sourceClass: snapshot.sourceClass,
      sourceFamilyId: snapshot.sourceFamilyId,
      quote,
    }));
  });
}
