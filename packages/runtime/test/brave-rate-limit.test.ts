import { describe, expect, it } from 'vitest';
import {
  BraveP9LiveSearchAdapter,
  BraveRateLimitError,
  decideBraveRateLimitRetry,
  parseBraveRateLimitHeaders,
} from '../src/index.js';

const okBody = JSON.stringify({
  web: {
    results: [
      {
        url: 'https://github.com/JustVugg/colibri',
        title: 'JustVugg/colibri',
      },
    ],
  },
});

function headers(value: Record<string, string>): Headers {
  return new Headers(value);
}

function braveHeaders(input: {
  readonly limit?: string;
  readonly remaining?: string;
  readonly reset?: string;
}): Headers {
  return headers({
    ...(input.limit ? { 'x-ratelimit-limit': input.limit } : {}),
    ...(input.remaining ? { 'x-ratelimit-remaining': input.remaining } : {}),
    ...(input.reset ? { 'x-ratelimit-reset': input.reset } : {}),
  });
}

describe('Brave multi-window rate limit parsing', () => {
  it('classifies short burst and monthly windows from comma-separated headers', () => {
    const parsed = parseBraveRateLimitHeaders(
      braveHeaders({
        limit: '1, 2000',
        remaining: '0, 1999',
        reset: '1, 1240427',
      }),
    );
    expect(parsed.malformedHeaders).toEqual([]);
    expect(parsed.shortWindow).toMatchObject({
      kind: 'burst',
      remaining: 0,
      resetSeconds: 1,
    });
    expect(parsed.monthlyWindow).toMatchObject({
      kind: 'monthly',
      remaining: 1999,
      resetSeconds: 1240427,
    });
  });

  it('retries 429 only against the short window when monthly quota remains', () => {
    const decision = decideBraveRateLimitRetry({
      status: 429,
      headers: braveHeaders({
        limit: '1, 2000',
        remaining: '0, 1999',
        reset: '1, 1240427',
      }),
      maxShortResetSeconds: 5,
      retryPaddingMs: 250,
      jitterMs: 10,
    });
    expect(decision).toMatchObject({
      kind: 'retry_short_window',
      waitMs: 1260,
    });
  });

  it('does not wait on monthly quota exhaustion', () => {
    const decision = decideBraveRateLimitRetry({
      status: 429,
      headers: braveHeaders({
        limit: '1, 2000',
        remaining: '0, 0',
        reset: '1, 1240427',
      }),
      maxShortResetSeconds: 5,
      retryPaddingMs: 250,
      jitterMs: 0,
    });
    expect(decision).toMatchObject({ kind: 'monthly_quota_exhausted' });
  });

  it('fails closed on malformed reset headers', () => {
    const decision = decideBraveRateLimitRetry({
      status: 429,
      headers: braveHeaders({
        limit: '1, 2000',
        remaining: '0, 1999',
        reset: 'soon, 1240427',
      }),
      maxShortResetSeconds: 5,
      retryPaddingMs: 250,
      jitterMs: 0,
    });
    expect(decision).toMatchObject({ kind: 'malformed_headers' });
  });

  it('fails closed when one rate-limit window is missing remaining quota', () => {
    const decision = decideBraveRateLimitRetry({
      status: 429,
      headers: braveHeaders({
        limit: '1, 2000',
        remaining: '0',
        reset: '1, 1240427',
      }),
      maxShortResetSeconds: 5,
      retryPaddingMs: 250,
      jitterMs: 0,
    });
    expect(decision).toMatchObject({ kind: 'malformed_headers' });
  });
});

