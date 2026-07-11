# Mammoth Initial MVP Plan

> Status: active
>
> Checkpoint: `v0.1.0-mvp`
>
> Scope authority: this document defines the first usable checkpoint; `ARCHITECTURE.md` remains the normative long-range design.

## Outcome

The initial MVP is complete when Mammoth can run one local, deterministic,
evidence-first research program end to end, survive interruption, and produce an
inspectable dossier whose factual sentences resolve to immutable evidence through
named policy assessments.

This checkpoint is intentionally smaller than the architecture-complete state in
`ARCHITECTURE.md` section 44. It proves the core product loop before adding the
broader model, novelty, experiment, desktop, and pipeline ecosystems.

## Current state

- [x] Phase 0: constitution and failure harness.
- [x] Phase 1: evidence-first vertical slice.
- [x] Phase 2: durable local orchestration and governance.
- [x] Runtime composition: one complete research-program workflow.
- [ ] Operator CLI and inspectability.
- [ ] Black-box MVP verification and clean-checkout receipt.

## Delivery loops

### M1 — Durable orchestration

Deliver:

- Durable workflow state with versioned definitions.
- Leased work queues, retries, dead letters, and stable idempotency keys.
- Side-effect receipts that prevent duplicate external effects.
- Pause, resume, cancel, durable timers, and revalidation schedules.
- Budget reservation, commit, release, and exhaustion behavior.
- Human gates with auditable decisions.
- Fault-injection tests across every durable boundary.
- An ADR documenting the MVP local runtime and its production Temporal adapter boundary.

Exit gate: forced restart at each step resumes to the same terminal state with no
lost authoritative state and no duplicated side effect. Add `pnpm verify:phase-2`.

### M2 — End-to-end runtime

Add a thin runtime composition layer that connects the existing domain, evidence,
retrieval, persistence, report compiler, workflow, queue, and governance packages.
It runs a checked-in public-source fixture through:

```text
charter -> retrieve -> snapshot -> parse -> locate -> propose claims
        -> assess -> persist -> compile dossier -> emit manifest and receipts
```

Model output, if introduced, remains a proposal. Deterministic services validate
and commit authoritative state. The fixture must also exercise an unresolved or
contradicted claim so that fail-closed behavior is visible.

### M3 — Operator surface

Provide a local CLI with commands equivalent to:

```text
mammoth run <charter>
mammoth status <program>
mammoth resume <program>
mammoth cancel <program>
mammoth inspect <program>
```

The CLI writes a durable program directory containing state, immutable snapshots,
the report, manifest, assessments, audit events, and receipts. No desktop UI or
hosted API is required for this checkpoint.

### M4 — MVP acceptance

Add `pnpm verify:mvp` and an evaluation receipt under `evals/reports/`. From a
clean checkout it must prove all of the following:

- Install, format check, lint, typecheck, test, and build are green.
- Phase 0, Phase 1, and Phase 2 verifiers remain green.
- Every report fact maps to a claim, named policy, exact locator, and snapshot digest.
- Unsupported, unresolved, contradicted, or expired claims cannot render as supported facts.
- Restart injection loses no state and duplicates no external side effect.
- Budget exhaustion fails closed.
- Cancellation emits an honest partial receipt.
- Revalidation is scheduled for stale or volatile evidence.
- CLI run, status, resume, cancel, and inspect behavior is covered end to end.
- Artifacts remain readable after a new process starts.
- README quickstart and known limitations match the shipped behavior.
- The checkpoint is merged to the default branch and CI is green.

Only after every item passes may the repository record the `v0.1.0-mvp` checkpoint
and contact Beaux with the result.

## Explicitly deferred

- Full Parliament multi-model research cells and correlation-aware panels.
- Novelty archives and prior-art evaluation.
- Sandboxed experiment runners, hidden evaluators, and statistical campaigns.
- Engram, AWM, ACR, Aegis, Sonder, Lattice, and Receipts service integrations.
- Cloud model providers and governed cloud egress.
- Desktop observatory and hosted API.
- `mammoth-pipelines` SDK and reference pipelines.
- Hosted multi-tenancy and production distribution.

These remain part of the long-range architecture. Deferral must not erase their
ports or make the core depend on an MVP-only implementation.

## Decision rules

- `ARCHITECTURE.md` section 6 invariants cannot be traded for schedule.
- Open architecture decisions require an ADR; implementation commits must not
  silently settle them.
- Git history, CI, verifier output, and evaluation receipts outrank status prose.
- A completed package or merged PR is progress, not the checkpoint.
- The operating loop and escalation rules are defined in `LOOP.md`.
