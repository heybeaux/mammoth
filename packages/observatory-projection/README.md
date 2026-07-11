# Observatory projection

Builds the versioned, deterministic, read-only Observatory contract from explicit
authoritative snapshots. It has no database, workflow-engine, UI, clock, or network
dependency. Callers must supply `generatedAt`, the authoritative revision, audit
head, completeness, and omissions; the builder never invents authority.

`buildObservatoryProjectionV1` validates all input and relationships, sorts
unordered collections, preserves every claim state, carries dossier provenance,
and hashes the complete projection content excluding only the digest itself.

Run `pnpm --filter @mammoth/observatory-projection test`, `typecheck`, and `build`.
