# P9 Trustworthy General Research Plan

## Status and authority

Status: **entry acceptance contract. Implementation is blocked until this plan
PR and a distinct T0 acceptance-baseline PR merge.**

Release target: `v0.9.0-trustworthy-general-research`.

P9 is the first delivery checkpoint under [`MAMMOTH_2.md`](MAMMOTH_2.md). It
preserves every P2-P8 authority and provenance invariant. It does not implement
arbitrary code execution or claim the future `lab solve` product. It makes the
current live research path truthful under hostile inputs and generalizes planning
away from the data-center fixture.

`ARCHITECTURE.md` remains normative. `ADVERSARIAL_ANALYSIS_POST_P8.md` is the
adversarial input. This plan freezes the P9 outcome, exclusions, contracts,
delivery order, verification, and stopping condition.

## Baseline and reality boundary

P8 proves one credible question-to-report live exhibition in the data-center
domain. The showcased bundle contains 17 live sources, 119 evidence spans, 94
claims, a 3,433-word report, provider/cost receipts, and a separate editorial
review.

P8 does not prove general-purpose research. Its live program still contains fixed
data-center queries, coverage taxonomy, titles, keywords, contradiction framing,
and verifier vocabulary. The current live path also records or accepts several
claims that exceed what the transport proves:

- declared dollar budget is recorded, not enforced before every request;
- source publication time is populated from retrieval time;
- robots status asserts a check the path does not perform;
- PDF bytes may be decoded as UTF-8 instead of parsed;
- redirect/DNS acquisition lacks a complete hosted-use SSRF boundary;
- exact quote identity does not prove semantic entailment;
- retrieval failures and provider-unknown costs can be hidden as omission or zero;
- the P8 implementation concentrates policy, transport, parsing, evidence,
  synthesis, rendering, and receipts in one high-risk runtime module.

P9 treats those as release blockers, not documentation notes.

## Frozen outcome

> A user supplies an arbitrary research question. Before external work, Mammoth
> creates and accepts a typed research plan derived from that question. It then
> performs budget-enforced, hostile-input-safe discovery and acquisition; records
> only provenance it actually observed; admits claims only after an independent
> entailment decision; preserves failures and unknown costs; and emits a cited
> report evaluated against the accepted plan rather than one domain's vocabulary.

Golden operator shape:

```sh
mammoth research plan \
  "QUESTION" \
  --depth comprehensive \
  --budget-usd 5 \
  --output ./research/PLAN-SLUG

mammoth research run ./research/PLAN-SLUG/research-plan.json
```

`research ask` remains the one-command convenience path. It must internally
persist the same previewable plan and may auto-accept only deterministic defaults
that do not materially change scope, risk, spend, rights, or tool authority.

## In scope

### Gate A — truthful and bounded live research

1. hard pre-transport reservations for search, retrieval, parsing, and model work;
2. honest source dates, robots decisions, media support, costs, and retrieval
   residue;
3. complete public-network/redirect SSRF policy suitable for hosted use;
4. fail-closed media parsing with no binary-as-text path;
5. independent quote-to-claim entailment and hostile-span handling;
6. explicit retention, redaction, quotation, deletion, and export policy fields;
7. decomposition of P8 runtime behavior along enforceable authority boundaries.

### Gate B — question-derived research planning

1. versioned `ResearchPlan` generated from the question and accepted under policy;
2. question-derived scope, subquestions, coverage, source classes, queries,
   contradiction requirements, freshness, stop criteria, outline, domain policy,
   and budget allocation;
3. verifier expectations derived from the accepted plan, not fixed vocabulary;
4. deterministic fixtures for unrelated technical, policy, and scientific plans;
5. one complete non-data-center offline report and one separately authorized live
   exhibition before release.

## Explicitly out of scope

- arbitrary shell, repository write, package-manager, compiler, GPU, or code
  execution authority;
- `mammoth lab solve`, patch generation, or claims of solving a project;
- a hosted multi-user service or broad public UI;
- OCR, audio, or video acquisition;
- paywall, authentication, CAPTCHA, or access-control bypass;
- legal conclusions about source rights;
- a universal research-quality score;
- weakening P8's deterministic offline fixture.

P11 owns experimental solver execution. P9 may freeze forward-compatible problem
and solution status vocabulary only through the separate 2.0 thesis and ADR.

## Versioned contracts

T0 freezes a new `p9.v1` envelope and canonical identities for:

