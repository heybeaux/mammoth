import { sha256 } from './canonical.js';
import type {
  AuditEvent,
  Receipt,
  ReceiptBody,
  ValidationResult,
} from './types.js';

export function issueReceipt(body: ReceiptBody): Receipt {
  return { ...body, integrityHash: sha256(body) };
}

export function verifyReceipt(receipt: Receipt): ValidationResult {
  const { integrityHash, ...body } = receipt;
  const errors: string[] = [];
  if (sha256(body) !== integrityHash) errors.push('RECEIPT_HASH_MISMATCH');
  for (const [artifactId, hash] of Object.entries(receipt.artifactHashes)) {
    if (!/^[a-f0-9]{64}$/.test(hash))
      errors.push(`INVALID_ARTIFACT_HASH:${artifactId}`);
  }
  return { valid: errors.length === 0, errors };
}

export function createAuditEvent(
  streamId: string,
  sequence: number,
  previousHash: string,
  payload: unknown,
): AuditEvent {
  const eventHash = sha256({ streamId, sequence, previousHash, payload });
  return { streamId, sequence, previousHash, eventHash, payload };
}

export function verifyAuditStream(events: AuditEvent[]): ValidationResult {
  const errors: string[] = [];
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (!event) continue;
    const previous = events[index - 1];
    const expectedSequence = index + 1;
    if (event.sequence !== expectedSequence)
      errors.push(`SEQUENCE_GAP:${String(expectedSequence)}`);
    const expectedPreviousHash = previous?.eventHash ?? 'GENESIS';
    if (event.previousHash !== expectedPreviousHash)
      errors.push(`PREVIOUS_HASH_MISMATCH:${String(event.sequence)}`);
    if (
      event.eventHash !==
      sha256({
        streamId: event.streamId,
        sequence: event.sequence,
        previousHash: event.previousHash,
        payload: event.payload,
      })
    )
      errors.push(`EVENT_HASH_MISMATCH:${String(event.sequence)}`);
    if (previous && event.streamId !== previous.streamId)
      errors.push(`STREAM_ID_MISMATCH:${String(event.sequence)}`);
  }
  return { valid: errors.length === 0, errors };
}
