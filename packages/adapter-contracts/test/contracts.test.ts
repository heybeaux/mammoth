import { describe, expect, it } from 'vitest';
import { deriveWorkflowId, supportedWorkflowVersion } from '@mammoth/workflow';
import {
  AdapterCompatibilityError,
  TEMPORAL_WORKFLOW_CAPABILITIES,
  TEMPORAL_WORKFLOW_RUNTIME_REQUIREMENT,
  assertAdapterCompatibility,
  parseWorkflowCancellationRequest,
  parseWorkflowQueryRequest,
  parseWorkflowQueryResult,
  parseWorkflowSignalRequest,
  parseWorkflowStartRequest,
  validateAdapterFailure,
  workflowTaskQueueTarget,
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

describe('workflow gateway boundary contracts', () => {
  const registered = supportedWorkflowVersion('research-program');
  const identity = {
    programId: 'program.alpha',
    criterionVersion: 'criterion.v1',
    branchId: 'main',
  };
  const workflowId = deriveWorkflowId(registered, identity);
  const startRequest = {
    workflow: registered,
    identity,
    workflowId,
    taskQueue: workflowTaskQueueTarget(registered),
    workItemId: 'work-1',
  };

  it('validates the registered workflow tuple, branch ID, and queue mapping', () => {
    expect(parseWorkflowStartRequest(startRequest)).toEqual(startRequest);
    expect(startRequest.taskQueue).toEqual({
      logical: 'research-control',
      physical: 'mammoth-research-control-v1',
    });

    expect(() =>
      parseWorkflowStartRequest({
        ...startRequest,
        workflow: { ...registered, name: 'ExperimentWorkflow' },
      }),
    ).toThrow('workflow contract tuple does not match');
    expect(() =>
      parseWorkflowStartRequest({
        ...startRequest,
        workflow: { ...registered, version: 2 },
      }),
    ).toThrow('unsupported workflow version');
    expect(() =>
      parseWorkflowStartRequest({
        ...startRequest,
        workflow: { ...registered, kind: 'made-up-workflow' },
      }),
    ).toThrow('unsupported workflow kind');
  });

  it('rejects ID/branch drift, extra fields, and arbitrary queues', () => {
    expect(() =>
      parseWorkflowStartRequest({ ...startRequest, workflowId: 'wrong' }),
    ).toThrow('workflow start ID does not match');
    expect(() =>
      parseWorkflowStartRequest({
        ...startRequest,
        identity: { ...identity, branchId: 'other' },
      }),
    ).toThrow('workflow start ID does not match');
    expect(() =>
      parseWorkflowStartRequest({
        ...startRequest,
        identity: { ...identity, attemptedAt: '2026-07-13T00:00:00.000Z' },
      }),
    ).toThrow('program branch identity has invalid fields');
    expect(() =>
      parseWorkflowStartRequest({
        ...startRequest,
        taskQueue: { logical: 'arbitrary', physical: 'arbitrary' },
      }),
    ).toThrow('unsupported logical workflow task queue');
    expect(() =>
      parseWorkflowStartRequest({
        ...startRequest,
        taskQueue: {
          logical: 'research-control',
          physical: 'research-control',
        },
      }),
    ).toThrow('workflow start task queue does not match');
    expect(() =>
      parseWorkflowStartRequest({ ...startRequest, productState: {} }),
    ).toThrow('workflow start request has invalid fields');
  });

  it('carries and validates the complete typed signal payload', () => {
    const signal = {
      signalId: 'signal-1',
      expectedRevision: 3,
      kind: 'pause',
    };
    expect(parseWorkflowSignalRequest({ workflowId, signal })).toEqual({
      workflowId,
      signal,
    });
    expect(() =>
      parseWorkflowSignalRequest({
        workflowId,
        signalName: 'pause',
        payloadDigest: 'sha256:missing-payload',
      }),
    ).toThrow('workflow signal request has invalid fields');
    expect(() => parseWorkflowSignalRequest({ workflowId })).toThrow(
      'workflow signal request has invalid fields',
    );
    expect(() =>
      parseWorkflowSignalRequest({
        workflowId,
        signal: { ...signal, productState: { claims: [] } },
      }),
    ).toThrow('signal has invalid fields');

    expect(
      parseWorkflowCancellationRequest({
        workflowId,
        signal: {
          signalId: 'cancel-1',
          expectedRevision: 4,
          kind: 'cancel',
          reason: 'operator request',
        },
      }),
    ).toMatchObject({ workflowId, signal: { kind: 'cancel' } });
    expect(() =>
      parseWorkflowCancellationRequest({ workflowId, signal }),
    ).toThrow('workflow cancellation requires a cancel signal');
  });

  it('accepts only closed query kinds and bounded orchestration results', () => {
    expect(
      parseWorkflowQueryRequest({
        workflowId,
        query: { kind: 'retry-state' },
      }),
    ).toEqual({ workflowId, query: { kind: 'retry-state' } });
    expect(() =>
      parseWorkflowQueryRequest({
        workflowId,
        query: { kind: 'raw-database' },
      }),
    ).toThrow('invalid workflow query kind');
    expect(() =>
      parseWorkflowQueryRequest({ workflowId, queryName: 'program-state' }),
    ).toThrow('workflow query request has invalid fields');

    expect(
      parseWorkflowQueryResult({
        workflowId,
        queryKind: 'program-state',
        value: { status: 'paused', revision: 4 },
      }),
    ).toEqual({
      workflowId,
      queryKind: 'program-state',
      value: { status: 'paused', revision: 4 },
    });
    expect(() =>
      parseWorkflowQueryResult({
        workflowId,
        queryKind: 'program-state',
        value: {
          status: 'paused',
          revision: 4,
          productState: { claims: [] },
        },
      }),
    ).toThrow('program-state result has invalid fields');
    expect(() =>
      parseWorkflowQueryResult({
        workflowId,
        queryKind: 'raw-database',
        value: {},
      }),
    ).toThrow('invalid workflow query kind');
  });
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
