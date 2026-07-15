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

| Assignment | State   | Owner/runtime             | Worktree / branch                                                                     | Base      | Record                     | Next                    |
| ---------- | ------- | ------------------------- | ------------------------------------------------------------------------------------- | --------- | -------------------------- | ----------------------- |
| `P9-PLAN`  | merged  | Scout / primary session   | `/private/tmp/mammoth-p9-plan` / `plan/p9-mammoth-2`                                  | `1de5b37` | [P9-PLAN](#p9-plan-record) | complete                |
| `P9-T0`    | merged  | Scout / cron continuation | `/private/tmp/mammoth-p9-t0-baseline` / `acceptance/p9-t0-baseline`                   | `2aeb3db` | [P9-T0](#p9-t0-record)     | complete                |
| `P9-T1`    | merged  | Scout / primary session   | `/private/tmp/mammoth-p9-t1-budget-metadata` / `feat/p9-t1-budget-metadata`           | `5db0fc9` | [P9-T1](#p9-t1-record)     | complete                |
| `P9-T2`    | merged  | Scout / primary session   | `/private/tmp/mammoth-p9-t2-safe-acquisition` / `feat/p9-t2-safe-acquisition`         | `60e2da8` | [P9-T2](#p9-t2-record)     | complete                |
| `P9-T3`    | merged  | Scout / primary session   | `/private/tmp/mammoth-p9-t3-entailment-admission` / `feat/p9-t3-entailment-admission` | `bbc6b38` | [P9-T3](#p9-t3-record)     | complete                |
| `P9-T4`    | merged  | Scout / OpenClaw subagent | `/private/tmp/mammoth-p9-t4-planning` / `feat/p9-t4-planning`                         | `33d291f` | [P9-T4](#p9-t4-record)     | complete                |
| `P9-T5`    | merged  | Scout / OpenClaw subagent | `/private/tmp/mammoth-p9-t5-review-remediation` / `fix/p9-t5-review-remediation`      | `86f5c30` | [P9-T5](#p9-t5-record)     | complete                |
| `P9-T6`    | blocked | Scout / primary session   | `/private/tmp/mammoth-p9-t6-live-authority` / `feat/p9-t6-live-authority`             | `fe0c96f` | [P9-T6](#p9-t6-record)     | explicit live authority |

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
- Final verification: focused T1 tests PASS (governance 11, retrieval 10);
  format PASS; lint PASS; typecheck PASS; full workspace tests PASS; build PASS;
  P8 regression PASS; `verify:p9` PASS with `T1_budget_metadata=pass` and
  T2-T6 still blocked. The final detached clean checkout passed frozen install
  and the complete ladder with a clean worktree. Exact-head CI `29384727715`
  passed, and merged-main CI `29385262997` passed in 13m02s.
- Reviewer: PR #62. CodeRabbit posted nine actionable findings; all were fixed
  and every review thread was resolved before merge.
- Registry/artifact proof: current-session Git worktree, branch, diff, test output,
  verifier output, PR head, and CI. No worker registry claim applies.
- Handoff/integration: PR #62 merged as
  `43498347032aeab9162ccb102f425a24498b67c6`.
- Blockers: none.
- Replacement audit: none.

### P9-T2 record

- Objective: implement hosted-safe acquisition and bounded parser authority,
  including policy-pinned DNS/redirect transport and explicit PDF rejection.
- Acceptance evidence: the frozen T2 network/parser hostile corpus fails closed;
  exact policy and parser receipts expose every terminal decision; no private host
  access, rebinding, origin drift, proxy bypass, binary-as-text, or hidden omission.
- Runtime identity: Scout primary Telegram session; Codex root runtime with no
  delegated child session or run ID; resolved model identity is not exposed to
  the repository runtime.
- Worktree/branch/base: `/private/tmp/mammoth-p9-t2-safe-acquisition`;
  `feat/p9-t2-safe-acquisition`; exact merged CI optimization `60e2da8`.
- Owned paths: retrieval acquisition/security/parser modules and tests; the T2
  subset of P9 domain contracts if required; `scripts/verify-p9.ts`; this ledger;
  root dependency wiring only if required by the parser implementation.
- Prohibited paths: P8 fixture semantics, T3 entailment/admission, T4 planning,
  T5 generic composition, T6 exhibition/release/tag work, frozen T0 fixture
  contents, unrelated user changes, and external repositories.
- Allowed contract changes: T2 subset of `p9.v1`: media support decisions,
  parser receipts, redirect-hop/network policy receipts, and pinned transport
  input/output contracts. P8 identities remain unchanged.
- Dependencies: P9 T1 merged as `4349834`; merged-main T1 CI `29385262997`
  passed; CI parallelization PR #63 merged as `60e2da8`; its merged-main CI
  `29386674999` passed every lane and the aggregate check in 4m20s.
- Exact gates: focused retrieval/security/parser tests; format; lint; typecheck;
  full tests; build; `pnpm verify:p8`; `pnpm verify:p9`; detached clean-checkout
  frozen install and repeat before merge recommendation.
- Current local results: retrieval tests PASS (37 tests, including 18 T2 hostile
  acquisition/parser cases); format PASS; lint PASS; typecheck PASS; full
  workspace tests PASS; build PASS; P8 regression PASS; `verify:p9` PASS with T2
  acquisition/parsers enabled and T3-T6 still blocked. A detached clean checkout
  of the committed implementation passed a frozen install and the same complete
  ladder with a clean worktree.
- Reviewer: CodeRabbit remained pending and produced no findings or completed
  review before merge; this is recorded as no reviewer result, not approval.
  Exact-head PR CI `29388313735` passed every lane in 4m29s.
- Registry/artifact proof: current-session Git worktree at exact base, frozen
  install, ledger assignment, attributable diffs/tests, PR head, and CI. No child
  worker registry claim applies. Fresh merged-main CI `29388542063` passed every
  lane and the aggregate check in 4m21s.
- Handoff/integration: PR #64 merged as
  `bbc6b38988ac5e6ae12aa0161b4ccfb5f8618927`.
- Blockers: none.
- Replacement audit: none.

### P9-T3 record

- Objective: implement distinct claim-proposal and entailment-evaluator work,
  hostile-span defenses, deterministic semantic-delta admission, independent
  profile policy, factual-sentence render gating, and preserved rejection residue.
- Acceptance evidence: the frozen T3 entailment and prompt-injection cases fail
  closed; correct contradiction remains contradicted; unsupported rewrites cannot
  render; exact accepted verdicts bind statement, quote, context, locator,
  snapshot, work identities, raw-response identities, and profile families.
- Runtime identity: Scout primary Telegram session; Codex root runtime with no
  delegated child session or run ID; resolved model identity is not exposed to
  the repository runtime.
- Worktree/branch/base: `/private/tmp/mammoth-p9-t3-entailment-admission`;
  `feat/p9-t3-entailment-admission`; exact merged T2 `bbc6b38`.
- Owned paths: P9 entailment/admission domain contracts; evidence policy module
  and tests; `scripts/verify-p9.ts`; evidence package/lock wiring; this ledger.
- Prohibited paths: T4 planning, T5 generic execution/composition, T6 live
  exhibition/release/tag work, frozen T0/P8 fixtures, unrelated user changes,
  and external repositories.
- Allowed contract changes: T3 subset of `p9.v1`: proposal/evaluator work refs,
  exact entailment inputs/verdicts, semantic deltas, admissions, and residue.
- Dependencies: P9 T2 merged as `bbc6b38`; merged-main CI `29388542063` passed
  every lane and the aggregate check in 4m21s.
- Exact gates: focused domain/evidence tests; format; lint; typecheck; full tests;
  build; `pnpm verify:p8`; `pnpm verify:p9`; detached clean-checkout frozen
  install and repeat before merge recommendation.
- Current local results: evidence tests PASS (24 tests, including 17 T3
  entailment/admission cases); format PASS; lint PASS; full workspace typecheck
  PASS; full workspace tests PASS; build PASS; P8 regression PASS; `verify:p9`
  PASS with T3 entailment enabled and T4-T6 still blocked. The first focused
  runtime test exposed a missing direct `@mammoth/domain` dependency in the
  evidence package; the package manifest and lockfile now declare it, and a
  frozen install is required in the detached clean-checkout proof.
- Detached clean-checkout result: the committed candidate passed
  `pnpm install --frozen-lockfile`, format, lint, full workspace typecheck, full
  workspace tests, build, P8 regression, and `verify:p9`; the worktree was clean
  after restoring the known install-induced CLI mode toggle.
- Reviewer: PR #65. CodeRabbit's check was green but its comment said review was
  rate-limited, so it produced no substantive findings or approval.
- Registry/artifact proof: current-session fresh worktree, exact base, frozen
  install, attributable diff/tests, PR head, and CI. No child worker claim applies.
- Handoff/integration: PR #65 merged as
  `33d291f0f9046bbd3e12e446ea64734f6ea09e47`; merged-main CI `29415848385`
  passed every lane and the aggregate check.
- Blockers: none at assignment time.
- Replacement audit: none.

### P9-T4 record

- Objective: implement typed question-derived planning: proposal validation,
  preview, immutable acceptance, linked revisions, four domain policy packs, and
  plan-derived search, coverage, contradiction, freshness, stop, outline, and
  budget fields.
- Acceptance evidence: the three frozen unrelated non-data-center plan fixtures
  plus a T4-owned `general-web/v1` proposal produce materially different accepted
  plans covering all four policy packs with distinct identities; a structurally
  valid template swap that ignores the question is rejected; forbidden data-center
  vocabulary cannot leak into unrelated plans; closed schemas reject future
  fields; material changes create linked revisions that invalidate downstream
  work.
- Runtime identity: Scout OpenClaw subagent session
  `agent:scout:subagent:eee6346d-761a-4742-b039-9a3cd205eb1b`; requester run
  `5387bca6-d44d-4d94-ae35-8a04c2c664a3`; resolved model identity is not
  exposed to the repository runtime. This retry inherited a timed-out partial
  worktree, inspected its diff, repaired it, and preserved useful output.
- Worktree/branch/base: `/private/tmp/mammoth-p9-t4-planning`;
  `feat/p9-t4-planning`; exact merged T3
  `33d291f0f9046bbd3e12e446ea64734f6ea09e47`.
- Owned paths: P9 planning domain contracts; governance plan authority and domain
  policy packs; focused planning tests; `scripts/verify-p9.ts`; this ledger.
- Prohibited paths: T5 generic execution/composition, T6 live exhibition/release/
  tag work, frozen T0/P8 fixture contents, unrelated user changes, external
  repositories, and future solver execution.
- Allowed contract changes: T4 subset of `p9.v1`: `ResearchPlanProposal`,
  `ResearchPlan`, `DomainPolicyPack`, plan derivations, plan acceptance receipt,
  plan revision record, and planning verifier wiring. P8 and T1-T3 identities
  remain unchanged.
- Dependencies: P9 T3 merged as `33d291f`; merged-main T3 CI `29415848385`
  passed every lane and the aggregate check.
- Exact gates: focused domain/governance planning tests; format; lint; typecheck;
  full tests; build; `pnpm verify:p8`; `pnpm verify:p9`; detached clean-checkout
  frozen install and repeat before merge recommendation.
- Current local results: domain planning tests PASS (9); governance plan-authority
  tests PASS (16); format PASS; lint PASS; typecheck PASS; full workspace tests
  PASS; build PASS; P8 regression PASS; `verify:p9` PASS with T4 planning enabled
  and T5-T6 still blocked. The known install-induced
  `packages/temporal-adapter/src/research-cli.ts` mode toggle was restored before
  staging.
- Reviewer: PR #66. CodeRabbit posted 11 actionable comments; the branch added
  structured reason contracts, duplicate-ID checks, exact token derivation,
  stricter revision authority, frozen preview identity, payload-bound proposer
  work digests, four-pack verifier coverage, localization field checks, and
  ledger replacement detail. Exact-head CI must be re-run at the final head.
- Registry/artifact proof: OpenClaw subagent assignment, exact-base worktree,
  frozen install, attributable diff/tests, verifier output, and later PR/CI. The
  previous failed/timed-out attempt was replaced only after this retry inspected
  the same worktree and took ownership of its partial artifacts.
- Handoff/integration: PR #66 merged as
  `d5b8c3b9e431ec7de7211eb51f5fbc066e24c75f`; README PR #67 then merged as
  `ff034823cc460d774642dbe9144c5ecd0ace35d5`. Fresh current-main CI
  `29421678055` passed every lane and the aggregate check.
- Blockers: none at assignment time.
- Replacement audit: previous model attempt failed/timed out after creating the
  correct worktree and partial T4 diff. The requester supplied the retry as a
  terminal replacement event for that attempt; no active registry entry remained
  available in this subagent context. Handoff recipient is the P9 coordinator
  parent session; independent reviewer is PR #66/CodeRabbit plus exact-head CI.
  This coordinator verified branch/base and status before continuing; no parallel
  live worker was claimed.

### P9-T5 record

- Objective: implement generic execution and plan-relative verification by
  composing an accepted plan into discovery, budgeted acquisition, parser
  receipts, independent entailment admission, cycle stop checks, admitted-only
  reporting, complete unrelated offline report artifacts, P8 regression, and a
  negative canned-prose coverage proof.
- Acceptance evidence: data-center P8 regression remains green; the frozen
  technical Colibri offline corpus produces a covered report against the
  accepted technical plan; a dense data-center corpus with entailed claims fails
  coverage and forbidden vocabulary under that same plan; `verify:p9` reports
  `T5 generic_execution=pass`.
- Runtime identity: Scout OpenClaw subagent session
  `agent:scout:subagent:acb0ab44-1153-4ce8-86b3-131f2c9b23d5`; requester
  session `agent:scout:telegram:direct:8274834197`; initial coordinator run
  `570424fd-2fe3-4686-ad56-3c00cf4db71c`; review-remediation restart run
  `e73860fa-989a-4999-b5ea-52801a195193`; recorded model
  `openai-codex/gpt-5.5`. The focused review-fix worker was Codex-native task
  `/root/p9_t5_review_fix`; its runtime exposes no separate stable run or
  resolved model identifier, so none is asserted. Exact source and runtime
  evidence is frozen in `docs/reviews/p9-t5-remediation-evidence.md`.
- Worktree/branch/base: `/private/tmp/mammoth-p9-t5-generic-retry`;
  `feat/p9-t5-generic-execution-retry`; exact `origin/main`
  `ff034823cc460d774642dbe9144c5ecd0ace35d5`.
- Owned paths: `packages/domain/src/p9-execution.ts`,
  `packages/governance/src/p9-plan-coverage.ts`,
  `packages/runtime/src/p9-generic-research.ts`, package exports and runtime
  dependency wiring, `evals/fixtures/p9/report-corpus/**`,
  `scripts/verify-p9.ts`, `pnpm-lock.yaml`, and this ledger.
- Prohibited paths: live provider execution, T6 release/tag/receipt work before
  T5 merge, frozen T0/P8 fixture semantics, unrelated user changes, external
  repositories, and future solver execution.
- Allowed contract changes: T5 subset of `p9.v1`: plan coverage assessment,
  report manifest, execution receipt, typed residue, and offline corpus schema.
- Dependencies: P9 T4 merged by PR #66, README PR #67 merged, current-main CI
  `29421678055` passed at `ff03482`.
- Exact gates: focused domain/governance/runtime tests; format; lint; typecheck;
  full tests; build; `pnpm verify:p8`; `pnpm verify:p9`; detached clean-checkout
  frozen install and repeat before merge recommendation; exact-head PR CI and
  merged-main CI.
- Prior local results (candidate `9448ce70ff86661c929c8d514a560b0fd331de0d`,
  before the current CodeRabbit review): `pnpm --filter @mammoth/domain test` PASS (56);
  `pnpm --filter @mammoth/governance test` PASS (40);
  `pnpm --filter @mammoth/runtime test` PASS (51); `pnpm format:check` PASS;
  `pnpm lint` PASS; `pnpm typecheck` PASS; full `pnpm test` PASS; `pnpm build`
  PASS; `pnpm verify:p8` PASS with manifest digest
  `sha256:d154c6e1df6bfdb41f5222643f33862fa4eb15531af75ce6194171150077298f`;
  `pnpm verify:p9` PASS with `T5 generic_execution=pass` and `T6=blocked`.
  Detached clean checkout proof passed `pnpm install --frozen-lockfile`, format,
  lint, typecheck, full tests, build, P8 regression, and `verify:p9`; the known
  install/build induced `packages/temporal-adapter/src/research-cli.ts` mode
  toggle was restored and `git status --short` was clean. Exact-head PR CI
  `29428355569` passed every lane and the aggregate check at
  `9448ce70ff86661c929c8d514a560b0fd331de0d`. Merged-main CI remains to be run
  after merge.
- Review-remediation claim `P9-T5-REMEDIATION-001`: PR #70 landed the
  remediation over merged PR #68. Commits
  `24fd47b`, `02f24be`, `b570ee1`, and
  `0af166a5411cac5c177f57bd6629264d64521d62` reconcile all 16 actionable
  findings in code and executable tests, including the final policy/digest
  binding for factual citations. Local focused gates passed for domain,
  governance, runtime, and `verify:p9`; full local gates passed for format,
  lint, typecheck, test, build, `verify:p8`, and `verify:p9`. Exact source-comment
  digests, finding-to-test mapping, command-result digests, and review status are
  recorded in `docs/reviews/p9-t5-remediation-evidence.md`.
- Reviewer: PR #68 CodeRabbit posted 16 actionable inline findings against
  `50596212634ecfbd7eabb3d0ce01c763e8dece1c`. PR #70 carried the reconciliation
  and a requested fresh CodeRabbit review at head `0af166a`; CodeRabbit replied
  "Review finished" and `gh api repos/heybeaux/mammoth/pulls/70/comments`
  returned no current inline comments. The earlier PR #70 rate-limit warning is
  preserved as a warning, not approval.
- Registry/artifact proof: fresh worktree from exact origin/main, frozen install,
  inspected prior dirty T5 worktree, attributable diff, focused tests, and
  verifier output.
- Handoff/integration: PR #70 merged as
  `fe0c96f646d6a5821a43dff814affe53dadf621e`.
- Verification after remediation: PR #70 exact-head CI run `29431969478` passed at
  `0af166a5411cac5c177f57bd6629264d64521d62`, including static, tests, build,
  foundation, p2-p4, p5-p7, p8-p9, aggregate verify, and CodeRabbit. Fresh
  default-branch CI run `29432359193` passed at
  `fe0c96f646d6a5821a43dff814affe53dadf621e`, including tests, p8-p9,
  foundation, p5-p7, build, p2-p4, static, and aggregate verify.
- Blockers: none for T5. The 16 original findings and their immutable body
  digests remain individually enumerated in
  `docs/reviews/p9-t5-remediation-evidence.md` for auditability.
- Replacement audit: previous model attempt failed/timed out after creating a
  dirty `/private/tmp/mammoth-p9-t5-generic` worktree with partial T5 files. This
  retry did not reuse that branch/worktree, copied only useful uncommitted
  artifacts into a fresh exact-main worktree, and continued with exclusive
  ownership of the retry worktree.

### P9-T6 record

- Objective: live exhibition and release sequencing after T5 merge.
- Runtime identity: Scout primary session in fresh worktree
  `/private/tmp/mammoth-p9-t6-live-authority`, branch
  `feat/p9-t6-live-authority`, exact base
  `fe0c96f646d6a5821a43dff814affe53dadf621e`.
- Owned paths for this audit slice: this ledger and
  `docs/reviews/p9-t6-live-authority-audit.md`.
- Prohibited paths: live provider execution, release/tag work, receipt-only PR,
  code changes beyond authority evidence, unrelated user changes, and external
  repositories.
- Contracts changed: none; this is a coordination and authority-evidence update.
- Dependencies: T5 PR #70 merged; default-branch CI run `29432359193` passed at
  `fe0c96f646d6a5821a43dff814affe53dadf621e`.
- State: blocked on explicit T6 live credential and billing authorization.
- Blocker: T6 live exhibition and any metered provider call still require a
  separate valid authorization check under `P9_PLAN.md`/`LOOP.md`. At
  2026-07-15T16:31:33Z, repository search found no P9 live-exhibition
  authorization artifact, `printenv` exposed no `MAMMOTH_P9_*`,
  `MAMMOTH_P8_*`, `MAMMOTH_SEARCH_*`, `MAMMOTH_OPENAI*`, or
  `MAMMOTH_PROVIDER*` variables in this process, and the only implemented live
  readiness check is P8-specific. Details are in
  `docs/reviews/p9-t6-live-authority-audit.md`.
- Handoff recipient: P9 coordinator after explicit credential and billing
  authorization is provided, or after a code slice adds a P9 live-readiness gate
  without making live effects.

## Release evidence

Not yet available. P9 is not implemented or released.
