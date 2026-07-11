import { describe, expect, it } from 'vitest';
import { GovernanceError, HumanGateRegistry } from '../src/index.js';

const gateInput = {
  id: 'gate-1',
  programId: 'program-1',
  workItemId: 'work-1',
  kind: 'cloud_egress',
  summary: 'Send restricted context',
  requestedDecision: 'Approve cloud egress',
  evidenceIds: ['e1'],
  claimIds: ['c1'],
  riskCodes: ['restricted_data'],
  expiresAt: '2026-07-10T20:05:00.000Z',
};

describe('HumanGateRegistry', () => {
  it('requires attributable reasons and receipts and prevents repeated decisions', () => {
    const registry = new HumanGateRegistry(() => '2026-07-10T20:00:00.000Z');
    registry.open(gateInput, 'workflow');
    expect(() =>
      registry.decide('gate-1', 'approve', {
        actorId: 'beaux',
        reason: 'Reviewed evidence',
        receiptId: '',
      }),
    ).toThrowError(GovernanceError);
    expect(
      registry.decide('gate-1', 'approve', {
        actorId: 'beaux',
        reason: 'Reviewed evidence',
        receiptId: 'receipt-1',
      }),
    ).toMatchObject({
      state: 'approved',
      decidedBy: 'beaux',
      receiptId: 'receipt-1',
    });
    expect(() =>
      registry.decide('gate-1', 'reject', {
        actorId: 'other',
        reason: 'No',
        receiptId: 'receipt-2',
      }),
    ).toThrowError(/gate_approved/);
    expect(
      registry.audit.list().filter((event) => event.outcome === 'denied'),
    ).toHaveLength(2);
  });

  it('expires before evaluating a late approval and fails closed', () => {
    let now = '2026-07-10T20:00:00.000Z';
    const registry = new HumanGateRegistry(() => now);
    registry.open(gateInput, 'workflow');
    now = '2026-07-10T20:06:00.000Z';
    expect(() =>
      registry.decide('gate-1', 'approve', {
        actorId: 'beaux',
        reason: 'late',
        receiptId: 'receipt',
      }),
    ).toThrowError(/gate_expired/);
    expect(registry.get('gate-1')?.state).toBe('expired');
    expect(registry.audit.list().map((event) => event.kind)).toContain(
      'human_gate.expired',
    );
  });
});
