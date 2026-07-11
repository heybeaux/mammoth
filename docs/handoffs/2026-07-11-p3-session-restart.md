# P3 Session Restart Handover

> Prepared: 2026-07-11 05:49 PDT
>
> Repository: `https://github.com/heybeaux/mammoth`
>
> Authoritative baseline: `origin/main` at
> `d28e1314bda694f1c9f8914536e001f0c19070e1`
>
> Target checkpoint: `v0.3.0-temporal-control-plane`

## Why this handover exists

The previous session reported that three implementation lanes were active, but it
did not successfully spawn or verify any workers. That report was false. At the
time of this handover:

- no P3 implementation worker is known to be active;
- no worker handoff, worker commit, P3 implementation branch, or P3 pull request
  exists to integrate;
- no P3 implementation has begun on the authoritative default branch;
- the only completed P3 work is the planning and operating-contract commit on
  `main`.

Do not infer worker activity from the earlier chat report. A restarted coordinator
must create workers through the native delegation mechanism and immediately prove
each worker is live with the agent-status mechanism before using the word
`active`. If live verification is unavailable or reports no worker, record the
spawn as failed and do not claim a team exists.

## Verified repository state

- Default branch: `main`
- Default-branch commit: `d28e1314bda694f1c9f8914536e001f0c19070e1`
- Commit subject: `docs: define P3 Temporal delivery loop`
- P2 baseline tag: `v0.2.0-production-data`
- P2 baseline commit: `e7c9703b7bc20805a422599da7b869b7d179eea1`
- Latest observed `main` CI: run `29152448499`, successful in 3m02s
- Open pull requests observed while preparing this handover: none
- P3 implementation commits on `main`: none
- `verify:p3` script: not yet implemented
- P3 entry receipt `evals/reports/p3-entry-temporal.md`: not yet created
- P3 checkpoint receipt
  `evals/reports/v0.3.0-temporal-control-plane.md`: not yet created

The checkout at `/Users/beauxwalton/projects/mammoth` is an old M4 worktree on
`feat/m4-integrated-resolved` and must not be treated as the P3 integration
checkout. It was intentionally left untouched. Start from a fresh clone or an
isolated worktree based on `origin/main`.

## Governing documents

Read these before assigning or editing work:

1. `AGENTS.md` — worker contract, ownership, verification, and truthful live-state
   terminology.
2. `LOOP.md` — autonomous P3 loop, integration order, recovery, escalation, and
   stopping condition.
3. `P3_PLAN.md` — normative P3 acceptance contract.
4. `P2_PLAN.md` and
   `evals/reports/v0.2.0-production-data.md` — the authority boundary that P3 must
   preserve.
5. `POST_MVP_ROADMAP.md` — sequencing and deferred scope.
6. `ARCHITECTURE.md` sections 6, 7, 15, 28, 38, 40, 42, and 44.
7. `docs/OBSERVATORY.md` for the read-only projection boundary.

The central invariant is that Temporal owns orchestration history, timers,
signals, queries, retries, and replay. Postgres/CAS remains authoritative for
product state, evidence, artifacts, effects, receipts, audit, and projections.

## Restart procedure

1. Fetch `origin` and confirm `origin/main` is at or descends from the baseline
   commit above. Inspect open PRs, CI, worktrees, and repository status.
2. Create a clean coordinator worktree from `origin/main`. Do not reuse or clean
   the dirty/old M4 checkout.
3. Run the P2 reconfirmation from the clean worktree before changing contracts:

   ```sh
   pnpm install --frozen-lockfile
   pnpm verify:p2
   ```

4. Re-read the entry gate in `P3_PLAN.md`. Create
   `evals/reports/p3-entry-temporal.md` only from commands actually executed and
   facts actually inspected.
5. Inspect the native delegation system. Spawn one small, bounded worker first,
   then immediately query live status. Do not queue all lanes until the
   spawn/status path is proven in this restarted session.
6. Once the first worker is proven active, spawn only path-disjoint lanes and keep
   one execution slot available for the coordinator.
7. Require each worker assignment and handoff to use the exact contracts in
   `AGENTS.md`. Integrate only reviewed diffs and executed verification evidence.
8. Continue through the `LOOP.md` integration order without contacting Beaux until
   the P3 stopping condition or an explicit escalation condition is reached.

## First worker: recommended bounded probe

Use the first worker both to validate delegation and to gather P3 entry evidence.
The worker should not implement Temporal production code yet.

