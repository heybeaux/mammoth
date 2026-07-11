# Mammoth P2 Production Data Checkpoint

> Status: active
>
> Baseline: `v0.1.0-mvp`
>
> Target: `v0.2.0-production-data`
>
> Human contact: checkpoint completion or an escalation explicitly allowed by
> `LOOP.md`

## Outcome

P2 is complete when Mammoth can run its evidence-first program against a
production-shaped Postgres ledger and content-addressed artifact store, survive
concurrent writers and service restarts, and prove that authoritative mutations,
outbox events, receipts, and immutable bytes cannot drift apart.

This checkpoint does not add Temporal or research-cell fan-out. It freezes the
ports those later systems will consume and creates the read model that the
Observatory can safely visualize.

## Entry gate — finish P1 contract freeze

Before production adapter implementation begins:

- [x] Record transaction ownership and Postgres/Temporal responsibility boundaries
      in an accepted ADR.
- [x] Publish capability descriptors for the local workflow, ledger, work-state,
      effect-receipt, and artifact adapters.
- [x] Define health and readiness semantics for `production-like-local`.
- [x] Confirm `pnpm verify:adapters` covers workflow state, ledger revisions, work
      state, completed-effect replay, CAS deduplication, invalid digests, and tampered
      bytes.
- [x] Freeze contract major `1` or explicitly version any required change.

P1 freeze evidence belongs in `evals/reports/p1-adapter-contracts.md`.

## P2 delivery slices

### D1 — Postgres lifecycle and migrations

Deliver:

- A dedicated Postgres adapter package with no imports from other concrete
  adapters.
- Forward-only, checksummed migrations and a migration ledger.
- Empty-install, ordered-upgrade, interrupted-migration, and restart tests.
- Explicit connection, transaction, statement-timeout, and shutdown behavior.
- Health and readiness descriptors matching the P1 contract.

Gate:

A fresh database and every supported prior schema converge to the same version;
an interrupted migration is detected and cannot silently report ready.

### D2 — Transactional epistemic ledger

Deliver:

- Postgres implementation of the epistemic ledger port.
- Optimistic revision checks and deterministic conflict classification.
- Transactional validation of claims, assessments, evidence references, claim
  dependencies, and source lineage.
- Atomic audit/outbox insertion with each authoritative mutation.
- Read-after-restart and concurrent-writer tests.

Gate:

Forced concurrent writers produce one ordered revision history with no lost
accepted mutation. A rejected or rolled-back mutation emits no outbox row.

### D3 — Content-addressed artifact adapter

Deliver:

- Production artifact metadata in Postgres and content-addressed bytes behind the
  frozen `ContentAddressedStore` port.
- Atomic create-or-verify behavior for duplicate digests.
- Digest verification on every read.
- Orphan detection and deterministic reconciliation tooling.
- Tamper, truncated-write, duplicate-put, and restart tests.

Gate:

Identical bytes deduplicate, mismatched bytes at an existing digest fail closed,
and metadata can never make corrupted content appear valid.

### D4 — Durable work state, effects, and outbox

Deliver:

- Transactional work items, leases, fencing tokens, retry state, cancellations,
  partial receipts, and completed-effect receipts.
- Stable provider idempotency keys and unique constraints.
- Transactional outbox with attributable work and authoritative revision IDs.
- Publisher retry, duplicate delivery, poison row, and restart behavior.
- Explicit separation between database atomicity and provider-side idempotency.

Gate:

Process death before or after database commit cannot duplicate an acknowledged
provider effect or publish an event for rolled-back state.

### D5 — Production-like local profile

Deliver:

- Reproducible local Postgres/CAS service lifecycle with persistent storage,
  health checks, readiness checks, and bounded startup.
- Configuration validation with no embedded credentials.
- Restart and process-kill harnesses.
- Backup/restore smoke test followed by integrity verification.
- Clear operator commands and failure diagnostics.

Gate:

A clean machine can start the profile, run the fixture, kill Mammoth processes and
Postgres at injected boundaries, restart, verify integrity, and reproduce the same
terminal dossier without duplicated effects.

### D6 — Observatory read projection

Deliver:

- Versioned, read-only projection types derived from authoritative Postgres state.
- Deterministic projection builder for program, claims, evidence, edges, timeline,
  dossier trace, and integrity metadata.
- Projection digest, authoritative revision, audit head, completeness flag, and
  explicit omissions.
- Checked-in fixture and schema validation.
- No UI framework or 3D runtime in this checkpoint.

Gate:

The projection is deterministic, contains no invented authority, preserves
unsupported and contradicted states, and maps every rendered dossier sentence to
the same provenance chain as the CLI artifacts.

## Required verification

Add `pnpm verify:p2`. From a clean checkout it must run or orchestrate:

```sh
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm verify:evidence
pnpm verify:audit
pnpm verify:phase-1
pnpm verify:phase-2
pnpm verify:adapters
pnpm verify:m2
pnpm verify:m3
pnpm verify:mvp
pnpm verify:p2
pnpm eval:offline
```

The P2 verifier must additionally prove:

- migrations: empty, upgrade, interruption, checksum drift, restart;
- ledger: concurrent revision conflicts, rollback, referential integrity;
- artifacts: dedupe, collision/tamper rejection, orphan reconciliation;
- work/effects: fencing, duplicate delivery, cancellation, crash windows;
- outbox: atomic write, retry, duplicate publish, poison-row visibility;
- service lifecycle: unready startup, forced restart, clean shutdown;
- backup/restore: restored state passes ledger, audit, receipt, and artifact
  integrity checks;
- Observatory projection: determinism, completeness, digest, and provenance.

## Checkpoint receipt

The team must create `evals/reports/v0.2.0-production-data.md` from executed
evidence. It records:

- exact default-branch commit and merged PRs;
- migration version and checksums;
- adapter descriptors and contract versions;
- commands, dates, durations, and results;
- injected failure boundaries and observed recovery;
- backup/restore evidence;
- known limitations and deferred Temporal/research-cell work;
- Observatory projection fixture and digest.

## Stopping condition

The autonomous loop stops only when every checkbox and gate above passes from a
clean checkout, `pnpm verify:p2` passes, default-branch CI is green at the recorded
commit, the receipt is accurate, and `v0.2.0-production-data` is ready to record.

Only then contact Beaux with the checkpoint report.
