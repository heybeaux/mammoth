# Mammoth P5 Isolated-Divergence Checkpoint

> Status: active — contract freeze and implementation entry
>
> Baseline: `v0.4.0-research-cell-contracts`
>
> Target: `v0.5.0-isolated-divergence`
>
> Human contact: checkpoint completion or an escalation explicitly allowed by
> `LOOP.md`

## Naming boundary

This is checkpoint **P5** in `POST_MVP_ROADMAP.md`: isolated divergence and blind
review. It is not “Phase 5 — Experiments and evaluators” in section 42 of
`ARCHITECTURE.md`. Experiment sandboxes, hidden evaluators, and the
`experimentally_differentiated` status remain later architecture work unless a P5
acceptance fixture needs a deterministic stub at an existing port.

## Outcome

P5 is complete when Mammoth can execute research positions in isolated divergence
cells, durably commit them before peer exposure, assign sanitized blind reviews
under deterministic self-review/correlation policy, preserve dissent and failed or
unfinished residue, and settle budgets and cancellation without duplicate effects
or false completion.

Postgres/CAS remains product authority. Temporal owns orchestration history,
signals, timers, retries, cancellation delivery, and replay, but reconstructs
product state through stable identifiers. Process scheduling, worker memory, and
Temporal history alone are not proof of isolation.

P5 does not claim broader landscape/prior-art/falsification/experiment/synthesis
topology, managed infrastructure, live-provider quality, or the 3D Observatory UI.
Those remain P6 or managed-deployment work.

## Entry gate

- [x] P4 code is merged as `34ed6ca`, `pnpm verify:p4` is enforced and green on
      default-branch CI, and `v0.4.0-research-cell-contracts` points to the
      code-bearing merge.
- [x] The P4 release receipt records the frozen research-cell, model-lineage,
      persistence, workflow-carriage, and projection contracts.
- [x] `AGENTS.md`, `LOOP.md`, and `POST_MVP_ROADMAP.md` identify P5 as active and
      preserve the P2-P4 authority boundaries.
- [x] The P5 contract versions, slices, adversarial fixtures, verifier shape,
      release label, and stopping condition are frozen here before implementation.
- [ ] A clean integration worktree and path-disjoint worker worktrees are created
      from the P5 entry commit; each has one live owner.

## Frozen entry decisions

- Isolation protocol: `1.0.0`.
- Sanitized review-context contract: `1.0.0`.
- Review-assignment/correlation policy: `1.0.0`.
- Budget settlement and cancellation-receipt contract: `1.0.0`.
- Divergence/review workflow application and carry major: `1`.
- P5 Postgres migrations begin after P4 migration `5`; exact forward-only
  versions and checksums are recorded in the final receipt.
- Stable position identities bind program, criterion ID/version/digest, cell plan
  and work item versions, branch, role, model-profile version, input digest, and
  isolation-protocol version.
- Stable review identities bind the committed position digest, assignment and
  policy versions, reviewer profile version, sanitized-context digest, and output
  schema version.
- Stable reservation, settlement, release, provider-effect, and cancellation
  identities derive from authoritative work and attempt IDs. Repeated delivery
  returns existing receipts rather than duplicating spend or state.
- Author attribution remains in authoritative audit state but is prohibited from
  reviewer input together with author model/provider, confidence, popularity,
  prior verdicts, and upstream PASS markers.
- Isolation is proved by authoritative commit/reveal states, digests, and audit
  sequence. An in-memory flag, queue order, or process timing cannot satisfy it.

Architecture decisions that change these boundaries require an ADR before code
integration.

## Delivery slices

### T1 — Isolation and sanitized-context contracts

Deliver pure, versioned commit-before-reveal and review-context schemas and state
machines. A position cannot read peer material before its immutable input and
output digests, criterion, model-profile version, receipt references, and audit
sequence are durably committed. Review-context construction is allowlist-based,
canonical, and rejects future or prohibited fields.

Gate: early reveal, digest drift, mutable criterion/profile references, missing
commit evidence, unknown versions, and reviewer-context leakage fail closed.

### T2 — Assignment, correlation, dissent, and residue policy

Deliver deterministic, versioned review assignment over P4 lineage/correlation
records. Same-role self-review is impossible; correlated or unknown lineage is
rejected or penalized exactly as policy declares. Preserve minority positions,
unresolved conflicts, abstentions, invalid reviews, criterion drift, rejected
assignments, and unfinished work with reason codes and attribution.

Gate: blind input cannot bypass author-aware assignment, consensus cannot erase
dissent, and synthesis cannot treat invalid, correlated, or absent reviews as
independent support.

### T3 — Authoritative persistence and budget lifecycle

Add forward-only Postgres migrations and inward-facing ports for isolation
commits/reveals, review assignments/contexts/results, dissent/residue, cell
attempts, reservations, settlements, releases, provider charges, partial results,
and cancellation receipts. Enforce canonical digests, uniqueness, foreign keys,
optimistic revision, fencing, and exact restart reconstruction.

