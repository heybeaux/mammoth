# Mammoth P4 Research-Cell Contract Checkpoint

> Status: implementation verification
>
> Baseline: `v0.3.0-temporal-control-plane`
>
> Target: `v0.4.0-research-cell-contracts`
>
> Human contact: checkpoint completion or an escalation explicitly allowed by
> `LOOP.md`

## Outcome

P4 is complete when Mammoth has deterministic, versioned research-cell and model-
lineage contracts whose admission policy makes correlation, self-review,
criterion drift, unsupported consensus, and missing provenance mechanically
rejectable. Postgres/CAS remains product authority; Temporal carries stable
identifiers and reconstructs state rather than becoming a shadow product store.

P4 does not claim peer-isolated execution, blind review, managed Temporal, or the
3D Observatory UI. Those remain P5 or later work.

## Entry gate

- [x] P3 is merged at `f35740c` with `pnpm verify:p3` enforced on default-branch
      CI and `v0.3.0-temporal-control-plane` pointing to the code-bearing merge.
- [x] The P4-P6 handover is present and its architecture boundaries are accepted.
- [x] P4 owns a clean integration worktree and path-disjoint worker worktrees.
- [x] Freeze the P4 contract version, policy version, stable-ID derivations,
      migration range, projection authority, and verifier fixture manifest.

Entry evidence is recorded in the P4 ADR and this plan before integration.

## Frozen entry decisions

- Research-cell contract: `1.0.0`.
- Model-lineage and admission policies: `1.0.0`.
- Workflow application/carry major: `1`; stable cell-plan/work-item/workflow IDs
  are derived by the code-owned `packages/workflow/src/p4-contract.ts` helpers
  from program, criterion ID/version/digest, cell-plan ID/version, branch, and
  role. Parser re-derivation is the acceptance authority.
- Postgres migration range: P3 versions `1-4` to P4 version `5`
  (`research_cell_persistence`), with checksummed forward-only migration
  enforcement.
- Projection authority: `ObservatoryProjectionV1` remains a deterministic,
  read-only view over validated domain contracts and authoritative revisions;
  it fails closed on drift, future authority, broken references, cycles, and
  digest mismatch.
- Adversarial fixture manifest:
  `evals/fixtures/p4/adversarial-manifest.json`.

## Delivery slices

### T1 — Versioned contracts and canonical identities

Deliver pure domain schemas for cell plans/templates, typed inputs and outputs,
positions, assignments, reviews, dissent, synthesis, outcomes, receipt references,
immutable model profiles/versions, training lineage, shared derivation, and
correlation assessments. Every proposal carries immutable program, work item,
criterion, model-profile, input, output-schema, usage, failure, and proposal
references. Canonical IDs and digests reject unknown versions and malformed or
non-canonical values.

Gate: dangling/cyclic lineage, missing parents, mutable criterion references,
unknown schema versions, and non-canonical digests fail closed.

### T2 — Admission and correlation policy

Deliver pure, versioned position/review/synthesis admission policies. Agreement
never promotes evidence status. Same-profile same-role review is impossible;
aliases, shared checkpoints, fine-tunes, and unknown lineage cannot masquerade as
independence. Criterion drift, missing references, non-admitted synthesis inputs,
and correlated review fail with durable audit residue.

Gate: one or one hundred unsupported agreeing positions remain unsupported, while
a valid cross-family review can be admitted without changing evidence authority.

### T3 — Authoritative persistence

Deliver forward-only Postgres migrations and inward-facing ports for model
profiles/versions, cell plans, positions, reviews, dissent, correlation,
rejections, and receipts. Historical versions are immutable and alias changes do
not rewrite lineage. Enforce foreign keys, uniqueness, optimistic revision,
fencing, digest integrity, and restart reconstruction.

Gate: empty install, P3 upgrade, repeated/interrupted migration, concurrent/stale
writes, integrity failure, and restart tests pass.

### T4 — Workflow carriage and reconstruction

Deliver versioned application/workflow contracts and stable IDs incorporating
program, criterion version/digest, cell-plan version, branch, and role. Temporal
carry state contains identifiers and bounded orchestration metadata only; product
state reconstructs from Postgres/CAS after `continueAsNew`.

Gate: replay and reconstruction are deterministic and do not claim P5 isolation.

### T5 — Projection and operator inspection

Deliver read-only Observatory nodes/edges for cells, positions, reviews, lineage,
correlation, dissent, rejections, and receipts, followed by CLI inspection. Future
authority/schema, broken references, digest mismatch, and lineage cycles fail
closed.

Gate: projection digest and restart reconstruction are deterministic.

### T6 — Acceptance, receipt, and release

Deliver deterministic fixtures, `pnpm verify:p4`, clean-checkout evidence,
default-branch CI enforcement, an independent adversarial review, and
`evals/reports/v0.4.0-research-cell-contracts.md`.

Gate: the PR is merged, post-merge main CI passes, and the annotated
`v0.4.0-research-cell-contracts` tag points to the code-bearing merge.

## Required adversarial fixtures

- one unsupported claim with one agreeing position;
- the same unsupported claim with 100 agreeing positions;
- aliases of one checkpoint/family presented as independent;
- unknown lineage presented as independent;
- same-profile same-role self-review;
- distinct but correlated lineage review;
- valid cross-family review;
- silent criterion edit and explicit criterion branch;
- missing claim/evidence/hypothesis/artifact references;
- cyclic and dangling model lineage;
- rejected position retained with exact audit reason;
- future schema/authority and digest mismatch;
- deterministic projection digest and restart reconstruction.

## Verification

The P4 verifier is a non-recursive wrapper around its deterministic fixture and
integration gates. The final clean-checkout ladder is:

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
pnpm eval:offline
```

Provider-dependent tests remain outside offline CI. P2 lifecycle/backup and P3
Temporal gates remain independently runnable.

## Receipt schema

`evals/reports/v0.4.0-research-cell-contracts.md` records the exact baseline,
code-bearing merge, PR, annotated tag, contract/policy versions, stable-ID and
digest rules, migrations, fixture manifest, commands, dates, durations, CI run,
projection digest, independent review findings and fixes, limitations, and
deferred P5 isolation work. Claims in the receipt must match executed evidence.

## Stopping condition

Stop only when every gate above is true; all adversarial fixtures and the complete
clean-checkout ladder pass; an independent non-author review has been resolved and
re-reviewed; the P4 verifier is visibly enforced by default-branch CI; the PR is
merged; post-merge main CI is green; the receipt is exact; and the annotated tag
points to the code-bearing merge. Then send Beaux one concise checkpoint report.
