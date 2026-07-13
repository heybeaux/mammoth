# P5 Coordinator Ledger

> Started: 2026-07-13T22:20:00Z
>
> Coordinator worktree: `/private/tmp/mammoth-p5-integration`
>
> Integration branch: `feat/p5-isolated-divergence`
>
> P5 entry baseline: `5c31dfb4c749d3c87391318fddeb6f2c664f1af9`

## Entry Gate

`origin/main` resolves to `5c31dfb4c749d3c87391318fddeb6f2c664f1af9`, the P5
entry commit. The integration checkout is on `feat/p5-isolated-divergence` at the
same commit.

The existing `/private/tmp/mammoth-p5-entry` worktree is preserved and unassigned.
Its dirty state at entry inspection was:

```text
## docs/p5-entry...origin/docs/p5-entry
 M packages/temporal-adapter/src/research-cli.ts
?? .openclaw/
?? .receipts/
?? HEARTBEAT.md
?? IDENTITY.md
?? SOUL.md
?? TOOLS.md
?? USER.md
```

## Worker Ownership

### T1/T2 Contracts And Policy

State: integrated.

Worker runtime: Codex worker fallback. Durable OpenClaw `sessions_spawn` and live
registry tools were not exposed in this turn's tool surface, so this worker must
not be called active until a live registry or final handoff proves it.

Agent id: `019f5d92-d1ec-70e1-8a1f-065d1ed38353`

Worktree: `/private/tmp/mammoth-p5-t1-t2`

Branch: `feat/p5-t1-t2-contracts-policy`

Baseline: `5c31dfb4c749d3c87391318fddeb6f2c664f1af9`

Objective and acceptance evidence: implement P5 T1/T2 pure contracts and policy:
commit-before-reveal isolation protocol `1.0.0`, sanitized review-context
contract `1.0.0`, deterministic assignment/correlation/dissent/residue policy
`1.0.0`, and adversarial fixtures proving early reveal, digest drift, mutable
references, reviewer-context leakage, self-review, correlated/unknown lineage,
dissent erasure, and residue loss all fail closed.

Owned paths: `packages/domain/src/**`, `packages/domain/test/**`,
`packages/evidence/src/**` only for pure canonical/audit primitives,
`packages/evidence/test/**` only if touched, `evals/fixtures/p5/**` for T1/T2
fixture cases, and `evals/p5-acceptance/**` only for pure T1/T2 evaluator stubs.

Non-owned paths: `packages/persistence/**`, `packages/workflow/**`,
`packages/temporal-adapter/**`, `packages/observatory-projection/**`,
`packages/governance/**`, `packages/work-queue/**`, `.github/**`, `scripts/**`,
`docs/reviews/**`, `evals/reports/**`, and `pnpm-lock.yaml` unless a dependency
is unavoidable.

Allowed contracts: isolation protocol `1.0.0`, sanitized review context
`1.0.0`, assignment/correlation/dissent/residue policy `1.0.0`, and pure
canonical identity/digest helpers.

Verification commands: `pnpm --filter @mammoth/domain test`;
`pnpm --filter @mammoth/evidence test` if touched; `pnpm typecheck` if feasible;
and any P5 evaluator tests added by the worker.

Handoff recipient: P5 coordinator in `/private/tmp/mammoth-p5-integration`.

Fresh evidence: after spawn, the worktree showed staged changes in
`packages/domain/src/research-cell.ts`, `packages/domain/test/research-cell.test.ts`,
and `evals/fixtures/p5/t1-t2-contracts-policy-manifest.json`. It also showed a
non-owned modification to `packages/temporal-adapter/src/research-cli.ts`.
Coordinator interruption `019f5d97-2828-7451-b606-c1d13ca01175` instructed the
worker to stop touching the non-owned path, revert that file if the change was
theirs, or return a conflict note.

Completion handoff: worker returned completed status with commit
`1bd6a59b69fc6e7318fe649d09bc06b4c973072e`. It reported
`pnpm install --frozen-lockfile`, `pnpm --filter @mammoth/domain test`, and
`pnpm typecheck` passing in its worktree. It reported the non-owned
`packages/temporal-adapter/src/research-cli.ts` diff remained unstaged and was
not committed.

Integration: coordinator cherry-picked the owned commit as
`40bd17b` on `feat/p5-isolated-divergence`. Integration verification:
`pnpm install --frozen-lockfile` passed; `pnpm --filter @mammoth/domain test`
passed with 3 files and 38 tests; `pnpm typecheck` passed.

### T3 Persistence And Budget

State: spawn requested; fresh worktree artifacts observed. Not active by Mammoth's
live-registry definition.

Worker runtime: Codex worker fallback. Durable OpenClaw `sessions_spawn` and live
registry tools were not exposed in this turn's tool surface, so this worker must
not be called active until a live registry or final handoff proves it.

Agent id: `019f5d93-2835-7ea1-9171-67426c00bdd1`

Worktree: `/private/tmp/mammoth-p5-t3`

Branch: `feat/p5-t3-persistence-budget`

Baseline: `5c31dfb4c749d3c87391318fddeb6f2c664f1af9`

Objective and acceptance evidence: implement P5 T3 authoritative persistence,
budget settlement, and cancellation lifecycle behind inward-facing ports with
forward-only migration(s) after P4 migration `5`, stable identities, uniqueness,
foreign keys, optimistic revision, fencing, duplicate-delivery idempotency,
bounded settlement/release, partial cancellation receipts, integrity failure, and
restart reconstruction.

