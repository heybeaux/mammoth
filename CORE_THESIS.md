# Mammoth Core Thesis

> Status: approved product authority as of 2026-07-16.
>
> Approval: Beaux Walton confirmed the thesis direction, the plain-language user
> contract, and explicit experiment-execution authority boundary.
>
> Purpose: this document governs Mammoth's product direction above phase-specific
> delivery plans. Historical phase plans remain evidence of work completed, not
> authority to narrow the product.

## The thesis

Mammoth is a local-first research operating system for difficult, long-horizon
problems.

It assembles an agentic team to investigate a question across sources,
disciplines, industries, and competing schools of thought; preserves independent
positions and disagreement; discovers transferable mechanisms and non-obvious
patterns; develops falsifiable hypotheses; and, when authorized, designs and
executes bounded experiments.

Mammoth is built to produce the strongest useful body of work that available
evidence, time, tools, and compute justify. It is not built merely to produce a
fast answer, a polished summary, or an audit bundle.

Its outputs must be intelligent and useful first, while remaining auditable all
the way down.

## The product promise

Given a plain-language question, theory, repository, dataset, or problem, Mammoth
can:

1. frame the real problem, decision criterion, constraints, unknowns, and
   falsifiers;
2. compose an appropriate team of independent research roles;
3. gather and preserve current evidence from relevant domains;
4. develop competing explanations and solution candidates without forcing
   consensus;
5. search deliberately for analogies and transferable mechanisms across
   disciplines and industries;
6. distinguish sourced findings, deductions, analogies, hypotheses, and
   speculation;
7. challenge candidates with prior art, counterexamples, dissent, and blind
   criticism;
8. design the cheapest decisive experiments that could change the conclusion;
9. execute only explicitly authorized experiments in declared sandboxes; and
10. deliver a readable answer, opportunity or solution portfolio, uncertainty
    map, and recommended next actions, backed by inspectable evidence and
    reproducible receipts.

"Novel" is never a model's self-awarded label. Mammoth may identify an idea as
apparently novel after prior-art challenge. It may call an idea experimentally
differentiated only after a declared evaluator produces reproducible evidence.
It never claims universal novelty.

## The agentic team is the engine

Mammoth does not use one model as researcher, judge, and narrator. It composes a
team according to the problem. Roles may include:

- problem framer;
- domain researcher;
- source and lineage analyst;
- independent lateralist;
- adjacent-industry scout;
- mechanism mapper;
- prior-art challenger;
- counterexample and falsification researcher;
- quantitative analyst;
- experiment designer;
- evaluator;
- blind critic;
- dissent keeper; and
- synthesist.

Candidate generators work independently before seeing peers. Evaluators do not
grade their own proposals. Model agreement is a robustness signal, never proof.
Minority positions, negative results, and unresolved contradictions remain part
of the record.

The team exchanges typed findings, claims, hypotheses, mechanisms, experiments,
and critiques. It does not collapse the investigation into a shared chat
transcript.

## Cross-domain intelligence

Cross-domain transfer is a first-class research operation, not an accidental
prompting trick.

For every substantial problem, Mammoth should be able to ask:

- What is the underlying mechanism or constraint?
- Which unrelated fields face an analogous mechanism?
- What solutions, failure modes, or measurement methods exist there?
- Which parts transfer, and which boundary conditions break the analogy?
- What evidence would discriminate a useful transfer from a superficial one?

Analogy produces a hypothesis, not a fact. A cross-domain candidate records its
source discipline, target discipline, shared mechanism, non-equivalences,
predictions, falsifiers, prior-art search, and experiment path.

## Research and experimentation are one loop

Mammoth's core loop is:

```text
frame
  -> research broadly
  -> diverge independently
  -> map mechanisms and contradictions
  -> search adjacent fields and prior art
  -> generate competing hypotheses
  -> challenge and rank by information value
  -> design decisive experiments
  -> execute when authorized
  -> update beliefs and preserve negative results
  -> synthesize useful conclusions and next actions
  -> re-open when evidence changes
```

Research-only completion is valid when experimentation is impossible,
unauthorized, unsafe, or not worth its cost. In that case Mammoth returns explicit
experiment proposals and identifies which uncertainty each would resolve.

## Epistemic statuses

Mammoth keeps different kinds of knowledge visibly separate:

- **observed** — captured from a source, tool, human, or experiment;
- **supported finding** — admitted under a named evidence policy;
- **contested finding** — supported and contradicted evidence both remain;
- **deduction** — derived from supported premises through a recorded method;
- **cross-domain hypothesis** — mechanism transfer with stated boundary
  conditions and falsifiers;
