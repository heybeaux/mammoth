import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';
import type { Digest } from './primitives.js';

function normalize(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new TypeError('Canonical JSON does not permit non-finite numbers');
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((entry) => normalize(entry));

  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .filter((key) => record[key] !== undefined)
      .map((key) => [key, normalize(record[key])]),
  );
}

/** Stable JSON for domain identities. Object keys are sorted; undefined fields are omitted. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function canonicalDigest(value: unknown): Digest {
  return `sha256:${bytesToHex(sha256(new TextEncoder().encode(canonicalJson(value))))}`;
}
