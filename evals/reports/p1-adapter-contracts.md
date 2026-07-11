# P1 Adapter Contract Freeze

- Status: accepted entry gate
- Date: 2026-07-10
- Baseline: `v0.1.0-mvp`
- Contract: adapter major `1` (`1.0.0`)

## Frozen surface

The adapter contract major is `1`. The concrete local descriptors are:

| Role             | Descriptor                     | Contract kind          | Required behavior                                    |
| ---------------- | ------------------------------ | ---------------------- | ---------------------------------------------------- |
| workflow state   | `local-workflow-store`         | `workflow-store`       | atomic transition, durable restart                   |
| epistemic ledger | `local-json-ledger`            | `epistemic-ledger`     | ordered revisions, rollback, durable restart         |
| work state       | `local-work-state-store`       | `work-state-store`     | atomic state, fencing, cancellation, durable restart |
| effect receipt   | `local-receipt-writer`         | `receipt-writer`       | attributable durable receipt writing                 |
| side effect      | `durable-side-effect-executor` | `side-effect-executor` | provider idempotency and completed-receipt replay    |
| artifact bytes   | `file-content-store`           | `artifact-store`       | digest verification, deduplication, durable restart  |

`packages/adapter-contracts/src/descriptors.ts` is the machine-readable source.
The role distinguishes concrete local responsibilities and the frozen contract
publishes work state separately from terminal receipt writing.

## Health and readiness

Health is a diagnostic state (`healthy`, `degraded`, or `unavailable`). It does not
authorize work by itself. `production-like-local` is ready only when every selected
adapter is healthy, its dependency is reachable, contract major and capabilities
are compatible, the checksummed schema is current, and the relevant integrity
check has passed. Every failed precondition is returned and readiness fails closed.

## Transaction and orchestration boundary

ADR 0003 assigns one application service ownership of each short Postgres
transaction. Authoritative state, audit records, and outbox rows commit together.
CAS bytes use write/verify before metadata publication plus orphan reconciliation.
Provider effects use stable provider idempotency keys and honest ambiguous-state
recovery. Temporal is deferred to P3 and will own orchestration history, not
epistemic or product authority.

## Executed evidence

The existing `verify:adapters` suite covers:

- workflow state durability, concurrent transactions, and rollback;
- epistemic ledger ordered revisions, concurrency, and rollback;
- durable work state and unique receipts;
- completed provider-effect replay after restart;
- CAS deduplication, invalid digest rejection, and tampered-byte rejection.

The descriptor suite additionally covers the five concrete local roles, contract
major `1`, production-profile requirements, and fail-closed readiness.

Executed on 2026-07-10 in the canonical P2 worktree:

- `pnpm verify:adapters` — passed: 3 files, 12 tests.
- `pnpm --filter @mammoth/adapter-contracts typecheck` — passed.
- `pnpm --filter @mammoth/adapter-contracts build` — passed.
- Prettier check over the five owned implementation, test, ADR, and receipt files
  — passed.
- `git diff --check` — passed.

No P2 production adapter may claim readiness until it passes the same behavioral
suite and its production-specific migration, transaction, restart, and integrity
gates.

## Compatibility rule

Additive optional descriptor metadata is minor-compatible. Removing or retyping a
field, changing adapter-kind meaning, weakening a capability, or changing observable
atomicity, fencing, replay, cancellation, receipt, or integrity behavior requires a
new contract major with migration and conformance evidence.

## Deferred scope

Postgres/CAS implementation is P2. Temporal execution is P3. Research-cell fan-out
and the 3D Observatory UI remain downstream. This receipt freezes their inward
adapter boundary; it does not claim those systems are implemented.
