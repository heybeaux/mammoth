import { describe, expect, it } from 'vitest';
import { evaluateP9LiveAuthority } from '../src/p9-live-authority.js';

describe('P9 legacy environment authority gate', () => {
  it('fails closed and requires immutable scoped artifacts', () => {
    const report = evaluateP9LiveAuthority({});
    expect(report).toMatchObject({
      status: 'blocked_live_exhibition',
      localProfile: 'ok',
      safeForEffects: false,
    });
    expect(report.liveAuthorization).toContain(
      'pinned, scoped authority receipt',
    );
    expect(report.liveBilling).toContain('scoped receipt');
    expect(report.liveBudget).toContain('full budget vector');
    expect(report.liveModelProvider).toContain('immutable provider profiles');
    expect(report.liveEvaluatorIndependence).toContain(
      'independent immutable proposer and evaluator profiles',
    );
  });

  it('ignores both P8 and legacy P9 environment assertions', () => {
    const baseline = evaluateP9LiveAuthority({});
    const asserted = evaluateP9LiveAuthority({
      MAMMOTH_P8_LIVE_RESEARCH: 'authorized',
      MAMMOTH_P9_LIVE_RESEARCH: 'authorized',
      MAMMOTH_P9_LIVE_BILLING_AUTHORIZATION: 'authorized',
      MAMMOTH_P9_LIVE_BUDGET_USD: '5',
      MAMMOTH_SEARCH_BRAVE_API_KEY: 'search-secret',
      MAMMOTH_P9_PROVIDER_BASE_URL: 'https://provider.example.test/v1',
      MAMMOTH_P9_PROPOSER_MODEL: 'model-a',
      MAMMOTH_P9_EVALUATOR_MODEL: 'model-b',
      MAMMOTH_P9_PROPOSER_PROFILE_FAMILY: 'family-a',
      MAMMOTH_P9_EVALUATOR_PROFILE_FAMILY: 'family-b',
      MAMMOTH_P9_PROVIDER_API_KEY: 'provider-secret',
    });
    expect(asserted).toEqual(baseline);
    expect(asserted.safeForEffects).toBe(false);
  });

  it('does not let environment model names establish evaluator independence', () => {
    for (const env of [
      {
        MAMMOTH_P9_PROPOSER_MODEL: 'same-model',
        MAMMOTH_P9_EVALUATOR_MODEL: 'same-model',
      },
      {
        MAMMOTH_P9_PROPOSER_MODEL: 'model-a',
        MAMMOTH_P9_EVALUATOR_MODEL: 'model-b',
        MAMMOTH_P9_PROPOSER_PROFILE_FAMILY: 'same-family',
        MAMMOTH_P9_EVALUATOR_PROFILE_FAMILY: 'same-family',
      },
    ]) {
      const report = evaluateP9LiveAuthority(env);
      expect(report.safeForEffects).toBe(false);
      expect(report.liveEvaluatorIndependence).toContain('immutable');
    }
  });
});
