<h1 align="center">🦣 Mammoth</h1>

<p align="center"><strong><em>Big hairy things take time.</em></strong></p>

<p align="center">
Mammoth is a local-first research engine that produces reports you can audit.
Every factual sentence in a Mammoth report traces to an exact span of
immutable source evidence — and when the evidence isn't there, Mammoth fails
closed instead of making something up.
</p>

> **Product reset (2026-07-16):** Mammoth is governed by
> [`CORE_THESIS.md`](CORE_THESIS.md). The thesis restores the full product:
> domain-independent agentic research, cross-domain hypothesis generation, and
> explicitly authorized experimentation. The P8 data-center and P9 Colibri paths
> are bounded exhibitions, not proof that arbitrary live questions work today.
> See the evidence-backed [`CURRENT_PRODUCT_AUDIT.md`](CURRENT_PRODUCT_AUDIT.md)
> and outcome-based [`PRODUCT_ROADMAP.md`](PRODUCT_ROADMAP.md).

---

## Why Mammoth?

AI research assistants are fast, confident, and frequently wrong. They cite
pages that don't say what the summary claims, lose their sources between
sessions, and present speculation with the same tone as fact.

Mammoth takes the opposite bet: research worth doing is worth doing slowly,
durably, and verifiably.

- **Evidence-first.** A claim only becomes a report fact when a named policy
  assessment binds it to fresh, immutable evidence with an exact locator.
  Unsupported claims stay visibly unresolved — they never quietly disappear
  into confident prose.
- **Fail-closed.** Tampered state, missing evidence, and unverifiable
  artifacts stop the run. The compiler refuses to render a sentence it cannot
  trace.
- **Durable.** Runs survive process death and restarts. Interrupted programs
  resume; cancelled ones commit an honest partial receipt and preserve
  completed work.
- **Local-first.** Your research, sources, and receipts live on your machine
  as inspectable artifacts — workflow state, content-addressed snapshots,
  provenance traces, and terminal receipts you can verify from the CLI.
- **Honest about itself.** Mammoth reports what it could not resolve, never
  assigns human approval, and keeps provider-dependent quality claims out of
  its deterministic release gates.

## See Mammoth work

The flagship live exhibition asks:

> What impacts do data centers have on the communities and environment around
> them?

Mammoth searched the public web, acquired and preserved 17 source snapshots,
bound 94 admitted claims to 119 exact evidence spans, and rendered a 3,433-word
report. The run used Brave Search plus `openai/gpt-5.6-luna` through OpenRouter;
an independent `anthropic/claude-sonnet-5` review returned `pass_with_notes`
with no blockers.

- [Read the completed report](research/examples/data-center-community-impacts/report.md)
- [Open the rendered HTML](research/examples/data-center-community-impacts/report.html)
- [Read the executive summary](research/examples/data-center-community-impacts/executive-summary.md)
- [Inspect the bibliography](research/examples/data-center-community-impacts/bibliography.md)
- [Inspect source provenance](research/examples/data-center-community-impacts/sources.json)
- [Inspect the execution receipt](research/examples/data-center-community-impacts/execution-receipt.json)
- [Read the independent review](research/examples/data-center-community-impacts/independent-review.json)

![Rendered Mammoth research report](docs/assets/research-showcase/report-ui.png)

The same immutable bundle can be checked from the CLI. `research inspect`
verifies the run state, manifest and receipt digests, and every required
artifact.

![Mammoth CLI inspecting a completed research bundle](docs/assets/research-showcase/cli-inspect.png)

This is intentionally a bounded cross-source showcase. The normal `research ask`
path remains specialized for data-center impact research; unrelated-topic
examples would overstate the current product. P9 added reusable question-derived
planning and a separately bounded Colibri live exhibition, but did not complete a
general arbitrary-question live path.

## Quickstart

The checked-in example is deterministic and network-free. It deliberately
proposes one claim supported by the source and one unsupported claim so the
fail-closed result is visible.

```sh
pnpm install --frozen-lockfile
pnpm --filter @mammoth/cli build
pnpm --silent mammoth run ./examples/quickstart/charter.json --root ./.mammoth --json
pnpm --silent mammoth status quickstart-example-domains --root ./.mammoth --json
pnpm --silent mammoth inspect quickstart-example-domains --root ./.mammoth --json
```

Interrupted programs can be continued with `mammoth resume`; `mammoth cancel`
commits a terminal partial receipt while preserving already completed
artifacts. The durable program directory contains workflow, queue, governance,
ledger, CAS, report, manifest, traces, operator state, and terminal receipt
artifacts.

Run `pnpm mammoth --help` for all commands and options. The CLI exits with `0`
on success, `2` for invalid input, `3` when a program is absent, `4` for state
conflicts, and `5` for execution or integrity failures. `--json` always writes
its stable envelope to stdout when the built CLI or `pnpm --silent mammoth` is
used; diagnostics also go to stderr.

## How it works

