# P9 Coordinator Ledger

This is the durable ownership and evidence ledger for P9 Trustworthy General
Research. Update it from observed Git, runtime, artifact, review, and CI evidence.
Never use a branch, worktree, or accepted spawn as proof that work is active.

## Baseline

- Plan branch: `plan/p9-mammoth-2`
- Base: `origin/main` at `1de5b3764a1bbcb45b19f6690d3eb551ce791854`
- Release target: `v0.9.0-trustworthy-general-research`
- Active plan: `P9_PLAN.md`
- Product thesis: `MAMMOTH_2.md`
- Adversarial input: `ADVERSARIAL_ANALYSIS_POST_P8.md`

## Ownership

| Task                      | State     | Owner/runtime           | Worktree / branch                                    | Base             | Owned paths                                           | Evidence / blocker                                                                                  | Next                             |
| ------------------------- | --------- | ----------------------- | ---------------------------------------------------- | ---------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------- |
| P9 entry plan             | producing | Scout / primary session | `/private/tmp/mammoth-p9-plan` / `plan/p9-mammoth-2` | `1de5b37`        | entry docs, active loop, roadmap, ledger              | frozen install, format, lint, typecheck and link smoke pass; pre-PR model review notes incorporated | commit, PR, CodeRabbit, CI       |
| P9 T0 acceptance baseline | blocked   | unassigned              | fresh worktree required                              | later plan merge | fixtures, `verify:p9`, thresholds, expected artifacts | blocked until plan PR merges                                                                        | claim after merge                |
| P9 T1-T6 implementation   | blocked   | unassigned              | fresh worktrees required                             | later T0 merge   | assigned per accepted slice                           | blocked until T0 baseline merges                                                                    | claim highest unproved predicate |

## Required state fields for implementation lanes

Record task ID, objective, acceptance evidence, runtime/session/run/model,
worktree/branch/base, owned and prohibited paths, allowed contract changes,
dependencies, exact gates, reviewer, last registry proof, last artifact proof,
handoff, integration commit, blockers, and replacement audit.

## Release evidence

Not yet available. P9 is not implemented or released.
