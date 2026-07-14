# ADR 0007: P7 local raw provider-output retention

## Status

Accepted for P7 implementation.

## Context

P7 must retain enough immutable evidence to diagnose malformed, rejected,
ambiguous, cancelled, and late provider responses. Raw prompts and responses can
also contain private material or attempted secret disclosure. Claiming encryption
without a managed key lifecycle would create a security guarantee the local
profile cannot currently prove.

## Options

1. Discard every raw prompt and response immediately.
2. Claim application-managed encryption at rest and introduce a key service in P7.
3. Narrow P7 to a single-user local threat model, retain plaintext raw bytes in
   owner-only CAS storage, and keep raw content out of relational state, logs,
   receipts, fixtures, dossiers, and projections.

## Decision

Use option 3.

P7 makes no application-level encryption-at-rest claim. The operator owns host
disk encryption and account security. Canonical prompt and raw response bytes are
stored as immutable CAS objects classified `local_only`. CAS directories use mode
`0700`; objects and atomic temporary files use `0600`. Temporary plaintext remains
under the CAS root and is removed after failed writes. Postgres rows, logs,
receipts, dossiers, fixtures, and projections contain only digests, byte counts,
classification, and redacted summaries.

The optional `discard_raw_after_validation` policy may delete bytes only after it
records their digest, byte length, validation verdict, and deletion receipt.
Rejected or ambiguous responses remain retained under the active policy for
reconciliation and audit.

## Consequences

- P7 can inspect provider failures without inventing encrypted-storage guarantees.
- Anyone with access to the operator account and CAS root can read retained raw
  bytes; this limitation must appear in the exhibition and release receipt.
- Managed encryption, key generation, storage, rotation, and multi-user isolation
  remain out of scope until a later checkpoint.
- Acceptance must test permissions, temporary-file location, failed-write cleanup,
  redaction, and the absence of an encryption claim.

## Evidence

The P7 provider/CAS adversarial gate must exercise owner-only storage, failed
writes, raw-content leakage scans, discard receipts, digest corruption, and
reconstruction from CAS references.
