# Mammoth 2.0 Product Thesis

## Status

Status: **directional product authority for P9-P12**.

This document records the product destination approved after the P8 live
exhibition and post-P8 adversarial assessment. Individual releases still require
their own frozen plan, acceptance corpus, verifier, review, and receipt. This
thesis does not authorize a release claim by itself.

## Product definition

Mammoth 2.0 is an evidence-governed research and problem-solving system.

It has two programs over one epistemic core:

1. `mammoth research ask` produces decision-grade, evidence-bound research;
2. `mammoth lab solve` researches a hard problem, proposes competing solutions,
   designs and executes bounded experiments, and returns solution candidates with
   measured evidence, uncertainty, and reproducible artifacts.

`mammoth lab solve` is future P11/P12 scope. It is not implemented or released,
and P9 does not authorize solver execution, repository mutation, or arbitrary
tool use. P9 may define forward-compatible vocabulary only.

Mammoth is not a generic autonomous coding agent. Models propose plans,
hypotheses, experiments, patches, proofs, and interpretations. Deterministic
services validate contracts, enforce authority and budgets, execute tools inside
declared sandboxes, admit evidence, and commit state.

## The 2.0 promise

> Given a hard question, repository, mathematical problem, or project goal,
> Mammoth can construct a reviewable problem contract, research the relevant
> system and prior art, preserve competing theories, run the cheapest decisive
> experiments it is authorized to run, and deliver a ranked solution portfolio
> whose claims resolve to evidence or reproducible evaluation receipts.

“Solve” is a pursuit, not a default verdict. Every candidate ends in one of these
explicit states:

- `proposed` — coherent but not yet tested;
- `proxy_supported` — supported only by a declared proxy or reduced experiment;
- `experimentally_supported` — passed the frozen target evaluation;
- `refuted` — failed a falsifier or acceptance threshold;
- `formally_verified` — passed a declared formal verifier under explicit
  assumptions;
- `inconclusive` — evidence or experimental power was insufficient;
- `blocked` — required authority, hardware, data, or tooling was unavailable.

No model vote, rhetorical confidence, test count, or benchmark win can promote a
candidate between these states. Only the named deterministic policy and admitted
evidence/experiment receipts can do so.

## Shared epistemic core

Both product programs share:

- immutable source and repository snapshots;
- exact locators and content digests;
- claim, assessment, contradiction, lineage, and freshness authority;
- typed problem/decision criteria;
- hypotheses, mechanism cards, falsifiers, and prior-art challenges;
- governed model and tool work;
- budgets, cancellation, idempotency, and effect receipts;
- durable orchestration and restart reconstruction;
- independent review and dissent preservation;
- admitted-only reporting and human-readable provenance.

The solver adds bounded intervention and evaluation. It does not bypass the
research product or create a second truth store.

## `research ask`

The research program accepts an arbitrary plain-language question and produces an
accepted `ResearchPlan` before discovery. The plan declares:

- scope, exclusions, audience, geography, timeframe, and decision criterion;
- subquestions and mandatory coverage;
- source classes, independence targets, freshness, and rights constraints;
- search queries and acquisition policy;
- contradiction, counterevidence, and falsification requirements;
- stop criteria and sufficiency thresholds;
- report outline and domain policy pack;
- currency, token, time, request, byte, and provider allocations.

The verifier evaluates the accepted plan and its resulting bundle. It does not
look for vocabulary from one hard-coded domain.

## `lab solve`

This section defines the future P11/P12 lifecycle. It is not an executable P9
contract: P9 permits no solver execution, repository mutation, package-manager,
compiler, shell, GPU, or code-running authority.

The solver program accepts a `ProblemContract` containing:

- target outcome and baseline;
- measurable success and falsification criteria;
- non-negotiable correctness, quality, safety, compatibility, and resource
  constraints;
- declared repository/data/model/hardware inputs;
- allowed tools, networks, filesystems, sandboxes, and external effects;
- spend and wall-time ceilings;
- required approvals and prohibited actions.

It executes this bounded lifecycle:

```text
frame problem and acceptance
  -> snapshot system, code, tests, issues, benchmarks, and environment
  -> research prior art and relevant mechanisms
  -> construct bottleneck and uncertainty map
  -> generate isolated competing hypotheses
  -> design cheapest decisive experiments
  -> static/adversarial review of experiment safety
  -> create sandboxed fork/worktree per candidate
  -> implement smallest testable intervention
  -> execute frozen evaluators and collect receipts
  -> update candidate states and preserve negative results
  -> independently review surviving candidates
  -> rank Pareto frontier under the accepted criterion
  -> deliver patches/branches, report, rollback, and next experiment
```

The product must support a research-only completion when code or experiment
authority is unavailable. It must never imply that a proposal was executed.

## Solver artifact model