Owned paths: `packages/persistence/src/**`, `packages/persistence/test/**`,
`packages/persistence/sql/**`, `packages/governance/src/**` and
`packages/governance/test/**` only for budget settlement/cancellation lifecycle,
`packages/work-queue/src/**` and `packages/work-queue/test/**` only for stable
effect receipt primitives, and `evals/fixtures/p5/**` for T3 fixture data.

Non-owned paths: `packages/domain/**`, `packages/evidence/**`,
`packages/workflow/**`, `packages/temporal-adapter/**`,
`packages/observatory-projection/**`, `.github/**`, `scripts/**`,
`docs/reviews/**`, `evals/reports/**`, and `pnpm-lock.yaml` unless a dependency
is unavoidable.

Allowed contracts: P5 persistence port shapes, P5 migration versions/checksums,
budget settlement and cancellation-receipt contract `1.0.0`, and stable
reservation/settlement/release/provider-effect/cancellation identity helpers in
owned packages.

Verification commands: `pnpm --filter @mammoth/persistence test`;
`pnpm --filter @mammoth/governance test` if touched;
`pnpm --filter @mammoth/work-queue test` if touched; `pnpm typecheck` if
feasible.

Handoff recipient: P5 coordinator in `/private/tmp/mammoth-p5-integration`.

Fresh evidence: after spawn, the worktree showed changes in
`packages/persistence/src/research-cells.ts` and
`packages/persistence/test/research-cells.test.ts`. An earlier non-owned
modification to `packages/temporal-adapter/src/research-cli.ts` was observed and
coordinator interruption `019f5d97-4367-7031-a8e1-7db187302571` instructed the
worker to stop touching the non-owned path. A follow-up status showed only owned
paths modified.

### T4/T5 Workflow And Projection

State: spawn requested; fresh worktree artifacts observed. Not active by Mammoth's
live-registry definition.

Worker runtime: Codex worker fallback. Durable OpenClaw `sessions_spawn` and live
registry tools were not exposed in this turn's tool surface, so this worker must
not be called active until a live registry or final handoff proves it.

Agent id: `019f5d93-8865-7160-b077-89623d67310a`

Worktree: `/private/tmp/mammoth-p5-t4-t5`

Branch: `feat/p5-t4-t5-workflow-projection`

Baseline: `5c31dfb4c749d3c87391318fddeb6f2c664f1af9`

Objective and acceptance evidence: implement P5 T4/T5 deterministic
divergence/review workflow contracts, Temporal execution/recovery shell, and
read-only fail-closed Observatory/operator projection. Product state must
reconstruct from Postgres/CAS ports; Temporal history is not product authority.

Owned paths: `packages/workflow/src/**`, `packages/workflow/test/**`,
`packages/temporal-adapter/src/**`, `packages/temporal-adapter/test/**`,
`packages/observatory-projection/src/**`,
`packages/observatory-projection/test/**`, `apps/cli/**` only for read-only
operator projection wiring, and `evals/fixtures/p5/**` for T4/T5 fixtures.

Non-owned paths: `packages/domain/**`, `packages/persistence/**`,
`packages/governance/**`, `packages/work-queue/**`, `.github/**`, `scripts/**`,
`docs/reviews/**`, `evals/reports/**`, and `pnpm-lock.yaml` unless a dependency
is unavoidable.

Allowed contracts: divergence/review workflow application and carry major `1`,
workflow IDs/signals/queries/retry/cancellation/versioning/continue-as-new
contracts, and P5 read-only Observatory projection schema extension for
isolation, review, spend, cancellation, retry, receipt, and operator-inspection
state.

Verification commands: `pnpm --filter @mammoth/workflow test`;
`pnpm --filter @mammoth/temporal-adapter test`;
`pnpm --filter @mammoth/observatory-projection test`; `pnpm typecheck` if
feasible.

Handoff recipient: P5 coordinator in `/private/tmp/mammoth-p5-integration`.

Fresh evidence: after spawn, the worktree showed changes in
`packages/workflow/src/index.ts`, `packages/workflow/src/p5-contract.ts`,
`packages/workflow/test/p5-contract.test.ts`,
`packages/temporal-adapter/src/index.ts`,
`packages/temporal-adapter/src/research-cli.ts`,
`packages/temporal-adapter/src/p5-workflow-shell.ts`, and
`packages/temporal-adapter/src/p5-workflow-types.ts`. These paths are within the
T4/T5 assignment.

## Coordinator-Owned T6

State: in progress.

Owned paths: integration branch, `docs/reviews/p5-coordinator-ledger.md`,
eventual `scripts/verify-p5.ts`, `.github/workflows/ci.yml`, `P5_PLAN.md`
reality updates, `evals/reports/v0.5.0-isolated-divergence.md`, PR body, CI
repair, independent adversarial review coordination, merge, post-merge main
verification, and annotated release tag.

Current risk: the requested durable OpenClaw worker runtime is unavailable in the
current tool surface. Codex workers were spawned as bounded fallback workers, but
their state remains `spawn requested` until live status or handoff evidence is
available. The coordinator must not mark the P5 entry gate complete until each
worker has one live owner proven by the appropriate registry or an accepted
replacement strategy is documented.
