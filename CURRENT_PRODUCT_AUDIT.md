# Mammoth Current Product Audit

> Audit date: 2026-07-16
>
> Audited baseline: `1ff7e9e52401773559904b35e6a6410b5546c80c`
>
> Purpose: establish the truthful starting point for
> [`CORE_THESIS.md`](CORE_THESIS.md) and
> [`PRODUCT_ROADMAP.md`](PRODUCT_ROADMAP.md). This is a source-level product
> stocktake, not a new release receipt.

## Verdict

Mammoth has a substantial domain-independent trust and durability substrate, but
the released normal user path does not yet satisfy the approved domain-general
product contract.

The repository currently contains three different product generations behind one
`research` namespace:

1. `research ask` routes to the P8 turnkey runtime, which accepts only the frozen
   data-center question;
2. P9 `plan`/`accept`/`run` supports typed, question-derived plans and deterministic
   offline corpora, but a normal live `run` always stops before effects; and
3. `research p9-live` executes a dedicated Colibri exhibition with hard-coded
   question, sources, sections, coverage logic, and synthesis requirements.

The P9 release therefore proves strong properties of a bounded live exhibition.
It does not prove that a user can submit an arbitrary live question and receive a
general Mammoth investigation.

## Evidence

### The normal ask path remains P8-specific

`apps/cli/src/bin.ts` routes `research ask` to `executeP8ResearchCli`.

`packages/runtime/src/p8-turnkey.ts` contains:

- a single accepted data-center question;
- fixed data-center search queries;
- fixed topical vocabulary and narrative;
- data-center-specific report titles; and
- an explicit error when the input differs from the golden question.

This is valid as a reproducible P8 fixture. It is not a general product path.

### P9 planning is more general than P9 live execution

`packages/governance/src/p9-plan-authority.ts` defines technical,
public-policy, and scientific policy packs and tests template leakage between
domains. The P9 offline verifier exercises unrelated plan shapes and a
non-data-center report.

This is reusable groundwork. However, `apps/cli/src/p9-operator.ts` requires the
operator to supply a `ResearchPlanProposal` file to `research plan`. A plain
question does not cause Mammoth to generate the proposal itself.

When `research run` receives an accepted P9 plan without `--offline-corpus`, the
released implementation evaluates readiness and then unconditionally throws a
`P9 live run blocked before effects` error. The normal accepted-plan path therefore
cannot perform live research.

### The live path is a frozen Colibri application

`packages/runtime/src/p9-live-application.ts` contains the Colibri exhibition's:

- question;
- pinned repository commit and source URLs;
- GLM model-card source;
- subquestions and search queries;
- source classifications;
- report-section IDs;
- mandatory coverage and stop criteria;
- critical first-change semantics; and
- repository-specific safety and authority language.

`packages/runtime/src/p9-live-model-adapter.ts` requires specific
`first_bounded_change` and `experiment_design` prose, benchmark vocabulary, and
statistical surface forms.

`packages/runtime/src/p9-generic-research.ts` contains matching semantic gates for
those sections.

These constraints helped make one exhibition truthful and useful. They must not
remain in the generic application path.

### The substrate is real and reusable

The audit does not support discarding Mammoth. The following capabilities are
substantial and aligned with the approved thesis:

- immutable content-addressed evidence;
- exact source locators and claim bindings;
- independent entailment and preserved rejection residue;
- provider/model lineage and correlation metadata;
- durable workflow and effect identities;
- restart, cancellation, and idempotency contracts;
- hard multidimensional budgets and cost journals;
- parser, network, and hostile-source boundaries;
- typed question-derived research plans;
- contradiction, dissent, and unresolved-result types;
- plan-relative offline compilation and verification; and
- separate architecture for research cells, hypotheses, novelty, experiments,
  and evaluators.

The failure was not that the infrastructure is fake. It was allowing a specialized
application to stand in for the general product proof.

## Classification

### Keep

