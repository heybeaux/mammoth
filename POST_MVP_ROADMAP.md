# Mammoth Post-MVP Roadmap

> Status: active
>
> Baseline: `v0.1.0-mvp`
>
> Direction: production adapters first, then broader research-cell orchestration.
>
> Completed checkpoints: [`P2_PLAN.md`](P2_PLAN.md), [`P3_PLAN.md`](P3_PLAN.md),
> [`P4_PLAN.md`](P4_PLAN.md)
>
> Active checkpoint: [`P5_PLAN.md`](P5_PLAN.md) — isolated divergence and blind
> review

## Outcome

The next checkpoint moves Mammoth from a proven single-host research runtime to a
production-shaped system without weakening the evidence-first invariants proven by
the MVP. It then introduces isolated, correlation-aware research cells whose
outputs remain proposals until deterministic evidence policy admits them.

The work is intentionally ordered. Research-cell fan-out increases concurrency,
cost, and failure surface, so it must land only after production storage,
orchestration, idempotency, and observability boundaries have executable
conformance evidence.

## Release train

### P1 — Adapter contracts and conformance

Deliver:

- Versioned production adapter contracts for workflow execution, authoritative
  ledger state, artifact storage, side effects, clocks, and receipts.
- Capability discovery and fail-closed startup when a required capability or
  contract version is unavailable.
- Reusable conformance suites for atomic transitions, fencing, duplicate delivery,
  retry classification, cancellation, receipt integrity, and restart recovery.
- A production-like local profile contract with explicit health and readiness
  semantics.
- ADRs for transaction ownership and Temporal/Postgres responsibility boundaries.

Exit gate:

The existing local adapters and every new production adapter pass the same
behavioral conformance suite. An adapter cannot be selected merely because it
implements the TypeScript shape.

### P2 — Postgres ledger and content-addressed artifacts

Deliver:

- Forward-only Postgres migrations for authoritative program, claim, evidence,
  assessment, audit, outbox, budget, and receipt state.
- Transactional repositories with optimistic revisions and explicit fencing.
- Content-addressed artifact storage whose bytes are verified on read.
- Atomic ledger mutation plus outbox insertion in one database transaction.
- Migration tests for empty install, upgrade, interruption, and restart.

Exit gate:

Forced concurrent writes cannot lose an accepted state transition, duplicate an
external effect, or publish an outbox event without its authoritative mutation.
Tampered artifact bytes fail closed.

### P3 — Temporal workflow adapter

Deliver:

- Deterministic Temporal workflows and separately testable Activities.
- Stable workflow IDs, search attributes, signals, queries, retries, timers,
  cancellation, and `continueAsNew` policy.
- Provider-idempotent activity effects tied to attributable work items.
- Replay tests across supported workflow versions.
- Process-kill and service-restart tests against the production-like local profile.

Exit gate:

Killing Mammoth workers, Temporal workers, and API processes at every durable
boundary loses no authoritative state and duplicates no external side effect.

Completed plan: [`P3_PLAN.md`](P3_PLAN.md).

### P4 — Research-cell contracts and lineage

Deliver:

- Versioned cell plans, typed cell inputs, positions, reviews, dissent, and
  synthesis artifacts.
- Immutable criterion references on every position and review.
- Model-profile and lineage registry with provider, family, checkpoint, context,
  and shared-derivation metadata.
- Correlation scoring that prevents nominally different but related models from
  masquerading as independent support.
- Admission rules that reject missing claim/evidence references, criterion drift,
  self-review, and untraceable model lineage.

Exit gate:

Adding any number of agreeing positions cannot change an unsupported claim to
supported, and a model cannot review its own candidate in the same role.

### P5 — Isolated divergence and blind review

Deliver:

- Independent divergence cells that commit positions before seeing peers.
- Blind review cells with author-aware assignment and correlation-aware panels.
- Preserved minority reports, unresolved conflict, and review residue.
- Budget reservations and cancellation receipts per cell.
- Typed exchange of claim IDs, evidence IDs, hypotheses, and artifacts rather than
  unconstrained transcript sharing.

Exit gate:

The verifier can prove pre-commit isolation, reviewer independence, complete
dissent retention, bounded spend, and honest partial results after cancellation.

### P6 — Broader research topology

Deliver:

- Landscape, divergence, prior-art, falsification, experiment, and synthesis cell
  templates from `ARCHITECTURE.md` section 18.
- Topology planner with explicit dependencies, concurrency limits, and budgets.
- Evidence-aware synthesis over admitted claims only.
- Operator projections for cell state, lineage, disagreement, spend, and receipts.
- Offline evaluation fixtures for correlated consensus, criterion drift, missing
  evidence, adversarial dissent, and partial failure.

Exit gate:

A complete multi-cell program survives restart, preserves dissent, stays within
budget, and emits a dossier whose factual sentences retain the MVP provenance
guarantee.

## Dependency order

```text
P1 adapter contracts
  -> P2 Postgres + CAS
  -> P3 Temporal
  -> P4 cell contracts + lineage
  -> P5 isolated divergence + blind review
  -> P6 broader research topology
```

P2 and the non-workflow portions of P3 may proceed in parallel after P1 contract
freeze. P4 domain modeling may be prototyped against in-memory adapters, but P5
cannot become release scope until P2 and P3 pass their exit gates.

## Invariants carried forward

- Models and cells propose; deterministic services validate and commit.
- Agreement, panel size, or rhetorical confidence never promotes truth.
- Every factual sentence resolves to an admitted claim, named policy assessment,
  exact locator, and immutable evidence digest.
- Criterion drift, dissent, contradictions, failures, red results, and partial
  execution remain inspectable.
- External effects require stable idempotency keys and attributable receipts.
- Adapters communicate through application ports or domain events, never direct
  cross-adapter imports.
- Cloud egress requires policy, classification, provider, budget, and cost records.

## Active implementation checkpoint

The active checkpoint is P5 isolated divergence and blind review. Its exact entry
gate, slices, adversarial fixtures, verifier, receipt, release label, and stopping
condition are frozen in [`P5_PLAN.md`](P5_PLAN.md).

The read-only visualization track is specified in
[`docs/OBSERVATORY.md`](docs/OBSERVATORY.md). A high-fidelity shell and 3D
prototype remain downstream of the stable projection contract; P5 may extend only
the read-only projection and operator-inspection surface needed to prove isolation,
attribution, dissent, spend, cancellation, and recovery.