```text
Objective:
  Audit the P3 entry gate against origin/main and draft factual entry evidence.

Owned paths:
  evals/reports/p3-entry-temporal.md

Non-owned paths:
  All package source, package manifests, lockfiles, CI, AGENTS.md, LOOP.md,
  P3_PLAN.md, and architecture documents.

Allowed contract changes:
  None.

Required work:
  Reconfirm the P2 baseline from a clean checkout; inventory workflow ports,
  adapter contract major 1, production-profile lifecycle seams, side-effecting
  operations, and missing Temporal lifecycle decisions. Record gaps honestly.

Verification:
  pnpm install --frozen-lockfile
  pnpm verify:p2
  pnpm format:check

Handoff recipient:
  P3 coordinator/integrator.
```

After requesting the spawn, query live agent status. Record one of:
`spawn requested`, `active`, `completed`, `integrated`, or `merged/verified`.
Never collapse these states.

## Subsequent implementation lanes

Only start these after delegation is proven and entry evidence identifies the
actual contracts. Keep ownership disjoint and serialize changes to workflow and
Activity contracts.

### Lane A — Temporal lifecycle and adapter

- Expected scope: a new concrete Temporal adapter package, descriptor/conformance
  integration, local Temporal service lifecycle, readiness, fail-closed startup,
  and CI-compatible setup.
- Likely integration touchpoints: `packages/adapter-contracts`,
  `packages/production-profile`, workspace manifests, lockfile, and CI.
- Must not make Temporal authoritative for product data.

### Lane B — deterministic workflow contract

- Expected scope: workflow names, stable workflow IDs, supported versions,
  deterministic definitions, replay fixtures, and `continueAsNew` policy.
- Likely integration touchpoint: `packages/workflow` plus a new Temporal workflow
  package if the architecture review supports it.
- Must not read wall-clock time, random IDs, model context, or UI state inside
  deterministic workflow code.

### Lane C — adversarial entry and idempotency review

- Expected scope: enumerate side-effecting Activities, stable provider keys,
  attributable work items, receipt lookup, duplicate-delivery tests, retryability,
  heartbeats, timeouts, poison input, and crash boundaries.
- Initial output should be a review/fixture plan, not overlapping source edits.
- Existing receipt primitives begin under `packages/work-queue/src/receipts.ts`.

The coordinator owns cross-package contract decisions, dependency additions,
lockfile changes, integration, PRs, CI repair, and the checkpoint receipts.

## P3 dependency order and completion boundary

Follow this order unless an ADR proves a safer alternative:

```text
P2 reconfirmation
  -> Temporal lifecycle + adapter descriptor
  -> deterministic workflow definitions + versioning
  -> idempotent Activities + receipt mapping
  -> signals, queries, cancellation, human gates
  -> crash/restart/replay harness
  -> Temporal-linked Observatory projection fixture
  -> clean-checkout P3 verifier + receipt
```

The work is not complete when workers spawn, an entry audit lands, one PR turns
green, or T1 passes. Stop only when every `P3_PLAN.md` gate is proven,
`pnpm verify:p3` and the complete verification ladder pass from a clean checkout,
the checkpoint receipt matches executed evidence, default-branch CI is green at
the recorded commit, and `v0.3.0-temporal-control-plane` is ready to record.

## Known risks and immediate checks

- **Delegation reliability:** this is the reason for the restart. Prove a single
  spawn/status cycle before distributing work.
- **Contract drift:** `packages/workflow` currently implements the local durable
  runtime. Inspect ports before choosing whether the Temporal adapter belongs in
  that package or a new inward-dependent package. Record architectural changes in
  an ADR before code depends on them.
- **Lifecycle scope:** the P2 production profile currently manages Postgres/CAS.
  Temporal namespace, task queue, retention, startup, shutdown, and restart
  behavior are unresolved until the entry audit proves otherwise.
- **Dependency and CI cost:** adding the Temporal SDK/server lifecycle will change
  manifests, lockfile, CI duration, and local requirements. Keep those changes
  coordinator-owned.
- **False evidence:** never create receipts from intended commands. A receipt must
  identify the command, date, result, and commit actually exercised.
- **Authority leakage:** Temporal history can explain orchestration but cannot
  render unsupported product facts or replace Postgres/CAS projection queries.

## Copy/paste restart brief

```text
Resume Mammoth P3 from docs/handoffs/2026-07-11-p3-session-restart.md.
Treat origin/main commit d28e1314bda694f1c9f8914536e001f0c19070e1 as
the verified planning baseline, then fetch and reconcile newer default-branch
state if present. No P3 workers were active and no P3 implementation had begun
when the handover was written. Use a clean isolated worktree, reconfirm P2, then
spawn exactly one bounded entry-audit worker and immediately verify it with the
live agent-status tool. Do not claim a worker is active without that evidence.
After delegation is proven, follow AGENTS.md, LOOP.md, and P3_PLAN.md autonomously
through the full v0.3.0-temporal-control-plane stopping condition. Do not contact
Beaux for routine progress.
```
