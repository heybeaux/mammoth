# P2 verifier findings

## Current verdict

`v0.2.0-production-data` is **not verified**. The acceptance harness exists and
the P1 contract-freeze plus D1 injected migration gates pass. D2 through D6 still
lack required executable production evidence. The verifier intentionally exits
non-zero and reports each absent target as `missing`.

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

## Remaining adversarial risks

- A package-local test may be too weak even when its command is green; independent
  production-profile fixtures still need to exercise real Postgres and artifact
  processes.
- The final receipt must record command output, service versions, migration
  checksums, injected boundaries, duration, and default-branch commit. This
  skeleton deliberately does not fabricate those values.
- Capability paths for CAS, the production-like profile, and Observatory remain
  coordinator-owned and therefore stay `missing` until registered.
