# Phase 1 evaluation report

## Scope

Phase 1 implements the evidence-first vertical slice: guarded retrieval,
content-addressed raw and parsed snapshots, source lineage, a claim graph,
durable local persistence, and evidence-bound report compilation.

## Exit-gate coverage

The report compiler tests prove that a generated factual sentence is emitted
only when it resolves through all of the following records:

1. a claim declared in the report manifest;
2. a claim status eligible for the requested report section;
3. a named, matching evidence-policy assessment;
4. an assessed evidence edge with an exact locator;
5. a fresh immutable snapshot digest.

Negative fixtures reject candidate claims, undeclared claims, stale evidence,
missing or mismatched assessments, missing evidence bindings, and multiple
factual sentences hidden inside a single fact node.

Retrieval fixtures cover redirect lineage, per-hop SSRF protection, streamed
size enforcement, deterministic parsing, CAS deduplication, integrity checking,
and creation of raw and parsed content-addressed artifacts. Persistence fixtures
cover atomic durable transactions, crash recovery, and referential validation.

## Verification

Run:

```sh
pnpm verify:phase-1
```

The complete repository gate remains:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm verify:evidence
pnpm verify:audit
```
