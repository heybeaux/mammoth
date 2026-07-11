# Mammoth Worker Contract

## Mission and authority

Build Mammoth from the completed `v0.1.0-mvp` baseline through the active batch in
`POST_MVP_ROADMAP.md`. `ARCHITECTURE.md` is the normative architecture,
`POST_MVP_ROADMAP.md` defines post-MVP sequencing, `MVP_PLAN.md` records the
completed initial checkpoint, and `LOOP.md` defines execution. Preserve
architecture invariants if any wording conflicts and record the conflict instead
of weakening a gate.

Workers may inspect, implement, test, commit, push, open or review pull requests,
repair CI, and merge accepted work without human confirmation until the checkpoint.
Contact Beaux only under the escalation conditions in `LOOP.md`.

## Before taking work

Read this file, `MVP_PLAN.md`, `LOOP.md`, the relevant package tests, and
`ARCHITECTURE.md` sections 6, 7, 38, 40, 42, and 44. Every assignment must name:

- objective and acceptance evidence;
- owned paths;
- contracts that may change;
- dependencies and non-owned paths;
- verification commands;
- handoff recipient.

Do not silently broaden an assignment. The coordinator owns cross-package scope.

## Non-negotiable invariants

- No factual sentence without a claim ID.
- No accepted claim without a named evidence-policy verdict.
- Model agreement never promotes truth.
- Models propose mutations; deterministic code validates and commits them.
- Evidence is immutable and content-addressed; locators and freshness are explicit.
- Contradictions, unresolved states, failures, and red results remain inspectable.
- Multi-step handoffs are typed and meaningful actions produce verifiable receipts.
- Memory is not truth.
- External effects use stable idempotency keys and attributable work items.
- Cloud egress requires policy, classification, provider, budget, and cost records.

A green test that violates an invariant is a failing implementation.

## Package boundaries

- `packages/domain`: pure schemas and state machines; no database, HTTP, model SDK,
  orchestration implementation, or UI dependency.
- `packages/evidence`: canonical evidence, policy, audit, and handoff primitives.
- `packages/retrieval`: hostile-input retrieval, snapshots, parsing, and security;
  retrieval cannot promote a claim.
- `packages/persistence`: repositories, ledger, CAS, and migrations behind ports.
- `packages/report-compiler`: manifest validation and rendering; rendering cannot
  introduce facts.
- `packages/workflow`: deterministic durable program state and runtime ports.
- `packages/work-queue`: leases, retries, idempotency, and effect receipts.
- `packages/governance`: budgets, human gates, revalidation, and fail-closed policy.
- Runtime, adapters, workers, and apps depend inward through ports. Adapters do not
  import each other and UI projections are never authoritative.

One worker owns a file or package at a time. Cross-package contracts require an
explicit integration task.

## Shared-checkout safety

Assume the worktree may be shared and dirty. Inspect `git status --short --branch`
before editing and preserve unexpected changes.

- Never use `git reset --hard`, `git clean`, broad restore, force push, or a
  destructive rebase.
- Never stage with `git add .` or `git add -A`; stage owned paths only.
- Never amend or rewrite another worker's commit.
- Do not run repository-wide formatting while concurrent edits exist.
- Prefer isolated branches or worktrees. In a shared checkout, declare ownership
  and commit one coherent change at a time.
- Do not hand-edit generated build output.

## Implementation discipline

Build the smallest vertical slice that satisfies a measured gate. Keep clocks,
IDs, network calls, storage, and side effects injectable. Validate trust boundaries
at runtime, use strict TypeScript and exhaustive unions, and classify errors by
retryability and policy effect. Never add fake receipts, test bypasses, embedded
secrets, or happy-path-only recovery logic.

Architecture decisions require an ADR with context, options, decision,
consequences, and evidence. Migrations are forward-only and must test empty,
upgrade, and interrupted states.

## Verification ladder

During implementation, run affected package tests, typecheck, and build. Before a
handoff, format owned files and run the relevant phase verifier. Before merge or
checkpoint, run:

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm verify:evidence
pnpm verify:audit
pnpm verify:phase-1
pnpm eval:offline
```

Also run every verifier introduced by the active loop, including
`verify:phase-2` and `verify:mvp`. Never claim a check passed unless it ran; record
the command and result. Phase 2 requires crash, restart, retry, lease-expiry,
idempotency, budget, and cancellation tests.

## Commits, reviews, and handoffs

Use scoped, imperative commits containing one coherent concern. A pull request must
state the objective, invariant and checkpoint item served, changed contracts, exact
verification, risks, migrations, and compatibility notes. CI green is necessary,
not sufficient: review the diff and failure behavior before merge.

Every handoff includes:

```text
Task / status / owned paths / commit or PR / contracts changed
tests and results / risks or unverified areas / blockers / next task
```

An item is done only when its acceptance evidence exists, tests and docs are
updated, required gates pass, the change is merged, and `MVP_PLAN.md` or the loop
receipt reflects reality. Do not stop because one task is done; claim the next
unblocked loop item and continue until the checkpoint is proven.
