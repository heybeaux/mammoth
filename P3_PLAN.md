# Mammoth P3 Temporal Workflow Checkpoint

> Status: active
>
> Baseline: `v0.2.0-production-data`
>
> Target: `v0.3.0-temporal-control-plane`
>
> Human contact: checkpoint completion or an escalation explicitly allowed by
> `LOOP.md`

## Outcome

P3 is complete when Mammoth can execute the evidence-first research program
through Temporal while keeping Postgres/CAS authoritative for product state,
artifacts, receipts, audit, and operator projections.

Temporal owns workflow history, timers, signals, queries, retries,
`continueAsNew`, and orchestration replay. It does not become the epistemic
ledger, the product query store, a replacement for idempotency receipts, or a
shortcut around the production-data gates proven in P2.

This checkpoint still does not add broader research-cell fan-out or the 3D
Observatory UI. It creates the durable control plane those later systems require.

## Entry gate

Before Temporal implementation begins:

- [x] Reconfirm `v0.2.0-production-data` from a clean checkout.
- [x] Record any contract change required by Temporal as an ADR before code
      depends on it.
- [x] Freeze the workflow adapter capability descriptor for Temporal under
      contract major `1`, or explicitly version the contract if that is
      impossible.
- [x] Define the local Temporal service lifecycle for development and CI without
      embedded credentials.
- [x] Identify every side-effecting Activity and map it to a provider-idempotency
      key, attributable work item, and completed-effect receipt.

Entry evidence belongs in `evals/reports/p3-entry-temporal.md`.

## P3 delivery slices

### T1 — Temporal adapter contract and lifecycle

Deliver:

- A concrete Temporal adapter package behind the existing workflow/runtime ports.
- Adapter descriptor, health, readiness, capability discovery, and fail-closed
  startup semantics.
- Local Temporal service lifecycle for test and development, with explicit
  namespace, task queue, retention, and shutdown behavior.
- CI-compatible setup that does not require a managed Temporal account.
- Conformance tests shared with the local workflow adapter where behavior overlaps.

Gate:

Mammoth refuses to start a Temporal-backed profile when the service, namespace,
task queue, contract version, or required capability is unavailable.

### T2 — Deterministic workflows and versioning

Deliver:

- Deterministic Temporal workflows for the MVP research program stages.
- Stable workflow IDs derived from program branch identity.
- Versioning strategy for in-flight workflows using supported Temporal patterns.
- `continueAsNew` policy that carries stable identifiers and reconstructs product
  state from Postgres/CAS.
- Replay tests for every supported workflow version.

Gate:

Workflow replay across supported versions produces the same authoritative product
state transitions and does not rely on model context, wall-clock time, random IDs,
or UI state.

### T3 — Activities and idempotent effects

Deliver:

- Separately testable Activities for retrieval, snapshotting, parsing, claim
  proposal admission, assessment, ledger mutation, report compilation, artifact
  writes, outbox publication, revalidation, and human-gate handoff.
- Provider idempotency keys derived from stable program, work item, activity, and
  attempt inputs.
- Completed-effect lookup before each retryable side effect.
- Activity heartbeat, timeout, retry, and non-retryable failure classification.
- Receipt linkage from every side effect back to a work item and workflow run.

Gate:

Forced duplicate Activity execution cannot duplicate a provider effect, outbox
publication, artifact write, or accepted ledger mutation.

### T4 — Signals, queries, cancellation, and human gates

Deliver:

- Signals for pause, resume, cancel, criterion branch, and human-gate decisions.
- Queries for program state, current durable step, pending gates, cancellation
  state, retry state, and receipt references.
- Honest partial receipts for cancellation and terminal failure.
- Expiring human gates with auditable decisions and deterministic timeout behavior.
- Operator CLI coverage that exercises Temporal-backed run, status, resume,
  cancel, and inspect from separate processes.

Gate:

Cancellation, resume, human approval, and timeout behavior remain inspectable
after worker restart and preserve the same ledger/audit invariants as the local
runtime.

### T5 — Crash, restart, and service recovery

Deliver:

- Process-kill tests for Mammoth API/CLI processes, Temporal workers, and
  Activity workers at every durable boundary.
- Temporal server restart tests against the production-like local profile.
- Recovery from worker poller loss, duplicate task delivery, heartbeat timeout,
  retry exhaustion, poison activity input, and stale signals.
- Backup/restore notes for Temporal history aligned with the Postgres/CAS
  integrity strategy.
- Failure diagnostics suitable for operators.

Gate:

Killing Mammoth workers, Temporal workers, and API/CLI processes at injected
boundaries loses no authoritative state and duplicates no external side effect.

### T6 — Observability and projection linkage

Deliver:

- Temporal workflow IDs, run IDs, task queues, attempts, and durable-step metadata
  linked into the existing Observatory projection without making Temporal the
  query store.
- Timeline events for signals, timers, retries, cancellations, human gates,
  `continueAsNew`, and terminal states.
- Metrics and logs for workflow latency, Activity latency, retry counts,
  duplicate-effect prevention, and fail-closed startup.
- Checked fixture showing Temporal-linked operations in the projection.

Gate:

The read-only projection can explain the workflow path for each admitted
transition while preserving the same provenance and integrity digest guarantees
proven in P2.

## Required verification

Add `pnpm verify:p3`. The command must be a non-recursive wrapper around the P3
acceptance implementation and the existing gates. From a clean checkout, the
checkpoint verification ladder is:

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

The P3 verifier must additionally prove:

- adapter startup: missing service, missing namespace, missing task queue, contract
  mismatch, health, readiness, and clean shutdown;
- workflows: deterministic replay, supported version migration, stable IDs,
  signals, queries, timers, retries, and `continueAsNew`;
- Activities: idempotency receipt lookup, duplicate delivery, heartbeat timeout,
  retry exhaustion, non-retryable failure, and poison input visibility;
- recovery: process kill before/after each durable boundary, Temporal worker
  restart, service restart, stale signal, and cancellation after restart;
- authority: Postgres/CAS remains the product source of truth and Temporal history
  cannot render unsupported facts;
- Observatory linkage: deterministic Temporal-linked timeline/projection fixture.

## Checkpoint receipt

The team must create `evals/reports/v0.3.0-temporal-control-plane.md` from
executed evidence. It records:

- exact default-branch commit and merged PRs;
- Temporal adapter descriptor, namespace/task-queue policy, and contract version;
- workflow names, versions, ID policy, signal/query surface, and `continueAsNew`
  policy;
- Activity list, retry classifications, idempotency-key derivation, and receipt
  mappings;
- commands, dates, durations, and results;
- injected crash/restart boundaries and observed recovery;
- projection fixture and digest;
- known limitations and deferred managed deployment, research-cell, and UI scope.

## Stopping condition

The autonomous loop stops only when every checkbox and gate above passes from a
clean checkout, `pnpm verify:p3` passes, default-branch CI is green at the recorded
commit, the receipt is accurate, and `v0.3.0-temporal-control-plane` is ready to
record.

Only then contact Beaux with the checkpoint report.