- `ResearchPlanProposal` and `ResearchPlan`;
- `ResearchScope`, `ResearchExclusion`, and `DomainPolicyPack`;
- `PlannedSubquestion`, `CoverageRequirement`, and `SourceClassTarget`;
- `PlannedSearchQuery` and `ContradictionRequirement`;
- `FreshnessRequirement`, `StopCriterion`, and `ReportOutline`;
- `BudgetAllocation` and `EffectCostBound`;
- `SourceDateObservation` and `DateExtractionVerdict`;
- `RobotsDecision` and `SourceRightsStatus`;
- `RetrievalAttempt`, `RetrievalFailure`, and `RetrievalCoverageResidue`;
- `MediaSupportDecision` and `ParserReceipt`;
- `EntailmentProposal` and independent `EntailmentVerdict`;
- `RetentionPolicyDecision`, `RedactionReceipt`, and `DeletionReceipt`;
- `PlanCoverageAssessment` and `PlanAcceptanceReceipt`.

Reuse P8 identities where semantics are unchanged. Never reinterpret a P8 digest.
New optional semantics require a P9 version or explicit `unknown` value; absence
must never be serialized as a confident observation.

## Gate A acceptance contract

### Hard budget enforcement

Every external effect has a preflight cost bound. One authoritative transaction
must reserve the worst-case declared amount before transport. A retry, fallback,
or batch split is a new effect or consumes a previously frozen bounded attempt.
The effect cannot start when its bound exceeds remaining authorization.

The bound comes from an immutable provider-price-catalog version plus the exact
request ceiling (requests, input/output tokens, bytes, parser class, and retry
count). A provider/effect without a conservative catalog entry is unavailable;
the operator cannot convert unknown pricing into permission by supplying an
arbitrary low estimate. If a provider reports settlement above its accepted
bound, Mammoth records a policy breach, quarantines further effects for that
catalog entry, and stops honestly. The invariant prevents the next overspend; it
does not pretend the already-reported breach did not occur.

Provider-reported settlement may be less than the reservation. Missing provider
cost is `unknown`, never `$0`. The run may continue only when policy defines a
conservative charge bound for that provider. Receipts retain reservation,
settlement, release, unknown-cost state, and remaining authorization.

Required adversarial fixtures:

- concurrent effects attempt to spend the same remainder;
- provider omits usage/cost;
- a split/retry would exceed remaining currency or tokens;
- transport succeeds but settlement is lost;
- cancellation races with transport;
- provider reports a cost greater than its declared bound.

No fixture may exceed the accepted budget, double settle, or convert unknown to
zero.

### Truthful source metadata

`retrievedAt` is the only mandatory timestamp. `publishedAt` is optional and
requires a typed extraction method, exact locator, source value, normalized value,
confidence, and verdict. Retrieval time is never copied into publication time.

Robots state is one of `allowed`, `denied`, `not_checked`, `unavailable`,
`ambiguous`, or explicit operator override. `allowed`/`denied` requires the
evaluated robots bytes or receipt, agent token, requested/final URL, timestamp,
policy version, and decision path. P9 follows denial and never lies about a check.

Rights/licensing status remains observational and may be `unknown` or
`conflicting`. It controls quotation/export policy but does not masquerade as legal
advice.

### Network acquisition safety

Before every connection and redirect hop:

- canonicalize scheme, host, port, credentials, and URL;
- allow only configured HTTP(S) destinations;
- resolve and reject loopback, private, link-local, multicast, carrier-grade NAT,
  metadata, documentation, reserved, and otherwise non-public addresses for IPv4
  and IPv6, including mapped forms;
- bind the approved address set to the actual transport connection while
  preserving Host and TLS SNI;
- reject mixed public/private answers, rebinding, origin drift, credentialed URLs,
  excessive redirects, and downgrade policy escape;
- re-run policy at every hop and record the chain.

Tests include IPv4/IPv6 literals, integer/hex/octal forms, mapped addresses,
userinfo, trailing dots, Unicode/punycode, DNS answer changes, public-to-private
redirects, and proxy/environment bypass attempts.

### Media and parser safety

Supported media requires a registered parser with version/digest identity,
byte/output limits, time/memory/process limits, and deterministic failure
classification. Content-Type, sniffed type, extension, and parser decision are
retained.

P9 either wires a real text-layer PDF parser with page locators and fixtures or
rejects PDF as unsupported. UTF-8 decoding of arbitrary PDF bytes is forbidden.
Compressed/archive, OCR-heavy, encrypted, malformed, or parser-hostile inputs fail
closed and remain visible as typed residue.

### Independent entailment

Claim generation and entailment evaluation are separate model works with distinct
role identity. The entailment evaluator receives the exact proposed claim, exact
quote, bounded context, locator, and no authority tools. Deterministic policy
rejects any claim that adds unsupported quantity, scope, causality, comparison,
certainty, actor, timeframe, or recommendation premise.

