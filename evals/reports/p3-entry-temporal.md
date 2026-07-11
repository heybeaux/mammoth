# P3 Temporal Entry Evidence

## Audit scope and verdict

This entry audit was executed from clean commit
`386c8882add78dd95ee21745f1b224ba964c3319` on 2026-07-11
(America/Vancouver). It inventories the contracts and production seams that the
Temporal control plane must consume; it does not claim that a Temporal adapter,
worker, workflow, or lifecycle already exists.

The P2 baseline is reconfirmed. The remaining P3 entry predicates are not yet
complete: Temporal has no frozen descriptor, its local service lifecycle is not
defined, and the candidate Activity inventory has not yet been frozen into a
complete work-item/idempotency/receipt mapping. No contract change was made by
this audit.

| P3 entry predicate                                                                           | Status                   | Evidence or gap                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reconfirm `v0.2.0-production-data` from a clean checkout                                     | passed                   | `pnpm verify:p2` passed all eight reported gates after supplying an operator-only test password and isolated profile root/port.                                                                    |
| Record contract changes in an ADR before dependent code                                      | no change identified yet | Accepted ADR 0003 already fixes the Postgres/CAS/provider/Temporal authority boundary. Any new or weakened observable contract still requires an ADR before implementation.                        |
| Freeze the Temporal workflow adapter descriptor under contract major `1`                     | open                     | Major `1` is frozen generally, but only the local `workflow-store` descriptor exists. There is no Temporal descriptor or Temporal conformance evidence.                                            |
| Define local Temporal service lifecycle for development and CI                               | open                     | The production-like profile manages native Postgres/CAS only. There is no Temporal service config, namespace, task queue, retention, startup, readiness, restart, or shutdown contract.            |
| Map every side-effecting Activity to a stable provider key, work item, and completed receipt | open                     | P2 supplies work/effect/outbox primitives, but the P3 Activity catalog and per-operation mapping are not frozen. The provisional inventory below records the existing seams and missing decisions. |

## Executed baseline evidence

Commands were run in this checkout in the following order:

1. `pnpm install --frozen-lockfile` — passed; the lockfile was current and 19
   workspace projects installed.
2. `pnpm verify:p2` without `MAMMOTH_PG_PASSWORD` — failed closed as designed.
   D1, D2, D3, D4, D6, and the P1 contract gate passed; both D5 gates refused to
   run because the required operator credential was absent.
3. `MAMMOTH_PG_PASSWORD=<operator-only test value> MAMMOTH_PROFILE_ROOT=/private/tmp/mammoth-p3-entry-audit-profile MAMMOTH_PG_PORT=55439 pnpm verify:p2`
   — passed. The verifier reported P1 adapter freeze and D1 through D6 passed,
   including real service lifecycle and backup/restore.
4. `pnpm format:check` — recorded after this report was formatted.

The test credential was supplied only through the process environment and is not
stored in the repository. The profile used an isolated root and port. This run
reconfirms the P2 gate at the pinned P3 baseline; it does not independently rerun
the complete repository verification ladder or default-branch CI.

## Frozen authority and adapter baseline

Accepted ADR 0003 remains the controlling boundary:

- Postgres is authoritative for product and epistemic state, receipt metadata,
  audit, and outbox state.
- CAS owns immutable content-addressed bytes; Postgres owns their authoritative
  metadata and references.
- Temporal may own workflow history, timers, signals, retries, cancellation
  delivery, and orchestration progress, but not product query state.
- Network and database work occurs in Activities through application ports.
- Provider effects require a stable provider idempotency key and an honest
  completed or ambiguous receipt; Temporal retry is not exactly-once proof.
- `continueAsNew` carries stable identifiers and reconstructs product state from
  Postgres/CAS.

`@mammoth/adapter-contracts` freezes adapter contract major `1` at `1.0.0`.
The current workflow role is a `workflow-store` implemented by
`local-workflow-store`, with `atomic-transactions`, `durable-restart`, and
`health-reporting`. Production-like requirements additionally require
`cross-process-fencing`. Compatibility fails closed for a missing adapter,
contract-major mismatch, missing capability, invalid profile, or unhealthy
descriptor.

