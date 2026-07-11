# ADR 0002: Sequence Production Adapters Before Research-Cell Expansion

- Status: accepted
- Date: 2026-07-10
- Baseline: `v0.1.0-mvp`

## Context

The MVP proves a local evidence-first program can survive interruption and emit an
inspectable dossier. The long-range architecture also calls for Postgres,
content-addressed artifact storage, Temporal, model providers, and Parliament-style
research cells.

Research cells multiply concurrent work, retries, model calls, budgets, and
partial-failure paths. Building broad cell orchestration directly on the MVP local
adapters would either make local implementation details de facto production
contracts or force a later rewrite of durability and idempotency behavior.

## Decision

The post-MVP release train will establish executable production-adapter contracts
and conformance suites first, then implement Postgres/CAS and Temporal adapters,
then expand into research-cell orchestration.

Cell domain contracts and offline prototypes may be developed before the
production adapters are complete, but multi-cell execution is not releasable until
the production storage and workflow gates pass.

All adapters must satisfy behavioral conformance tests. Structural TypeScript
compatibility alone is insufficient. Research cells remain proposal generators;
claim promotion stays in deterministic evidence-policy services.

## Consequences

- The first post-MVP work is less visible than a multi-agent demonstration, but it
  removes the highest-risk durability and transaction ambiguity first.
- Local and production adapters share observable invariants without requiring the
  domain to import Temporal, Postgres, or provider SDKs.
- Research-cell tests can use in-memory adapters while preserving a clear release
  dependency on production conformance.
- Adapter contract changes require versioning and migration evidence once a
  production adapter ships.

## Rejected alternatives

### Build Parliament topology immediately

Rejected because fan-out would be coupled to single-host persistence and would not
have production-grade fencing, replay, or transaction evidence.

### Implement Postgres and Temporal before defining conformance

Rejected because two implementations could appear compatible while disagreeing on
atomicity, cancellation, retries, or receipt semantics.

### Treat model agreement as the first cell-level acceptance metric

Rejected because agreement is not evidence and correlated models can create false
independence.