- **apparently novel hypothesis** — survived a bounded, dated prior-art search;
- **experimentally supported** — passed a declared reproducible evaluator;
- **refuted** — failed a falsifier or accepted threshold;
- **inconclusive** — evidence or experimental power was insufficient; and
- **blocked** — required evidence, authority, hardware, data, or tooling was
  unavailable.

Rhetorical confidence, model votes, citation count, and report polish cannot
promote an item between these states.

## What the user receives

The primary product is a comprehensible body of work:

1. a direct answer or decision brief;
2. the strongest findings and why they matter;
3. competing explanations and meaningful dissent;
4. cross-domain opportunities and their transfer logic;
5. ranked hypotheses or solution candidates;
6. experiments completed and what they showed;
7. experiments worth running next;
8. unresolved uncertainties, limitations, and changed assumptions; and
9. concrete recommended next actions.

Human-readable citations connect conclusions to sources and experiments.

The audit projection is separate but complete: accepted and rejected claims,
exact source spans, immutable snapshots, lineage, model work, prompts and schema
identities, parser and retrieval receipts, budget journal, experiment manifests,
evaluator results, dissent, failures, and replay verification.

The audit system serves the research product. It does not become the reader's
report.

## Domain independence

Mammoth core must not contain topic logic.

Domain-specific vocabulary, sources, section names, queries, coverage rules, or
success criteria may exist only in:

- an explicit user-approved problem contract;
- a versioned, inspectable domain or method pack;
- an optional `mammoth-pipelines` package; or
- a clearly labelled fixture or exhibition.

They must not be hidden in generic runtime branches, provider adapters, report
gates, or release verifiers.

A domain or method pack is data and policy, not a privileged code path. The plan
records why the pack applies. Users can inspect, replace, or reject it. Running an
unrelated question must not inherit another domain's sources, headings, queries,
mandatory concepts, opportunity categories, or experimental criteria.

Frozen fixtures prove reproducibility only. A successful fixture never proves
generality.

## Non-negotiable architecture

The existing evidence and durability substrate remains valuable. Mammoth keeps:

- immutable evidence and repository snapshots;
- exact locators and content digests;
- claim, contradiction, lineage, and freshness authority;
- independent model-work lineage and correlation awareness;
- durable orchestration, restart, cancellation, and idempotency;
- hard budgets and attributable external effects;
- sandboxed tools and experiment authority;
- blind review and preserved dissent;
- admitted-only factual reporting; and
- traversable audit and receipts.

These are constitutional guarantees. They are not the product thesis, the user
journey, or substitutes for useful research.

## Black-box product contract

Mammoth is not ready to claim generality until a user can, from a clean install:

1. submit an unfamiliar plain-language problem through the normal product
   interface;
2. receive a reviewable, question-derived plan without authoring schemas, IDs,
   source classes, headings, or queries;
3. run the plan within declared time, compute, network, tool, and spend limits;
4. receive a readable, decision-useful result before seeing internal audit
   machinery;
5. traverse every factual conclusion to admitted evidence or an experiment;
6. inspect rejected claims, disagreements, failures, costs, and unknowns;
7. resume or reconstruct the run without duplicated effects; and
8. prove that no unrelated fixture or domain vocabulary influenced the result.

## Acceptance before a general release

A future general release requires black-box demonstrations across unrelated
problem shapes, not merely different question strings:

- evidence synthesis in a scientific or technical domain;
- a policy or strategic decision with genuine stakeholder conflict;
- a repository or systems problem requiring prior art and measurable tests;
- a cross-domain opportunity search that produces mechanism-bound hypotheses;
- an investigation that ends inconclusive or refutes its leading idea; and
- an authorized experiment whose result changes the final ranking.

At least one evaluation problem must be selected after the candidate build is
frozen. Core code and generic verifiers must contain no topic terms from any
evaluation problem. Equal-budget comparison against strong research and
problem-solving baselines is required before claiming superior results.

Passing schemas, producing receipts, covering sections, or succeeding on a frozen
exhibition cannot substitute for these outcomes.

## Reset consequences

Until this thesis is translated into accepted black-box product behavior:

- P10 and P11 work is paused;
- no phase number defines the product;
- the P9 release is historical evidence for a bounded Colibri-shaped live
  exhibition, not proof of domain-general research;
- unfinished P9.1 report and generic-live work remains unpublished;
- new implementation work is blocked; and
- the next engineering plan must begin with black-box product evaluation, not
  another internal contract ladder.

## Product success criterion

Mammoth succeeds when, across unrelated domains and problem types, its agentic
research and experimentation process produces more useful, more original, and
better-supported conclusions or solution candidates than strong baselines under
equal declared resources—while preserving uncertainty, negative results,
reproducibility, local control, and complete auditability.
