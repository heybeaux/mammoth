# Mammoth Post-MVP Roadmap

> Status: historical; superseded as product authority on 2026-07-16
>
> Baseline: `v0.1.0-mvp`
>
> Direction: production adapters first, then broader research-cell orchestration.
>
> Completed release checkpoints: [`P2_PLAN.md`](P2_PLAN.md),
> [`P3_PLAN.md`](P3_PLAN.md), [`P4_PLAN.md`](P4_PLAN.md),
> [`P5_PLAN.md`](P5_PLAN.md), [`P6_PLAN.md`](P6_PLAN.md),
> [`P7_PLAN.md`](P7_PLAN.md), [`P8_PLAN.md`](P8_PLAN.md)
>
> Latest release receipt:
> [`v0.8.0-turnkey-research.md`](evals/reports/v0.8.0-turnkey-research.md)
>
> Current authority: [`CORE_THESIS.md`](CORE_THESIS.md) and
> [`PRODUCT_ROADMAP.md`](PRODUCT_ROADMAP.md).

This roadmap remains a record of the P1-P9 delivery sequence. It no longer
authorizes phase-number progression or defines Mammoth's product destination.

## Outcome

P8 turns the production-shaped P2-P7 substrate into a local CLI product: a user
supplies a plain-language question or theory, Mammoth performs bounded iterative
discovery and evidence admission, and it returns a cited report bundle. The
substrate remains subordinate to that user outcome and every evidence, authority,
durability, isolation, lineage, budget, and receipt invariant carries forward.

The approved Mammoth 2.0 direction is recorded in [`MAMMOTH_2.md`](MAMMOTH_2.md):
one epistemic core with `research ask` for evidence-bound research and a future
`lab solve` program for research-driven hypotheses, bounded experiments, patches,
formal checks, and solution portfolios. P9 does not implement solver execution; it
makes the live path truthful and general first.

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

Completed plan: [`P5_PLAN.md`](P5_PLAN.md). Release receipt:
[`evals/reports/v0.5.0-isolated-divergence.md`](evals/reports/v0.5.0-isolated-divergence.md).

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

Frozen plan: [`P6_PLAN.md`](P6_PLAN.md).

Completed release receipt:
[`evals/reports/v0.6.0-research-topology.md`](evals/reports/v0.6.0-research-topology.md).

### P7 — Live Research Loop

Deliver:

- A provider-neutral model-work port and immutable resolution from model-profile
  version to a concrete local or cloud adapter configuration.
- Governed model Activities with explicit work-item contracts, egress decisions,
  data classification, mounted tools, secrets isolation, idempotency, usage, cost,
  raw-artifact, failure, and cancellation receipts.
- An operator entry point that starts, resumes, cancels, inspects, and reconstructs
  a P6 topology research program through application ports rather than direct
  adapter imports.
- Typed conversion of provider outputs into observations, claim/evidence proposals,
  hypotheses, reviews, dissent, and experiment artifacts; deterministic services
  remain the only authority that validates and commits them.
- Offline provider conformance fixtures for malformed output, prompt injection,
  alias drift, outage, throttling, duplicate delivery, timeout, cancellation,
  budget exhaustion, partial results, and restart recovery.
- A separate manually authorized live-provider exhibition protocol that records
  provider, concrete model, prompt and contract digests, date, cost, raw artifacts,
  and limitations without becoming an offline release dependency.

Exit gate:

A user can launch one bounded research topology through the operator surface and
obtain a restart-safe, budget-bounded, evidence-bound dossier with preserved
dissent and complete provider/effect receipts. Deterministic offline gates prove
the contract; any live-provider run is reported honestly as an exhibition unless
the frozen P7 plan defines a replicated evaluation protocol.

Frozen plan: [`P7_PLAN.md`](P7_PLAN.md). The merged P7 implementation proves the
governed execution substrate described there. It does not prove question-driven
source discovery or a comprehensive report product; those are P8 scope.

Merged substrate: [`P7_PLAN.md`](P7_PLAN.md).

### P8 — Turnkey Research Product

Deliver:

- Plain-language question/theory intake and a versioned research charter.
- Governed provider-neutral discovery, immutable source snapshots, exact locators,
  evidence admission, and source lineage.
- Persisted semantic topology and bounded evidence-gap/falsification cycles.
- Admitted-only comprehensive Markdown/HTML reports with traversable citations.
- Turnkey ask/status/inspect/resume/cancel/export operator experience.
- Frozen offline data-center evaluation, adversarial verification, separately
  authorized live exhibition, release receipt, and tag.

Exit gate:

The natural-language data-center command produces the complete report bundle;
every factual sentence passes provenance; mandatory coverage is accounted for;
iterative gap research, restart/idempotency, budgets, cancellation, and hostile
sources are proven; and independent review plus merged-main CI and receipt prove
the exact candidate.

Frozen entry contract: [`P8_PLAN.md`](P8_PLAN.md).

Completed release receipt:
[`v0.8.0-turnkey-research.md`](evals/reports/v0.8.0-turnkey-research.md).

### P9 — Trustworthy General Research

Deliver:

- Hard pre-transport budget reservations and honest unknown provider cost.
- Truthful publication, retrieval, robots, rights, media, parser, and failure
  metadata.
- Hosted-safe DNS/redirect/SSRF acquisition and bounded parser policy.
- Independent quote-to-claim entailment before admission.
- A versioned question-derived research plan covering scope, subquestions,
  sources, contradictions, freshness, stop criteria, outline, and budget.
- Plan-relative verification, three unrelated accepted plans, and one complete
  non-data-center report.

Exit gate:

No hostile transport, retry, parser, source span, or provider can overspend,
access private infrastructure, fabricate provenance, hide selected-source failure,
or render a non-entailing claim. Technical, policy, and scientific questions
produce distinct accepted plans; an unrelated offline report and authorized live
exhibition pass plan-relative review and the complete P2-P9 ladder.

Proposed entry contract: [`P9_PLAN.md`](P9_PLAN.md). It becomes frozen only after
the entry-plan PR merges.

### P10-P12 — General evaluation and experimental solver

- **P10:** complete three unrelated report exhibitions and equal-budget benchmark
  against strong direct/deep-research baselines.
- **P11:** freeze and implement problem, hypothesis, sandbox, patch, evaluator,
  run, and solution-verdict contracts for `mammoth lab solve`.
- **P12:** run Colibri, mathematical, and non-code solver exhibitions with exact
  reproducibility and independent review.

These scopes remain directional until their own entry plans and acceptance
baselines merge. See [`MAMMOTH_2.md`](MAMMOTH_2.md).

## Dependency order

```text
P1 adapter contracts
  -> P2 Postgres + CAS
  -> P3 Temporal
  -> P4 cell contracts + lineage
  -> P5 isolated divergence + blind review
  -> P6 broader research topology
  -> P7 live research loop
  -> P8 turnkey research product
  -> P9 trustworthy general research
  -> P10 comparative general-research evaluation
  -> P11 experimental solver
  -> P12 solver exhibitions
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

## Next implementation checkpoint

P8 Turnkey Research is complete at the local CLI and release-receipt layer. P9
Trustworthy General Research is the active plan-first checkpoint. Implementation
starts only after its entry-plan PR and a distinct T0 acceptance-baseline PR
merge. P10-P12 remain directional and cannot inherit a release claim from P9.

The read-only visualization track is specified in
[`docs/OBSERVATORY.md`](docs/OBSERVATORY.md). A high-fidelity shell and 3D
prototype remain downstream of the stable projection contract.