describe('Brave live search retry behavior', () => {
  it('records a burst 429 attempt and then returns a successful search result', async () => {
    const sleeps: number[] = [];
    let fetches = 0;
    const adapter = new BraveP9LiveSearchAdapter({
      apiKeyEnvironmentVariable: 'BRAVE_KEY',
      environment: { BRAVE_KEY: 'test' },
      minimumIntervalMs: 0,
      retryPaddingMs: 0,
      fetchImpl: () => {
        fetches += 1;
        if (fetches === 1) {
          return Promise.resolve(
            new Response('', {
              status: 429,
              headers: braveHeaders({
                limit: '1, 2000',
                remaining: '0, 1999',
                reset: '0, 1240427',
              }),
            }),
          );
        }
        return Promise.resolve(
          new Response(okBody, {
            status: 200,
            headers: braveHeaders({
              limit: '1, 2000',
              remaining: '0, 1998',
              reset: '1, 1240426',
            }),
          }),
        );
      },
      sleep: (milliseconds) => {
        sleeps.push(milliseconds);
        return Promise.resolve();
      },
    });
    const result = await adapter.search('colibri world model');
    expect(fetches).toBe(2);
    expect(sleeps).toEqual([0]);
    expect(result.usage?.requests).toBe(2);
    expect(result.candidates).toHaveLength(1);
  });

  it('stops after the bounded retry count', async () => {
    const adapter = new BraveP9LiveSearchAdapter({
      apiKeyEnvironmentVariable: 'BRAVE_KEY',
      environment: { BRAVE_KEY: 'test' },
      minimumIntervalMs: 0,
      retryPaddingMs: 0,
      max429Retries: 1,
      fetchImpl: () =>
        Promise.resolve(
          new Response('', {
            status: 429,
            headers: braveHeaders({
              limit: '1, 2000',
              remaining: '0, 1999',
              reset: '0, 1240427',
            }),
          }),
        ),
      sleep: () => Promise.resolve(),
    });
    await expect(adapter.search('colibri')).rejects.toMatchObject({
      name: 'BraveRateLimitError',
      decision: { kind: 'retry_short_window' },
    });
  });

  it('rejects retry settings beyond the reserved attempt and wait bounds', async () => {
    const adapter = new BraveP9LiveSearchAdapter({
      apiKeyEnvironmentVariable: 'BRAVE_KEY',
      environment: { BRAVE_KEY: 'test' },
      max429Retries: 3,
      fetchImpl: () => Promise.resolve(new Response(okBody, { status: 200 })),
    });
    await expect(adapter.search('colibri')).rejects.toThrow(
      /reserved attempt envelope/u,
    );

    const unboundedWait = new BraveP9LiveSearchAdapter({
      apiKeyEnvironmentVariable: 'BRAVE_KEY',
      environment: { BRAVE_KEY: 'test' },
      maxShortResetSeconds: Number.POSITIVE_INFINITY,
      fetchImpl: () => Promise.resolve(new Response(okBody, { status: 200 })),
    });
    await expect(unboundedWait.search('colibri')).rejects.toThrow(
      /short reset cap/u,
    );
  });

  it('propagates an abortable wait failure before retrying', async () => {
    const adapter = new BraveP9LiveSearchAdapter({
      apiKeyEnvironmentVariable: 'BRAVE_KEY',
      environment: { BRAVE_KEY: 'test' },
      minimumIntervalMs: 0,
      retryPaddingMs: 0,
      fetchImpl: () =>
        Promise.resolve(
          new Response('', {
            status: 429,
            headers: braveHeaders({
              limit: '1, 2000',
              remaining: '0, 1999',
              reset: '1, 1240427',
            }),
          }),
        ),
      sleep: () => Promise.reject(new Error('wait aborted')),
    });
    await expect(adapter.search('colibri')).rejects.toThrow(/wait aborted/u);
  });

  it('surfaces monthly quota exhaustion distinctly', async () => {
    const adapter = new BraveP9LiveSearchAdapter({
      apiKeyEnvironmentVariable: 'BRAVE_KEY',
      environment: { BRAVE_KEY: 'test' },
      minimumIntervalMs: 0,
      retryPaddingMs: 0,
      fetchImpl: () =>
        Promise.resolve(
          new Response('', {
            status: 429,
            headers: braveHeaders({
              limit: '1, 2000',
              remaining: '0, 0',
              reset: '1, 1240427',
            }),
          }),
        ),
    });
    await expect(adapter.search('colibri')).rejects.toMatchObject({
      name: BraveRateLimitError.name,
      decision: { kind: 'monthly_quota_exhausted' },
    });
  });
});
