# Mammoth Outcome Roadmap

> Status: proposed implementation authority under
> [`CORE_THESIS.md`](CORE_THESIS.md).
>
> This roadmap replaces phase-number progression with user-visible outcomes.
> Historical P0-P9 plans and receipts remain immutable delivery evidence. They do
> not define the product destination or authorize new work.

## Operating rule

Mammoth work proceeds outside-in:

```text
user outcome
  -> black-box acceptance
  -> adversarial and holdout evaluation
  -> minimum product contract
  -> architecture change
  -> implementation
  -> equal-resource comparison
```

An internal subsystem, schema, receipt, verifier, fixture, or successful frozen
exhibition is not an outcome. It may prove a necessary property, but cannot close
an outcome by itself.

No outcome may be marked complete until a user can reach it through the normal
product interface from a clean install.

## Outcome 0 — Product truth and reset

### User outcome

Users and contributors can tell exactly what Mammoth does today, what it does not
do, and which demonstrations are general versus frozen.

### Deliver

- Make `CORE_THESIS.md` the governing product authority.
- Publish an evidence-backed stocktake of existing behavior.
- Classify current components as `keep`, `generalize`, `isolate`, or `remove`.
- Label P8 and P9 demonstrations as bounded exhibitions.
- Remove phase language from current product promises.
- Freeze new implementation until the stocktake and black-box contracts merge.

### Exit gate

The README, CLI help, release descriptions, and roadmap make no claim that an
arbitrary live question works before a black-box demonstration proves it.

## Outcome 1 — One honest general research path

### User outcome

A user submits an unfamiliar plain-language question or theory. Mammoth proposes
a reviewable research team and plan, states its requested authority and budget,
and—after approval—returns a strong readable research result plus a separate
audit projection.

The user does not author schemas, IDs, source classes, queries, report sections,
or topology.

### Product contract

```text
mammoth investigate "QUESTION OR THEORY"
```

The command may be surfaced through CLI, API, or UI, but all surfaces invoke the
same application contract.

Before external work, Mammoth shows:

- its interpretation of the problem;
- proposed research roles and why each is needed;
- important ambiguities and assumptions;
- research and falsification plan;
- requested local/cloud providers, tools, network access, time, and spend;
- whether experiments are proposed or executable; and
- explicit approval choices.

### Exit gates

- Three unrelated unfamiliar questions execute through the same public path.
- One question is selected after the candidate build is frozen.
- Core runtime and generic verifiers contain none of the evaluation topics'
  vocabulary, URLs, headings, source classes, or success criteria.
- Plans, teams, searches, evidence requirements, and report structures differ
  materially between problems.
- The readable result answers the question before exposing audit internals.
- Every factual conclusion traverses to admitted evidence.
- Failures, disagreement, costs, and unresolved questions remain inspectable.
- Restart and reconstruction duplicate no external effect.

## Outcome 2 — Genuine agentic research teams

### User outcome

Mammoth composes a research team suited to the problem rather than replaying one
generic sequence or a shared group chat.

### Deliver

- Problem-derived role composition from a versioned role capability registry.
- Independent candidate generation before peer exposure.
- Deliberately different evidence subsets, abstractions, and research strategies.
- Blind critics and evaluator separation.
- Correlation-aware model and context lineage.
- Typed exchange of findings, mechanisms, claims, hypotheses, critiques, and
  dissent.
- Dynamic follow-up work based on information gain and unresolved uncertainty.

### Exit gates

- Removing or changing a relevant role predictably changes coverage or quality.
- Duplicating correlated agents cannot promote a claim or hypothesis.
- A minority finding survives synthesis and materially affects the result.
- A failed or blocked agent yields an honest partial result rather than silent
  omission.
- Equal-budget comparison beats repeated sampling from one strong model on
  supported conclusions, decision usefulness, or uncertainty reduction.

## Outcome 3 — Cross-domain discovery and hypothesis portfolios

### User outcome

