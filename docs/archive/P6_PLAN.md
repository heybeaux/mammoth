# Mammoth P6 Broader Research Topology Checkpoint

> Status: frozen entry contract — implementation starts only after this plan is
> merged to `main`
>
> Baseline: `v0.5.0-isolated-divergence`
>
> Target: `v0.6.0-research-topology`
>
> Prior receipt:
> [`evals/reports/v0.5.0-isolated-divergence.md`](evals/reports/v0.5.0-isolated-divergence.md)

## Naming boundary

This is checkpoint **P6** in `POST_MVP_ROADMAP.md`: broader research topology.
It extends the P4 research-cell contracts and P5 isolated-divergence execution
into an inspectable multi-cell topology. It is not a managed production
deployment, live-provider quality checkpoint, or 3D Observatory UI checkpoint.

`ARCHITECTURE.md` remains normative. If this plan and the architecture appear to
conflict, preserve the architecture invariant, record the conflict, and stop
before weakening a gate.

## Outcome

P6 is complete when Mammoth can plan and execute a deterministic, versioned
multi-cell research topology spanning landscape, divergence, prior-art,
falsification, experiment, and synthesis cells. The topology must expose explicit
dependencies, bounded concurrency, budgets, failure policy, and stable cell
identities; survive process, worker, and Temporal-service restart; preserve
dissent and honest partial failure; stay within budget; and emit a dossier whose
factual sentences retain the MVP provenance guarantee.

Postgres/CAS remains authoritative for product state, artifacts, receipts, audit,
budget, and projection source data. Temporal owns orchestration history, parent
and child workflow composition, retries, timers, signals, cancellation delivery,
queries, and replay evidence only. Observatory projections remain read-only and
fail closed.

P6 does not claim live-provider epistemic quality, managed infrastructure, public
cloud deployment, automatic experiment sandbox provisioning beyond deterministic
offline fixtures, or the spatial Observatory UI.

## Entry gate

- [x] P5 code is merged, verified, tagged, and recorded in
      `evals/reports/v0.5.0-isolated-divergence.md`.
- [x] `AGENTS.md`, `LOOP.md`, and `POST_MVP_ROADMAP.md` identify P6 as the next
      checkpoint and preserve the P2-P5 authority boundaries.
- [ ] This P6 contract is merged to `main` in a distinct reviewable entry PR.
- [ ] The integration branch and all implementation worktrees are recreated or
      resynced from the merged P6-plan baseline before implementation claims.
- [ ] A bounded OpenClaw worker probe proves the intended model/thinking route
      before fan-out; every worker is verified active through the live registry
      before being described as active.

No implementation slice may claim P6 progress until every unchecked entry item is
complete.

## Frozen entry decisions

- Topology plan schema: `1.0.0`.
- Cell-template catalog schema: `1.0.0`.
- Topology planner policy: `1.0.0`.
- Topology budget and starvation policy: `1.0.0`.
- Synthesis contract: `1.0.0`.
- Topology projection schema extension: `1.0.0`.
- P6 topology workflow application contract major: `1`.
- P6 topology workflow version: `1`.
- P6 Postgres migrations begin after P5 migration `6`; exact forward-only
  versions and checksums are recorded in the final receipt.
- Stable topology identities bind program ID, criterion ID/version/digest,
  topology-plan version, planner-policy version, template-catalog version, input
  digest, and budget-policy version.
- Stable topology-cell identities bind topology ID, node ID, cell template ID and
  version, dependency digest, work-item contract digest, criterion
  ID/version/digest, and role.
- Stable child workflow IDs derive from topology ID, cell identity, cell attempt,
  workflow major, and run partition. Retries and duplicate delivery return
  existing receipts instead of duplicating state or spend.
- Scheduler state distinguishes `idle_no_ready_work`, `blocked_dependency`,
  `budget_starved`, `concurrency_saturated`, `failed_policy`, `cancelled`, and
  `complete`.
- Synthesis may describe position distribution, agreement, disagreement,
  criterion drift, and lineage diversity, but it may cite only admitted claim IDs
  as factual support and never treat agreement as truth authority.

Architecture decisions that change these boundaries require an ADR before code
integration.

## Path ownership and team lanes

The coordinator owns cross-package contracts, integration, PRs, CI repair,
receipt, tag, and final checkpoint claim. Workers must stop with a conflict note
before editing outside their owned paths.

### Lane A — topology/domain contracts and deterministic planner

Owned paths:

- `packages/domain/src/**`
- `packages/domain/test/**`
- `packages/workflow/src/p6-contract.ts`
- `packages/workflow/test/p6-contract.test.ts`
- `evals/fixtures/p6/**`

Allowed contract changes: topology plan, cell-template catalog, planner-policy,
cell dependency graph, scheduler state, synthesis input/output identity, and pure
validation errors.

Non-owned paths: persistence, Postgres migrations, Temporal workers, Observatory
builder implementation, CI, receipts.

Verification: `pnpm --filter @mammoth/domain test`,
`pnpm --filter @mammoth/workflow test`, and the P6 manifest gate once created.

