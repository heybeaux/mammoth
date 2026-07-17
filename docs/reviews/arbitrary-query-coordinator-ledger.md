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
- **Assigned implementation record:** runtime/CLI session
  `agent:scout:subagent:b42d93bd-d4e1-4088-8cb4-b68d759c2caf`, run
  `eb144e97-2c95-42b5-be0b-5f634d5501c2`, owns only `packages/runtime/**` and
  `packages/cli/**` in fresh worktree `/private/tmp/mammoth-core-runtime-acquisition`
  on `feat/core-query-runtime-acquisition`, based on `5574785`. It must prove
  digest binding, no implied authority, generic distinct inputs, and drift refusal;
  it is strictly no-effect and requires an independent reviewer after handoff.

## 2026-07-16 — evidence stocktake recovered, verified, and integrated

- **Registry reconciliation:** TaskFlow child
  `f1371911-8821-481f-8e63-38fb8797aef1` still reported `queued` during this
  coordinator turn, but its designated worktree held a completed, staged owned
  diff. During focused validation the worker finalized commit `4c53e57`; its
  tracked tree then became clean. This is recorded as a scheduler-state lag,
  not as a second lane or inferred completion.
- **Ownership and integration:** the commit changes only declared
  `packages/retrieval` and `packages/evidence` paths (including the lane
  handoff). It was serially integrated at `5ecdd8d` on
  `feat/core-thesis-arbitrary-query`; no untracked OpenClaw bootstrap files
  were included.
- **Predicate evidence:** discovery hints are now selected only when traced to
  planned query and source-class targets; rejected, duplicate, insecure, and
  over-capacity hints become typed residue. Exact spans bind quote, offsets,
  bounded context, and snapshot digest and fail closed on body/context drift.
  Both seams are generic and perform no effects.
- **Coordinator gates:** integration retrieval tests **46/46**, evidence tests
  **34/34**, and both retrieval/evidence typechecks passed. The worker also
  reported clean builds for both packages. No provider, network, paid, or other
  effect authority was used.
- **Current predicate:** compose the accepted immutable plan through the
  runtime/CLI normal path into these no-effect discovery and acquisition
  intents, then carry snapshots through exact spans and independent admission.
  The active runtime/CLI lane remains the only owner of that path.

## 2026-07-17 — runtime composition integrated; contract decisions recorded

- **Successor coordinator:** session
  `agent:scout:subagent:e338ae2d-8b73-44a6-a2df-8fa188ade309` resumed the loop.
  Managed flow `56206e6d-363b-486b-94bc-1f315f859d0d` remains `running`
  (revision 6); TaskFlow runtime mutation is again unavailable on this session's
  tool surface, so this ledger and the coordinator state file remain the durable
  record.
- **Runtime lane evidence:** session
  `agent:scout:subagent:b42d93bd-d4e1-4088-8cb4-b68d759c2caf` completed at
  `4ca0cf7`; its registry entries and subagents are dead and its tracked tree is
  clean (only injected OpenClaw bootstrap files untracked). The committed diff is
  confined to `packages/runtime` and `apps/cli` (the CLI lives under `apps/`,
  matching the lane's intent). Serially integrated as `9426c3e`.
- **Coordinator gates at `9426c3e`:** runtime tests **123/123**, CLI tests
  **45/45**, repo typecheck, lint, `format:check`, and build all passed;
  `verify:p8` ok and `verify:p9` ok (offline adapters only). No provider,
  network, paid, or other effect authority was used.
- **Decision — schema home:** `investigation.acquisition.v1` intent-set and
  release schemas are promoted from `packages/runtime` to `packages/domain` as a
  shared contract, because the governed-execution seam spans retrieval and
  evidence packages that must not import runtime. Derivation and release
  evaluation remain runtime composition logic. The move is coordinator-owned
  cross-package contract scope per `AGENTS.md`.
- **Decision — authority receipt:** the release gate continues to reuse
  `P9LiveAuthorityReceipt`; it already binds plan digest, question scope,
  validity window, effect kinds, and issuer, and a parallel investigation-scoped
  receipt contract would add surface without a new invariant. Revisit only when
  requirements diverge (for example per-intent budgets). The trusted-issuer
  anchor stays caller-pinned: the CLI must take it from explicit configuration
  and fail closed when absent; no code-level default issuer is permitted.
- **Current predicate:** governed execution of released intents — a valid
  scoped authority minted by an offline trusted-issuer fixture must drive
  policy-pinned retrieval, snapshot preservation, exact spans, and independent
  admission through the normal product path with strictly local, no-effect
  adapters.

## 2026-07-17 — Governed execution lane integrated (coordinator)

- **Lane:** `feat/core-query-governed-execution` at
  `/private/tmp/mammoth-core-governed-execution`, based on `b0c9c72`. The
  builder agent terminated mid-lane (provider-side API refusal after the
  implementation was substantially complete); the coordinator completed
  verification, fixed one lint violation in `investigate-reader-bundle.ts`
  (destructuring guard replacing a non-null assertion), independently reviewed
  every source and test file, wrote the handoff doc, and committed the lane as
  `efa4bd8`. Serially integrated as `f4bac11` (cherry-pick verified as an empty
  diff against `efa4bd8`).
- **What landed:** offline fixture authority issuer
  (`offline-fixture-issuer/v1`, `.invalid` origins, never trusted by default);
  fail-closed governed executor (`verifyExecutionAuthority` re-checks release
  decision, digest bindings, pinned issuer, authority↔release receipt binding,
  validity window, effect kinds before any adapter call; three-phase execution
  with typed rejection residue and falsification probes; refuses
  `no_admissible_evidence`); operator-declared offline source catalog with
  strictly no-effect adapters; reader/audit bundle composition (verbatim
  admitted evidence only, forbidden-pattern reader gate, digest-chained
  `execution-receipt.json`); CLI `mammoth investigate --execute` path requiring
  explicit `--approve`, `--offline-sources`, and `--trusted-issuer`.
- **Acceptance:** `evals/outcome-1-acceptance/test/governed-execution-e2e.ts`
  (wired into `test:harness`) drives an arbitrary question through the public
  CLI into a readable cited report verified by the frozen outcome-1
  reader/audit bundle verifier, and proves unpinned/wrong-issuer refusals
  execute nothing. Runtime tests include refused-release/expired/not-yet-valid/
  tampered-intent-set/swapped-authority negatives with adapter call counters
  asserting zero effects on refusal.
- **Coordinator gates at `f4bac11`:** full-repo `pnpm test` passed (all
  packages, including runtime 139/139 and CLI 52/52), repo typecheck, lint,
  `format:check`, and build all passed; `pnpm --filter outcome-1-acceptance
  test:harness` passed (`outcome-1.v1` 4 cases + governed-execution e2e);
  `verify:p8` ok and `verify:p9` ok. No provider, network, paid, or other
  effect authority was used at any point.
- **Completion contract status:** an arbitrary difficult question now flows
  through the normal product path (preview → recorded approval → immutable
  plan → derived intents → issuer-pinned release → governed offline execution)
  into a comprehensive, readable, decision-grade, auditable answer with
  offline/no-effect proof. Proceeding to PR against `main` (merge only after
  exact-head CI green; no tag/release today — Friday).
