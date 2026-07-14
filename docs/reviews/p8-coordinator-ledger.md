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

| Task ID                   | State                                            | Assignment block |
| ------------------------- | ------------------------------------------------ | ---------------- |
| P8-T0-acceptance-baseline | completed (PR #51 under coordinator integration) | see below        |

No T1-T8 implementation worker is assigned. T1-T8 delegation is blocked until the
T0 acceptance-baseline PR merges; implementation worktrees are then recreated
from the T0 merge commit.

```text
Task ID: P8-T0-acceptance-baseline
Objective: freeze the P8 acceptance baseline before any T1-T8 implementation:
  both golden corpus manifests with digest-pinned source bytes, coverage/
  sufficiency thresholds, independent-source-family diversity thresholds, typed
  expected artifacts, editorial rubric, adversarial expected outcomes, verifier
  manifest, receipt schemas, version/identity ADR, and search-provider spike
  report with adapter/robots/licensing/credential-preflight/fallback ADR
Acceptance evidence required: PR #51 merged to main with exact-head CI green
  (full existing ladder through pnpm verify:p7); independent digest
  re-verification; independent non-author review with blocking findings
  resolved; both black-box acceptance paths mechanically measurable from the
  frozen fixtures alone
State: completed (handoff = PR #51; coordinator review and CI in progress)
Runtime / session / run / resolved model: OpenClaw coordinator-session worker,
  claude-cli/claude-fable-5 (same runtime family as coordinator; commits
  5d425d3/a7e2565 authored 2026-07-14 10:20-10:25 PDT, pushed before handoff)
Worktree / branch / base SHA: /private/tmp/mammoth-t0-baseline /
  t0/acceptance-baseline / 86fff91 (merged PR #50 head of main)
Owned paths: evals/fixtures/p8/**, docs/adr/0009*, docs/adr/0010*,
  docs/reviews/p8-search-provider-spike.md, .prettierignore, .gitattributes,
  docs/reviews/p8-coordinator-ledger.md (this record, coordinator-applied)
Prohibited paths: packages/**, apps/**, scripts/**, .github/**, pnpm-lock.yaml,
  all P2-P7 fixtures and verifiers (no product code before T0 merge)
Contracts allowed to change: none existing; introduces frozen p8.v1 acceptance
  fixtures and ADRs only
Dependencies / integration predecessor: merged entry plan PR #50 (86fff91);
  successor: T1 contract-freeze gate and all T1-T8 lanes resync from T0 merge
Exact verification commands: node /private/tmp/t0-audit/verify-digests.cjs
  (independent digest recomputation: 28 source rawDigests, 2 corpus
  manifestDigests, 7 verifier inputDigests, verifier manifestDigest — all OK);
  per-topic family-independence recount over admissible sources (all 10
  mandatory topics >= 2 families); pnpm format:check; exact-head CI ladder
  through pnpm verify:p7 on PR #51
Handoff recipient: P8 coordinator (integration, review reconciliation, merge)
Independent reviewer: independent non-author adversarial review against
  P8_PLAN T0 contract (recorded in PR #51 thread) plus CodeRabbit automated
  review (SUCCESS)
Last registry proof: worker session ended after push (branch and PR are the
  durable handoff; no live registry entry claimed)
Last artifact proof: commits 5d425d3, a7e2565 on origin/t0/acceptance-baseline;
  PR #51 open against main
Handoff / commit: PR #51 (t0/acceptance-baseline, head a7e2565)
Integration: coordinator digest re-verification and topic-coverage audit passed
  2026-07-14; merge pending exact-head CI green and independent review
Blockers / replacement audit: none; original worktree preserved and reused only
  by the coordinator for integration
```

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
State: merged/verified (PR #50 squash-merged to main as 86fff91)
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
Integration: merged to main 2026-07-14 as 86fff911ff581aa45cc16d27b8f56db3b04f6b5c
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
