# Mammoth Worker Contract

## Mission and authority

Mammoth is a domain-agnostic, local-first research operating system for difficult,
long-horizon problems. Its product is the strongest useful, readable, evidence-bound
answer an agentic team can justify, including competing explanations, cross-domain
mechanisms, falsifiable hypotheses, and bounded experiments when authorized.

Read authority in this order:

1. `CORE_THESIS.md` — product purpose and non-negotiable epistemic contract;
2. `PRODUCT_ROADMAP.md` — active outcome sequence and completion criteria;
3. `CURRENT_PRODUCT_AUDIT.md` — honest current capability and known drift;
4. `ARCHITECTURE.md` — durable technical and research architecture;
5. `LOOP.md` — autonomous delivery protocol;
6. phase plans and release receipts — historical evidence, not product authority.

If a historical plan conflicts with the core thesis, the core thesis wins. Phase
numbers, frozen exhibitions, manifests, journals, receipts, and verifiers are
subordinate to the user outcome. They may constrain implementation and prove trust;
they may not redefine the product.

## Active product outcome

The current target is the first honest arbitrary-question vertical slice through the
normal public product path. It must answer this holdout question without topic logic:

> Yann LeCun argues that world models are important beyond the limitations of LLMs.
> With compute increasingly scarce, where do the biggest opportunities lie today for
> individuals building open-source, private, local systems based on world models
> using a single consumer GPU?

The required path is:

```text
plain-language question
  -> generated problem contract
  -> generated independent team and research plan
  -> explicit scoped authority
  -> governed live retrieval and source preservation
  -> source-derived spans, claims, contradictions, and admission
  -> cross-domain mechanism mapping and falsifiable hypotheses
  -> bounded experiment proposals
  -> reader-first cited answer
  -> separate complete audit projection
```

`mammoth investigate` currently proves only the no-effect preview and approval
surface. Work is incomplete until the accepted plan composes existing governed
capabilities and returns a strong answer through the normal CLI path.

## Product invariants

- No topic names, expected conclusions, source URLs, prose templates, section IDs,
  domain keywords, or fixture answers may appear in generic runtime branches.
- Domain packs are inspectable data and policy. They are not privileged code paths.
- Candidate generators diverge independently before seeing peers. Evaluators never
  grade their own proposals. Dissent and negative results remain visible.
- Cross-domain transfer records the shared mechanism, boundary conditions,
  non-equivalences, predictions, falsifiers, and prior-art challenge.
- Every factual sentence in reader output is supported by admitted evidence or is
  visibly labelled as deduction, analogy, hypothesis, speculation, or uncertainty.
- Reader output answers the question before exposing implementation detail. Internal
  IDs, manifests, journals, receipts, and diagnostics belong in the audit projection.
- Citations are sentence-local and resolve to preserved source material. Fabricated,
  unbound, or weak evidence fails closed.
- Research may end honestly as partial, inconclusive, or blocked. It may not disguise
  missing evidence, authority, provider capacity, or experimental power.
- Existing safety, budget, lineage, idempotency, retention, and hostile-input gates
  remain in force. Generality is not permission to weaken trust machinery.

## Effect and authority boundary

Research and experiment design are automatic. Repository edits, tests, branches, PRs,
CI repair, and reversible integration are authorized for this delivery loop.

The following still require valid explicit scoped authority before execution:

- paid provider effects or new budget;
- destructive or irreversible actions;
- external publication outside `heybeaux/mammoth`;
- real-world mutations, messaging, account changes, or deployment;
- experiments that modify repositories, install unapproved software, touch private
  data, or escape declared sandboxes.

Prefer deterministic fixtures, local models, replayed evidence, and zero-cost
providers while building. Never infer spend authority from a broad implementation
request. Do not deploy or publish a release on Friday.

## Required assignment record

Every delegated lane must record:

- objective, acceptance evidence, and the product predicate it advances;
- runtime, session key, run ID, resolved model, owner, and independent reviewer;
- fresh worktree, branch, base SHA, owned paths, and prohibited paths;
- contracts allowed to change and integration dependencies;
- exact focused and regression verification commands;
- effect ceiling, authority source, and whether the lane is strictly no-effect;
- handoff artifact, residual risks, and next unproved predicate.

Do not silently broaden a lane. Stop with a conflict note before editing outside its
write set. The coordinator alone reconciles cross-package contracts, root manifests,
the lockfile, shared plans, and release claims unless ownership is explicitly moved.

## Coordinator and team shape

The coordinator owns the integration branch and durable TaskFlow. It keeps one slot
for integration and uses at most three concurrent implementation lanes. Good lane
boundaries for the current outcome are:

- **Plan and authority** — accepted generated plan, team, scope, budgets, and effect
  grants from the public preview;
- **Acquisition and evidence** — plan-driven discovery, policy-pinned retrieval,
  snapshots, parsing, exact spans, claims, contradiction, and admission;
- **Synthesis and projections** — cross-domain mechanism transfer, hypotheses,
  experiment proposals, reader report, citations, and audit projection;
- **Adversarial acceptance** — four-domain holdouts, leakage detection, canned-prose
  rejection, evidence tampering, hostile inputs, clean-checkout gates, and editorial
  review.

Contract changes serialize. Dependents resync after integration. Authors do not
self-certify release predicates.

## Worker liveness and ownership

Use exact states:

- **spawn requested** — accepted but execution unproved;
- **active** — the matching live registry reports the same run as running;
- **producing** — active plus a fresh attributable artifact, diff, test, or report;
- **completed** — a handoff was returned;
- **integrated** — reviewed and incorporated by the coordinator;
- **retired** — registry termination and filesystem quiescence are proved.

Prepared worktrees or accepted spawn requests do not prove activity. Before replacing
a worker, verify the exact session/run is terminal, inspect fresh mtimes and diffs,
preserve useful work, and retire ownership. One worker owns one worktree and path set.

## Verification and claims

Start with focused tests, then run the affected package gates, Outcome 1 four-domain
acceptance, `verify:p8`, `verify:p9`, full format/lint/typecheck/test/build, and a clean
checkout when ignored `dist/` output could mask missing builds.

The world-model result is not accepted merely because commands pass. Independent
review must confirm that:

- the answer is responsive, readable, and useful before audit detail;
- claims and prose derive from captured source content rather than topic templates;
- contrary evidence and uncertainty are represented honestly;
- cross-domain transfers identify mechanisms and failure boundaries;
- experiments are decisive, bounded, and tied to uncertainties;
- citations resolve to the exact admitted evidence used;
- the same public path produces structurally valid, distinct work on unrelated
  holdouts; and
- removing or swapping source evidence changes the result appropriately.

## Escalation and completion

Change strategy after two identical failures. After three, quarantine the failure,
record the root cause, and continue on independent unblocked work. Never delete or
weaken a gate to manufacture progress.

Escalate only for a genuinely non-retrievable product decision, new credentials or
billing, legal/privacy/security risk, destructive action, or a blocker that survives
three distinct strategies with no useful unblocked work left. Routine reversible
implementation, review, PRs, CI repair, and sequencing remain coordinator work.

The current loop completes only when the exact holdout question is answered through
the normal Mammoth path, the reader and audit projections pass independent review,
unrelated-domain acceptance and regressions pass from a clean checkout, all code is
merged with green exact-head and fresh-main CI, and the completion receipt states both
what was proved and what remains outside the claim. A release or deployment waits
until a non-Friday day.
