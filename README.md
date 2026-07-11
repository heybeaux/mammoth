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

## Quickstart

The checked-in example is deterministic and network-free. It deliberately proposes
one claim supported by the source and one unsupported claim so the fail-closed
result is visible.

```sh
pnpm install
pnpm --filter @mammoth/cli build
pnpm mammoth run ./examples/quickstart/charter.json --root ./.mammoth --json
pnpm mammoth status quickstart-example-domains --root ./.mammoth --json
pnpm mammoth inspect quickstart-example-domains --root ./.mammoth --json
```

Interrupted programs can be continued with `mammoth resume`; `mammoth cancel`
commits a terminal partial receipt while preserving already completed artifacts.
The durable program directory contains workflow, queue, governance, ledger, CAS,
report, manifest, traces, operator state, and terminal receipt artifacts.

Run `pnpm mammoth --help` for all commands and options. The CLI exits with `0` on
success, `2` for invalid input, `3` when a program is absent, `4` for state
conflicts, and `5` for execution or integrity failures. `--json` always writes its
stable envelope to stdout; diagnostics also go to stderr.

## MVP limitations

- This checkpoint provides a local CLI, not the deferred desktop UI or hosted API.
- The quickstart uses an immutable checked-in source. Live HTTP retrieval is
  available, but offline fixtures are the reproducible release evidence.
- Parliament model cells, cloud providers, novelty search, experiment runners,
  external stack adapters, and `mammoth-pipelines` are deferred beyond MVP.
- Local JSON and content-addressed files are the MVP durability implementation;
  production Temporal and Postgres adapters remain future work behind runtime ports.
- A completed run may honestly contain unresolved claims. Only supported claims
  with a named policy assessment and exact immutable locator render as report facts.
