import { describe, expect, it } from 'vitest';
import {
  AdapterCompatibilityError,
  TEMPORAL_WORKFLOW_CAPABILITIES,
  TEMPORAL_WORKFLOW_RUNTIME_REQUIREMENT,
  assertAdapterCompatibility,
  validateAdapterFailure,
  type AdapterDescriptor,
  type WorkflowRuntimeDescriptor,
} from '../src/index.js';

const workflow: AdapterDescriptor = {
  id: 'workflow:local:v1',
  kind: 'workflow-store',
  contractVersion: '1.1.0',
  implementationVersion: '0.1.0',
  profile: 'local',
  capabilities: ['atomic-transactions', 'durable-restart'],
  health: 'healthy',
  checkedAt: '2026-01-01T00:00:00.000Z',
};

describe('adapter startup contracts', () => {
  it('accepts an explicitly compatible adapter', () => {
    expect(() => {
      assertAdapterCompatibility(
        [workflow],
        [
          {
            kind: 'workflow-store',
            contractMajor: 1,
            capabilities: ['atomic-transactions'],
          },
        ],
      );
    }).not.toThrow();
  });

  it('fails closed with all compatibility issues', () => {
    expect(() => {
      assertAdapterCompatibility(
        [workflow],
        [
          {
            kind: 'workflow-store',
            contractMajor: 2,
            capabilities: ['cross-process-fencing'],
            requireProductionProfile: true,
          },
          { kind: 'epistemic-ledger', contractMajor: 1, capabilities: [] },
        ],
      );
    }).toThrow(AdapterCompatibilityError);
    try {
      assertAdapterCompatibility(
        [workflow],
        [
          {
            kind: 'workflow-store',
            contractMajor: 2,
            capabilities: ['cross-process-fencing'],
            requireProductionProfile: true,
          },
          { kind: 'epistemic-ledger', contractMajor: 1, capabilities: [] },
        ],
      );
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(AdapterCompatibilityError);
      expect((error as AdapterCompatibilityError).issues).toHaveLength(4);
    }
  });

  it('enforces retry classification and fail-closed errors', () => {
    expect(() => {
      validateAdapterFailure({
        kind: 'transient',
        message: 'connection reset',
        retryable: true,
        failClosed: true,
        retryAfterMs: 250,
      });
    }).not.toThrow();
    expect(() => {
      validateAdapterFailure({
        kind: 'integrity',
        message: 'digest mismatch',
        retryable: true,
        failClosed: true,
      });
    }).toThrow(/invalid retryable/);
  });

  it('rejects the wrong workflow-runtime major with a stable issue code', () => {
    const descriptor = temporalDescriptor({ contractVersion: '2.0.0' });
    expectCompatibilityIssue(descriptor, 'contract-version-mismatch');
  });

  it.each(TEMPORAL_WORKFLOW_CAPABILITIES)(
    'rejects missing workflow-runtime capability %s',
    (missing) => {
      const descriptor = temporalDescriptor({
        capabilities: TEMPORAL_WORKFLOW_CAPABILITIES.filter(
          (capability) => capability !== missing,
        ),
      });
      expectCompatibilityIssue(descriptor, 'missing-capability');
    },
  );
});

function temporalDescriptor(
  overrides: Partial<WorkflowRuntimeDescriptor> = {},
): WorkflowRuntimeDescriptor {
  return {
    id: 'temporal:test',
    kind: 'workflow-runtime',
    contractVersion: '1.1.0',
    implementationVersion: '0.1.0',
    profile: 'production-like-local',
    capabilities: TEMPORAL_WORKFLOW_CAPABILITIES,
    health: 'healthy',
    checkedAt: '2026-07-13T00:00:00.000Z',
    namespace: 'mammoth-test',
    taskQueue: 'mammoth-research-control-v1',
    retentionDays: 1,
    workflowBundleId: 'probe-v1',
    workerBuildId: 'worker-v1',
    ...overrides,
  };
}

function expectCompatibilityIssue(
  descriptor: WorkflowRuntimeDescriptor,
  code: 'contract-version-mismatch' | 'missing-capability',
): void {
  try {
    assertAdapterCompatibility(
      [descriptor],
      [TEMPORAL_WORKFLOW_RUNTIME_REQUIREMENT],
    );
    throw new Error('expected adapter compatibility failure');
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(AdapterCompatibilityError);
    expect((error as AdapterCompatibilityError).issues).toEqual([
      expect.objectContaining({ kind: 'workflow-runtime', code }),
    ]);
  }
}
