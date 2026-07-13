# Observatory projection

Builds the versioned, deterministic, read-only Observatory contract from explicit
authoritative snapshots. It has no database, workflow-engine, UI, clock, or network
dependency. Callers must supply `generatedAt`, the authoritative revision, audit
head, completeness, and omissions; the builder never invents authority.

`buildObservatoryProjectionV1` validates all input and relationships, sorts
unordered collections, preserves every claim state, carries dossier provenance,
and hashes the complete projection content excluding only the digest itself.

P3 callers may attach validated Temporal execution metadata: workflow/run IDs,
task queue, durable step, attempts, operation timeline, metrics, and structured
logs. Those links are included in the deterministic digest, must point at the
same run and an existing or prior authoritative revision, and remain diagnostic;
they cannot add claims, evidence, audit events, or dossier sentences.

Run `pnpm --filter @mammoth/observatory-projection test`, `typecheck`, and `build`.
