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

| Task ID                   | State           | Assignment block |
| ------------------------- | --------------- | ---------------- |
| P8-T0-acceptance-baseline | merged/verified | see below        |
| P8-T1-T8-turnkey-slice    | merged/verified | see below        |

T1-T8 implementation was completed by the release controller in
`/private/tmp/mammoth-p8-integration`. No other P8 worker owned the worktree
during the final live exhibition and receipt sequence.

```text
Task ID: P8-T1-T8-turnkey-slice
Objective: implement the P8 natural-language research command, p8.v1 contracts,
  deterministic offline discovery/acquisition/admission/report publication,
  verifier, CI hook, and proof bundle for the data-center golden question
Acceptance evidence required: the golden command writes the complete report
  bundle; pnpm verify:p8 proves every factual sentence has claim/policy/locator/
  snapshot/lineage provenance, mandatory topics are covered, follow-up cycle,
  contradiction, rejected residue, limitations, and costs are visible; prior
  phase gates remain green; CI includes the P8 verifier
State: merged/verified (offline slice PR #52 merged, live Brave-backed repair
  PR #53 merged, authorized live exhibition produced the complete receipt-bearing
  bundle, independent editorial review was non-blocking, annotated tag
  v0.8.0-turnkey-research object bf1eaa74f25005f04bdfb29dcac28cdc36c4a46d
  targets the code-bearing merge, and the receipt-only PR records the final
  evidence)
Runtime / session / run / resolved model: OpenClaw managed TaskFlow
  391de2f2-e399-4c36-8013-22e1769e3c1a / qwen subagent
Worktree / branch / base SHA: /private/tmp/mammoth-p8-integration /
  receipt/p8-turnkey-release / 2b2b41321a06e5d7cea7070f38a8d2a1fd945a25
Owned paths: packages/domain/src/p8.ts, packages/domain/src/index.ts,
  packages/runtime/src/p8-turnkey.ts, packages/runtime/src/index.ts,
  apps/cli/src/bin.ts, apps/cli/src/p8-operator.ts, scripts/verify-p8.ts,
  package.json, .github/workflows/ci.yml, research/data-center-impacts/**
Prohibited paths: existing P2-P7 verifier semantics except compatibility fixes;
  no generated build output
Contracts allowed to change: add p8.v1 domain contracts and non-recursive
  verify:p8 script/CI step
Dependencies / integration predecessor: T0 merge commit 3fd25b7; P7 command
  compatibility retained by routing existing P7 run IDs to the P7 operator
Exact verification commands: PR #52 exact-head CI run 29358048198 passed on
  814a6ad and merged-main CI run 29358953839 passed on 0109b3a. Independent
  non-author review on 0109b3a was BLOCKING, so PR #53 added the authorized live
  Brave-backed path. PR #53 exact-head CI run 29362369844 passed on
  54f9a1dbfb169b8ec3c92bfd2caf05f5641b833c and merged as
  2b2b41321a06e5d7cea7070f38a8d2a1fd945a25. Code-bearing main CI run
  29363234888 verified the clean checkout ladder through visible
  pnpm verify:p8. Live commands: pnpm mammoth research doctor returned ok with
  credential and billing authorization; the exact data-center ask command wrote
  research/data-center-impacts with run p8-run:6202fc8f432b8aeb, manifest digest
  sha256:6202fc8f432b8aebd3edc0628ae763061bf5c6e33abaefcd6160585b2718c3c2,
  receipt digest
  sha256:82545b8c737516b2384cd48672267a5220c1d3003826bbd2fa87c1e5a5951d6e.
  pnpm mammoth research inspect returned the same run and digests; secret leak
  and locator/snapshot audits passed; screenshots were captured under
  research/data-center-impacts/screenshots/.
Handoff recipient: P8 release controller/integrator
Independent reviewer: 2026-07-14 Codex non-author review on main 0109b3a:
  BLOCKING, resolved by PR #53 and exact-head CI. Exact live-bundle editorial
  review in research/data-center-impacts/independent-review.json: verdict
  pass_with_notes, blockers none, digest
  sha256:d795cdec1530d70540bc53ebfa8c162d3d1cd6bdd33e5ee90a0d0a5632d7166d.
Last registry proof: release controller active in TaskFlow
  391de2f2-e399-4c36-8013-22e1769e3c1a
Last artifact proof: live bundle research/data-center-impacts, screenshots,
  independent-review.json, and release receipt
  evals/reports/v0.8.0-turnkey-research.md.
Handoff / commit: PR #53 merged as
  2b2b41321a06e5d7cea7070f38a8d2a1fd945a25; receipt-only PR records final
  evidence, tag, screenshots, and documentation truth updates.
Integration: P8 is release-complete at the local CLI/product-receipt layer. The
  deterministic offline verifier remains fixture-backed; the live Brave-backed
  exhibition is separately authorized and receipt-bearing.
Blockers / replacement audit: none remaining for P8. Future hosted API, desktop
  UI, Observatory visualization, Parliament provider execution, and broader
  production operations claims remain out of P8 scope.
```

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
State: merged/verified (PR #51 squash-merged to main as 3fd25b7)
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
  (independent digest recomputation: 32 source rawDigests including hostile
  fixture bytes, corpus and hostile manifestDigests, 8 verifier inputDigests,
  verifier manifestDigest — all OK after review-fix regeneration);
  per-topic family-independence recount over admissible sources (all 10
  mandatory topics >= 2 families); pnpm format:check (clean); pnpm lint and
  pnpm typecheck (clean); exact-head CI ladder through pnpm verify:p7 on PR #51
Handoff recipient: P8 coordinator (integration, review reconciliation, merge)
Independent reviewer: independent non-author adversarial review against
  P8_PLAN T0 contract — verdict PASS with findings; 2 MAJOR + 6 MINOR/NIT
  findings all resolved by strengthening frozen fixtures (committed hostile
  bytes + digest-pinned generator parameters; irrelevant-source seeded
  rejection; unified rejection-reason vocabulary; stopReason/artifact schema
  completion; hostileFixtures wired into verifier inputs); CodeRabbit automated
  findings were reconciled in c7ba4d3 and exact-head CI passed
Last registry proof: worker session ended after push (branch and PR are the
  durable handoff; no live registry entry claimed)
Last artifact proof: commits 5d425d3, a7e2565, a1544c6, bb6fe6e, c7ba4d3 on
  origin/t0/acceptance-baseline; PR #51 merged
Handoff / commit: PR #51 (t0/acceptance-baseline, head c7ba4d3; merge commit
  3fd25b72b4e55496f673226f756c406812da5b87)
Integration: coordinator digest re-verification and topic-coverage audit passed
  2026-07-14; independent review findings resolved through c7ba4d3 and
  re-verified 2026-07-14 (format:check, lint, typecheck, full pnpm test all
  clean locally); exact-head PR CI run 29355690240 passed before merge
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
