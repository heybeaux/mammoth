# Phase 2 evaluation report

## Scope

Phase 2 adds durable orchestration for long-running research programs: workflow
execution, timers and schedules, leased work queues, idempotent external effects,
budget reservations, human approvals, and evidence revalidation schedules.

## Exit-gate coverage

Recovery tests reconstruct runtimes from disk at critical crash windows. Separate
Node child processes also contend on one queue store and are killed while holding
its process lock. They verify:

- persisted running workflow steps replay with the same idempotency key;
- a provider-side idempotency contract prevents duplicate external effects when
  the worker dies after the remote commit but before local completion;
- active work leases are reclaimed only after expiry and stale owners are fenced;
- queue and side-effect receipt state survive restart together;
- concurrent local processes cannot lose queue writes or claim one item twice;
- a stale process lock is recovered after `SIGKILL`;
- cancellation records an attributable receipt and preserves partial output;
- corrupt workflow snapshots fail closed;
- budgets cannot be over-reserved and denials are audited;
- expired human approvals cannot authorize work; and
- failed revalidation attempts require a receipted retry schedule.

These tests do not simulate torn filesystem writes or distributed-host
coordination. The local adapter's supported topology and production migration
boundary are recorded in `docs/adr/0001-local-durable-runtime.md`.

## Verification

Run:

```sh
pnpm verify:phase-2
```
