# `@mammoth/temporal-adapter`

Temporal control-plane adapter foundation for the P3 checkpoint.

This package owns Temporal service lifecycle, descriptor publication, readiness
probes, and fail-closed startup checks. It does not store Mammoth product state:
Postgres and CAS remain authoritative for programs, claims, evidence, artifacts,
receipts, audit, and projections.

The local development lifecycle uses the Temporal CLI start-dev server. It
requires an operator-installed `temporal` binary and never embeds service
credentials. The namespace, task queue, retention, address, and bounded startup
and shutdown timeouts are explicit configuration.

```sh
export MAMMOTH_TEMPORAL_NAMESPACE=mammoth-local
export MAMMOTH_TEMPORAL_TASK_QUEUE=mammoth-research-control-v1
pnpm --filter @mammoth/temporal-adapter start
pnpm --filter @mammoth/temporal-adapter status
pnpm --filter @mammoth/temporal-adapter stop
```

`status` fails closed unless the Temporal frontend is reachable, the namespace
has the configured retention, and every required workflow-runtime capability is
proven by a live worker-bundle probe. A poller identity string is only a routing
check; it cannot attest replay, signals, queries, timers, retries, or other worker
behavior. The strict schema-v1 worker manifest is intersected with independently
probed capabilities, so missing, malformed, offline, or over-claiming manifests
remain not ready.

The local server stores schema-v1 ownership metadata containing its PID, process
start time, exact observed command, and profile command fingerprint. A later
`stop` validates all of those fields before signalling. Missing processes are
treated as stale metadata; malformed or reused-PID metadata fails safely without
signalling. An in-process child handle is treated as owned directly.

The package exposes orchestration lifecycle only; it has no product-state
persistence API.

## Research workflow control plane

`ResearchProgramWorkflow` version 1 executes the six evidence-first MVP stages
defined by `@mammoth/workflow`. Its workflow ID is derived only from the frozen
workflow contract and the program, criterion-version, and branch identifiers.
It never uses wall-clock time, randomness, model context, or UI state to choose
the command path.

The workflow executes at most one durable stage per run, then uses
`continueAsNew`. The next run carries stable identity, workflow version, cycle,
and Temporal control metadata; completed product stages and receipt references
are reconstructed through Activities from the authoritative Postgres/CAS-facing
state port. A Temporal patch marker freezes the version-1 stage order for future
compatible migrations.

The versioned control surface is:

- signal `researchProgram.control.v1`: pause, resume, cancel, criterion branch,
  and human-gate approve/reject decisions with revision and signal-ID guards;
- query `researchProgram.state.v1`: complete operator inspection;
- queries `researchProgram.step.v1`, `researchProgram.gates.v1`,
  `researchProgram.cancellation.v1`, `researchProgram.retry.v1`, and
  `researchProgram.receipts.v1`: focused durable state views.

The `mammoth-temporal-research` command is a stateless operator client. Each
invocation reconnects to Temporal, so the tested run, status, pause, resume,
cancel, inspect, approve, and reject operations do not depend on an in-process
worker handle.

```sh
pnpm --filter @mammoth/temporal-adapter exec mammoth-temporal-research run program-1 \
  --gate-id assessment-review \
  --before-stage assess-claims \
  --timeout-ms 3600000
pnpm --filter @mammoth/temporal-adapter exec mammoth-temporal-research status program-1
pnpm --filter @mammoth/temporal-adapter exec mammoth-temporal-research approve program-1 \
  --gate-id assessment-review \
  --receipt-id receipt:assessment-review-approved
pnpm --filter @mammoth/temporal-adapter exec mammoth-temporal-research resume program-1
```

Human-gate specifications are persisted by an Activity before the first stage
and reloaded after `continueAsNew`; decisions are recorded through an Activity
and included in receipt references. Cancellation and gate timeout return honest
partial results containing only completed stages and receipts that exist.
