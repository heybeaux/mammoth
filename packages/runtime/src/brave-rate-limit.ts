export type BraveRateLimitWindowKind = 'burst' | 'monthly' | 'other';

export interface BraveRateLimitWindow {
  readonly index: number;
  readonly kind: BraveRateLimitWindowKind;
  readonly limit: number | null;
  readonly remaining: number | null;
  readonly resetSeconds: number | null;
}

export interface BraveRateLimitState {
  readonly windows: readonly BraveRateLimitWindow[];
  readonly shortWindow: BraveRateLimitWindow | null;
  readonly monthlyWindow: BraveRateLimitWindow | null;
  readonly malformedHeaders: readonly string[];
}

export type BraveRateLimitDecision =
  | {
      readonly kind: 'retry_short_window';
      readonly waitMs: number;
      readonly window: BraveRateLimitWindow;
    }
  | {
      readonly kind: 'monthly_quota_exhausted';
      readonly window: BraveRateLimitWindow;
    }
  | { readonly kind: 'not_rate_limit' }
  | { readonly kind: 'malformed_headers'; readonly headers: readonly string[] }
  | { readonly kind: 'unbounded_reset'; readonly resetSeconds: number };

export class BraveRateLimitError extends Error {
  constructor(
    message: string,
    readonly decision: Exclude<
      BraveRateLimitDecision,
      { kind: 'not_rate_limit' }
    >,
  ) {
    super(message);
    this.name = 'BraveRateLimitError';
  }
}

export function parseBraveRateLimitHeaders(
  headers: Pick<Headers, 'get'>,
): BraveRateLimitState {
  const malformedHeaders: string[] = [];
  const limits = parseIntegerList(
    headers.get('x-ratelimit-limit'),
    'x-ratelimit-limit',
    malformedHeaders,
  );
  const remaining = parseIntegerList(
    headers.get('x-ratelimit-remaining'),
    'x-ratelimit-remaining',
    malformedHeaders,
  );
  const resets = parseIntegerList(
    headers.get('x-ratelimit-reset'),
    'x-ratelimit-reset',
    malformedHeaders,
  );
  const count = Math.max(limits.length, remaining.length, resets.length);
  const monthlyIndex = chooseMonthlyIndex(limits, resets);
  const shortIndex = chooseShortIndex(resets, monthlyIndex);
  const windows = Array.from({ length: count }, (_, index) => ({
    index,
    kind:
      index === shortIndex
        ? ('burst' as const)
        : index === monthlyIndex
          ? ('monthly' as const)
          : ('other' as const),
    limit: limits[index] ?? null,
    remaining: remaining[index] ?? null,
    resetSeconds: resets[index] ?? null,
  }));
  return {
    windows,
    shortWindow: shortIndex === null ? null : (windows[shortIndex] ?? null),
    monthlyWindow:
      monthlyIndex === null ? null : (windows[monthlyIndex] ?? null),
    malformedHeaders,
  };
}

export function decideBraveRateLimitRetry(input: {
  readonly status: number;
  readonly headers: Pick<Headers, 'get'>;
  readonly maxShortResetSeconds: number;
  readonly retryPaddingMs: number;
  readonly jitterMs: number;
}): BraveRateLimitDecision {
  if (input.status !== 429) return { kind: 'not_rate_limit' };
  const state = parseBraveRateLimitHeaders(input.headers);
  const monthly = state.monthlyWindow;
  const windowCount = state.windows.length;
  if (
    state.malformedHeaders.length > 0 ||
    windowCount === 0 ||
    state.windows.some(
      (window) =>
        window.limit === null ||
        window.remaining === null ||
        window.resetSeconds === null,
    ) ||
    monthly?.remaining === null ||
    monthly?.remaining === undefined ||
    monthly.resetSeconds === null
  ) {
    return { kind: 'malformed_headers', headers: state.malformedHeaders };
  }
  if (monthly.remaining === 0) {
    return {
      kind: 'monthly_quota_exhausted',
      window: monthly,
    };
  }
  const short = state.shortWindow;
  if (short?.resetSeconds === null || short?.resetSeconds === undefined) {
    return { kind: 'malformed_headers', headers: ['x-ratelimit-reset'] };
  }
  if (short.resetSeconds > input.maxShortResetSeconds) {
    return { kind: 'unbounded_reset', resetSeconds: short.resetSeconds };
  }
  return {
    kind: 'retry_short_window',
    window: short,
    waitMs: short.resetSeconds * 1_000 + input.retryPaddingMs + input.jitterMs,
  };
}

export function nextBraveShortWindowDelayMs(input: {
  readonly headers: Pick<Headers, 'get'>;
  readonly fallbackIntervalMs: number;
  readonly retryPaddingMs: number;
}): number {
  const state = parseBraveRateLimitHeaders(input.headers);
  const short = state.shortWindow;
  if (
    state.malformedHeaders.length > 0 ||
    short?.resetSeconds === null ||
    short?.resetSeconds === undefined ||
    short.remaining === null
  ) {
    return input.fallbackIntervalMs;
  }
  if (short.remaining > 0) return 0;
  return short.resetSeconds * 1_000 + input.retryPaddingMs;
}

function parseIntegerList(
  value: string | null,
  headerName: string,
  malformedHeaders: string[],
): number[] {
  if (value === null) return [];
  const parts = value.split(',').map((part) => part.trim());
  if (parts.length === 0 || parts.some((part) => part === '')) {
    malformedHeaders.push(headerName);
    return [];
  }
  const parsed: number[] = [];
  for (const part of parts) {
    if (!/^\d+$/u.test(part)) {
      malformedHeaders.push(headerName);
      return [];
    }
    parsed.push(Number(part));
  }
  return parsed;
}

function chooseMonthlyIndex(
  limits: readonly number[],
  resets: readonly number[],
): number | null {
  if (limits.length === 0 && resets.length === 0) return null;
  let selected = 0;
  const count = Math.max(limits.length, resets.length);
  for (let index = 1; index < count; index += 1) {
    const selectedScore = monthlyScore(limits[selected], resets[selected]);
    const candidateScore = monthlyScore(limits[index], resets[index]);
    if (candidateScore > selectedScore) selected = index;
  }
  return selected;
}

function chooseShortIndex(
  resets: readonly number[],
  monthlyIndex: number | null,
): number | null {
  if (resets.length === 0) return null;
  let selected: number | null = null;
  for (let index = 0; index < resets.length; index += 1) {
    if (index === monthlyIndex) continue;
    if (
      selected === null ||
      (resets[index] ?? Infinity) < (resets[selected] ?? Infinity)
    ) {
      selected = index;
    }
  }
  return selected ?? (monthlyIndex === 0 && resets.length === 1 ? 0 : null);
}

function monthlyScore(
  limit: number | undefined,
  resetSeconds: number | undefined,
): number {
  return (limit ?? 0) + (resetSeconds ?? 0);
}