A research run moves through a governed pipeline, and every stage leaves
verifiable artifacts behind:

1. **Ask.** A plain-language question enters through `research ask`; governed
   planning derives the research program.
2. **Discover and acquire.** Policy-gated live web discovery (Brave Search,
   when authorized) fetches sources into immutable content-addressed
   snapshots with full lineage.
3. **Admit claims.** Proposed claims face correlation-aware admission and
   entailment checks against exact evidence spans. Budgets, human gates, and
   receipts govern every side effect.
4. **Compile the report.** The evidence-bound compiler renders only supported
   claims, each with sentence-level provenance back to an exact immutable
   locator.
5. **Verify.** `research inspect` re-checks run state, manifests, receipt
   digests, and every declared artifact. Tampered state fails closed.

Under the hood: durable Temporal workflows with replay and recovery, a
Postgres/CAS authority with forward-only migrations, leased task queues,
provider-idempotent side-effect receipts, multi-dimensional budgets, isolated
research cells with blind review and preserved dissent, and deterministic
multi-cell topology planning. The historical ledger of delivered checkpoints
(P0 through P9) lives in [MVP_PLAN.md](MVP_PLAN.md) and
[POST_MVP_ROADMAP.md](POST_MVP_ROADMAP.md).

## Current product boundary

Mammoth states plainly what it is not yet:

- A local CLI today — the desktop UI
  ([Mammoth Observatory](docs/OBSERVATORY.md)) and hosted API are future work.
- The normal `research ask` path remains the frozen P8 data-center application.
  P9 can create and verify question-derived plans offline, but the normal
  accepted-plan path does not execute live; its separate live command is the
  bounded Colibri exhibition. Accepting an arbitrary question string does not
  yet mean honest arbitrary-domain research.
- Postgres/CAS and Temporal have production-shaped local profiles and recovery
  evidence, not a managed hosted deployment.
- Provider-dependent quality, cost, and reliability claims remain outside
  offline CI and are never inferred from deterministic fixtures.
- Source parsing supports bounded plain text, HTML, JSON, and the text-layer
  source path; browser rendering and OCR-heavy media are deferred.
- A completed run may honestly contain unresolved claims. `inspect` verifies —
  it does not repair. The dossier remains `evidence_complete`; Mammoth never
  assigns human approval.
- Parliament provider execution, external stack adapters, and
  `mammoth-pipelines` remain future work.

The current product boundary is audited in
[`CURRENT_PRODUCT_AUDIT.md`](CURRENT_PRODUCT_AUDIT.md). Current development is
organized by user-visible outcomes in
[`PRODUCT_ROADMAP.md`](PRODUCT_ROADMAP.md), not by a new phase number.

## Development

Mammoth requires Node.js 22 or later and pnpm 8.15.6. From the repository
root:

```sh
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm test
pnpm eval:offline
```

The release ladder is enforced by independently runnable verification gates,
all required in default-branch CI:

```sh
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
```

`pnpm verify:phase-1` runs the Phase 1 exit gates: the compiler fails closed
unless each factual sentence resolves through an eligible claim and named
policy assessment to fresh immutable evidence with an exact locator.
`pnpm verify:phase-2` runs the process-death and duplicate-delivery gates.
`pnpm verify:p8` is a visible non-recursive verifier that checks the frozen
data-center acceptance path without changing the meaning of earlier gates.

Run `pnpm format` to format tracked source and documentation. Workspace
packages live under `apps/`, `packages/`, `workers/`, and `evals/`; packages
extend `tsconfig.base.json` and expose the applicable `build`, `typecheck`,
and `test` scripts, which root commands run recursively.

## Documentation

- [MVP_PLAN.md](MVP_PLAN.md) — the completed MVP contract
- [CORE_THESIS.md](CORE_THESIS.md) — governing product authority
- [PRODUCT_ROADMAP.md](PRODUCT_ROADMAP.md) — current outcome-based roadmap
- [CURRENT_PRODUCT_AUDIT.md](CURRENT_PRODUCT_AUDIT.md) — evidence-backed
  boundary and stocktake
- [POST_MVP_ROADMAP.md](POST_MVP_ROADMAP.md) — historical P1-P9 delivery train
- [ARCHITECTURE.md](ARCHITECTURE.md) — system architecture
- [docs/adr/0001-local-durable-runtime.md](docs/adr/0001-local-durable-runtime.md)
  — MVP topology limits and the production adapter boundary
- [docs/OBSERVATORY.md](docs/OBSERVATORY.md) — the read-only visualization
  contract
- [ADVERSARIAL_ANALYSIS.md](ADVERSARIAL_ANALYSIS.md) and
  [ADVERSARIAL_ANALYSIS_POST_P8.md](ADVERSARIAL_ANALYSIS_POST_P8.md) — blind
  product critiques, preserved
- [AGENTS.md](AGENTS.md) and [LOOP.md](LOOP.md) — how autonomous workers
  operate in this repository
