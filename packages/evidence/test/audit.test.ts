import { describe, expect, it } from 'vitest';
import {
  createAuditEvent,
  issueReceipt,
  verifyAuditStream,
  verifyReceipt,
} from '../src/index.js';

describe('receipt integrity', () => {
  it('rejects a tampered receipt', () => {
    const receipt = issueReceipt({
      id: 'receipt-1',
      claim: 'The verification suite passed.',
      changes: ['report.json'],
      evidenceIds: ['test-output-1'],
      verificationChecks: ['unit'],
      artifactHashes: { 'report.json': 'a'.repeat(64) },
      issuedAt: '2026-07-10T00:00:00.000Z',
    });
    const tampered = { ...receipt, claim: 'All release gates passed.' };
    expect(verifyReceipt(tampered)).toEqual({
      valid: false,
      errors: ['RECEIPT_HASH_MISMATCH'],
    });
  });
});

describe('audit stream integrity', () => {
  it('detects sequence gaps and event mutation', () => {
    const first = createAuditEvent('program-1', 1, 'GENESIS', {
      state: 'candidate',
    });
    const second = createAuditEvent('program-1', 2, first.eventHash, {
      state: 'supported',
    });
    const result = verifyAuditStream([first, { ...second, sequence: 3 }]);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining(['SEQUENCE_GAP:2', 'EVENT_HASH_MISMATCH:3']),
    );
  });
});
