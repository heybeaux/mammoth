# `@mammoth/postgres-adapter`

Driver-injected Postgres lifecycle and forward-only migration foundation for the
Mammoth production-like profile. The package owns no credentials and imports no
concrete adapter or Postgres client. A composition root supplies a driver that
implements `PostgresDriver`.

## Lifecycle

`PostgresLifecycle.start()` connects with explicit connection and statement
timeouts, serializes migration runners with a Postgres advisory lock, and applies
each migration in its own bounded transaction. `shutdown()` delegates a bounded
close to the injected driver. Health proves connectivity; readiness additionally
requires the exact checksummed migration set to be fully applied.

The migration ledger records a durable `started_at` before migration SQL runs. A
process failure therefore leaves an inspectable incomplete row. Restart fails
closed with `interrupted_migration`; operators must investigate and repair or
restore rather than silently replaying potentially non-transactional DDL.

Released migrations are immutable and contiguous from version 1. Changes use a
new forward migration. Checksum or name drift fails readiness.

## Verification

```sh
pnpm --dir packages/postgres-adapter test
pnpm --dir packages/postgres-adapter typecheck
pnpm --dir packages/postgres-adapter build
```

Tests cover empty installation, ordered upgrade, restart, interrupted migration,
checksum drift, timeout propagation, and bounded shutdown. Real Postgres service
and backup/restore coverage belongs to the later production-like profile gate.

The D1 lifecycle descriptor deliberately does not advertise transactional-ledger
or fencing capabilities. Those capabilities become eligible only after D2 lands
and passes the frozen adapter conformance requirements.

## Transactional epistemic ledger

Migration v2 installs a single authoritative ledger row, immutable revision
history, audit log, and publisher-facing outbox. `PostgresEpistemicLedger`
commits all four in one injected-driver transaction. `transactAtRevision()`
classifies stale compare-and-swap writers as retryable; invalid references and
graph cycles are non-retryable. Rejected or rolled-back mutations produce no
revision, audit record, or outbox event. Publication remains outside the
authoritative transaction and consumes only committed outbox rows.

## Durable work and effects

Migration v3 and `PostgresWorkState` add transactional work items, leases,
monotonic fencing tokens, retry and cancellation state, partial receipts, and
completed provider-effect receipts. Every authoritative transition and its work
outbox event share one database transaction. Events retain both the attributable
ledger revision and the work fencing token.

Database atomicity cannot extend into an external provider. Callers pass the
persisted stable idempotency key to the provider, then record its receipt before
completing work. `PostgresOutbox` stores a stable dispatch key and uniquely
acknowledges `(outbox_id, destination)`, making restart and duplicate delivery
idempotent. Exhausted rows remain visible with `last_error` and `poison_at`.

Run `pnpm --filter @mammoth/postgres-adapter verify:p2:d4` for the D4 gate.
