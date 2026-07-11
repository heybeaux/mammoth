import { describe, expect, it } from 'vitest';
import {
  AdapterCompatibilityError,
  assertAdapterCompatibility,
  validateAdapterFailure,
  type AdapterDescriptor,
} from '../src/index.js';

const workflow: AdapterDescriptor = {
  id: 'workflow:local:v1',
  kind: 'workflow-store',
  contractVersion: '1.0.0',
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
});
