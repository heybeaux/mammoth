# `@mammoth/production-profile`

Reproducible native `production-like-local` lifecycle for a real PostgreSQL
server and filesystem-backed content-addressed artifacts. The profile refuses to
run without an operator-supplied password, uses SCRAM authentication, bounds all
service transitions, and treats missing PostgreSQL tools as gate failures.

See [`docs/OPERATIONS.md`](../../docs/OPERATIONS.md) for commands and recovery.
