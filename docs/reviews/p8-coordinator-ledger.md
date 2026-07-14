# P8 Coordinator Ledger

This is the durable cross-turn ownership and liveness authority for P8. The
coordinator updates it from observed registry, worktree, artifact, PR, and CI
evidence. A row is not proof of liveness by itself.

## State vocabulary

`spawn requested` -> `active` -> `producing` -> `completed` -> `integrated` ->
`retired` -> `merged/verified`.

## Active delegated assignments

Each assignment is one structured block using the assignment schema below. The
summary table indexes the blocks; the block, not the table, is the durable
record.

| Task ID | State | Assignment block |
| ------- | ----- | ---------------- |

No implementation worker is assigned. T1-T8 delegation is blocked until the entry
plan and T0 acceptance-baseline PR merge.

## Assignment schema

Every assignment block records, before launch and updated on every checkpoint:

```text
Task ID:
Objective:
Acceptance evidence required:
State:                        # spawn requested | active | producing | completed
                              # | integrated | retired | merged/verified
Runtime / session / run / resolved model:
Worktree / branch / base SHA:
Owned paths:
Prohibited paths:
Contracts allowed to change:
Dependencies / integration predecessor:
Exact verification commands:  # focused, golden-path, adversarial, clean-checkout
Handoff recipient:
Independent reviewer:
Last registry proof:
Last artifact proof:
Handoff / commit:
Integration:
Blockers / replacement audit:
```

## Coordinator planning record

```text
Task ID: P8-entry-plan
Objective: freeze the P8 entry contract (plan, worker contract, loop, ledger,
  roadmap/readme reconciliation) and merge it as PR #50
Acceptance evidence required: PR #50 merged to main with exact-head CI green and
  actionable review findings resolved; independent product and architecture
  reviews recorded
State: producing (entry-plan PR #50 open; CI running)
Runtime / session / run / resolved model: root coordinator local work; not a
  delegated registry worker (N/A for worker liveness)
Worktree / branch / base SHA: /private/tmp/mammoth-turnkey-research-plan /
  plan/turnkey-research-product / 2e35802
Owned paths: P8_PLAN.md, AGENTS.md, LOOP.md, README.md, POST_MVP_ROADMAP.md,
  docs/reviews/p8-coordinator-ledger.md
Prohibited paths: packages/**, apps/**, evals/**, scripts/**, infra/**,
  .github/**, pnpm-lock.yaml (no implementation before T0 merge)
Contracts allowed to change: none (documentation-only entry contract)
Dependencies / integration predecessor: merged P7 baseline 2e35802; no
  downstream dependents until the T0 acceptance-baseline PR
Exact verification commands: pnpm format:check; git diff --check; default-branch
  CI ladder unchanged (docs-only diff); no p8 gate exists yet by design
Handoff recipient: P8 coordinator (self-integrated after review)
Independent reviewer: independent product review and independent architecture
  review, both returned PASS before PR; CodeRabbit review on PR #50
Last registry proof: N/A (coordinator-local work, not a registry worker)
Last artifact proof: commits 84fbb47, a13e751
Handoff / commit: PR #50 (plan/turnkey-research-product)
Integration: pending exact-head CI green and review reconciliation
Blockers / replacement audit: none
```

## Replacement audit

Before reassigning a task, append evidence that the prior worker is terminal or
absent in its own runtime registry; record session/process inspection, worktree
status/diff/fresh timestamps, preserved artifacts or commits, lease retirement,
and the new fresh worktree/base. Never overwrite the original row or reuse its
worktree concurrently.

## Turn checkpoint

At each coordinator turn record or verify: `origin/main`, relevant PR/CI state,
OpenClaw registry, Codex-native registry, assigned worktrees/branches/processes,
fresh artifacts, ownership conflicts, integration state, and the highest unproved
P8 stopping predicate.