Future solver releases freeze versioned forms of:

- `ProblemContract`;
- `SystemSnapshot` and `EnvironmentManifest`;
- `BottleneckMap` and `UncertaintyMap`;
- `SolutionHypothesis` and `MechanismCard`;
- `ExperimentPlan`, `EvaluatorContract`, and `RunManifest`;
- `SandboxGrant`, `ToolGrant`, and `ExternalEffectGrant`;
- `PatchProposal`, `PatchSet`, and `RepositorySnapshot`;
- `BenchmarkResult`, `CorrectnessResult`, and `FormalVerificationResult`;
- `SolutionVerdict`, `SolutionPortfolio`, and `SolverReceipt`.

Every patch and experiment is attributable to one hypothesis and one accepted
problem-contract revision. Results from changed workloads, hardware, code,
datasets, compilers, model checkpoints, or policies are not silently comparable.

## Engineering problem mode

Engineering runs may read repositories, issues, documentation, papers, benchmark
data, and declared environments. Write and execution authority is separate:

- repository input is pinned to an immutable commit;
- each candidate receives an isolated fork/worktree and branch;
- sandboxes default to no ambient network, secrets, home directory, or host write
  access;
- dependencies and build scripts are treated as hostile supply-chain inputs;
- CPU, RAM, disk, GPU, process, time, output, and spend limits are enforced;
- tests and benchmarks run from declared commands and artifact digests;
- release, merge, push to third-party repositories, issue/PR publication, and
  destructive actions always require explicit authority;
- failures, crashes, invalid runs, and negative results remain inspectable.

## Mathematical problem mode

Mathematical runs distinguish literature evidence, computation, heuristic
argument, proof sketch, and formal proof. A mathematical candidate may be promoted
to `formally_verified` only when a declared proof assistant or mechanical checker
accepts the exact artifact under recorded axioms, imports, versions, and trust
assumptions.

Counterexample search, symbolic algebra, numeric experiments, and theorem-prover
output are experimental evidence. They do not establish a universal theorem
unless the accepted verifier contract says they do.

## First solver exhibition: Colibri

The first systems exhibition targets the Apache-2.0 `JustVugg/colibri` project, a
pure-C runtime that streams GLM-5.2 routed experts through disk, RAM, and optional
accelerator tiers.

The exhibition starts from a pinned upstream commit and a frozen target profile.
The initial goal contract is:

> Improve sustained decode performance on a consumer system with at most 25 GiB
> available RAM, without exceeding the memory ceiling, silently changing router
> semantics, or causing a statistically meaningful quality regression under the
> accepted evaluator.

The T0 exhibition baseline must freeze the exact machine, operating system,
compiler, storage, model/checkpoint or proxy, workloads, warm/cold state, quality
evaluation, repetitions, uncertainty method, and invalid-run rules. A reduced
model or oracle can produce only `proxy_supported` evidence until the full target
checkpoint and hardware evaluation passes.

Candidate research lanes include, without pre-selecting a winner:

- grouped-scale versus row-scale quantization quality;
- expert-budget and cache-placement policies;
- router prediction and deferred prefetch;
- MTP acceptance regressions and cold-cache cost;
- kernel, memory-bandwidth, and I/O crossover points;
- benchmark-protocol confounds and quality-adjusted throughput.

The exhibition is successful only if Mammoth produces at least two independently
motivated candidates, refutes or supports them through accepted experiments, and
delivers one useful upstream-quality artifact: a measured patch, a negative result
that closes a plausible lane, or a reproducible benchmark that resolves an open
uncertainty. Opening or publishing an upstream PR remains a separate human gate.

## Release sequence

### P9 — Trustworthy General Research

Make the P8 live path truthful and bounded, split its authority boundaries, and
replace data-center hard-coding with an accepted question-derived plan. Prove
three unrelated research plans and at least one non-data-center report.

### P10 — General Research Evaluation

Complete three unrelated frozen report exhibitions and an equal-budget benchmark
against strong direct/deep-research baselines. Establish whether Mammoth's
epistemic machinery improves supported conclusions and decision usefulness.

### P11 — Experimental Solver

Freeze and implement the problem, hypothesis, sandbox, patch, evaluator, run, and
solution-verdict contracts. Prove restart, budget, isolation, supply-chain, and
negative-result behavior on deterministic fixtures.

### P12 — Solver Exhibitions

Run the Colibri systems exhibition, one mathematical problem with a mechanical
verification path, and one non-code theory/decision problem. Publish exact bundles
and compare against strong problem-solving baselines.

## Product success criterion

Mammoth 2.0 succeeds when it can demonstrate, on unrelated problems, that it
produces more useful, auditable, and reproducible decisions or solutions than a
strong baseline under equal declared resources—without false provenance,
unbounded effects, hidden failures, or inflated solution claims.