Handoff recipient: coordinator/integrator.

### Lane B — authoritative persistence, budget, and Temporal execution

Owned paths:

- `packages/persistence/src/**`
- `packages/persistence/test/**`
- `packages/postgres-adapter/src/**`
- `packages/postgres-adapter/test/**`
- `packages/production-profile/src/**`
- `packages/production-profile/test/**`
- `packages/temporal-adapter/src/**`
- `packages/temporal-adapter/test/**`

Allowed contract changes: inward-facing topology repositories, migration `7+`,
budget reservation/settlement/release for topology cells, child workflow
execution contracts, cancellation receipts, restart reconstruction, bounded
history, and replay fixtures.

Non-owned paths: domain schema design except through explicit integration,
Observatory UI/projection schema except through explicit integration,
acceptance receipt.

Verification: affected package tests, native Postgres migration/profile gates,
Temporal live P6 recovery tests, and `pnpm verify:p6` once wired.

Handoff recipient: coordinator/integrator.

### Lane C — evidence-aware synthesis, projections, and adversarial acceptance

Owned paths:

- `packages/observatory-projection/src/**`
- `packages/observatory-projection/test/**`
- `packages/report-compiler/src/**`
- `packages/report-compiler/test/**`
- `evals/p6-acceptance/**`
- `scripts/verify-p6.ts`
- `.github/workflows/ci.yml` only for adding the visible P6 gate after verifier
  implementation

Allowed contract changes: read-only topology projection extension, synthesis
manifest validation over admitted claim IDs, P6 verifier result shape, executable
case mapping, and fixture manifest schema.

Non-owned paths: authoritative stores, Temporal execution logic, topology planner
policy except via public contracts.

Verification: projection/report-compiler tests, `pnpm verify:p6`, and CI
visibility of the P6 gate.

Handoff recipient: coordinator/integrator.

### Independent reviewer

Owned paths:

- `docs/reviews/p6-independent-review.md`
- temporary review notes outside owned implementation paths

The reviewer must not author implementation changes. The reviewer attacks
authority drift, truth-by-consensus, missing provenance, hidden Temporal state,
budget overspend, cancellation dishonesty, projection writes, fixture gaps, and
receipt accuracy. Findings must be resolved and re-reviewed before the code PR
merges.

## Delivery slices

### T1 — Topology templates and planner contracts

Deliver versioned landscape, divergence, prior-art, falsification, experiment,
and synthesis templates from `ARCHITECTURE.md` section 18, plus a pure topology
plan schema with explicit node dependencies, dependency artifact kinds,
concurrency limits, budget ceilings, retry/cancellation policy, and failure
semantics.

Gate: cycles, missing nodes, unknown template versions, mutable criterion
references, invalid dependency artifact kinds, unbounded concurrency, unbounded
budgets, duplicate node identities, and unknown failure policies fail closed.

### T2 — Deterministic planner and scheduler state

Deliver a deterministic planner that produces stable topology IDs, cell IDs,
child workflow IDs, work-item contracts, and dependency digests for a fixed
program state. The planner must distinguish no ready work from budget starvation,
blocked dependencies, and concurrency saturation.

Gate: reordering equivalent inputs does not change canonical digests; budget
starvation cannot be reported as idle completion; failed or cancelled
dependencies remain inspectable; retry eligibility is policy-defined.

### T3 — Authoritative persistence and budget lifecycle

Add forward-only Postgres migrations and inward-facing ports for topology plans,
template versions, cell nodes, dependencies, attempts, dependency artifacts,
budget reservations, settlements, releases, partial results, cancellation
receipts, scheduler snapshots, and topology receipts.

Gate: empty install, P5 upgrade, interrupted migration, uniqueness, foreign keys,
optimistic revision/fencing, duplicate delivery, stale writes, overspend,
settlement beyond reservation, release-after-final-settlement, partial
cancellation, digest corruption, and restart reconstruction pass.

### T4 — Temporal parent/child topology execution

Implement deterministic parent/child workflow composition for topology programs.
The parent workflow owns orchestration, signals, queries, cancellation
propagation, retry policy, bounded history, and `continueAsNew`; child workflows
execute cell contracts and reconstruct product state from Postgres/CAS by stable
ID.

Gate: workflow worker, Activity worker, client, and local Temporal service death
before and after each durable boundary loses no authoritative state, duplicates
no cell, reservation, settlement, release, receipt, or charge, and honestly
collects partial results after cancellation or failed dependencies.

### T5 — Evidence-aware synthesis and dossier provenance

Deliver synthesis contracts that admit only supported claim IDs, named policy
verdicts, immutable evidence locators, experiment receipts, preserved dissent,
and unresolved issues. Synthesis may include descriptive consensus metrics only
when labelled non-authoritative.

Gate: correlated consensus, unsupported agreement, missing evidence, criterion
drift, invalid experiment receipts, and hidden reviewer/verdict leakage cannot
enter factual dossier sentences. Report rendering cannot introduce new facts.

### T6 — Read-only topology projection and operator inspection

