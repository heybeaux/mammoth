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

## 2026-07-17 — Predicate 9 live lane claimed; provider search blocked

- **Current predicate:** replace the offline fixture executor behind
  `mammoth investigate --execute` with governed live search, retrieval, parser,
  and model effects under the active USD 15 loop authority.
- **Integration slot:** `/private/tmp/mammoth-core-live-coordinator-v3`, branch
  `feat/core-loop-live-retrieval-v3`, based on `07259e8` (PR #143 merge). Fresh
  `pnpm install --frozen-lockfile` completed before gates.
- **Implementation evidence:** the normal public path now accepts
  `--live --approve --trusted-issuer mammoth-core-loop-live-authority/v1
--budget-journal PATH`; it mints a scoped loop authority from the approved
  `AGENTS.md` budget, opens a fresh durable journal from 0, reserves before
  search, retrieval, parser, and model effects, preserves live retrieval
  receipts, emits `audit/durable-budget-journal.jsonl`, and marks live bundles
  as `externalEffectsExecuted: true`. Search providers are cataloged as
  `brave-search` and `tavily-search`; model review uses an OpenAI-compatible
  strict JSON-schema response without provider-facing cardinality keywords.
- **Regression evidence:** runtime focused test
  `investigate-governed-execution.test.ts` now includes an injected live
  transport path proving search, retrieval, parser, and model reservations plus
  live effect receipts and reader/audit composition. Focused runtime test passed
  **17/17**; full repository `pnpm typecheck` passed.
- **Live provider attempt:** a real Brave run for an unrelated CRDT/remote-clinic
  holdout started under a fresh journal and stopped on the first search with
  `Brave search failed with HTTP 429; rate limit reset 1, 1242819 seconds`.
  This is an operational provider quota block, not a product acceptance pass.
  A second strategy was prepared using Tavily based on official API docs, but the
  available `~/projects/tra/.env` entry `TAVILY_API_KEY` is empty, so it cannot
  run without a credential.
- **Remaining gap:** predicates 9-12 are not complete. The code seam is live-path
  ready and machine-tested with injected transports, but the required three
  unrelated real live holdouts and exact world-model live review remain blocked
  on an available search credential/provider or a non-rate-limited Brave window.
  No release, tag, or deployment is permitted today (Friday).

## 2026-07-17 — Independent review findings repaired on PR #144

- **Independent reviewer:** native worker
  `019f7094-1b57-75d1-801d-be960bd70ce3` reviewed commit `acaafd5` without
  edits or live effects. It found two high-severity authority defects and two
  medium audit-truth defects: retrieval origins were not enforced, model
  destination authority was expanded from a CLI-supplied URL, live budget text
  pointed at an offline-shaped journal, and destination/profile fields were not
  validated before effects.
- **Repairs:** live execution now checks authorized search/model destination
  origins before reservation/transport, filters retrieval candidates to
  authority-listed origins before fetch, restricts the current CLI-minted model
  destination to OpenRouter, adds explicit `--authorized-retrieval-origin`
  configuration for governed live runs, and renders live `audit/budget-journal`
  content from live effect receipts instead of offline zero-charge placeholders.
- **Verification after repair:** focused runtime live/offline test passed
  **17/17**, full repository `pnpm typecheck` passed, and `pnpm lint` passed.
  The provider blocker remains unchanged: Brave is rate-limited and Tavily has
  no usable credential in the available environment.

## 2026-07-17 — V6 Brave burst limiter claimed

- **Coordinator:** `mammoth-core-loop-coordinator-v6`, fresh worktree
  `/private/tmp/mammoth-core-loop-v6`, branch
  `fix/core-live-brave-rate-limit-v6`, based on verified `origin/main`
  `fb1abb379ab565ecc63e7a8276526d79c6aeed9c` (PR #145 merge). The old v5
  worktree is not reused.
- **Authority boundary:** Beaux explicitly authorized only the existing Brave
  credential for remaining governed Mammoth acceptance runs under the existing
  USD 15 aggregate live-provider ceiling. Tavily is permanently out of scope for
  this loop unless new explicit authorization is granted; the employer-owned
  DeerFlow Tavily credential must not be sourced, inspected, fingerprinted,
  tested, copied, or used.
- **Root cause under repair:** Brave returns comma-separated rate-limit windows
  such as short burst reset plus monthly reset. The live path treated the list as
  an opaque reset string and had no bounded short-window retry, so a one-second
  burst 429 blocked acceptance even though monthly quota remained.
- **Owned paths:** `packages/runtime/src/brave-rate-limit.ts`,
  `packages/runtime/src/p9-live-application.ts`,
  `packages/runtime/src/investigate-governed-execution.ts`,
  `packages/runtime/src/index.ts`, `packages/runtime/test/brave-rate-limit.test.ts`,
  `AGENTS.md`, `LOOP.md`, and this ledger.
- **Initial offline evidence:** added multi-window parsing and bounded burst
  retry tests covering short/monthly classification, burst 429 then success,
  monthly exhaustion, malformed headers, bounded retry exhaustion, and abortable
  wait failure. Focused command
  `pnpm --filter @mammoth/runtime test -- brave-rate-limit.test.ts` passed
  **8/8** after `pnpm install --frozen-lockfile`. Runtime typecheck passed.
- **Independent review:** reviewer `019f70d9-062e-75e0-a2c0-65ca6ec8435f`
  found that retry attempts initially exceeded the reserved request envelope and
  incomplete multi-window headers could retry. V6 repaired both, then repaired
  follow-up findings by capping `max429Retries` to the `attempts: 3`
  reservation envelope and bounding retry wait inputs. Final re-review reported
  no remaining findings.
- **Post-review evidence:** focused runtime tests
  `pnpm --filter @mammoth/runtime test -- brave-rate-limit.test.ts p9-live-application.test.ts investigate-governed-execution.test.ts`
  passed **71/71**; full runtime tests passed **150/150**; runtime typecheck,
  `pnpm lint`, and `pnpm format:check` passed.
- **Next action:** run the governed Brave-only holdouts and exact world-model
  question from fresh immutable directories and journals.

## 2026-07-17 — V6 live acceptance blocked by reader-quality failure

- **Commit:** local `e21c170` contains the reviewed Brave short-window limiter,
  query preservation, arXiv PDF-to-HTML normalization, and stricter
  low-information/relevance filters.
- **Brave-only live attempts:** using only `BRAVE_API_KEY` and
  `OPENROUTER_API_KEY` sourced from `~/projects/tra/.env`, V6 ran fresh
  governed journals and immutable output directories under
  `evals/live/mammoth-core-loop-v6/`. The first credential-loading attempt
  (`holdout-remote-clinic`) failed with Brave HTTP 422 because the shell copied
  quoted env text instead of sourcing the bounded Brave/OpenRouter lines; it is
  preserved and does not count for acceptance.
- **Completed but invalid holdouts:** `holdout-remote-clinic-a2`,
  `holdout-grid-battery`, and `holdout-heritage-hvac` completed with governed
  live effects, receipts, and admitted claims, but manual reader audit found
  boilerplate or irrelevant source-derived claims (license text, publication
  metadata, replication-crisis content, or weakly related articles). They reject
  leakage/canned-path concerns but do **not** satisfy the substantive-answer
  predicate.
- **Exact world-model attempts:** `world-model-local` through
  `world-model-local-v5` either completed with irrelevant OpenAI/LARK evidence
  or failed closed after stricter filters. `world-model-local-v6` failed closed
  with `no admitted evidence can be rendered on the reader surface`, which is
  preferable to publishing an uncited or irrelevant report but leaves predicate
  10 incomplete.
- **Spend evidence:** search/model/retrieval receipts are preserved in each
  bundle/journal. `jq -s '[.[] | select(.entry.kind=="settle") | .entry.input.actual.currencyUsd // 0] | add' evals/live/mammoth-core-loop-v6/*/budget-journal.jsonl`
  returned **USD 0.3600660500000002** for V6 live attempts. The aggregate
  ceiling remains USD 15 less prior authorized spend and these V6 attempts.
- **Root cause:** Brave rate limiting is no longer the protected boundary. The
  normal-path live product still needs stronger source selection, relevance
  gating, and reader synthesis that answers the submitted question using
  admitted evidence instead of rendering the first admitted quote.
- **Next action:** continue from `/private/tmp/mammoth-core-loop-v6` commit
  `e21c170`; do not count V6 live outputs as acceptance evidence. Fix the
  source-selection/reader-quality root cause without weakening evidence gates,
  then rerun three unrelated Brave-only holdouts and the exact world-model
  question from fresh directories and fresh journals.

## 2026-07-17 — V7 live source-quality repair and fresh acceptance evidence

- **Coordinator:** `mammoth-core-loop-coordinator-v7`, same owned worktree
  `/private/tmp/mammoth-core-loop-v6`, branch
  `fix/core-live-brave-rate-limit-v6`, started from exact commit `256dfb8`.
  The failed `evals/live/mammoth-core-loop-v6/` outputs remain untracked audit
  evidence and are not counted for acceptance.
- **Repair:** generic live search hints now preserve provider descriptions,
  score title/description/URL surfaces against question-derived and
  plan-query-derived terms, reject low-relevance hints as typed residue, rank
  source spans by question relevance across a larger bounded parse window, and
  render a labelled source-bounded deduction from the independent live model
  review instead of using the first admitted quote as the direct answer. The
  public-web retrieval authority default is the explicit policy origin
  `https://public-web.invalid`; retrieval still passes through HTTPS-only,
  DNS-pinned, private-network-blocking, media-type, byte-cap, and
  redirect-origin checks. No topic names, expected conclusions, or source URLs
  were added to generic runtime branches.
- **Focused gates:** runtime live/offline test
  `pnpm --filter @mammoth/runtime test -- investigate-governed-execution.test.ts`
  passed **17/17**; focused runtime live set
  `pnpm --filter @mammoth/runtime test -- brave-rate-limit.test.ts p9-live-application.test.ts investigate-governed-execution.test.ts`
  passed **71/71**; full runtime tests passed **150/150**; full CLI tests
  passed **52/52** after building `@mammoth/temporal-adapter`; retrieval tests
  passed **46/46**. `pnpm lint`, `pnpm format:check`, and full `pnpm typecheck`
  passed.
- **Acceptance/regression gates:** `pnpm --filter outcome-1-acceptance
test:harness` passed (`outcome-1.v1` 4 cases plus governed-execution e2e);
  `pnpm verify:p8` passed; `pnpm verify:p9` passed; full `pnpm test` passed
  across the workspace; full `pnpm build` passed.
- **Fresh Brave-only live runs:** using only `BRAVE_API_KEY` and
  `OPENROUTER_API_KEY` sourced from `~/projects/tra/.env`, fresh immutable
  directories and journals were created under
  `evals/live/mammoth-core-loop-v7/`. Three unrelated holdouts completed:
  `holdout-remote-clinic` (7 snapshots, 20 admitted claims),
  `holdout-grid-battery` (3 snapshots, 6 admitted claims), and
  `holdout-heritage-hvac` (6 snapshots, 15 admitted claims). The exact
  world-model question completed at `world-model-local-v2` (4 snapshots,
  9 admitted claims) with a reader-first source-bounded answer, sentence-local
  citations, reader-visible reviewer limitations, admitted/rejected claim
  residue, live effect receipts, durable budget journal copy, and audit
  projection.
- **Manual product review:** the holdout reports are structurally distinct and
  source-derived. The world-model answer is bounded: it identifies JEPA-style
  physical-world modelling and specific-use-case systems such as robotics and
  asset generation as the best-supported opportunity area, while preserving the
  limitation that interfaces/tools and local-GPU software maturity remain
  unresolved. This counts only as Outcome 1 normal-path evidence, not as a claim
  of broad Mammoth research superiority.
- **Spend:** V7 settled spend across all fresh attempts, including the first
  world-model run superseded by `world-model-local-v2`, was
  **USD 0.20006906000000005**. Aggregate authorized spend is
  **USD 0.70015137000000025** (v4 USD 0.14001626 + v6
  USD 0.3600660500000002 + v7 USD 0.20006906000000005), leaving
  **USD 14.29984862999999975** under the USD 15 ceiling.
- **Independent review:** read-only reviewer
  `019f7101-fe95-74e2-9e62-e9e57b90291f` is reviewing the diff and V7
  artifacts for hidden topic logic, evidence-gate weakening, authority,
  citation support, budget truth, and reader quality before PR/merge claims.
- **Next action:** incorporate or repair independent review findings, commit and
  push the branch, open/update PR, require exact-head CI, merge only if green,
  then verify fresh-main CI. No tag, release, or deployment may occur on Friday
  2026-07-17.

## 2026-07-17 — V7 continuation: independent review blocked acceptance

- **Correction:** the V7/V12-V19 live outputs are preserved audit evidence but
  do **not** count as predicate 9/10 acceptance. Independent read-only review
  `019f711b-8613-7163-b609-010f0460bd70` blocked V12 because the world-model
  report did not answer the single-consumer-GPU/open-source/private/local
  constraint, the reader overclaimed that model-authored deductions were
  verbatim admitted quotes, dissent and transfer boundaries were weak, and
  experiments/source relevance were insufficient.
- **Repairs attempted after the blocker:** the normal path now rejects Tavily
  provider/credential selection, requires a fresh aggregate
  `--loop-budget-journal`, chains aggregate budget records under the USD 15
  ceiling, allocates per-run budget from remaining aggregate capacity, uses
  Brave only for live search, increases generic implementation-query breadth,
  preserves more question terms, raises live candidate breadth, classifies
  limitation/failure searches as `counterevidence`, renders model-authored
  answers as labelled source-bounded deductions, adds dissent and boundary
  sections, fixes the method text, and surfaces unresolved question constraints
  instead of hiding them in audit.
- **Verification during continuation:** focused runtime/CLI tests passed after
  each repair. Before the independent blocker, full runtime tests passed
  **150/150**, full CLI tests passed **54/54**, Outcome 1 acceptance harness
  passed, `verify:p8` passed, `verify:p9` passed, `pnpm lint`,
  `pnpm format:check`, full `pnpm typecheck`, full `pnpm test`, and full
  `pnpm build` passed. These are code-health results only; they do not prove
  product acceptance.
- **Fresh/probe live evidence:** V9, V11, V12, V13, V17 full runs and V14-V16,
  V18, V19 probes completed under governed Brave/OpenRouter authority. The best
  later reports fail honestly by exposing unresolved constraints, but still do
  not produce a useful enough world-model answer through the normal public path.
  In particular, the path still misses or underuses practical open-source,
  private/local, single-consumer-GPU implementation evidence, and the
  remote-clinic holdout still lacks strong offline/conflict-resolution evidence.
- **Spend:** later governed attempts after the earlier V7 receipt settled
  **USD 1.2807873200030002**. Total authorized loop spend recorded here is
  **USD 1.9809386900030005**, leaving **USD 13.019061309996999** under the
  USD 15 ceiling. The historical unauthorized employer-account Tavily spend
  remains invalid evidence and is not part of authorized acceptance spend.
- **Current blocker:** predicates 9 and 10 remain incomplete due product
  quality, not due command failure. Next work should continue from the
  uncommitted repairs and likely add a stronger normal-path query/source-quality
  layer or model-assisted query expansion before retrieval. Do not count
  `evals/live/mammoth-core-loop-v6` through `mammoth-core-loop-v19*` as
  acceptance evidence.

## 2026-07-17 — V8 generic constraint coverage repair; review still blocks

- **Coordinator:** `mammoth-core-loop-coordinator-v8`, same owned worktree
  `/private/tmp/mammoth-core-loop-v6`, branch
  `fix/core-live-brave-rate-limit-v6`, continued from local `f50eadb` plus
  uncommitted V7 repairs. Existing failed/probe artifacts under
  `evals/live/mammoth-core-loop-v6` through `v19*` were preserved.
- **Repair:** generic planner search queries now preserve original-order
  constraint phrases for unrelated constraint-heavy questions; live discovery
  scores hints by question/query coverage plus generic source-quality signals
  and interleaves candidates by planned query so broad early searches cannot
  crowd out narrower constraints; live span/review evidence breadth increased
  within bounded ceilings; reader fallback evidence prioritizes unresolved
  question constraints; model-authored `evidenceIndex` syntax is stripped from
  reader prose. The changes remain topic-agnostic and contain no fixed sources
  or expected conclusions in runtime branches.
- **Focused verification:** `pnpm --filter @mammoth/runtime test --
investigate-governed-execution.test.ts investigate-preview.test.ts` passed
  **22/22**; `pnpm --filter @mammoth/runtime typecheck` passed; and
  `pnpm format:check` passed. These are code-health gates only.
- **Live evidence:** fresh governed Brave/OpenRouter runs were preserved under
  `evals/live/mammoth-core-loop-v20/` for three unrelated holdouts and the
  world-model question. V20 completed remote-clinic, grid-battery,
  heritage-HVAC, and world-model bundles. Targeted world-model iterations V21,
  V22, and V23 were preserved under `evals/live/mammoth-core-loop-v21/`,
  `v22/`, and `v23/` after additional generic repairs.
- **Spend:** V20 opened a hash-chained aggregate loop journal seeded with the
  previously recorded authorized spend **USD 1.980938690003**. By V23, the
  aggregate journal records **USD 2.6112140700029998** settled spend, leaving
  **USD 12.388785929997** under the USD 15 ceiling. Only Brave Search and
  OpenRouter were configured; Tavily was not read, sourced, or used.
- **Independent review:** read-only reviewer
  `019f7140-1453-70c3-ad5c-c8930247f1bd` blocked predicates 9/10. Findings:
  the V23 world-model report remains too generic and does not rank concrete
  open-source/private/local/single-consumer-GPU opportunities; source binding
  is weak for local world-model implementation evidence; V20 holdouts remain
  structurally complete but substantively unresolved for central constraints
  (remote-clinic conflict resolution, grid decision/equity/summer peaks,
  heritage archival collections); and pre-repair reader reports leaked
  evidence-index syntax. The syntax leak has a focused code repair and test,
  but the preserved live reports remain failed evidence.
- **Current blocker:** predicates 9 and 10 remain incomplete due product
  quality and evidence fit, not provider authority, budget, or command health.

## 2026-07-17 — V9 coordinator checkpoint: constrain implementation searches

- **GitHub checkpoint:** branch `fix/core-live-brave-rate-limit-v6` was pushed
  and draft PR #146 was opened after focused runtime and CLI gates passed. The
  PR is an implementation checkpoint only; predicates 9/10 remain unclaimed.
- **Repair:** the generic planner now carries late question constraints into
  repository, implementation, hardware, and feasibility searches instead of
  letting early framing terms dominate every query. This is question-derived
  and does not add any world-model topic branch.
- **Focused verification:** `pnpm --filter @mammoth/runtime test --
investigate-preview.test.ts investigate-governed-execution.test.ts` passed
  with the new planner coverage test. The exact world-model generated query
  set now includes `open-source private local single consumer gpu` in
  implementation and hardware searches, plus `single consumer gpu` in the
  benchmark feasibility search.
- **Next action:** rerun governed Brave/OpenRouter acceptance probes in fresh
  directories with the aggregate live budget journal, then independently
  review three unrelated holdouts and the exact world-model report before any
  predicate claim.
  Further progress likely requires a different generic strategy: source
  selection must favor direct implementation/benchmark/project evidence over
  commentary, and synthesis must produce a ranked decision-grade opportunity
  portfolio or fail closed when admitted evidence cannot support one.

## 2026-07-17 — V24/V25 failed evidence; decision-grade source repair

- **GitHub checkpoint:** commit `eb747c2` pushed to draft PR #146 after focused
  runtime tests plus `pnpm format:check && pnpm lint && pnpm typecheck` passed.
- **Fresh/probe live evidence:** V24 completed the three unrelated holdouts and
  exact world-model question through the governed live public path; V25 added a
  remote-clinic probe. These artifacts are preserved under
  `evals/live/mammoth-core-loop-v24/` and `evals/live/mammoth-core-loop-v25/`
  but do **not** count as predicate acceptance.
- **Why V24 fails:** the exact world-model report still left
  private/local/consumer constraints unresolved and ranked broad digital-twin
  and weather items alongside single-GPU local implementation work. The holdout
  reports also left central constraints unresolved, and some model-authored
  rationale still reflected weak commentary/community evidence rather than
  direct decision evidence.
- **Spend:** V24/V25 extended the aggregate loop journal from the previously
  recorded **USD 2.611214070003** to **USD 2.981478360004**, leaving
  **USD 12.018521639996** under the USD 15 ceiling. Only Brave Search and
  OpenRouter were configured; Tavily was not read, sourced, or used.
- **Repair:** generic search planning now places constraint-led official,
  repository, benchmark/resource, deployment/hardware, and counterexample
  searches before broad framing searches. Live source selection now rejects
  common community/encyclopedia/commentary hosts as decision-grade evidence and
  requires at least one cited bounded experiment proposal before live synthesis
  can pass. Reader cleanup now strips singular `evidenceIndex` syntax as well
  as plural variants.
- **Focused verification:** `pnpm --filter @mammoth/runtime test --
investigate-governed-execution.test.ts investigate-preview.test.ts`,
  `pnpm --filter @mammoth/runtime typecheck`, and
  `pnpm format:check && pnpm lint && pnpm typecheck` passed locally before the
  repair checkpoint. Predicates 9/10 remain incomplete pending fresh live runs
  and independent review.
