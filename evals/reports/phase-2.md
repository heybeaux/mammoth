# Phase 2 evaluation report

## Scope

Phase 2 adds durable orchestration for long-running research programs: workflow
execution, timers and schedules, leased work queues, idempotent external effects,
budget reservations, human approvals, and evidence revalidation schedules.

## Exit-gate coverage

Fresh-process recovery tests kill the logical runtime at the critical crash
windows and then construct new runtime/store instances from disk. They verify:

- persisted running workflow steps replay with the same idempotency key;
- a provider-side idempotency contract prevents duplicate external effects when
  the worker dies after the remote commit but before local completion;
- active work leases are reclaimed only after expiry and stale owners are fenced;
- queue and side-effect receipt state survive restart together;
- corrupt workflow snapshots fail closed;
- budgets cannot be over-reserved and denials are audited;
- expired human approvals cannot authorize work; and
- failed revalidation attempts require a receipted retry schedule.

## Verification

Run:

```sh
pnpm verify:phase-2
```
