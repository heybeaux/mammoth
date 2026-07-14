# P8 Coordinator Ledger

This is the durable cross-turn ownership and liveness authority for P8. The
coordinator updates it from observed registry, worktree, artifact, PR, and CI
evidence. A row is not proof of liveness by itself.

## State vocabulary

`spawn requested` -> `active` -> `producing` -> `completed` -> `integrated` ->
`retired` -> `merged/verified`.

## Active delegated assignments

| Task | State | Runtime / session / run / model | Worktree / branch / base SHA | Owned paths | Dependencies | Last registry proof | Last artifact proof | Handoff / commit | Integration | Blockers / replacement audit |
| ---- | ----- | ------------------------------- | ---------------------------- | ----------- | ------------ | ------------------- | ------------------- | ---------------- | ----------- | ---------------------------- |

No implementation worker is assigned. T1-T8 delegation is blocked until the entry
plan and T0 acceptance-baseline PR merge.

## Coordinator planning record

- Task: `P8-entry-plan`
- Owner: root coordinator local work; not a delegated registry worker
- Runtime/session/run/model: `N/A` for worker liveness
- Worktree/branch/base: `/private/tmp/mammoth-turnkey-research-plan` /
  `plan/turnkey-research-product` / `2e35802`
- Owned paths: `P8_PLAN.md`, `AGENTS.md`, `LOOP.md`, `README.md`,
  `POST_MVP_ROADMAP.md`, and this ledger
- Artifact proof: commit `84fbb47`; independent product and architecture reviews
  both returned `PASS`
- State: entry-plan PR #50 open with CI pending; implementation blocked through T0
  baseline merge

## Assignment template

Copy a row above and record, before launch:

- objective and exact acceptance evidence;
- owned and prohibited paths;
- contracts allowed to change;
- integration predecessor and downstream dependents;
- exact focused, golden-path, adversarial, and clean-checkout commands;
- handoff recipient and independent reviewer.

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
