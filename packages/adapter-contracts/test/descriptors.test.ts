import { describe, expect, it } from 'vitest';
import {
  ADAPTER_CONTRACT_MAJOR,
  ADAPTER_CONTRACT_VERSION,
  evaluateProductionLikeReadiness,
  LOCAL_ADAPTER_DESCRIPTORS,
  LOCAL_ADAPTER_ROLES,
  P3_TEMPORAL_PRODUCTION_LIKE_REQUIREMENTS,
  PRODUCTION_LIKE_LOCAL_REQUIREMENTS,
  TEMPORAL_WORKFLOW_CAPABILITIES,
  TEMPORAL_WORKFLOW_RUNTIME_REQUIREMENT,
} from '../src/index.js';

describe('frozen adapter descriptors', () => {
  it('publishes one contract-major-1 descriptor for every concrete local role', () => {
    expect(ADAPTER_CONTRACT_MAJOR).toBe(1);
    expect(ADAPTER_CONTRACT_VERSION).toBe('1.1.0');
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

  it('freezes the Temporal workflow-runtime descriptor under contract major 1', () => {
    expect(TEMPORAL_WORKFLOW_RUNTIME_REQUIREMENT).toEqual({
      kind: 'workflow-runtime',
      contractMajor: 1,
      capabilities: TEMPORAL_WORKFLOW_CAPABILITIES,
      requireProductionProfile: true,
    });
    expect(P3_TEMPORAL_PRODUCTION_LIKE_REQUIREMENTS).toHaveLength(7);
    expect(P3_TEMPORAL_PRODUCTION_LIKE_REQUIREMENTS.at(-1)).toBe(
      TEMPORAL_WORKFLOW_RUNTIME_REQUIREMENT,
    );
    expect(TEMPORAL_WORKFLOW_CAPABILITIES).toEqual([
      'deterministic-replay',
      'durable-timers',
      'signals',
      'queries',
      'retry-scheduling',
      'continue-as-new',
      'task-queue-polling',
      'clean-shutdown',
      'durable-restart',
      'cooperative-cancellation',
      'health-reporting',
    ]);
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
