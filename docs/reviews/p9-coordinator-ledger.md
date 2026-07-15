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

| Assignment | State   | Owner/runtime             | Worktree / branch                                                           | Base           | Record                       | Next                          |
| ---------- | ------- | ------------------------- | --------------------------------------------------------------------------- | -------------- | ---------------------------- | ----------------------------- |
| `P9-PLAN`  | merged  | Scout / primary session   | `/private/tmp/mammoth-p9-plan` / `plan/p9-mammoth-2`                        | `1de5b37`      | [P9-PLAN](#p9-plan-record)   | complete                      |
| `P9-T0`    | merged  | Scout / cron continuation | `/private/tmp/mammoth-p9-t0-baseline` / `acceptance/p9-t0-baseline`         | `2aeb3db`      | [P9-T0](#p9-t0-record)       | complete                      |
| `P9-T1`    | review  | Scout / primary session   | `/private/tmp/mammoth-p9-t1-budget-metadata` / `feat/p9-t1-budget-metadata` | `5db0fc9`      | [P9-T1](#p9-t1-record)       | resolve review; exact-head CI |
| `P9-T2-T6` | blocked | unassigned                | fresh worktrees required                                                    | later T1 merge | [P9-T2-T6](#p9-t2-t6-record) | claim after accepted T1 merge |

## Required state fields for implementation lanes

Record task ID, objective, acceptance evidence, runtime/session/run/model,
worktree/branch/base, owned and prohibited paths, allowed contract changes,
dependencies, exact gates, reviewer, last registry proof, last artifact proof,
handoff, integration commit, blockers, and replacement audit.

### P9-PLAN record

- Objective: freeze the Mammoth 2.0 boundary and P9 entry acceptance contract.
- Acceptance evidence: the seven entry artifacts listed in `P9_PLAN.md` T0;
  exact-head CI; CodeRabbit review with every valid finding resolved.
- Runtime identity: Scout primary Telegram session; no delegated runtime, child
  session, run, or model owns this assignment.
- Worktree/branch/base: `/private/tmp/mammoth-p9-plan`;
  `plan/p9-mammoth-2`; `1de5b3764a1bbcb45b19f6690d3eb551ce791854`.
- Owned paths: `AGENTS.md`, `LOOP.md`, `MAMMOTH_2.md`, `P9_PLAN.md`,
  `POST_MVP_ROADMAP.md`, ADR 0011, and this ledger.
- Prohibited paths: runtime/package implementation, frozen P8 fixtures, release
  receipts, unrelated user changes, and external repositories.
- Allowed contract changes: entry documentation only; no implementation or
  release claim.
- Dependencies: P8 main `1de5b37`; post-P8 adversarial assessment; human approval.
- Verification results at reviewed head `d24c6a6`: `pnpm install
--frozen-lockfile` PASS; `pnpm format:check` PASS; `pnpm lint` PASS;
  `pnpm typecheck` PASS; `git diff --check` PASS; documentation link/artifact
  smoke check PASS; GitHub CI run `29380622975` PASS. Any later head requires its
  own exact-head results before merge.
- Reviewer: CodeRabbit plus human merge authority. Review findings and their
  resolution remain on PR #60.
- Registry/artifact proof: no worker registry claim applies; Git head, PR #60,
  changed artifacts, local results, and GitHub checks are the proofs.
- Handoff/integration commit: merged by PR #60 as `2aeb3db`.
- Blockers: none; merged-main CI `29381683709` passed.
- Replacement audit: none; no replacement runtime or duplicate assignment.

### P9-T0 record

- Objective: freeze P9 fixtures, thresholds, schemas, expected artifacts, rubric,
  receipt schema, and the visible `verify:p9` skeleton before implementation.
- Acceptance evidence: four canonical plans; unrelated report fixture; 21 hostile
  cases; thresholds; expected artifacts; rubric; closed receipt schema; verifier
  manifest; executable T0 baseline verifier.
- Runtime identity: Scout cron continuation; no delegated worker or replacement
  runtime owned the lane.
- Worktree/branch/base: `/private/tmp/mammoth-p9-t0-baseline`;
  `acceptance/p9-t0-baseline`; `2aeb3db`.
- Owned paths: `evals/fixtures/p9`, `scripts/verify-p9.ts`, root verifier wiring,
  CI verifier step, and this ledger.
- Prohibited paths: T1-T6 runtime implementation, P8 fixtures, release receipts,
  and unrelated changes.
- Contracts changed: frozen `p9.v1` acceptance inputs and receipt schema only.
- Dependencies: merged P9 plan and green main CI `29381683709`.
- Verification: fresh frozen install plus format, lint, typecheck, test, build,
  `pnpm verify:p9`, and PR CI passed at head `e254f8f`; merged-main CI
  `29383000905` passed the complete ladder at `5db0fc9`.
- Reviewer: CodeRabbit reported pass on PR #61; human merge authority merged it.
- Registry/artifact proof: Git head, PR #61, frozen artifacts, verifier output,
  and exact merged-main CI; no live worker claim remains.
- Handoff/integration commit: PR #61 merged as `5db0fc9`.
- Blocker: none.
- Replacement audit: none.

### P9-T1 record

- Objective: implement hard pre-transport budgets and truthful source metadata,
  rights, robots, cost, and terminal retrieval residue without beginning T2.
- Acceptance evidence: executable `verify:p9` T1 gate; focused domain,
  governance, and retrieval tests for all eight frozen T1 hostile cases; exact
  diff review; clean-checkout ladder; exact-head PR CI and review.
- Runtime identity: Scout primary Telegram session; no delegated runtime, child
  session, run, or model owns this assignment.
- Worktree/branch/base: `/private/tmp/mammoth-p9-t1-budget-metadata`;
  `feat/p9-t1-budget-metadata`; exact merged T0 `5db0fc9`.
- Owned paths: P9 domain contracts; governance P9 budget authority and tests;
  retrieval P9 metadata/residue and tests; `scripts/verify-p9.ts`; package/lock
  dependency wiring; this ledger.
- Prohibited paths: P8 live runtime behavior, T2 network/DNS/redirect/parser
  implementation, T3 entailment, T4 planning, T5 composition, release/tag work,
  frozen T0/P8 fixture contents, and unrelated changes.
- Allowed contract changes: T1 subset of `p9.v1` only: cost bounds/catalogs,
  source date/robots/rights observations, retrieval attempts/failures/residue.
- Dependencies: merged T0 `5db0fc9`; merged-main CI `29383000905` passed.
- Exact gates: focused package tests; format; lint; typecheck; full tests; build;
  `pnpm verify:p8`; `pnpm verify:p9`; clean-checkout frozen install and repeat.
- Current local results: focused T1 tests PASS (governance 11, retrieval 10);
  format PASS; lint PASS; typecheck PASS; full workspace tests PASS; build PASS;
  P8 regression PASS; `verify:p9` PASS with `T1_budget_metadata=pass` and
  T2-T6 still blocked. Detached clean checkout at `08c5aac` passed a frozen
  install and the same complete ladder with a clean worktree. A repeat at the
  final review-fix head is pending.
- Reviewer: PR #62. CodeRabbit reviewed `5530eb4` and posted nine actionable
  findings; hardened implementation candidate `da9ada4` addresses them. Review
  confirmation and exact-latest-head CI are pending.
- Registry/artifact proof: current-session Git worktree, branch, diff, test output,
  verifier output, PR head, and CI. No worker registry claim applies.
- Handoff/integration candidate: `da9ada4`; PR #62; merge commit unavailable.
- Blockers: review confirmation and exact-head CI remain pending.
- Replacement audit: none.

### P9-T2-T6 record

- Objective: continue one accepted slice at a time after T1.
- State: blocked and unassigned.
- Blocker: P9 T1 must merge and fresh default-branch CI must pass.

## Release evidence

Not yet available. P9 is not implemented or released.
