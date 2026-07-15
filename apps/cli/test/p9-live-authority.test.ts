import { describe, expect, it } from 'vitest';
import { evaluateP9LiveAuthority } from '../src/p9-live-authority.js';

describe('P9 live authority gate', () => {
  it('fails closed without explicit P9 billing and credential authority', () => {
    const report = evaluateP9LiveAuthority({});

    expect(report).toMatchObject({
      status: 'blocked_live_exhibition',
      localProfile: 'ok',
      safeForEffects: false,
    });
    expect(report.liveAuthorization).toContain('MAMMOTH_P9_LIVE_RESEARCH');
    expect(report.liveBilling).toContain(
      'MAMMOTH_P9_LIVE_BILLING_AUTHORIZATION',
    );
    expect(report.liveBudget).toContain('MAMMOTH_P9_LIVE_BUDGET_USD');
  });

  it('does not treat P8 live flags as P9 authority', () => {
    const report = evaluateP9LiveAuthority({
      MAMMOTH_P8_LIVE_RESEARCH: 'authorized',
      MAMMOTH_SEARCH_BRAVE_API_KEY: 'search-secret',
      MAMMOTH_SEARCH_BRAVE_BILLING_AUTHORIZATION: 'authorized',
      MAMMOTH_P8_PROVIDER_BASE_URL: 'https://provider.example.test/v1',
      MAMMOTH_P8_PROVIDER_MODEL: 'fixture-live',
    });

    expect(report.status).toBe('blocked_live_exhibition');
    expect(report.safeForEffects).toBe(false);
    expect(report.liveAuthorization).toContain(
      'MAMMOTH_P9_LIVE_RESEARCH=authorized missing',
    );
    expect(report.liveBilling).toContain(
      'MAMMOTH_P9_LIVE_BILLING_AUTHORIZATION=authorized missing',
    );
  });

  it('requires a finite positive P9 live budget', () => {
    const base = {
      MAMMOTH_P9_LIVE_RESEARCH: 'authorized',
      MAMMOTH_SEARCH_BRAVE_API_KEY: 'search-secret',
      MAMMOTH_P9_LIVE_BILLING_AUTHORIZATION: 'authorized',
      MAMMOTH_P9_PROVIDER_BASE_URL: 'https://provider.example.test/v1',
      MAMMOTH_P9_PROVIDER_MODEL: 'fixture-live',
      MAMMOTH_P9_PROVIDER_API_KEY_ENV: 'MAMMOTH_P9_PROVIDER_API_KEY',
      MAMMOTH_P9_PROVIDER_API_KEY: 'provider-secret',
    };

    for (const value of ['', '0', '-1', 'NaN', 'Infinity']) {
      const report = evaluateP9LiveAuthority({
        ...base,
        MAMMOTH_P9_LIVE_BUDGET_USD: value,
      });
      expect(report.status).toBe('blocked_live_exhibition');
      expect(report.safeForEffects).toBe(false);
    }
  });

  it('reports ready only when every P9 live authority field is explicit', () => {
    const report = evaluateP9LiveAuthority({
      MAMMOTH_P9_LIVE_RESEARCH: 'authorized',
      MAMMOTH_SEARCH_BRAVE_API_KEY: 'search-secret',
      MAMMOTH_P9_LIVE_BILLING_AUTHORIZATION: 'authorized',
      MAMMOTH_P9_LIVE_BUDGET_USD: '5',
      MAMMOTH_P9_PROVIDER_BASE_URL: 'https://provider.example.test/v1',
      MAMMOTH_P9_PROVIDER_MODEL: 'fixture-live',
      MAMMOTH_P9_PROVIDER_API_KEY_ENV: 'MAMMOTH_P9_PROVIDER_API_KEY',
      MAMMOTH_P9_PROVIDER_API_KEY: 'provider-secret',
    });

    expect(report).toMatchObject({
      status: 'ready',
      safeForEffects: true,
      liveAuthorization: 'MAMMOTH_P9_LIVE_RESEARCH=authorized',
      liveBilling: 'P9 live billing explicitly authorized',
    });
    expect(report.liveBudget).toBe('P9 live budget cap accepted: 5.00 USD');
  });
});