Extend Observatory projections with topology plan, cell state, dependencies,
lineage, disagreement, spend, reservations, receipts, retries, cancellation,
partial failure, and synthesis trace. Projection source data must be Postgres/CAS
and immutable artifacts, with Temporal identifiers linked only as orchestration
references.

Gate: projection construction fails closed on future authority, broken
references, digest mismatch, impossible sequence, hidden product state in
Temporal, projection write attempts, overspend, silent node omission, and
non-deterministic digest.

### T7 — Acceptance, independent review, receipt, and release

Add deterministic fixtures, non-recursive `pnpm verify:p6`, full clean-checkout
evidence, default-branch CI enforcement, independent adversarial review, exact
release receipt, and annotated `v0.6.0-research-topology` tag.

Gate: findings are fixed and re-reviewed; the code PR is merged; post-merge
`main` CI visibly runs `verify:p6`; the exact receipt is merged; and the
annotated tag points to the code-bearing merge.

## Required adversarial fixtures

- topology with a cycle;
- topology with a missing dependency node;
- topology with an unknown template version;
- topology with unbounded concurrency or budget;
- topology with duplicate stable node identities;
- criterion drift between parent topology and child cell;
- landscape output missing claim or evidence IDs;
- divergence agreement over unsupported claims;
- correlated consensus presented as independent support;
- valid dissent retained through prior-art, falsification, and synthesis;
- adversarial dissent with admissible evidence that contradicts the majority;
- prior-art challenge producing `rediscovered`, `known_combination`,
  `new_to_project`, and `apparently_novel_as_of_date` outputs without claiming
  universal novelty;
- falsification cell preserving counterexamples, cheaper decisive tests, invalid
  critiques, abstentions, and unresolved boundary conditions;
- experiment contract with hidden holdout leakage, invalid environment digest,
  failed run, cancelled run, and valid reproduced run;
- evidence-aware synthesis attempted with missing evidence, invalid policy
  verdict, stale criterion, unsupported agreement, and admitted claims only;
- scheduler state proving idle, blocked dependency, concurrency saturation, and
  budget starvation are distinct;
- duplicate topology plan, child dispatch, reservation, settlement, release,
  provider effect, cancellation, and receipt delivery;
- budget starvation before dispatch and mid-topology after partial completion;
- cancellation before dispatch, during a child workflow, after a child succeeds
  before synthesis, during synthesis, and during settlement;
- workflow-worker, Activity-worker, client, and Temporal-service death at parent
  and child durable boundaries;
- `continueAsNew` reconstruction and replay across every supported P6 workflow
  version;
- migration interruption, stale fencing, digest corruption, broken references,
  future projection authority, projection write attempt, and deterministic
  restart/projection digest;
- a clean multi-cell acceptance run that survives restart, preserves dissent,
  stays within budget, records partial failures, and emits a dossier manifest
  whose factual sentences all resolve to admitted claims with named policy
  verdicts and immutable evidence digests.

Fixtures must exercise production-shaped public boundaries rather than duplicating
implementation logic inside the verifier.

## Verification

`pnpm verify:p6` is a non-recursive wrapper around code-owned gates for:

- fixture-manifest coverage;
- topology contract and planner validation;
- deterministic scheduler and budget-starvation policy;
- authoritative persistence, migrations, and budget lifecycle;
- Temporal parent/child execution, cancellation, recovery, and replay;
- evidence-aware synthesis and dossier provenance;
- read-only fail-closed Observatory topology projection; and
- clean multi-cell acceptance run.

The final clean-checkout ladder is:

```sh
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm verify:evidence
pnpm verify:audit
pnpm verify:phase-1
pnpm verify:phase-2
pnpm verify:adapters
pnpm verify:m2
pnpm verify:m3
pnpm verify:mvp
pnpm verify:p2
pnpm verify:p3
pnpm verify:p4
pnpm verify:p5
pnpm verify:p6
pnpm eval:offline
```

P2 lifecycle/backup, P3 Temporal, P4 contract, and P5 isolation gates remain
independently runnable. Provider-dependent live model calls remain outside
offline CI; deterministic workers and stubs must prove the P6 contracts without
claiming live-provider quality.

## Receipt schema

`evals/reports/v0.6.0-research-topology.md` records the exact baseline, plan PR,
code-bearing merge, code PR, receipt PR, annotated tag object and target, frozen
versions, stable identities, migrations/checksums, fixture manifest, executed
commands/durations, CI run URL and ID with visible `verify:p6`, projection
digest, topology acceptance run digest, independent review findings/fixes and
re-review, limitations, and P7 deferrals. Claims in the receipt must match
inspectable executed evidence.

## Stopping condition

Stop only when every gate and fixture above passes; the complete clean-checkout
ladder is green; a non-author semantic/adversarial review is resolved and
re-reviewed; `pnpm verify:p6` is visibly enforced by default-branch CI; the code
PR is merged; post-merge `main` CI is green; the exact receipt is merged; and the
annotated `v0.6.0-research-topology` tag points to the code-bearing merge. Then
send one concise checkpoint report and do not claim P6 before the merged receipt
proves every predicate.
