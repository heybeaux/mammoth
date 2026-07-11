import { describe, expect, it } from 'vitest';
import {
  ADAPTER_CONTRACT_MAJOR,
  ADAPTER_CONTRACT_VERSION,
  evaluateProductionLikeReadiness,
  LOCAL_ADAPTER_DESCRIPTORS,
  LOCAL_ADAPTER_ROLES,
  PRODUCTION_LIKE_LOCAL_REQUIREMENTS,
} from '../src/index.js';

describe('frozen adapter descriptors', () => {
  it('publishes one contract-major-1 descriptor for every concrete local role', () => {
    expect(ADAPTER_CONTRACT_MAJOR).toBe(1);
    expect(ADAPTER_CONTRACT_VERSION).toBe('1.0.0');
    expect(LOCAL_ADAPTER_DESCRIPTORS.map(({ role }) => role)).toEqual(
      LOCAL_ADAPTER_ROLES,
    );
    expect(
      LOCAL_ADAPTER_DESCRIPTORS.every(
        ({ contractVersion }) => contractVersion === ADAPTER_CONTRACT_VERSION,
      ),
    ).toBe(true);
    expect(new Set(LOCAL_ADAPTER_DESCRIPTORS.map(({ id }) => id)).size).toBe(
      LOCAL_ADAPTER_DESCRIPTORS.length,
    );
  });

  it('requires the production-like profile and contract major 1', () => {
    expect(PRODUCTION_LIKE_LOCAL_REQUIREMENTS).toHaveLength(6);
    for (const requirement of PRODUCTION_LIKE_LOCAL_REQUIREMENTS) {
      expect(requirement.contractMajor).toBe(1);
      expect(requirement.requireProductionProfile).toBe(true);
      expect(requirement.capabilities).toContain('health-reporting');
    }
  });
});

describe('production-like health and readiness', () => {
  const healthy = {
    health: 'healthy' as const,
    dependencyReachable: true,
    contractCompatible: true,
    schemaCurrent: true,
    integrityVerified: true,
    checkedAt: '2026-07-10T00:00:00.000Z',
  };

  it('is ready only after all authoritative preconditions pass', () => {
    expect(evaluateProductionLikeReadiness(healthy)).toEqual({
      ready: true,
      checkedAt: healthy.checkedAt,
      failures: [],
    });
  });

  it('reports every failed precondition and fails closed', () => {
    expect(
      evaluateProductionLikeReadiness({
        ...healthy,
        health: 'degraded',
        dependencyReachable: false,
        contractCompatible: false,
        schemaCurrent: false,
        integrityVerified: false,
      }),
    ).toEqual({
      ready: false,
      checkedAt: healthy.checkedAt,
      failures: [
        'unhealthy',
        'dependency-unreachable',
        'contract-incompatible',
        'schema-not-current',
        'integrity-unverified',
      ],
    });
  });
});
