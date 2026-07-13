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