- Claim, evidence, contradiction, lineage, and freshness authority.
- CAS snapshots and exact locators.
- Durable orchestration, queues, retries, cancellation, and reconstruction.
- Effect identities, budgets, provider profiles, journals, and receipts.
- Hosted-safe retrieval and parser boundaries.
- Independent entailment and admission.
- Research-cell isolation, blind review, and dissent contracts.
- Hypothesis, novelty, experiment, and evaluator architecture.
- Plan-relative offline verification primitives.

### Generalize

- Plain-language intake into a generated, reviewable problem contract.
- Dynamic team and topology composition.
- Search, source-class, contradiction, and coverage planning.
- Live execution of any accepted plan through the normal application boundary.
- Source classification based on declared policy and observed source properties.
- Report planning, synthesis, and quality gates.
- Reader and audit projections.
- Sufficiency decisions based on the accepted problem rather than frozen section
  names.

### Isolate as fixtures or method packs

- P8 data-center question, queries, corpus, taxonomy, and narrative.
- P9 Colibri question, pinned commit, sources, classifications, sections,
  experiment protocol, and live verifier expectations.
- Any future domain-specific evaluation corpus or exhibition.

Fixtures remain valuable regression and historical evidence. They must execute
through public product contracts or explicitly labelled fixture harnesses, never
through privileged generic branches.

### Remove from current product authority

- Phase numbers as the product roadmap.
- Claims that a successful frozen exhibition proves generality.
- User-authored proposal JSON as the default entry experience.
- Topic-specific checks in generic live runtime, model adapter, compiler, or
  verifier code.
- A report format that exposes internal IDs, manifests, or budget journals before
  answering the user.
- Release gates that can pass a cited but unreadable or nonresponsive result.

## Immediate black-box tests

Before implementation changes, the released CLI should be exercised from a clean
checkout with no hidden fixture inputs:

1. an unfamiliar scientific or technical question through `research ask`;
2. an unfamiliar policy question through `research ask`;
3. an accepted P9 plan through `research run` without `--offline-corpus`;
4. the frozen P8 question through `research ask`; and
5. the frozen P9 Colibri exhibition through its dedicated command, without
   spending provider budget.

Expected truthful result on the audited baseline:

- cases 1 and 2 fail because P8 accepts only its golden question;
- case 3 stops before live effects;
- case 4 is the supported P8 product path; and
- case 5 requires the specialized authority and provider configuration.

These failures are the baseline. Future work must turn cases 1-3 into the normal
product instead of adding another dedicated exhibition command.

## Executed no-spend baseline

The audit installed the exact lockfile and built all workspaces successfully from
the clean reset worktree. It then exercised the released CLI without provider
credentials or paid effects.

### Unfamiliar technical question

```text
mammoth research ask "Where do the biggest opportunities lie for individuals
building private local world-model systems on consumer hardware?"
```

Result: exit `1` with `P8 offline runtime only supports the frozen data-center
golden question`.

### Unfamiliar policy question

```text
mammoth research ask "What policy interventions most effectively reduce urban
heat without displacing low-income residents?"
```

Result: exit `1` with the same frozen-question boundary.

### Accepted P9 plan through the normal live run path

The audit generated the repository's own accepted Colibri P9 plan and invoked
`research run` without an offline corpus. Result: exit `1` before effects with the
missing live-authority configuration listed. Source inspection confirms the
released branch throws after readiness inspection rather than composing the P9
live application for the accepted plan.

### Frozen P8 question

```text
mammoth research ask "What impacts do data centers have on the communities and
environment around them?" --depth quick --budget-usd 0
```

Result: exit `0`, `status: completed`, with all nine declared P8 bundle artifacts.

These results confirm the distinction between a working bounded fixture and the
missing domain-general product path without spending provider budget.

## First implementation question

The first engineering plan should answer one question:

> What is the smallest composition of existing Mammoth capabilities that turns an
> unfamiliar plain-language problem into a generated team and accepted plan, then
> executes that exact plan live and returns reader-first and audit projections—
> without any topic-specific branch?

No new subsystem should be introduced unless the stocktake proves existing ports
cannot satisfy that path.
