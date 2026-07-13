# Production-like local operations

## Prerequisites

- Node 22 and the pinned pnpm version.
- A native PostgreSQL server/client installation. `pg_config --bindir` must
  contain `initdb`, `pg_ctl`, `pg_isready`, `psql`, `createdb`, `dropdb`,
  `pg_dump`, and `pg_restore`.
- The exact configured Temporal CLI version. The `temporal` binary must support
  `server start-dev`, namespace operations, task-queue inspection, and cluster
  health checks.
- A private password of at least 12 characters. Mammoth has no embedded database
  credential and deliberately fails if `MAMMOTH_PG_PASSWORD` is absent.

Docker is not required. The harness creates an isolated SCRAM-authenticated
Postgres cluster and persistent Temporal development database beneath
`MAMMOTH_PROFILE_ROOT`.

```sh
export MAMMOTH_PG_PASSWORD="$(openssl rand -hex 24)"
export MAMMOTH_PROFILE_ROOT="$PWD/.mammoth/production-profile"
export MAMMOTH_TEMPORAL_NAMESPACE="mammoth-local"
export MAMMOTH_TEMPORAL_TASK_QUEUE="mammoth-research-control-v1"
pnpm --filter @mammoth/production-profile exec tsx src/cli.ts bootstrap
```

`bootstrap` starts Postgres first, then the pinned local Temporal service, and
explicitly creates the configured namespace. It does not report the profile
ready. ADR 0004 readiness additionally requires the configured namespace and
retention plus a compatible worker poller on the task queue.

The production-profile CLI does not yet own the worker process. After bootstrap,
start the worker separately with the same namespace, task queue, workflow-bundle
ID, and worker-build ID. Full readiness also requires that worker integration to
provide live manifest/capability probe evidence; task-queue identity text alone
is insufficient. Until that probe is composed, `start`, `status`, and verification
are expected to remain fail-closed. Once it is available, run:

```sh
pnpm profile:start
pnpm profile:status
```

`profile:start` is a full composition gate, not a synonym for “the database is
up.” It starts or reuses the backing services, then fails closed unless Postgres,
Temporal, namespace retention, task queue, adapter contract, required
capabilities, and the compatible poller all pass. On failure it shuts Temporal
down before Postgres. `profile:status`, `verify-lifecycle`, and `verify-backup`
apply the same full gate and cannot emit production-like success evidence when
the Temporal CLI, service, namespace, or worker is absent.

Before shutdown, stop the external worker and wait for its bounded drain/client
close. Then run:

```sh
pnpm profile:stop
```

The profile stops the Temporal service before Postgres so Temporal cannot
schedule new Activity work after the authoritative stores close. Repeated stop is
safe. A Temporal shutdown timeout is a hard failure and leaves Postgres running
for inspection. `pnpm profile:kill` also performs bounded Temporal shutdown
first, then requests immediate Postgres shutdown for the crash-recovery boundary.

Do not place the password in `infra/production-profile.env.example`, shell
history, logs, or committed files. Override the host, port, user, database, and
timeouts only through the documented `MAMMOTH_*` variables in that example.
Temporal host, port, namespace, task queue, retention, pinned service version,
workflow bundle/build identity, CLI path, and bounded timeouts are configured
only through `MAMMOTH_TEMPORAL_*` variables. Adapter startup never creates a
namespace; creation belongs to the explicit local-profile bootstrap/start action.
Temporal workflow queries are orchestration diagnostics, not product authority.
Postgres/CAS remain the source of truth for product state and artifacts.

## Acceptance and recovery

```sh
pnpm verify:p2:lifecycle
pnpm verify:p2:backup
# or both, in order
pnpm verify:p2:profile
```

The P2 lifecycle and backup commands retain their Postgres/CAS-only acceptance
boundary; they do not start or require Temporal. The lifecycle operation proves
unready Postgres startup, bounded start, schema readiness, immediate process
stop, restart, durable
ledger/audit/outbox state, CAS byte integrity, and bounded clean shutdown. The
backup operation creates a custom-format `pg_dump`, copies content-addressed
bytes, restores into a distinct database and directory, then compares the
migration ledger, authoritative revision, audit and outbox counts, artifact
digests, and sizes.

The combined operational `bootstrap`, `start`, `status`, `stop`, and `kill`
commands remain Temporal-aware and fail closed unless the configured service,
namespace, and compatible worker are ready. The P2 verifier commands do not
prove that a live Temporal workflow executed; P3 workflow, Activity, and recovery
evidence belongs to `verify:p3`.

Missing binaries, ports already in use, invalid credentials, startup/shutdown
timeouts, dump/restore failures, and manifest mismatches are hard failures with
the failing command or prerequisite in the diagnostic. Combined Temporal
operations also fail on an absent namespace or compatible worker.
Inspect `$MAMMOTH_PROFILE_ROOT/postgres.log` and
`$MAMMOTH_PROFILE_ROOT/temporal.log` for service startup failures. Data is
persistent and is never automatically deleted by these commands.
