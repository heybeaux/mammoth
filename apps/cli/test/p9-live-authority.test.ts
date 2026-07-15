import { describe, expect, it } from 'vitest';
import { executeP8ResearchCli } from '../src/p8-operator.js';
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
      MAMMOTH_P9_PROPOSER_MODEL: 'fixture-proposer',
      MAMMOTH_P9_EVALUATOR_MODEL: 'fixture-evaluator',
      MAMMOTH_P9_PROVIDER_API_KEY_ENV: 'MAMMOTH_P9_PROVIDER_API_KEY',
      MAMMOTH_P9_PROVIDER_API_KEY: 'provider-secret',
    };

    for (const value of ['', '0', '-1', '5.01', '6', 'NaN', 'Infinity']) {
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
      MAMMOTH_P9_PROPOSER_MODEL: 'fixture-proposer',
      MAMMOTH_P9_EVALUATOR_MODEL: 'fixture-evaluator',
      MAMMOTH_P9_PROVIDER_API_KEY_ENV: 'MAMMOTH_P9_PROVIDER_API_KEY',
      MAMMOTH_P9_PROVIDER_API_KEY: 'provider-secret',
    });

    expect(report).toMatchObject({
      status: 'ready',
      safeForEffects: true,
      authorizedBudgetUsd: 5,
      liveAuthorization: 'MAMMOTH_P9_LIVE_RESEARCH=authorized',
      liveBilling: 'P9 live billing explicitly authorized',
    });
    expect(report.liveBudget).toBe('P9 live budget cap accepted: 5.00 USD');
    expect(report.liveEvaluatorIndependence).toContain('distinct');
  });

  it('rejects one model identity reused for proposing and evaluation', () => {
    const report = evaluateP9LiveAuthority({
      MAMMOTH_P9_LIVE_RESEARCH: 'authorized',
      MAMMOTH_SEARCH_BRAVE_API_KEY: 'search-secret',
      MAMMOTH_P9_LIVE_BILLING_AUTHORIZATION: 'authorized',
      MAMMOTH_P9_LIVE_BUDGET_USD: '5',
      MAMMOTH_P9_PROVIDER_BASE_URL: 'https://provider.example.test/v1',
      MAMMOTH_P9_PROPOSER_MODEL: 'same-model',
      MAMMOTH_P9_EVALUATOR_MODEL: 'same-model',
      MAMMOTH_P9_PROVIDER_API_KEY_ENV: 'MAMMOTH_P9_PROVIDER_API_KEY',
      MAMMOTH_P9_PROVIDER_API_KEY: 'provider-secret',
    });
    expect(report.safeForEffects).toBe(false);
    expect(report.liveEvaluatorIndependence).toContain('must be distinct');
  });

  it('rejects distinct model strings from the same profile family', () => {
    const report = evaluateP9LiveAuthority({
      MAMMOTH_P9_LIVE_RESEARCH: 'authorized',
      MAMMOTH_SEARCH_BRAVE_API_KEY: 'search-secret',
      MAMMOTH_P9_LIVE_BILLING_AUTHORIZATION: 'authorized',
      MAMMOTH_P9_LIVE_BUDGET_USD: '5',
      MAMMOTH_P9_PROVIDER_BASE_URL: 'https://provider.example.test/v1',
      MAMMOTH_P9_PROPOSER_MODEL: 'openai/gpt-5.1',
      MAMMOTH_P9_EVALUATOR_MODEL: 'openai/gpt-5.2',
      MAMMOTH_P9_PROVIDER_API_KEY_ENV: 'MAMMOTH_P9_PROVIDER_API_KEY',
      MAMMOTH_P9_PROVIDER_API_KEY: 'provider-secret',
    });
    expect(report.safeForEffects).toBe(false);
    expect(report.liveEvaluatorIndependence).toContain(
      'distinct profile families',
    );
  });

  it('blocks CLI budget broadening beyond the authorized environment budget', async () => {
    const original = { ...process.env };
    const stderr: string[] = [];
    try {
      Object.assign(process.env, {
        MAMMOTH_P9_LIVE_RESEARCH: 'authorized',
        MAMMOTH_SEARCH_BRAVE_API_KEY: 'search-secret',
        MAMMOTH_P9_LIVE_BILLING_AUTHORIZATION: 'authorized',
        MAMMOTH_P9_LIVE_BUDGET_USD: '1',
        MAMMOTH_P9_PROVIDER_BASE_URL: 'https://provider.example.test/v1',
        MAMMOTH_P9_PROPOSER_MODEL: 'fixture-proposer',
        MAMMOTH_P9_EVALUATOR_MODEL: 'fixture-evaluator',
        MAMMOTH_P9_PROVIDER_API_KEY_ENV: 'MAMMOTH_P9_PROVIDER_API_KEY',
        MAMMOTH_P9_PROVIDER_API_KEY: 'provider-secret',
      });
      const code = await executeP8ResearchCli(
        ['research', 'p9-live', '--budget-usd', '5'],
        { stdout: () => undefined, stderr: (value) => stderr.push(value) },
      );

      expect(code).toBe(2);
      expect(JSON.parse(stderr[0] ?? '{}')).toMatchObject({
        status: 'blocked_live_exhibition',
        safeForEffects: false,
      });
      expect(stderr[0]).toContain('must match authorized environment budget');
    } finally {
      process.env = original;
    }
  });
});