Reserve budget before dispatch. Record attempted, afforded, rejected, consumed,
released, timed-out, and cancelled amounts without exceeding the reservation or
policy ceiling. Persistence and external-effect receipts use stable identities.

Gate: empty install, P4 upgrade, repeat/interruption, concurrent/stale writes,
duplicate delivery, over-settlement, partial cancellation, integrity failure, and
real restart reconstruction pass.

### T4 — Temporal divergence and blind-review execution

Implement deterministic divergence/review workflows and separately testable
Activities with stable IDs, task queues, signals, queries, retries, cancellation,
versioning, bounded history, and `continueAsNew`. Product state reconstructs from
Postgres/CAS. Activity effects are idempotent and attributable.

Gate: kill and restart clients, workflow workers, Activity workers, and the local
Temporal service before and after position commit, reveal, assignment, review
commit, budget settlement/release, and cancellation. No authoritative state is
lost and no position, review, reservation, release, receipt, or charge duplicates.

### T5 — Recovery, projection, and operator inspection

Extend read-only Observatory projections and operator inspection with isolation
state, commit/reveal sequence, sanitized-context digest, assignment attribution,
lineage/correlation, dissent/residue, reservation/settlement, partial result,
cancellation, retry, and receipt linkage. Projection construction fails closed on
future authority, broken references, digest mismatch, impossible sequence,
overspend, or hidden product state in Temporal.

Gate: projection digests and restart reconstruction are deterministic, while the
operator can inspect attribution without exposing prohibited fields in the
reviewer contract.

### T6 — Acceptance, independent review, receipt, and release

Add the frozen deterministic fixtures, non-recursive `pnpm verify:p5`, full
clean-checkout evidence, default-branch CI enforcement, a non-author adversarial
review, and `evals/reports/v0.5.0-isolated-divergence.md`.

Gate: findings are fixed and re-reviewed; the code PR is merged; post-merge main
CI visibly runs `verify:p5`; the exact receipt is merged; and the annotated
`v0.5.0-isolated-divergence` tag points to the code-bearing merge.

## Required adversarial fixtures

- two divergence workers where one attempts to read the peer before committing;
- reveal attempted with no durable commit, a mismatched digest, or stale criterion;
- one valid commit followed by permitted peer reveal;
- reviewer context containing each prohibited field, including nested/unknown
  future fields and digest-confusion variants;
- authoritative assignment/audit state retaining attribution while reviewer input
  remains sanitized;
- same-profile same-role self-review and alias/checkpoint-equivalent self-review;
- correlated, unknown-lineage, and valid cross-family review panels;
- one minority position and unresolved conflict surviving synthesis and restart;
- abstained, invalid, rejected, timed-out, and never-started reviews retained;
- duplicate position, review, reservation, settlement, release, provider effect,
  and cancellation delivery;
- attempted overspend, settlement beyond reservation, and release after settlement;
- cancellation before dispatch, during generation, after commit/before reveal,
  during review, and during settlement, each with honest partial results;
- workflow-worker, Activity-worker, client, and Temporal-service death at every
  durable boundary;
- `continueAsNew` reconstruction and replay across every supported workflow
  version;
- migration interruption, stale fencing, digest corruption, broken references,
  future projection authority, and deterministic restart/projection digests.

Fixtures must exercise production-shaped public boundaries rather than duplicating
the implementation logic inside the verifier.

## Verification

`pnpm verify:p5` is a non-recursive wrapper around code-owned gates for:

- isolation protocol and commit/reveal sequencing;
- sanitized reviewer-context allowlisting;
- assignment, correlation, dissent, and residue policy;
- authoritative persistence and budget/cancellation lifecycle;
- Temporal execution, idempotency, replay, and fault recovery;
- read-only projection and operator inspection; and
- the frozen adversarial fixture manifest.

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
pnpm eval:offline
```

P2 lifecycle/backup, P3 Temporal, P4 contract, and P5 isolation gates remain
independently runnable. Provider-dependent model calls remain outside offline CI;
deterministic workers/stubs must prove the checkpoint contracts without claiming
live-provider quality.

## Receipt schema

`evals/reports/v0.5.0-isolated-divergence.md` records the exact baseline,
code-bearing merge, PR, annotated tag, frozen versions, stable identities,
migrations/checksums, fixture manifest, executed commands/durations, CI run,
projection digest, independent review findings/fixes, limitations, and P6
deferrals. Claims in the receipt must match inspectable executed evidence.

## Stopping condition

Stop only when every gate and fixture above passes; the complete clean-checkout
ladder is green; a non-author semantic/adversarial review is resolved and
re-reviewed; `pnpm verify:p5` is visibly enforced by default-branch CI; the code PR
is merged; post-merge `main` CI is green; the receipt is exact and merged; and the
annotated `v0.5.0-isolated-divergence` tag points to the code-bearing merge. Then
send Beaux one concise checkpoint report and hand P6 the proved baseline.