Mammoth does more than summarize a field. It identifies transferable mechanisms
from adjacent or apparently unrelated fields, produces falsifiable hypotheses,
and explains which ideas are established, derived, analogous, speculative, or
apparently novel.

### Deliver

- Mechanism maps separating surface terminology from underlying constraints.
- Adjacent-industry and cross-discipline search.
- Source-to-target analogy records with boundary conditions and
  non-equivalences.
- Quality-diversity archives preserving different mechanisms, not just prose.
- Hypothesis genealogy and mutation history.
- Bounded, dated prior-art challenge.
- Explicit predictions, falsifiers, and cheapest decisive experiment for every
  leading hypothesis.

### Exit gates

- A frozen rediscovery corpus tests whether Mammoth can recover known transfers
  without being told the source field.
- A historical holdout tests whether dated evidence would have supported a later
  real development without hindsight leakage.
- A superficial analogy fixture is rejected for broken boundary conditions.
- At least one useful candidate comes from a field absent from the initial
  question.
- Independent reviewers can distinguish the candidate's mechanism from retrieved
  prior art.
- Mammoth never promotes an idea to universal novelty.

## Outcome 4 — Bounded experimentation

### User outcome

Mammoth converts important uncertainties into decisive experiments and, when the
user grants authority, executes them safely and reproducibly.

Research and experiment design are automatic. Execution of code, benchmarks,
simulations, repository changes, external actions, or paid effects is opt-in and
scope-bound.

### Deliver

- Typed experiment and evaluator contracts.
- Explicit inputs, environment, baseline, metrics, thresholds, repetitions,
  invalid-run rules, and resource ceilings.
- Candidate isolation and evaluator independence.
- Sandboxes with declared filesystem, process, network, secret, CPU, RAM, disk,
  GPU, time, and spend authority.
- Reproducible artifacts, negative results, and changed-belief records.
- Research-only completion when execution is unavailable or not worthwhile.

### Exit gates

- A deterministic fixture catches result fabrication, evaluator leakage, changed
  workloads, and invalid comparisons.
- One authorized experiment refutes the leading hypothesis and changes the final
  recommendation.
- One authorized experiment supports a non-leading hypothesis under a declared
  threshold.
- Cancellation and restart preserve valid partial artifacts without duplicate
  execution or charges.
- No model promotes its own experiment result when machine-checkable ground truth
  exists.

## Outcome 5 — Decision-grade product and honest evaluation

### User outcome

Mammoth reliably produces work that is more useful than strong alternatives,
without making the user read its internals.

### Deliver

- Reader-first answer, opportunity brief, or solution portfolio.
- Separate evidence and operations audit projections from the same authoritative
  state.
- Traversable human citations, disagreement, uncertainty, experiment results,
  and next actions.
- Black-box benchmark suite spanning scientific, policy, strategic, repository,
  and cross-domain problems.
- Strong direct-model, agentic-research, and deep-research baselines under equal
  time, provider, token, tool, and spend budgets.
- Independent human review using frozen usefulness and correctness rubrics.

### Exit gates

- Mammoth improves supported-conclusion precision, decision usefulness,
  uncertainty reduction, or experimentally differentiated candidates without an
  unacceptable cost or latency penalty.
- Auditability can be independently verified but does not dominate the report.
- A polished unsupported answer fails even if its format and citations look
  plausible.
- An inconclusive but honest result can outrank a confident baseline answer.

## Sequencing

Outcomes are ordered by dependency, not marketed as maturity phases:

1. product truth;
2. one honest general path;
3. genuine team intelligence;
4. cross-domain hypothesis generation;
5. bounded experimentation; and
6. comparative product proof.

Work may overlap only when a downstream experiment cannot weaken or bypass an
upstream black-box contract.

## Definition of done

Mammoth's reset is complete when the product can take unfamiliar problems through
research, independent agent work, cross-domain hypothesis generation, optional
bounded experiments, synthesis, and audit—then demonstrate under equal resources
that the result is more useful and better supported than strong baselines.