This is a reusable compatibility envelope, not a frozen Temporal descriptor.
The descriptor vocabulary currently has no Temporal-specific capabilities for
signals, queries, replay/versioning, timers, cancellation delivery,
`continueAsNew`, namespace/task-queue discovery, or clean worker shutdown. The T1
owner must determine whether these can be expressed as additive metadata and
conformance requirements under major `1`; weakening or retyping current semantics
requires a new major and an ADR.

## Workflow and runtime ports available to P3

The existing workflow package exposes a deterministic local runtime boundary:

- `WorkflowDefinition` names and versions ordered steps.
- `WorkflowExecution` records definition version, revision, durable step,
  attempt, wake time, run token, cancellation, and timestamps.
- `WorkflowStore` supplies `load`, `save`, and atomic `transact` over execution
  and schedule snapshots.
- `WorkflowRuntime` provides start/get, pause/resume/cancel, schedules, durable
  sleeps, old-definition retention, crash fencing, and step idempotency keys.
- Clocks are injectable, but the local runtime defaults start IDs and run tokens
  to `randomUUID`; this implementation must not be imported into Temporal
  workflow code.

The current runtime composes these concrete local classes directly. There is no
application-level `WorkflowGateway`, Temporal client port, worker registration
port, signal/query contract, Activity invocation contract, workflow search
attribute contract, or `continueAsNew` contract. P3 should preserve the useful
domain-neutral execution concepts while placing Temporal SDK dependencies only
in concrete adapter/worker packages.

## Production-profile lifecycle seams

The existing `production-like-local` profile provides a sound pattern for the
Temporal lifecycle integration:

- typed environment configuration with no default password;
- bounded startup and shutdown timeouts;
- native service start/status/stop/immediate-kill commands;
- readiness checks before accepting work;
- persistent isolated service data;
- restart plus backup/restore integrity verification;
- operator commands exposed as `profile:start`, `profile:status`,
  `profile:stop`, and `profile:kill`.

These seams currently manage Postgres and filesystem CAS only. Temporal must be
added without embedding credentials and without making Temporal readiness imply
Postgres/CAS integrity. Combined profile readiness must fail closed if either
service, required namespace/task queue, contract major, or capability is absent.

## Provisional Activity and side-effect inventory

The table distinguishes an existing stable seam from a P3 decision. It is not a
completed mapping and therefore does not satisfy the entry checkbox.

| Candidate Activity or effect                     | Existing authoritative seam                                                                                                       | Stable key / attributable work / completed receipt status                                                                                                                                                                                                                           |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Retrieval and source snapshot                    | Retrieval transport plus verified CAS snapshot; local runtime queues `retrieve-and-snapshot`                                      | Existing local keys derive from program/workflow stage, and a completed provider receipt is persisted locally. P3 must adopt the architecture formula `programId + workItemId + contractVersion + inputDigest + operationKind` and persist the production receipt through Postgres. |
| Parsed artifact persistence                      | CAS/content-addressed artifact boundary                                                                                           | Digest makes duplicate bytes safe, but the Activity work-item identity and completed artifact-write receipt are not frozen.                                                                                                                                                         |
| Claim proposal admission and evidence assessment | Deterministic policy/domain validation followed by authoritative ledger mutation                                                  | Must remain proposals until validation. Work-item kinds, input digests, mutation receipt IDs, and retry classification are open. Model/provider calls, if introduced, need their own provider keys and cost/egress receipts.                                                        |
| Ledger mutation                                  | `PostgresEpistemicLedger` atomic revision + audit + authoritative outbox                                                          | Postgres transaction semantics exist. P3 must define the Activity key, expected revision/fencing input, attributable work item, replay lookup, and returned mutation receipt.                                                                                                       |
| Report compilation and report/artifact writes    | Pure compiler plus manifest/trace/report writes; CAS is the intended immutable artifact boundary                                  | Compilation is deterministic; filesystem/CAS writes are effects. Work IDs, digest inputs, completed receipts, and overwrite/collision behavior for the Temporal Activity are open.                                                                                                  |
| Work completion and provider effects             | `PostgresWorkState` stores work, fencing token, provider key, partial/completed receipt, and work outbox atomically               | Strong P2 seam exists. Every Activity still needs a named provider/operation kind and stable input digest; ambiguous remote commit remains visible rather than fabricated as success.                                                                                               |
| Outbox publication                               | `PostgresOutbox` exposes pending rows, destination-specific dispatch keys, acknowledgement receipts, retry, and poison visibility | The Temporal Activity must reuse a stable dispatch identity and completed dispatch receipt. Retry/timeout/heartbeat policy and poison classification are open.                                                                                                                      |
| Revalidation scheduling and execution            | Governance stores revalidation schedule; acquisition is retrieval/CAS work                                                        | Temporal schedule ownership, stable workflow/work IDs, reacquisition key, affected-claim mutation receipt, and duplicate schedule behavior are open.                                                                                                                                |
| Human-gate handoff and decision                  | Governance has durable human-gate state; Temporal is intended to deliver timers/signals                                           | Handoff creation, signed decision, expiry/timeout, stale-signal handling, work attribution, and partial/terminal receipt mapping are open.                                                                                                                                          |
| Cancellation and partial effects                 | Work state supports cancellation, fencing, and partial receipts; local workflow stores cancellation state                         | The Temporal cancellation handshake, heartbeat boundary, sandbox termination, partial artifact capture, and terminal receipt contract are open.                                                                                                                                     |

