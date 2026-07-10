import type {
  HandoffManifest,
  HandoffPayload,
  ValidationResult,
} from './types.js';

export function validateHandoff(
  manifest: HandoffManifest,
  payload: HandoffPayload,
): ValidationResult {
  const errors: string[] = [];
  if (payload.contractId !== manifest.contractId)
    errors.push('CONTRACT_ID_MISMATCH');
  for (const id of manifest.requiredClaimIds) {
    if (!payload.claimIds.includes(id)) errors.push(`MISSING_CLAIM:${id}`);
  }
  for (const id of manifest.requiredEvidenceIds) {
    if (!payload.evidenceIds.includes(id))
      errors.push(`MISSING_EVIDENCE:${id}`);
  }
  for (const expected of manifest.fields) {
    const actual = payload.fields.find((field) => field.name === expected.name);
    if (!actual) {
      errors.push(`MISSING_FIELD:${expected.name}`);
      continue;
    }
    for (const key of ['wire', 'concept', 'unit', 'expectedDigest'] as const) {
      if (!actual[key]) errors.push(`MISSING_SEMANTIC:${expected.name}.${key}`);
      else if (actual[key] !== expected[key])
        errors.push(`SEMANTIC_MISMATCH:${expected.name}.${key}`);
    }
  }
  return { valid: errors.length === 0, errors };
}