The evaluator is blind to the generator's rationale and receives no editable
generator output beyond the typed claim. Work IDs and raw responses are distinct.
Model-profile lineage/correlation is recorded. Critical claims require a distinct
accepted profile family in the default P9 policy; a same-family verdict is labelled
correlated and cannot satisfy that gate. Offline fixtures use deterministic
independent proposer/verifier adapters rather than one response copied twice.

Fixtures include prompt injection inside valid spans, near-entailing text,
negation, unit drift, causal overreach, scope widening, quote truncation, and
correct contradiction. Unsupported claims cannot render even if the editorial
review likes them.

### Retrieval and retention residue

Every search candidate selected for acquisition yields a terminal typed attempt:
admitted, rejected, denied, unavailable, timed out, rate-limited, parser-failed,
policy-blocked, cancelled, or unknown. Coverage reports distinguish weak evidence
from failed acquisition and expose missing source classes.

Snapshot retention/export records policy ID, access class, quotation bounds,
redaction status, deletion eligibility, and public-bundle status. Public examples
minimize quoted source text and contain no secrets or private data.

## Gate B planning contract

### Plan production and acceptance

A model may propose a plan. Deterministic code validates closed schemas, identities,
budgets, policy compatibility, coverage structure, allowed source classes, and
operator authority. The accepted plan is immutable and content-addressed. Material
changes create a linked revision and invalidate downstream work whose identity
depends on the changed field.

The plan must answer:

- What decision or understanding is sought?
- What is in and out of scope?
- Which subquestions must be answered?
- What source classes and independence are required?
- Which contradictions or counterarguments must be sought?
- What is time-sensitive and how fresh must it be?
- What evidence would falsify the leading answer?
- When should Mammoth stop or report insufficiency?
- What report structure serves the audience?
- How are budgets allocated and rebalanced?

### Domain policy packs

Domain packs define additional constraints without hard-coding conclusions. The
first packs are:

- `general-web/v1`;
- `technical-due-diligence/v1`;
- `public-policy/v1`;
- `scientific-review/v1`.

Packs may require source classes, date rules, evidence hierarchies, uncertainty
language, rights handling, or evaluator methods. They may not add unsupported
facts or silently relax global security/provenance rules.

### Generic verification

The P9 verifier reads the accepted plan and proves:

- all mandatory coverage is supported or explicitly insufficient;
- source-class targets and independence policy are accounted for;
- contradiction/counterevidence requirements ran;
- freshness and stop criteria were evaluated;
- every factual sentence retains P8 provenance plus independent entailment;
- report headings and terminology derive from the plan/manifest;
- unrelated questions do not inherit data-center queries, topics, titles,
  keywords, or contradiction text;
- dense but irrelevant prose cannot satisfy plan coverage.

T0 makes plan quality mechanical through exact canonical fixture plans and
metamorphic cases. Changing geography, timeframe, audience, risk, or budget must
change the corresponding canonical plan fields and downstream identities.
Unrelated questions must differ in subquestions, source-class targets, queries,
contradiction requirements, outline, and domain pack. Every fixture includes
forbidden vocabulary from the other domains so accidental data-center/template
leakage fails explicitly. A structurally valid plan that ignores a material input
must be rejected.

## Frozen acceptance corpus

T0 merges a distinct acceptance-baseline PR containing:

1. the existing data-center fixture, unchanged and still required;
2. a technical due-diligence fixture with code/docs/vendor/security claims;
3. a public-policy fixture with legislation, dates, implementation evidence, and
   stakeholder disagreement;
4. a scientific-review fixture with papers, conflicting results, uncertainty,
   and causal limits;
5. hostile network, parser, metadata, budget, entailment, prompt-injection,
   retention, and future-schema fixtures;
6. frozen thresholds, plan expectations, typed artifacts, evaluator rubrics,
   verifier manifest, and receipt schema.

T0 also freezes the exact non-data-center offline report question, the exact live
exhibition question, their domain packs, expected source classes, critical-claim
policy, independent-review policy, numeric sufficiency/diversity thresholds, and
machine-readable pass/fail predicates. T6 cannot select an easier exhibition after
seeing implementation results.

Only one non-data-center full offline report is required for the P9 release; all
three unrelated domains must produce accepted plans. P10 completes and benchmarks
all three report exhibitions.

## Architecture decomposition

Refactor by authority boundary while preserving behavior:

