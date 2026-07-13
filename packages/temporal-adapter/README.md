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
has the configured retention, a compatible bundle/build poller is visible on the
task queue, the contract major is `1`, and every required workflow-runtime
capability is present. The package exposes orchestration lifecycle only; it has no
product-state persistence API.
