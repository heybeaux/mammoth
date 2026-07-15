import { describe, expect, it } from 'vitest';
import {
  executeP9ResearchCli,
  inspectP9LiveReadiness,
} from '../src/p9-operator.js';

function io() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    value: {
      stdout: (entry: string) => stdout.push(entry),
      stderr: (entry: string) => stderr.push(entry),
    },
  };
}

describe('P9 live readiness artifacts', () => {
  it('does not accept legacy environment assertions as live authority', async () => {
    const readiness = await inspectP9LiveReadiness({
      MAMMOTH_P9_LIVE_RESEARCH: 'authorized',
      MAMMOTH_P9_LIVE_BILLING_AUTHORIZATION: 'authorized',
      MAMMOTH_P9_LIVE_BUDGET_USD: '5',
      MAMMOTH_P9_PROPOSER_MODEL: 'model-a',
      MAMMOTH_P9_EVALUATOR_MODEL: 'model-b',
      MAMMOTH_P8_LIVE_RESEARCH: 'authorized',
    });
    expect(readiness.blockers).toContain('authority_trust_anchor_missing');
    expect(readiness.blockers).toContain('trusted_authorizer_missing');
    expect(readiness.blockers).toContain(
      'scoped_live_authority_receipt_missing',
    );
    expect(readiness.blockers).toContain(
      'immutable_provider_profile_catalog_missing',
    );
    expect(readiness.proposerProfileFamily).toBeNull();
    expect(readiness.evaluatorProfileFamily).toBeNull();
  });

  it('requires an accepted plan, execution identity, question, and source policy in addition to file locators', async () => {
    const readiness = await inspectP9LiveReadiness({
      MAMMOTH_P9_EXPECTED_AUTHORITY_DIGEST:
        'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      MAMMOTH_P9_TRUSTED_AUTHORIZER_ID: 'issuer:trusted',
    });
    expect(readiness.blockers).toEqual(
      expect.arrayContaining([
        'accepted_plan_missing',
        'plan_acceptance_receipt_missing',
        'execution_identity_missing',
        'authorized_question_missing',
        'source_classification_policy_missing',
      ]),
    );
  });

  it('keeps both the consumption boundary and live executor mechanically unavailable', async () => {
    const readiness = await inspectP9LiveReadiness({});
    expect(readiness.ready).toBe(false);
    expect(readiness.blockers).toContain(
      'authority_consumption_store_unavailable',
    );
    expect(readiness.blockers).toContain('live_executor_unavailable');

    const output = io();
    expect(
      await executeP9ResearchCli(['research', 'p9-live'], output.value, {
        env: {
          MAMMOTH_P9_LIVE_RESEARCH: 'authorized',
          MAMMOTH_P9_LIVE_BILLING_AUTHORIZATION: 'authorized',
          MAMMOTH_P9_LIVE_BUDGET_USD: '5',
        },
      }),
    ).toBe(3);
    expect(JSON.parse(output.stderr[0] ?? '{}')).toMatchObject({
      status: 'blocked_before_effects',
      ready: false,
    });
  });
});
