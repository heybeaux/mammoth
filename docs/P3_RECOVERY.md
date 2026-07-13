# P3 Temporal recovery and backup

## Acceptance boundaries

`@mammoth/temporal-adapter` includes two live SDK probes. The readiness probe
executes signals, queries, timers, retries, cancellation, `continueAsNew`,
history download, and replay. The recovery probe starts an open workflow on one
worker, drains that poller, resumes the same run on a replacement worker, ignores
a stale signal, injects a failure after a simulated provider commit, and proves
the redelivered Activity returns one completed receipt for one provider effect.

Run both with:

```sh
pnpm --filter @mammoth/temporal-adapter test:live
```

The full production-profile P3 verifier must additionally kill separate API/CLI,
workflow-worker, and Activity-worker processes, restart the persistent Temporal
service, and compare Postgres/CAS/outbox/receipt integrity before and after every
injected boundary. A graceful SDK worker drain is evidence for poller replacement,
not a claim that `SIGKILL` or service recovery was exercised.

## Recovery diagnostics

Operators should diagnose from product authority outward:

1. Compare the authoritative Postgres revision, audit head, effect receipts,
   outbox dispatch keys, and CAS manifest. A Temporal status alone cannot mark a
   program recovered.
2. Inspect the Temporal workflow ID, run ID, workflow type, task queue, current
   durable step, Activity attempt, retry classification, heartbeat age, and the
   most recent receipt reference.
3. Treat a missing compatible poller, namespace mismatch, task-queue mismatch,
   contract mismatch, or unavailable service as fail-closed startup. Do not start
   a parallel workflow with a new ID to work around it.
4. For an ambiguous provider commit, query the provider using the stable
   idempotency key and reconcile the completed-effect receipt before retrying.
5. Quarantine poison input and retry exhaustion with the original input digest,
   errors, attempts, work attribution, and partial receipts still inspectable.

The Observatory link is diagnostic and read-only. Its workflow latency, Activity
latency, retries, duplicate-effect prevention, and fail-closed startup counters
must be derived from durable product projections plus linked execution metadata;
they cannot create or promote claims.

## Temporal history backup and restore

Postgres and CAS remain Mammoth's authoritative backup set and continue to use
the P2 dump, CAS copy, manifest, and restore verification. Temporal persistence
is a separate orchestration recovery set:

- stop Mammoth writers and drain workers before a coordinated snapshot;
- back up the Temporal persistence database with the procedure supported by the
  deployed Temporal backend, including cluster and namespace metadata;
- record the Temporal server version, namespace, retention, workflow bundle/build
  identity, task queue, snapshot instant, and checksum beside the P2 manifest;
- restore into an isolated cluster first, then replay supported workflow histories
  with the recorded worker bundle before permitting task polling;
- reconcile every open workflow ID/run ID and referenced receipt against restored
  Postgres/CAS; fail closed on missing history, unsupported workflow code, a
  future product revision, or receipt divergence.

The local `temporal server start-dev` SQLite file is development evidence, not a
production backup format. Copying it while the server is running is unsupported.
For the local recovery acceptance boundary, stop the owned service, copy the
closed database plus checksum, restart it, and prove the same open workflow run
continues against unchanged authoritative product manifests.

History retention is not backup. Expired histories may be archived for audit,
but Mammoth still needs Postgres/CAS receipts and artifacts to explain accepted
facts. Restoring Temporal without the matching authoritative revision must remain
diagnostic-only until reconciliation succeeds.
