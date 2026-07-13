# `@mammoth/production-profile`

Reproducible native `production-like-local` lifecycle for a real PostgreSQL
server, filesystem-backed content-addressed artifacts, and the local Temporal
control-plane readiness contract. The profile refuses to run without an
operator-supplied password, uses SCRAM authentication, bounds all service
transitions, and treats missing PostgreSQL or Temporal tools as gate failures.

`bootstrap` starts Postgres and the pinned local Temporal service and creates the
explicit namespace. It deliberately does not claim the profile is ready. `start`,
and `status` require Postgres, the Temporal service, the configured
namespace/retention, and a compatible worker poller on the task queue with live
manifest/capability probe evidence. Until the worker package and probe are
composed into this CLI, the full readiness commands intentionally fail closed.
Run that worker as a separate process after bootstrap and stop it before stopping
the profile.

The P2 `verify-lifecycle` and `verify-backup` commands retain their original
Postgres/CAS-only contract. They neither start nor require Temporal; use the
operational commands above when validating the combined P3 profile.

Shutdown is ordered: compatible worker polling must stop first, then the profile
performs bounded Temporal service shutdown, then Postgres stops. `kill` still
shuts Temporal down cleanly before requesting the Postgres crash boundary. A
Temporal shutdown timeout leaves Postgres running and fails closed.

See [`docs/OPERATIONS.md`](../../docs/OPERATIONS.md) for commands and recovery.
