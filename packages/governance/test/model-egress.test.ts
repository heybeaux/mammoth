import { describe, expect, it } from 'vitest';
import { canonicalDigest } from '@mammoth/domain';
import {
  MODEL_EGRESS_POLICY_DIGEST,
  createModelEgressPolicy,
  evaluateModelEgress,
} from '../src/index.js';

const digest = canonicalDigest({ fixture: 'egress' });

function input(overrides: Record<string, unknown> = {}) {
  return {
    modelWorkIdentityDigest: digest,
    providerAttemptDigest: digest,
    reservationId: 'reservation-1',
    dataClassification: 'local_only' as const,
    provider: 'ollama',
    concreteModel: 'llama3.2:3b',
    checkpoint: 'checkpoint-1',
    destinationOrigin: 'http://127.0.0.1:11434',
    allowedTools: [],
    promptDigest: digest,
    policyDigest: MODEL_EGRESS_POLICY_DIGEST,
    ...overrides,
  };
}

describe('model egress policy', () => {
  it('allows exact loopback origins with no tools', () => {
    expect(evaluateModelEgress(input())).toMatchObject({
      policyDigest: MODEL_EGRESS_POLICY_DIGEST,
      decision: 'allowed',
      reason: 'local_loopback_allowed',
    });
    expect(
      evaluateModelEgress(input({ destinationOrigin: 'http://[::1]:11434' }))
        .decision,
    ).toBe('allowed');
  });

  it('denies local-only content to non-loopback destinations', () => {
    expect(
      evaluateModelEgress(
        input({ destinationOrigin: 'https://api.example.test' }),
      ),
    ).toMatchObject({
      decision: 'denied',
      reason: 'local_only_non_loopback_denied',
    });
  });

  it('defaults cloud egress to deny and requires exact HTTPS allowlisting', () => {
    const cloud = input({
      dataClassification: 'cloud_allowed',
      destinationOrigin: 'https://api.example.test',
    });
    expect(evaluateModelEgress(cloud).reason).toBe('cloud_default_deny');
    const policy = createModelEgressPolicy(['https://api.example.test']);
    expect(
      evaluateModelEgress({ ...cloud, policyDigest: policy.digest }, policy)
        .decision,
    ).toBe('allowed');
    expect(
      evaluateModelEgress(
        {
          ...cloud,
          destinationOrigin: 'http://api.example.test',
          policyDigest: policy.digest,
        },
        policy,
      ).reason,
    ).toBe('cloud_origin_must_use_https');
  });

  it('rejects paths, credentials, tools, and unbound fields', () => {
    expect(
      evaluateModelEgress(
        input({ destinationOrigin: 'http://127.0.0.1:11434/v1' }),
      ).reason,
    ).toBe('destination_must_be_origin_only');
    expect(() =>
      evaluateModelEgress(input({ allowedTools: ['shell'] })),
    ).toThrow();
    expect(() =>
      evaluateModelEgress({ ...input(), extra: true } as never),
    ).toThrow();
    expect(() =>
      createModelEgressPolicy(['https://api.example.test/v1']),
    ).toThrow(/exact HTTPS origins/u);
    expect(evaluateModelEgress(input({ policyDigest: digest })).reason).toBe(
      'policy_digest_mismatch',
    );
  });
});
