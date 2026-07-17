import {
  canonicalDigest,
  P9EntailmentLocatorSchema,
  type P9EntailmentLocator,
} from '@mammoth/domain';
import { containsP9HostileInstruction } from './p9-entailment.js';

export const DEFAULT_SPAN_DERIVATION_BOUNDS: SpanDerivationBounds = {
  maximumWindowCharacters: 8_000,
  minimumSpanCharacters: 12,
  maximumSpanCharacters: 600,
};

export interface SpanDerivationBounds {
  /** Evaluator-visible window; spans never start beyond this bound. */
  readonly maximumWindowCharacters: number;
  readonly minimumSpanCharacters: number;
  readonly maximumSpanCharacters: number;
}

export interface BoundedEvidenceSpan {
  readonly evidenceSpanId: string;
  readonly quote: string;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly boundedContext: string;
  readonly hostileInstructionDetected: boolean;
}

export class SpanDerivationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SpanDerivationError';
  }
}

const SENTENCE_BOUNDARY = /(?<=[.!?])\s+|\n+/gu;

function trimmedSegment(
  body: string,
  rawStart: number,
  rawEnd: number,
): { start: number; end: number } | null {
  let start = rawStart;
  let end = rawEnd;
  while (start < end && /\s/u.test(body[start] ?? '')) start += 1;
  while (end > start && /\s/u.test(body[end - 1] ?? '')) end -= 1;
  return end > start ? { start, end } : null;
}

/**
 * Expands an exact span to the surrounding sentence boundaries so the
 * independent evaluator sees the same bounded neighbourhood the proposer saw.
 */
export function boundedEvidenceContext(
  body: string,
  startOffset: number,
  endOffset: number,
): string {
  if (
    !Number.isInteger(startOffset) ||
    !Number.isInteger(endOffset) ||
    startOffset < 0 ||
    endOffset > body.length ||
    endOffset <= startOffset
  ) {
    throw new SpanDerivationError(
      'invalid_span_offsets',
      'context derivation requires a non-empty span inside the body',
    );
  }
  const priorBoundary = Math.max(
    body.lastIndexOf('.', Math.max(0, startOffset - 1)),
    body.lastIndexOf('!', Math.max(0, startOffset - 1)),
    body.lastIndexOf('?', Math.max(0, startOffset - 1)),
    body.lastIndexOf('\n', Math.max(0, startOffset - 1)),
  );
  const lastSelected = body[endOffset - 1];
  const endsAtBoundary =
    lastSelected === '.' ||
    lastSelected === '!' ||
    lastSelected === '?' ||
    lastSelected === '\n';
  const following = endsAtBoundary
    ? endOffset
    : [
        body.indexOf('.', endOffset),
        body.indexOf('!', endOffset),
        body.indexOf('?', endOffset),
        body.indexOf('\n', endOffset),
      ].filter((index) => index >= 0);
  const contextEnd =
    typeof following === 'number'
      ? following
      : following.length === 0
        ? body.length
        : Math.min(...following) + 1;
  return body.slice(priorBoundary + 1, contextEnd).trim();
}

/**
 * Derives exact, offset-bound spans from one parsed snapshot body. The
 * derivation is deterministic and domain-generic: it never inspects topics,
 * source families, hostnames, or expected conclusions. Callers may supply an
 * exclusion predicate carrying inspectable pack policy; hostile-instruction
 * content is flagged, never silently dropped, so downstream admission can
 * reject it with visible residue.
 */
export function deriveBoundedEvidenceSpans(input: {
  readonly body: string;
  readonly spanIdPrefix: string;
  readonly bounds?: Partial<SpanDerivationBounds>;
  readonly isExcluded?: (quote: string) => boolean;
}): readonly BoundedEvidenceSpan[] {
  if (!input.spanIdPrefix.trim()) {
    throw new SpanDerivationError(
      'missing_span_id_prefix',
      'span derivation requires a stable span identity prefix',
    );
  }
  const bounds = { ...DEFAULT_SPAN_DERIVATION_BOUNDS, ...input.bounds };
  if (
    bounds.minimumSpanCharacters < 1 ||
    bounds.maximumSpanCharacters < bounds.minimumSpanCharacters ||
    bounds.maximumWindowCharacters < bounds.minimumSpanCharacters
  ) {
    throw new SpanDerivationError(
      'invalid_span_bounds',
      'span bounds must describe a non-empty derivation window',
    );
  }
  const window = Math.min(input.body.length, bounds.maximumWindowCharacters);
  const segments: { start: number; end: number }[] = [];
  let cursor = 0;
  SENTENCE_BOUNDARY.lastIndex = 0;
  for (const match of input.body.slice(0, window).matchAll(SENTENCE_BOUNDARY)) {
    const segment = trimmedSegment(input.body, cursor, match.index);
    if (segment) segments.push(segment);
    cursor = match.index + match[0].length;
  }
  const tail = trimmedSegment(input.body, cursor, window);
  if (tail) segments.push(tail);

  const seen = new Set<string>();
  const spans: BoundedEvidenceSpan[] = [];
  for (const segment of segments) {
    const quote = input.body.slice(segment.start, segment.end);
    if (
      quote.length < bounds.minimumSpanCharacters ||
      quote.length > bounds.maximumSpanCharacters ||
      seen.has(quote) ||
      input.isExcluded?.(quote) === true
    ) {
      continue;
    }
    seen.add(quote);
    spans.push({
      evidenceSpanId: `${input.spanIdPrefix}:span:${String(spans.length)}`,
      quote,
      startOffset: segment.start,
      endOffset: segment.end,
      boundedContext: boundedEvidenceContext(
        input.body,
        segment.start,
        segment.end,
      ),
      hostileInstructionDetected: containsP9HostileInstruction(quote),
    });
  }
  return spans;
}

/**
 * Binds a derived span to an immutable snapshot as a schema-valid entailment
 * locator. Fails closed when the span does not reproduce exactly from the
 * body it claims to quote.
 */
export function buildEntailmentLocatorForSpan(input: {
  readonly body: string;
  readonly span: BoundedEvidenceSpan;
  readonly snapshotDigest: string;
  readonly coordinateSpace: string;
}): P9EntailmentLocator {
  const { span } = input;
  if (
    input.body.slice(span.startOffset, span.endOffset) !== span.quote ||
    span.endOffset - span.startOffset !== span.quote.length
  ) {
    throw new SpanDerivationError(
      'span_body_binding_mismatch',
      `span ${span.evidenceSpanId} does not reproduce exactly from its snapshot body`,
    );
  }
  if (!span.boundedContext.includes(span.quote)) {
    throw new SpanDerivationError(
      'span_context_binding_mismatch',
      `span ${span.evidenceSpanId} bounded context does not contain its quote`,
    );
  }
  return P9EntailmentLocatorSchema.parse({
    evidenceSpanId: span.evidenceSpanId,
    snapshotDigest: input.snapshotDigest,
    quoteDigest: canonicalDigest(span.quote),
    contextDigest: canonicalDigest(span.boundedContext),
    coordinateSpace: input.coordinateSpace,
    startOffset: span.startOffset,
    endOffset: span.endOffset,
  });
}
