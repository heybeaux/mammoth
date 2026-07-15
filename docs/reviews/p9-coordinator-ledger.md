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

| Assignment | State     | Owner/runtime           | Worktree / branch                                    | Base             | Record                       | Next                             |
| ---------- | --------- | ----------------------- | ---------------------------------------------------- | ---------------- | ---------------------------- | -------------------------------- |
| `P9-PLAN`  | producing | Scout / primary session | `/private/tmp/mammoth-p9-plan` / `plan/p9-mammoth-2` | `1de5b37`        | [P9-PLAN](#p9-plan-record)   | fix review, rerun CI, merge      |
| `P9-T0`    | blocked   | unassigned              | fresh worktree required                              | later plan merge | [P9-T0](#p9-t0-record)       | claim after plan merge           |
| `P9-T1-T6` | blocked   | unassigned              | fresh worktrees required                             | later T0 merge   | [P9-T1-T6](#p9-t1-t6-record) | claim highest unproved predicate |

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
- Handoff/integration commit: not yet available; branch head is the candidate.
- Blockers: valid review findings and exact-head CI for their resolution.
- Replacement audit: none; no replacement runtime or duplicate assignment.

### P9-T0 record

- Objective: freeze P9 fixtures, thresholds, schemas, expected artifacts, rubric,
  and the visible `verify:p9` skeleton before implementation.
- Acceptance evidence, runtime identity, worktree/base, owned/prohibited paths,
  allowed contract changes, dependencies, exact gates/results, reviewer,
  registry/artifact proofs, handoff, integration commit, and replacement audit:
  unassigned and therefore unavailable.
- Blocker: `P9-PLAN` must merge and fresh default-branch CI must pass.

### P9-T1-T6 record

- Objective: implement the highest unproved P9 predicate one accepted slice at a
  time after T0.
- Acceptance evidence, runtime identity, worktree/base, owned/prohibited paths,
  allowed contract changes, dependencies, exact gates/results, reviewer,
  registry/artifact proofs, handoff, integration commit, and replacement audit:
  unassigned and therefore unavailable.
- Blocker: `P9-T0` must merge and fresh default-branch CI must pass.

## Release evidence

Not yet available. P9 is not implemented or released.
