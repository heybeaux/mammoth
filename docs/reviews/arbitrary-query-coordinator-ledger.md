# Arbitrary-query coordinator ledger

## 2026-07-16 — orientation and bounded lane launch

- **Current predicate:** accepted preview authority must bind to an immutable
  executable plan before any governed effect can occur.
- **Baseline:** PR #140 supplies only a no-effect `mammoth investigate` preview;
  it returns `awaiting_approval` and does not execute the research product path.
- **Authority:** `origin/main` includes PR #141 merge
  `5637851ad9ecc7f3368d40e5200def07e36af4fc`; its fresh-main CI run
  `29559667727` succeeded.
- **Integration:** `/private/tmp/mammoth-core-query-integration`, branch
  `feat/core-thesis-arbitrary-query`, at `5637851ad9ecc7f3368d40e5200def07e36af4fc`.
- **Durable control:** managed TaskFlow `56206e6d-363b-486b-94bc-1f315f859d0d`,
  controller `mammoth/core-thesis-arbitrary-query`. An initial incorrectly
  parent-bound flow was retired before any worker or effect started.
- **Lanes requested (all strictly no-effect):** plan/authority binding,
  retrieval/evidence stocktake, and reader/audit projection stocktake. Each has a
  separate fresh worktree and disjoint write set; completion evidence and live
  ownership must be checked before integration.
- **Effect authority:** none. No provider, search, or paid effect may run.
- **Next action:** reconcile lane handoffs, independently review the smallest
  plan/authority seam, then integrate and claim plan-driven discovery.

## 2026-07-16 — projection stocktake reconciled and integrated

- **Managed flow:** `56206e6d-363b-486b-94bc-1f315f859d0d` remains running.
  The coordinator session is not live (its prior turn timed out); active children
  are plan/authority `agent:scout:subagent:7c9d7a13-f2e0-4f41-a9f3-80ca1a2816d6`
  and evidence `agent:scout:subagent:910bc0c9-953a-41c4-b368-9d72a2b9cf1f`.
  Projection `agent:scout:subagent:8401c3bb-f0c6-4c80-8991-b8b88cce52c8`
  completed at reported commit `05fc628`.
- **Projection verification:** its committed diff is limited to its owned
  `packages/report-compiler` paths (`src/index.ts`, `src/synthesis-extension.ts`,
  `test/synthesis-extension.test.ts`). Its tracked tree is clean; untracked
  `.openclaw/` and identity/bootstrap files are not lane changes. The coordinator
  cherry-picked it serially as `6cc67f8` onto `feat/core-thesis-arbitrary-query`.
- **Coordinator gates:** integration `@mammoth/report-compiler` test passed
  **29/29** and its TypeScript typecheck passed. No effect authority was used.
- **Product evidence:** the additive extension supplies fail-closed typed mechanism
  transfers, hypotheses, and bounded experiment proposals plus reader-visible
  epistemic labels. It is intentionally not yet on the runtime path; composition
  waits on the immutable plan/authority seam.
- **Next action:** reconcile the two still-running disjoint lanes, integrate the
  plan authority work if its focused and regression gates hold, then schedule the
  smallest runtime composition lane. TaskFlow runtime mutation is unavailable to
  this cron worker's exposed tool surface; this ledger and the coordinator state
  are the durable reconciliation record for the next coordinator turn.

## 2026-07-16 — predicate 1 integrated; predicate 2 claimed

- **Predicate 1 evidence:** plan/authority session
  `agent:scout:subagent:7c9d7a13-f2e0-4f41-a9f3-80ca1a2816d6` completed at
  `806d223`. Its committed diff is confined to declared `packages/domain` and
  `packages/governance` files; tracked tree is clean, with only injected OpenClaw
  bootstrap files untracked. The coordinator serially integrated it as `dfb75e7`.
- **Contract:** `investigation.approval.v1` digest-binds a human approval; the
  immutable `investigation.plan.v1` binds preview and approval digests, permits no
  effects (`none_granted` / `not_granted`), and rejects drift, forged digests,
  non-approvals, non-human actors, and mismatched investigations. It is generic and
  clock-free.
- **Coordinator gates:** domain tests **76/76**, governance tests **64/64**, and
  runtime regression tests **116/116** passed at the integration head. No provider
  or other effect authority was used.
- **Current predicate:** accepted immutable plan drives generic discovery and
  acquisition without topic branches. A fresh path-disjoint runtime/CLI lane is
  being claimed while the separate retrieval/evidence stocktake remains active.
