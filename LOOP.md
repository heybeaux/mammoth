# Autonomous Delivery Loop

## Mission

P6 `v0.6.0-research-topology` is merged, verified, tagged, and recorded under
`P6_PLAN.md`. P7 Live Research Loop is next, but its acceptance contract is not
yet frozen. The current loop is therefore plan-first: reconcile product boundaries,
freeze a P7 plan in a distinct PR, then recreate or resync implementation worktrees.
Preserve the P2 Postgres/CAS authority boundary, P3 Temporal control plane, P4-P5
lineage/isolation/review contracts, and P6 topology/synthesis contracts.

Routine reversible choices, ADR-backed decisions, delegation, PRs, reviews, CI
repair, and sequencing do not require human contact.

## Roles and ownership

- **Coordinator/integrator:** contracts, priorities, ownership, integration, CI,
  receipt, release, and checkpoint decision.
- **Provider/model builder:** provider-neutral port, model-profile resolution,
  governed egress, typed outputs, usage, cost, and effect receipts.
- **Persistence/budget builder:** ports, migrations, constraints, fencing,
  reservations, settlements, receipts, and restart evidence.
- **Workflow/operator builder:** topology entry point, live research Activities,
  recovery/replay probes, and read-only fail-closed projection.
- **Adversarial reviewer:** independently attacks epistemic and authority claims;
  an author never self-certifies the exit gate.

One worker owns a path at a time. Each assignment names owned/non-owned paths,
contracts, commands, dependencies, and handoff recipient. A prepared worktree or
accepted spawn is not liveness evidence; require a live registry entry plus fresh
artifacts, diffs, tests, or a tied status report. Prove a run dead before replacing
it and never assign overlapping workers to one worktree.

## Loop

1. **Orient** — fetch `main`; inspect worktrees, PRs, CI, active workers,
   `P6_PLAN.md`, its receipt, the P7 handover, ADRs, migrations, provider seams,
   and the highest unproved predicate.
2. **Claim** — freeze the smallest testable slice, owner, paths, dependencies,
   contract impact, adversarial risks, commands, and independent reviewer.
3. **Delegate** — use path-disjoint durable workers and prove actual liveness.
4. **Build** — provider-neutral contracts first, then governed adapters, topology
   operator entry, typed Activities, persistence/budgets, recovery, and projection.
5. **Attack** — exercise malformed provider output, prompt injection, secret or
   sensitive-data leakage, provider outage/throttling, alias drift, duplicate
   calls/charges, budget exhaustion, cancellation, stale fencing, future authority,
   and restart at every durable boundary.
6. **Review** — inspect dependency direction, hidden stores, authority drift,
   deleted rejection residue, direct adapter imports, Temporal shadow state,
   projection writes, fake receipts, process-order "isolation," and hidden
   author/popularity/verdict fields.
7. **Verify** — run focused gates, every verifier through `pnpm verify:p6`, the
   active P7 verifier once frozen and implemented, and the full clean-checkout
   ladder. The P7 verifier must be non-recursive, exercise production-shaped
   public boundaries, preserve every earlier gate, and keep live-provider
   evaluations separately authorized. Capture exact evidence in the receipt.
8. **Integrate** — resolve without discarding work, push, open a PR, repair CI,
   resolve independent findings, merge, and verify `main`.
9. **Reconcile** — update plan, roadmap, receipt, and tag only from executed proof.
10. **Continue** — a green slice or PR is not a pause point while any stopping
    predicate remains false.

Git constraints, database state, verifier output, CI, integrity digests, and
receipts outrank prose or worker confidence.

## Dependency order

```text
P6 receipt reconfirmation
  -> P7 acceptance-contract freeze
  -> provider-neutral model work contract and governed adapter
  -> topology operator entry and live research Activities
  -> authoritative receipts, budgets, cancellation, and recovery
  -> read-only projection and operator inspection
  -> adversarial verifier and clean-checkout receipt
  -> independent review, PR, main CI, annotated tag
```

Tests and documentation may run in parallel only when paths and contracts are
disjoint. The coordinator serializes cross-package reconciliation.

## Failure and recovery

- Retry transient failures only when retry is safe.
- After two identical failures, change strategy or assign an independent reviewer.
- After three, quarantine the approach, record root cause, and use an alternative;
  never weaken or delete a gate.
- Preserve unrelated work, failed migrations, rejected proposals, dissent, red
  results, and diagnostics.
- Never repair drift by deleting non-disposable data or rewriting history.
- Continue valid offline work during external-service outages without claiming the
  service gate passed.
- Resolve authority ambiguity in an ADR before it becomes an accidental contract.

## Human escalation

Do not send progress updates or request routine confirmation. Escalate only when:

- the active checkpoint stopping condition is satisfied;
- an irreversible/destructive action outside disposable test infrastructure is
  required;
- credentials, account authority, billing, legal/licensing input, or a security
  incident has no safe local alternative;
- a product decision changes checkpoint, authority, privacy, distribution, or
  deployment boundaries and architecture cannot resolve it;
- the same hard blocker survives three strategies and no useful work remains; or
- acceptance genuinely requires human judgment.

Otherwise choose the safest reversible option, document it, and continue.

## P6 receipt

The P6 stopping condition is satisfied by
[`evals/reports/v0.6.0-research-topology.md`](evals/reports/v0.6.0-research-topology.md):
plan PR #39, code PR #40, code-bearing merge
`6685f193c3c2669f5cd8da8b46c78b7ffeeabf40`, final receipt PR #41,
final default-branch CI run `29303588863`, and annotated tag
`v0.6.0-research-topology`.

## Stopping condition

Before P7 implementation, stop the planning loop only when a distinct `P7_PLAN.md`
entry PR has frozen scope, authority, schemas, slices, adversarial fixtures,
verification, receipt, release label, and stopping predicates; that PR is merged;
and every implementation worktree is recreated or resynced from the merged plan
baseline. After that point, `P7_PLAN.md` becomes the stopping authority.
