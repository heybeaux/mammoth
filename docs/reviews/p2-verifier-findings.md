# P2 verifier findings

## Current verdict

`v0.2.0-production-data` is **verified**. All eight executable gates pass,
including real PostgreSQL lifecycle and backup/restore checks. The verifier
continues to fail closed when a capability, executable script, or required path
is missing.

## Verifier contract

The verifier owns stable gate IDs and executes evidence-producing commands. It
does not read a `passed` boolean from an adapter or checkpoint receipt. A gate
passes only when its registered required path exists and its command exits zero.
Missing registration, missing service paths, duplicate gate IDs, and non-zero
commands fail closed. Capability registration is restricted to `pnpm` commands.

## Exact future service gates

1. `p1-adapter-contract-freeze` — major-v1 descriptors and local conformance.
2. `d1-postgres-migrations` — empty install, ordered upgrade, interruption,
   checksum drift, and restart.
3. `d2-transactional-ledger` — concurrent revision conflicts, rollback,
   referential integrity, and atomic audit/outbox insertion.
4. `d3-content-addressed-artifacts` — dedupe, collision/tamper rejection,
   truncated writes, restart, and orphan reconciliation.
5. `d4-work-effects-outbox` — fencing, cancellation, both database crash windows,
   provider duplicate delivery, publisher retry, and visible poison rows.
6. `d5-service-lifecycle` — unready startup, bounded readiness, forced restart,
   persistent storage, and clean shutdown.
7. `d5-backup-restore` — restored ledger, audit, receipt, and artifact integrity.
8. `d6-observatory-projection` — deterministic digest, revision/audit head,
   completeness and omissions, contradicted/unresolved retention, and dossier
   provenance.

## Residual risks and deferred work

- The production profile uses a native PostgreSQL process and filesystem CAS; a
  managed database and object-store deployment adapter remain production rollout
  work.
- Provider effects remain at-least-once at the dispatcher boundary and depend on
  stable provider idempotency keys, as the contract explicitly states.
- Temporal orchestration and research-cell fan-out remain P3+ work and must consume
  the frozen adapter contracts rather than bypassing them.
