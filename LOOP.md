# Autonomous Delivery Loop

## Mission

P5 `v0.5.0-isolated-divergence` is merged, verified, tagged, and recorded under
`P5_PLAN.md`. Operate from that baseline toward P6 broader research topology only
after the P6 acceptance contract is frozen. Preserve the P2 Postgres/CAS
authority boundary, P3 Temporal control plane, P4 research-cell/model-lineage
contracts, and P5 isolated-divergence/blind-review contracts.

Routine reversible choices, ADR-backed decisions, delegation, PRs, reviews, CI
repair, and sequencing do not require human contact.

## Roles and ownership

- **Coordinator/integrator:** contracts, priorities, ownership, integration, CI,
  receipt, release, and checkpoint decision.
- **Isolation/policy builder:** commit/reveal state machine, sanitized context,
  assignment, correlation, dissent, residue, and adversarial fixtures.
- **Persistence/budget builder:** ports, migrations, constraints, fencing,
  reservations, settlements, receipts, and restart evidence.
- **Workflow/projection builder:** divergence/review workflows, Activities,
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
   `P5_PLAN.md`, ADRs, migrations, receipts, and the highest unproved predicate.
2. **Claim** — freeze the smallest testable slice, owner, paths, dependencies,
   contract impact, adversarial risks, commands, and independent reviewer.
3. **Delegate** — use path-disjoint durable workers and prove actual liveness.
4. **Build** — isolation/review contracts first, then persistence and budgets,
   Temporal execution/recovery, projection/operator inspection, and acceptance.
5. **Attack** — exercise early peer exposure, reviewer-context leakage,
   self-review, correlated panels, criterion drift, dissent deletion, duplicate
   delivery/charges, reservation overspend, partial cancellation, migration
   interruption, stale fencing, future authority, and restart at every boundary.
6. **Review** — inspect dependency direction, hidden stores, authority drift,
   deleted rejection residue, direct adapter imports, Temporal shadow state,
   projection writes, fake receipts, process-order "isolation," and hidden
   author/popularity/verdict fields.
7. **Verify** — run focused gates, `pnpm verify:p5`, and the full clean-checkout
   ladder; capture exact evidence in the receipt.
8. **Integrate** — resolve without discarding work, push, open a PR, repair CI,
   resolve independent findings, merge, and verify `main`.
9. **Reconcile** — update plan, roadmap, receipt, and tag only from executed proof.
10. **Continue** — a green slice or PR is not a pause point while any stopping
    predicate remains false.

Git constraints, database state, verifier output, CI, integrity digests, and
receipts outrank prose or worker confidence.

## Dependency order

```text
P4 reconfirmation
  -> P5 isolation/review contract freeze
  -> authoritative persistence and budget lifecycle
  -> Temporal divergence/review execution and recovery
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

- the full P5 stopping condition is satisfied;
- an irreversible/destructive action outside disposable test infrastructure is
  required;
- credentials, account authority, billing, legal/licensing input, or a security
  incident has no safe local alternative;
- a product decision changes checkpoint, authority, privacy, distribution, or
  deployment boundaries and architecture cannot resolve it;
- the same hard blocker survives three strategies and no useful work remains; or
- acceptance genuinely requires human judgment.

Otherwise choose the safest reversible option, document it, and continue.

## P5 receipt

The P5 stopping condition is satisfied by
[`evals/reports/v0.5.0-isolated-divergence.md`](evals/reports/v0.5.0-isolated-divergence.md):
entry PR #36, code PR #37, code-bearing merge
`0cd81f86f1c893f06ff06c88c683e6f84234dbbf`, default-branch CI run
`29294543576`, and annotated tag `v0.5.0-isolated-divergence`.

## Stopping condition

For the next checkpoint, stop only when its frozen plan's gates and fixtures pass;
the clean-checkout ladder is green; required independent review is resolved and
re-reviewed; the checkpoint verifier is enforced in default-branch CI; the PR is
merged; post-merge `main` CI is green; the receipt is exact and merged; and the
release tag points to the code-bearing merge.
