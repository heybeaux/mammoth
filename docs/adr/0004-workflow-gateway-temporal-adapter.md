# ADR 0004: Workflow gateway and Temporal adapter placement

- Status: accepted
- Date: 2026-07-13
- Supersedes: the Temporal-specific boundary wording in ADR 0001
- Preserves: ADR 0003 transaction and orchestration ownership

## Context

`WorkflowStore` is the persistence port used by Mammoth's local step runtime. It
loads, saves, and atomically transacts a complete `WorkflowSnapshot`. Temporal is
not a snapshot store: it records immutable workflow history and derives
orchestration state through deterministic replay, commands, signals, queries,
timers, retries, and task-queue polling. Treating Temporal as a `WorkflowStore`
would either invent unsupported atomic semantics or hide a second state store.

The P3 control plane needs a concrete Temporal adapter without changing the P2
authority boundary. Temporal may be authoritative for orchestration history,
timers, signals, retries, and workflow execution state. Postgres and the CAS
remain authoritative for programs, claims, evidence, product projections,
artifacts, audit records, outbox rows, work items, and completed-effect receipts.

Two T1 prototypes existed. `@mammoth/adapter-temporal` reused
`workflow-store`, which conflated the local store and orchestration engine. The
`@mammoth/temporal-adapter` prototype introduced a separate adapter kind but did
not yet freeze the inward gateway, descriptor metadata, or bounded lifecycle.

## Options considered

1. Implement Temporal as `WorkflowStore`. Rejected because the atomic snapshot
   contract cannot represent Temporal history, signals, queries, or polling.
2. Put Temporal SDK types in `@mammoth/workflow`. Rejected because the core
   package would depend on one concrete engine and expose SDK handles outward.
3. Expose Temporal clients directly to application services. Rejected because
   callers would bypass capability, readiness, version, and authority gates.
4. Add a distinct inward workflow-runtime gateway and concrete
   `@mammoth/temporal-adapter`. Accepted.

## Decision

Mammoth adds `workflow-runtime` as a distinct adapter kind. `workflow-store`
remains unchanged and continues to describe the local snapshot persistence
boundary. The adapter contract advances additively within major 1 from `1.0.0`
to `1.1.0`.

The workflow-runtime capabilities are:

- `deterministic-replay`
- `durable-timers`
- `signals`
- `queries`
- `retry-scheduling`
- `continue-as-new`
- `task-queue-polling`
- `clean-shutdown`
- `durable-restart`
- `cooperative-cancellation`
- `health-reporting`

A `WorkflowRuntimeDescriptor` adds diagnostic-only namespace, task queue,
retention, workflow-bundle identity, and worker-build identity. None is product
state. Readiness requires a reachable service, the configured namespace with the
expected retention, a compatible poller on the configured task queue, contract
major 1, and every required capability. A queue exists for readiness purposes
only when a compatible worker poller is observable; Temporal does not pre-create
task queues as configuration objects.

The inward `WorkflowGateway` exposes stable start, describe, signal, query, and
cancel requests. It must not expose raw Temporal clients, SDK handles, history
events, or product records. Gateway query results describe orchestration only and
must never be used as the product query source. Workflow definitions may use
Temporal workflow APIs only inside deterministic workflow bundles. Network I/O,
filesystem access, product-state reads or writes, and external effects belong in
Activities.

`@mammoth/temporal-adapter` is the chosen package name because it matches the
repository's existing `<technology>-adapter` convention (`postgres-adapter`),
states the concrete dependency plainly, and is already used by the stronger T1
lifecycle prototype. The competing `@mammoth/adapter-temporal` package is not
adopted.

The production-like local profile uses a pinned Temporal CLI/server version,
loopback endpoint, explicit namespace, task queue, retention, startup timeout,
and shutdown timeout. Adapter startup never creates or changes a namespace.
Namespace creation is an explicit profile bootstrap action. Local development
defaults to namespace `mammoth-local`, queue
`mammoth-research-control-v1`, seven-day retention, 60-second startup, and
30-second shutdown. CI must use a run-unique namespace and one-day retention.
No managed credentials are embedded.

Shutdown first closes admission, then drains adapter calls and worker polling,
then closes worker/client resources, and finally stops the local service. A
timeout is a failed shutdown, not a clean stop. Repeated shutdown is idempotent.

## Consequences

- P2 `workflow-store` descriptors and conformance tests retain their meaning.
- Temporal-specific dependencies remain outside domain and workflow packages.
- Later T2 code can implement the frozen gateway without leaking SDK types.
- Production composition must require both P2 product-state adapters and the P3
  workflow-runtime adapter.
- Temporal history cannot render facts, commit product mutations, replace effect
  receipts, or become the Observatory query store.
- T1 unit tests can prove configuration, compatibility, readiness, and bounded
  shutdown without falsely claiming that a live Temporal service or worker ran.

## Evidence

- `ARCHITECTURE.md` sections 15, 28, and 38 define Temporal's orchestration role,
  Postgres/CAS authority, and inward `WorkflowGateway` dependency direction.
- `docs/reviews/p3-temporal-lifecycle-architecture.md` compared the placement and
  contract options and recommended the separate runtime role.
- Adapter-contract and Temporal-adapter tests exercise major-1 compatibility,
  stable failure reasons, namespace/queue readiness, and bounded shutdown.