1. `planning` — plan proposal, policy, identities, revisions;
2. `acquisition-policy` — URL/DNS/redirect/robots/rights decisions;
3. `document-parsers` — bounded parser registry and artifacts;
4. `evidence-selection` — chunks/spans and locator integrity;
5. `claim-admission` — proposals, entailment, lineage, deterministic policy;
6. `report-planning` — admitted-only outline/manifest construction;
7. `budget-authority` — reservations, settlements, unknown cost, receipts;
8. `p9-application` — composition only.

The decomposition may use modules before packages. A new package must correspond
to an authority/test boundary, not file-count aesthetics. `p8-turnkey.ts` becomes
a compatibility facade during migration and cannot remain the policy owner.

## Delivery slices

### T0 — entry plan and acceptance baseline

Merge this plan, `MAMMOTH_2.md`, ADR 0011, `AGENTS.md`, `LOOP.md`,
`docs/reviews/p9-coordinator-ledger.md`, and the reconciled roadmap. Those
governance artifacts are part of the entry-plan gate and must remain merged and
consistent before any lane setup. Then merge a distinct acceptance-baseline PR
with the four plan fixtures, one non-data-center report fixture, hostile cases,
thresholds, expected artifacts, rubric, receipt schema, and a visible
`verify:p9` skeleton that fails until each required implementation gate exists.

Gate: implementation cannot claim progress before the acceptance baseline is
mechanically measurable.

### T1 — budget and truthful metadata

Implement pre-transport reservations/settlements, unknown cost, optional
publication dates with locators, real robots decisions, rights status, and complete
retrieval residue.

Gate: adversarial concurrency/retry/cost fixtures cannot overspend; no unobserved
date/robots/cost becomes a confident field.

### T2 — hosted-safe acquisition and parsers

Implement pinned public-network policy across redirects, bounded media registry,
and real PDF parsing or explicit rejection. Move acquisition policy and parsers
out of the P8 monolith.

Gate: network/parser hostile corpus fails safely with exact receipts and no host
access, binary-as-text, or hidden omission.

### T3 — independent entailment admission

Implement distinct claim and entailment work, hostile-span defenses, deterministic
admission, and preserved rejection residue.

Gate: every rendered factual sentence has an independent accepted entailment
verdict; seeded unsupported rewrites cannot render.

### T4 — typed question-derived planning

Implement plan proposal/validation/preview/accept/revise and the four domain policy
packs. Search, coverage, contradiction, freshness, stop, outline, and budgets derive
from the accepted plan.

Gate: unrelated questions produce materially different accepted plans with no
data-center constants.

### T5 — generic execution and verification

Compose the accepted plan into discovery, acquisition, evidence, cycles, and
reporting. Replace domain-word checks with plan-relative verification and complete
one non-data-center offline report.

Gate: both data-center regression and unrelated report pass; a canned dense report
fails plan coverage.

### T6 — live exhibition and release

Run one separately authorized non-data-center live exhibition, exact-bundle
independent editorial and entailment audit, security review, clean-checkout ladder,
code PR/main CI, annotated tag, receipt-only PR, and receipt-bearing main CI.

Gate: exact candidate satisfies every stopping predicate below. P10 becomes next.

## Verification

Before release:

```sh
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm verify:p2
pnpm verify:p3
pnpm verify:p4
pnpm verify:p5
pnpm verify:p6
pnpm verify:p7
pnpm verify:p8
pnpm verify:p9
```

CI must visibly run `verify:p9`. Offline gates require no public web, paid provider,
large model, or secret. Live exhibitions require explicit credential and billing
authorization and record exact provider/model/configuration/cost/latency/failure
evidence.

Independent review must include:

- application/security review of budget, network, parser, retention, and authority;
- epistemic review of plan derivation, entailment, and verifier gaming;
- editorial review of the exact non-data-center report;
- code-author-independent review before tag.

## Stopping condition

P9 is complete only when:

1. all P8 regressions pass unchanged;
2. no external effect can exceed the accepted hard budget under concurrency,
   retry, split, timeout, cancellation, or unknown provider cost;
3. publication, retrieval, robots, rights, media, parser, cost, and failure fields
   state only what Mammoth observed;
4. hosted-safe SSRF/redirect/DNS and parser hostile fixtures pass;
5. every rendered factual sentence has an independent accepted entailment verdict;
6. technical, policy, and scientific questions produce distinct accepted plans;
7. at least one unrelated offline report passes plan-relative verification while
   a canned/irrelevant report fails;
8. one authorized unrelated live exhibition passes exact-bundle independent
   review with no blockers;
9. clean-checkout `verify:p9`, exact-head CI, merged-main CI, annotated tag,
   release receipt, and final receipt-bearing main CI all pass;
10. P10 remains unclaimed until its own plan and benchmark baseline merge.
