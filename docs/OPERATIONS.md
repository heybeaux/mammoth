# Production-like local operations

## Prerequisites

- Node 22 and the pinned pnpm version.
- A native PostgreSQL server/client installation. `pg_config --bindir` must
  contain `initdb`, `pg_ctl`, `pg_isready`, `psql`, `createdb`, `dropdb`,
  `pg_dump`, and `pg_restore`.
- A private password of at least 12 characters. Mammoth has no embedded database
  credential and deliberately fails if `MAMMOTH_PG_PASSWORD` is absent.

Docker is not required. The harness creates an isolated SCRAM-authenticated
cluster beneath `MAMMOTH_PROFILE_ROOT`, so it works on macOS and CI runners with
PostgreSQL installed.

```sh
export MAMMOTH_PG_PASSWORD="$(openssl rand -hex 24)"
export MAMMOTH_PROFILE_ROOT="$PWD/.mammoth/production-profile"
pnpm profile:start
pnpm profile:status
pnpm profile:stop
```

Do not place the password in `infra/production-profile.env.example`, shell
history, logs, or committed files. Override the host, port, user, database and
timeouts only through the documented `MAMMOTH_*` variables in that example.

## Acceptance and recovery

```sh
pnpm verify:p2:lifecycle
pnpm verify:p2:backup
# or both, in order
pnpm verify:p2:profile
```

The lifecycle gate proves unready startup, bounded start, schema readiness,
immediate process stop, restart, durable ledger/audit/outbox state, CAS byte
integrity, and bounded clean shutdown. The backup gate creates a custom-format
`pg_dump`, copies content-addressed bytes, restores into a distinct database and
directory, then compares the migration ledger, authoritative revision, audit and
outbox counts, artifact digests, and sizes.

Missing binaries, ports already in use, invalid credentials, startup timeouts,
dump/restore failures, and manifest mismatches are hard failures with the failing
command or prerequisite in the diagnostic. Inspect
`$MAMMOTH_PROFILE_ROOT/postgres.log` for server startup failures. `pnpm
profile:kill` requests PostgreSQL immediate shutdown for crash-recovery testing;
run `pnpm profile:start` afterward. Data is persistent and is never automatically
deleted by these commands.
