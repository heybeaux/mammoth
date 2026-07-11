# mammoth

Local-first, hybrid, long-horizon epistemic engine.

The active delivery contract is documented in [MVP_PLAN.md](MVP_PLAN.md).
Autonomous workers follow [AGENTS.md](AGENTS.md) and [LOOP.md](LOOP.md).

## Development

Mammoth requires Node.js 22 or later and pnpm 8.15.6. From the repository root:

```sh
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm verify:evidence
pnpm verify:audit
pnpm verify:phase-1
pnpm verify:phase-2
pnpm verify:m2
pnpm verify:m3
pnpm verify:mvp
pnpm eval:offline
```

Run `pnpm format` to format tracked source and documentation, or
`pnpm format:check` to check formatting without changing files.

Workspace packages live under `apps/`, `packages/`, `workers/`, and `evals/`.
Packages should extend `tsconfig.base.json` and expose the applicable `build`,
`typecheck`, and `test` scripts; root commands run those scripts recursively.

## Implemented slices

- **Phase 0 — Constitution and failure harness:** domain schemas, claim lifecycle,
  evidence policy, handoff validation, audit integrity, and offline fixtures.
- **Phase 1 — Evidence-first vertical slice:** policy-gated retrieval, immutable
  content-addressed snapshots, deterministic parsing, source lineage, claim graph,
  crash-safe local persistence with a Postgres reference migration, and an
  evidence-bound report compiler with sentence-level provenance traces.
- **Phase 2 — Durable orchestration:** restart-safe workflow execution and
  schedules, leased task queues, provider-idempotent side-effect receipts,
  multi-dimensional budgets, human gates, and revalidation scheduling.

`pnpm verify:phase-1` runs the Phase 1 exit-gate suites. The compiler fails closed
unless each factual sentence resolves through an eligible claim and named policy
assessment to fresh immutable evidence with an exact locator.

`pnpm verify:phase-2` runs the process-death and duplicate-delivery gates. Local
MVP stores use atomic rename plus file and directory fsync; runtime ports remain
compatible with a future Temporal and Postgres deployment.

## Local operator CLI

Run the checked-in offline example from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm mammoth run examples/mvp-charter.json --root .mammoth --json
pnpm mammoth status mvp-example-domains --root .mammoth --json
pnpm mammoth inspect mvp-example-domains --root .mammoth --json
```

Interrupted programs can be continued with `mammoth resume`; `mammoth cancel`
commits a terminal partial receipt while preserving already completed artifacts.
The durable program directory contains workflow, queue, governance, ledger, CAS,
report, manifest, traces, operator state, and terminal receipt artifacts.

## MVP limitations

- The local JSON/CAS adapters support one host and are not distributed stores.
- Workflow execution is local; the production Temporal and Postgres adapters are
  deferred.
- The MVP uses deterministic charter proposals and evidence policy. It does not
  invoke models, Parliament, cloud providers, or the wider heybeaux agent stack.
- Source parsing supports bounded plain text, HTML, and JSON; PDF and browser
  rendering are deferred.
- `inspect` verifies terminal receipts and declared artifact digests but is not a
  repair command. Tampered state fails closed.
- The dossier remains `evidence_complete`; Mammoth never assigns human approval.
- Desktop UI, hosted API, experiments, novelty archives, and pipeline SDKs are
  explicitly post-MVP work.
