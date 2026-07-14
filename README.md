# mammoth

Local-first, hybrid, long-horizon epistemic engine.

The completed MVP contract is documented in [MVP_PLAN.md](MVP_PLAN.md). Post-MVP
delivery through P8 Turnkey Research is sequenced in
[POST_MVP_ROADMAP.md](POST_MVP_ROADMAP.md). P8 adds a local plain-language
question-to-report CLI with iterative evidence-bound research, immutable source
snapshots, admitted-only Markdown/HTML reports, and receipt-bearing live
exhibition evidence. The future read-only visualization contract is
[Mammoth Observatory](docs/OBSERVATORY.md). Autonomous workers follow
[AGENTS.md](AGENTS.md) and [LOOP.md](LOOP.md).

## Development

Mammoth requires Node.js 22 or later and pnpm 8.15.6. From the repository root:

```sh
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm test
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
pnpm verify:p7
pnpm verify:p8
pnpm eval:offline
git diff --check
```

Every verifier through `pnpm verify:p7` is independently runnable and enforced in
default-branch CI. `pnpm verify:p8` is a visible non-recursive verifier that
checks the frozen data-center acceptance path without changing the meaning of
earlier gates.

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
- **Initial MVP runtime:** a durable evidence-first research workflow, pinned
  fixture and entailment oracle, inspectable report/manifest/traces, audit and
  cancellation receipts, budget and revalidation gates, and a local operator CLI.
- **P2-P3 production-shaped control plane:** Postgres/CAS authority, forward-only
  migrations, production-profile lifecycle and backup gates, Temporal workflows,
  replay, cancellation, recovery, and bounded history.
- **P4-P5 isolated research cells:** immutable model lineage, correlation-aware
  admission, commit-before-reveal divergence, blind review, preserved dissent,
  bounded budgets, and honest partial cancellation.
- **P6 broader research topology:** deterministic multi-cell planning and
  scheduling, authoritative topology persistence, Temporal parent/child execution,
  evidence-aware synthesis, and read-only topology projection.
- **P7 governed execution substrate:** provider-backed typed cell work, governed
  egress and budgets, effect/cost receipts, reconstruction, dossier projection,
  operator controls, and restart-safe resume.
- **P8 turnkey research product:** local plain-language `research ask` intake,
  Brave-backed live public-web discovery when authorized, immutable acquired
  source snapshots, admitted-only report manifests, Markdown/HTML reports,
  inspection, deterministic offline acceptance, and a receipt-bearing live
  data-center exhibition.

`pnpm verify:phase-1` runs the Phase 1 exit-gate suites. The compiler fails closed
unless each factual sentence resolves through an eligible claim and named policy
assessment to fresh immutable evidence with an exact locator.

`pnpm verify:phase-2` runs the process-death and duplicate-delivery gates. Local
MVP stores use atomic rename plus file and directory fsync; runtime ports remain
compatible with the completed Postgres/CAS and Temporal production-shaped
adapters.

The MVP topology limits and production adapter boundary are recorded in
[`docs/adr/0001-local-durable-runtime.md`](docs/adr/0001-local-durable-runtime.md).

## Quickstart

The checked-in example is deterministic and network-free. It deliberately proposes
one claim supported by the source and one unsupported claim so the fail-closed
result is visible.

```sh
pnpm install --frozen-lockfile
pnpm --filter @mammoth/cli build
pnpm --silent mammoth run ./examples/quickstart/charter.json --root ./.mammoth --json
pnpm --silent mammoth status quickstart-example-domains --root ./.mammoth --json
pnpm --silent mammoth inspect quickstart-example-domains --root ./.mammoth --json
```

Interrupted programs can be continued with `mammoth resume`; `mammoth cancel`
commits a terminal partial receipt while preserving already completed artifacts.
The durable program directory contains workflow, queue, governance, ledger, CAS,
report, manifest, traces, operator state, and terminal receipt artifacts.

Run `pnpm mammoth --help` for all commands and options. The CLI exits with `0` on
success, `2` for invalid input, `3` when a program is absent, `4` for state
conflicts, and `5` for execution or integrity failures. `--json` always writes its
stable envelope to stdout when the built CLI or `pnpm --silent mammoth` is used;
diagnostics also go to stderr.

## Current product boundary

- This checkpoint provides a local CLI, not the deferred desktop UI or hosted API.
- The quickstart uses an immutable checked-in source. P8's reproducible release
  gate is fixture-backed; the authorized Brave-backed run is recorded separately
  as the live exhibition receipt.
- The CLI exposes the P7 operator path and the P8 plain-language `research ask`,
  `research status`, `research inspect`, and `research doctor` commands.
- Postgres/CAS and Temporal have production-shaped local profiles and recovery
  evidence, not a managed hosted deployment or production operations claim.
- Provider-dependent quality, cost, and reliability evaluations remain outside
  offline CI and must never be inferred from deterministic fixtures.
- Parliament provider execution, the hosted API, full Observatory UI, external
  stack adapters, and `mammoth-pipelines` remain future work.
- A completed run may honestly contain unresolved claims. Only supported claims
  with a named policy assessment and exact immutable locator render as report facts.
- Source parsing supports bounded plain text, HTML, JSON, and the P8 text-layer
  source path; browser rendering and OCR-heavy media remain deferred.
- `inspect` verifies terminal receipts and declared artifact digests but is not a
  repair command. Tampered state fails closed.
- The dossier remains `evidence_complete`; Mammoth never assigns human approval.
