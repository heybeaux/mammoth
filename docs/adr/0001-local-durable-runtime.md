# ADR 0001: Local durable runtime for the MVP

- Status: accepted
- Date: 2026-07-10
- Checkpoint: `v0.1.0-mvp`

## Context

Mammoth needs durable timers, retries, pause and resume, idempotent external
effects, budgets, approvals, and revalidation before the end-to-end product loop
exists. The production architecture selects Temporal for workflow history and
Postgres for authoritative query state, but requiring both services would make the
first local checkpoint harder to install and would obscure the durability contract
behind infrastructure setup.

The MVP still has to survive process death. An in-memory implementation or a JSON
export that callers may forget to save does not meet that requirement.

## Options considered

1. Require Temporal and Postgres for the MVP.
2. Use in-memory orchestration and document restart as deferred.
3. Define runtime and store ports, then ship strict local durable adapters for the
   checkpoint.

## Decision

Use option 3.

The workflow, work-queue, and governance packages expose deterministic runtime
APIs whose clocks, handlers, and stores are injectable. Their local adapters write
versioned snapshots through exclusive temporary files, sync file contents, rename
atomically, and sync the parent directory. The work queue additionally uses a
host-local process lock and fresh read/modify/write transactions so concurrent
workers cannot overwrite queue state or acquire the same lease. Loaded state is
validated and malformed or inconsistent snapshots fail closed.

Workflow steps and work items use stable idempotency keys. Exactly-once external
effects additionally require the provider adapter to honor that key; a local
receipt cannot close the crash window after a remote commit by itself. Mammoth
persists started and completed receipts and replays an interrupted call with the
same provider key.

Temporal will later implement the workflow runtime/store boundary. Postgres will
implement the queue, governance, and query-store ports transactionally. Domain
packages do not depend on either infrastructure choice.

## Consequences

- The MVP runs with no database or workflow service.
- Process restart, expired leases, corrupt state, and the remote-commit crash
  window are deterministic test fixtures.
- Local stores are single-host adapters, not distributed coordination systems.
- Multiple local work-queue processes are supported and fenced. Workflow and
  governance writers remain owned by one orchestrator process in the MVP; they
  are not safe for independent multi-process mutation.
- A work-queue process lock is recovered when its recorded PID no longer exists.
  Host crash recovery therefore relies on the atomic state image, not the lock.
- Cancellation receipts preserve the operator reason and partial output, but
  terminating arbitrary subprocesses remains the worker adapter's responsibility.
- Production adapters must preserve the same state transitions, fencing tokens,
  idempotency keys, receipts, and fail-closed validation.

## Evidence

`pnpm verify:phase-2` covers fresh-runtime recovery, lease reclamation,
cross-process writer serialization and fencing, stale-lock recovery after SIGKILL,
cancellation receipts and partial output, duplicate delivery, provider-idempotent
side effects, budget exhaustion, human-gate expiry, revalidation retry scheduling,
and snapshot corruption.