Activity implementations must check for a completed effect before each retryable
external action. Database transactions, CAS writes, provider calls, and outbox
dispatches must remain separately attributable; a single Temporal Activity
success cannot claim atomicity across them.

## Missing Temporal lifecycle and workflow decisions

The following decisions must be frozen by implementation evidence and, where they
change architecture or observable contracts, by an ADR before dependent code:

1. Local/CI Temporal distribution and pinned version; persistence mode and data
   root; namespace creation/verification; namespace retention; startup timeout;
   health/readiness distinction; restart behavior; bounded shutdown; log and
   diagnostic locations; and cleanup rules for disposable CI state.
2. Namespace, task queue, worker identity/build ID, required capabilities, and
   fail-closed profile selection. Architecture names seven queues, but the first
   P3 slice must state which queues exist now and which are deferred.
3. Concrete Temporal descriptor ID, implementation version, profile, health
   probe, readiness probe, contract-major compatibility, and shared conformance
   behavior with the local adapter.
4. Stable workflow ID derivation from program branch identity, workflow/run ID
   projection fields, workflow name/version registry, supported-version window,
   patch/build-ID strategy, replay fixture ownership, and retirement policy.
5. Signal schemas and ordering for pause, resume, cancel, criterion branch, and
   human decisions; query schemas; stale/duplicate signal behavior; cancellation
   races; timer semantics; and deterministic human-gate expiry.
6. `continueAsNew` thresholds by cycles/events/history bytes, carried stable
   identifiers, reconstruction reads from Postgres/CAS, and lineage between runs.
7. Activity names, task-queue routing, timeouts, heartbeat intervals, retry and
   non-retryable error classes, poison-input visibility, idempotency formula,
   completed-effect lookup, and receipt return types for every row above.
8. Crash boundaries before/after provider action, CAS write, Postgres commit,
   receipt commit, and outbox acknowledgement; worker/process/server restart
   harness; Temporal history backup/restore guidance; and recovery diagnostics.
9. Temporal-linked Observatory fields and timeline events. The projection must be
   built from Postgres projections and immutable metadata, carry integrity and
   omission fields, and never query Temporal history as product authority.

## Entry handoff

P2 is a verified foundation for P3, but Temporal implementation should not claim
the full entry gate until the T1 contract/lifecycle owner freezes the descriptor
and service policy and the Activity owner completes the per-operation mapping.
The first bounded integration slice is therefore Temporal lifecycle plus adapter
descriptor/conformance, with any required contract decision recorded before code
depends on it.
