# Adversarial analysis of Mammoth after P8

- Date: 2026-07-14
- Scope: application and product reality at `f54ad1a`
- Comparator: the pre-completion blind assessment in
  [`ADVERSARIAL_ANALYSIS.md`](ADVERSARIAL_ANALYSIS.md)

## Verdict

Mammoth has crossed an important line: it is no longer only an unusually rigorous
research substrate. It can now accept a plain-language question in its supported
domain, search the public web, preserve acquired sources, generate source-derived
claims, render a readable cited report, emit receipts, and verify the completed
bundle.

That is real product progress. The 3,433-word
[data-center impact report](research/examples/data-center-community-impacts/report.md)
is a credible demonstration, not the 448-word canned artifact that initially
passed the release machinery. It uses 17 live sources, 119 evidence spans, and 94
claims. An independent model review returned `pass_with_notes` with no blockers.
Here “independent” means a separate Claude Sonnet 5 call reviewing the exact Luna
report with no access to the generation response. It is model-separated, not an
independent human or organization, and should not be represented as equivalent to
expert peer review.

The adversarial conclusion is still not “Mammoth is finished.” It is:

> Mammoth is now a strong, inspectable **single-domain research application**
> built on an unusually rigorous substrate. It is not yet an honest
> general-purpose research application, and several provenance and safety fields
> currently promise more than the live acquisition path actually proves.

The next phase should not add more orchestration. It should make the live product
truthful under hostile inputs, enforce its economic limits, generalize planning,
and prove a measurable advantage on unrelated tasks.

## Updated scorecard

| Dimension                      | Blind assessment | Post-P8 assessment | Adversarial reading                                                        |
| ------------------------------ | ---------------: | -----------------: | -------------------------------------------------------------------------- |
| Engineering foundations        |           8.5/10 |               9/10 | Durability, receipts, replay, provenance wiring, and CI remain excellent.  |
| Current end-user functionality |           3.5/10 |               6/10 | A real question-to-report CLI exists, but only for one hard-coded domain.  |
| Technical differentiation      |             8/10 |             8.5/10 | Evidence-bound output remains genuinely differentiated.                    |
| Generic research capability    |       not scored |             2.5/10 | The input is generic text; the planning and report program are not.        |
| Human-review experience        |       not scored |               4/10 | The report is readable; provenance inspection is still artifact-oriented.  |
| Operational readiness          |       not scored |               4/10 | Local operation is credible; hosted and hostile-network operation are not. |
| Commercial proof               |             5/10 |               3/10 | The code advanced faster than customer and benchmark evidence.             |
| Risk of overengineering        |             9/10 |             8.5/10 | The risk fell slightly because a product exists, but remains high.         |

## What changed since the blind assessment

### The product demonstration gap is substantially closed

The blind assessment asked for one exceptional end-to-end live example. P8 now
provides one. The live path performs public-web discovery, acquisition, source
snapshotting, evidence-span extraction, model-assisted claim rewriting, report
rendering, inspection, and receipt generation in one operator flow.

The corrective P8 work also fixed a serious acceptance failure: a report could
previously pass the release process while containing sparse, canned synthesis.
The verifier now rejects thin sections, low claim/span density, repeated narrative
templates, malformed fragments, and missing domain coverage.

### Multi-model execution is now practical

The OpenAI-compatible path works with OpenRouter, including provider base URLs
that carry a path prefix. The live run used `openai/gpt-5.6-luna`; a separate
`anthropic/claude-sonnet-5` pass reviewed the exact report. Provider timeouts,
strict structured output, batch splitting, and response-shape validation are much
stronger than the initial live implementation.

### The broader orchestration thesis has more implementation evidence

P4-P7 added isolated cells, preserved dissent, broader topology, governed model
work, Temporal execution, receipts, and projections. The blind analysis was
correct that the earlier runtime only proved a sequential evidence-processing
pipeline. The repository now proves substantially more of the orchestration
substrate.

However, the P8 product path does not yet expose most of that sophistication to
the end user. The product demonstration is still effectively a specialized
research compiler rather than a visibly adaptive multi-cell research program.

## Critical findings

### P0 — The declared dollar budget is not a hard spending boundary

`runP8LiveResearch()` records `budgetUsd` in the brief and receipt, but the live
search and synthesis loops do not reserve or decrement that budget before each
request. Actual provider cost is added after the model returns. Batch splitting
can create additional requests, and providers that omit a `usage.cost` field are
recorded as zero-cost.

This means the receipt can accurately say what a cooperative provider reported,
but `--budget-usd` does not currently guarantee that Mammoth will stop before
crossing the user's authorization.

Required fix:

- reserve worst-case search and model cost before transport;
- pass a governed output-token ceiling to every provider call;
- stop or require approval before a retry/split can exceed the remaining budget;
- distinguish “provider did not report cost” from `$0`;
- test the limit with a fake provider that attempts to exceed it.

### P0 — Source publication dates are currently fabricated from retrieval time

The live acquisition path sets `publishedDate` to the current date for every
source. That value is not extracted from the page and is not the source's
publication date. Retrieval time is already recorded separately as `retrievedAt`.

An epistemic product cannot use a confident field name for information it did not
observe. The correct value is `unknown` unless Mammoth extracts and validates a
publication date.

Required fix:

- make publication time optional and provenance-bearing;
- retain `retrievedAt` as the only guaranteed timestamp;
- add explicit date-extraction confidence and source locator when a date exists;
- revalidation policies must not infer freshness from retrieval time.

### P0 — The robots field asserts a check that does not occur

Each acquired live source records `robots: recorded_no_disallow_found`, but the P8
path does not fetch or evaluate `robots.txt`. That is a false provenance claim.

Required fix: implement a real robots decision with the evaluated URL, policy,
timestamp, and result—or record `not_checked` and make the acquisition policy
explicit.

### P0 — PDF content is accepted but not parsed as PDF

`application/pdf` is admitted as a supported media type, then its bytes are
decoded through UTF-8 normalization. A binary PDF can therefore become garbage
text, while a coincidentally long result may clear the minimum-length test.

Required fix: reject PDFs until a real text-layer parser is wired into the live
path. OCR can remain deferred, but binary decoding must never masquerade as
parsed evidence.

### P0 before hosted use — live acquisition lacks an SSRF boundary

Search results are fetched with redirects enabled. The acquisition path does not
show a public-address allowlist, DNS/IP validation, redirect-hop validation, or a
block on loopback, link-local, and private networks. Brave normally returns public
results, but a compromised result or redirect can still target local services.

This is tolerable only as a trusted local experiment. It is a release blocker for
any hosted or multi-user service.

### P1 — Exact span binding is not semantic entailment

The provider is prompted to write a claim entailed by each quote, and Mammoth
strictly validates schema, IDs, quote identity, and length. That prevents invented
sources and broken locators. It does not prove that the rewritten claim is
actually entailed by the quote.

The independent editorial review helps for this exhibition, but it is not part of
the governed acceptance path. A hostile source can also place instructions inside
an otherwise admissible span.

Required fix:

- treat rewritten claims as proposed state only;
- run an independent entailment verdict against the exact quote;
- reject claims that add quantities, causal force, scope, or certainty;
- include adversarial prompt-injection spans in the acceptance corpus;
- require verifier evidence that an unsupported rewrite cannot render.

### P1 — Retrieval failure policy can hide partial acquisition

Brave rate limits receive bounded retry treatment, but individual acquisition
errors are generally converted to “source unavailable” and omitted. That keeps a
run moving, but the final product does not clearly distinguish a genuinely weak
evidence landscape from transport errors, parser failures, blocked pages, and
provider outages. Model batch splitting can also amplify requests during a
provider degradation.

Required fix: preserve typed retrieval residue for every attempted result, expose
failure rates in coverage, and make sufficiency sensitive to missing source
classes rather than only the count of successfully admitted pages.

### P1 — Captured web content creates privacy and redistribution obligations

Mammoth intentionally retains source snapshots. Public pages can still contain
personal information, subsequently deleted content, copyrighted text, or terms
that restrict automated reuse. A local single-user tool has a smaller exposure,
but a hosted product or committed public bundle changes the risk substantially.

Required fix: define retention, redaction, deletion, access-control, and export
policies; minimize quoted text in public artifacts; record source rights/status
where known; and obtain legal review before redistributing broad captured corpora.

## Product findings

### The application is data-center-specific despite generic CLI wording

The P8 input accepts an arbitrary question string, but the live program contains:

- six hard-coded data-center search queries;
- a fixed mandatory-topic taxonomy for electricity, water, emissions, pollution,
  land, environmental justice, economics, housing/services, variation, and policy;
- a fixed data-center report title and HTML title;
- data-center-specific keyword admission;
- a fixed climate-accounting contradiction;
- a verifier that intentionally rejects an unrelated banana/battery question.

This is not inherently bad. A narrow research product can be excellent. The
problem is representational: accepting a string is not the same as supporting an
arbitrary research domain.

The README now states this boundary explicitly. Additional unrelated showcase
reports should wait until the planner, coverage contract, and report framing are
derived from the question rather than from a fixture.

The current verifier is also optimized for this fixed acceptance case. Its
keyword and section-depth thresholds can reject a legitimate narrow question or
be satisfied by mechanically dense prose. Verifier success must remain evidence
about the frozen contract, not a universal research-quality score.

### P8 is becoming a monolith inside a modular repository

The repository has 27 pnpm workspace projects and roughly 70,000 lines of
TypeScript across application, package, and evaluation code. Yet the current P8
product path concentrates acquisition, text normalization, evidence extraction,
model transport, validation, report planning, rendering, and receipts in
`packages/runtime/src/p8-turnkey.ts`—2,648 lines and roughly 74 functions.

That concentration made rapid correction possible, but it is now the highest-risk
change surface in the application. Provider compatibility, parsing, policy, and
prose fixes all collide in one file.

Recommended split:

1. question-derived planning contract;
2. acquisition and network policy;
3. document parsers;
4. evidence-span selection;
5. claim proposal and entailment admission;
6. report planning/rendering;
7. budget/receipt accounting.

The split should follow enforceable authority boundaries, not create packages for
their own sake.

### Source independence remains mostly hostname independence

Live source families are derived from registrable-looking hostname suffixes. That
prevents two pages on one domain from counting as independent families, but it
does not detect syndicated articles, copied press releases, shared upstream
datasets, or circular citation across domains.

The blind analysis identified source-independence modelling as a possible moat.
That opportunity remains open.

### The report is a UI; the application still does not have one

The rendered report is clean and readable. The provenance artifact is functional
but raw, and the CLI returns machine-oriented JSON. There is no completed desktop
or hosted application UI despite the existence of Observatory projection
contracts.

That is not a release failure because the README declares the UI deferred. It is
a product-adoption limit. A reviewer still cannot quickly answer “which conclusion
is most fragile?”, “what changed?”, or “what evidence would most reduce
uncertainty?” without traversing artifacts.

### Report quality is now credible, but still mechanical

The independent reviewer praised coverage, conditional framing, integrated
environmental-justice analysis, citation discipline, and actionable conclusions.
It also identified repetitive evidence-linking templates, loosely connected facts,
unreconciled water-use units, and repeated examples.

This is acceptable for the flagship proof. It is not yet a premium analyst
experience. Future quality work should improve synthesis planning rather than add
more source-derived sentences.

### The flagship economics are encouraging but incompletely governed

The live execution receipt records `$0.066208` for Brave plus Luna synthesis and
19,454 model tokens. The separate Sonnet editorial review cost `$0.024034`.
Provider-only comparison calls added roughly two cents, keeping the entire
OpenRouter experiment far below the authorized `$5` ceiling.

That is useful early evidence that the workflow can be inexpensive. It does not
repair the budget-enforcement finding: the low total happened because the chosen
providers were inexpensive, not because Mammoth could guarantee the cap. The
receipt also does not record end-to-end latency, so this analysis cannot make a
verified time-to-report claim.

## What the blind analysis got right

| Blind prediction                                           | Post-P8 result                                                                                         |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| “Make one end-to-end live example exceptional.”            | Achieved after the initial sparse report was rejected and rebuilt.                                     |
| “The architecture-to-product ratio is dangerously high.”   | Improved, but one specialized CLI remains the only complete product surface.                           |
| “Build an evaluation moat before a feature moat.”          | Not achieved. Offline gates prove integrity, not comparative research quality.                         |
| “Provider-dependent quality remains unproven.”             | One useful Luna/Sonnet comparison exists, but no benchmark suite or controlled baseline.               |
| “Source independence could become a differentiator.”       | Still mostly unimplemented beyond hostname-family counting.                                            |
| “Human-review ergonomics should answer decisions quickly.” | The report improved; artifact/provenance review remains technical.                                     |
| “Choose a narrow beachhead.”                               | Accidentally achieved through hard-coded data-center research, but not yet chosen as a customer wedge. |
| “Pause nonessential platform work.”                        | Not followed; P4-P7 expanded the substrate before external benchmark or user evidence.                 |

The blind analysis therefore remains directionally valid. P8 did not invalidate
it; P8 supplied the first evidence that the foundations can produce something a
person actually wants to read.

## Recommended next sequence

### Gate A — Make the current live path truthful and bounded

Before advertising more examples:

1. enforce spend before transport;
2. correct publication and robots metadata;
3. reject unsupported media types;
4. add SSRF and redirect policy;
5. add semantic entailment admission;
6. preserve provider-unknown cost as unknown;
7. break the P8 monolith along authority boundaries.

### Gate B — Generalize planning, not just prompts

Introduce a typed research-plan artifact produced from the question and accepted
under policy. It should declare:

- research scope and exclusions;
- subquestions and mandatory coverage;
- search queries and source-class targets;
- contradiction and counterevidence requirements;
- freshness rules;
- stopping criteria;
- report outline;
- domain policy pack;
- budget allocation.

The offline verifier should validate the accepted plan and resulting bundle, not
look for data-center vocabulary.

### Gate C — Prove three unrelated examples

Only after Gate B, produce three examples that stress different evidence modes:

1. **Technical due diligence** — repository, security, architecture, and vendor
   claims with primary documentation and code evidence.
2. **Public-policy impact analysis** — legislation, implementation data,
   stakeholder disagreement, and temporal freshness.
3. **Scientific evidence review** — papers, uncertainty, conflicting findings,
   and explicit limits on causal inference.

Each example should have a frozen corpus, expert rubric, baseline comparison,
cost receipt, independent review, and a readable provenance view.

### Gate D — Run the benchmark the blind analysis requested

Compare, at equal declared cost:

- a frontier model directly;
- a frontier provider's deep-research mode;
- a lightweight search-and-synthesize loop;
- Mammoth with one model;
- Mammoth with independent model review;
- Mammoth with entailment and source-independence gates.

Measure factual precision, supported-claim recall, contradiction recall,
abstention quality, source independence, required-section completion, expert
usefulness, latency, and total cost.

## Go/no-go decision

Continue. The project has now demonstrated enough end-user value to justify the
next phase.

But define success narrowly:

> Mammoth must produce more decision-grade, auditable research than a strong
> baseline on three unrelated workflows, under a hard declared budget, with no
> false provenance metadata.

If it cannot meet that standard, stop expanding the platform and extract the
evidence ledger, report compiler, and receipt system as infrastructure products.
If it can, Mammoth will have something substantially rarer than another research
agent: empirical proof that its epistemic machinery improves decisions.

## Audit methodology and limits

This follow-up used the repository at merge commit `f54ad1a`, the successful
default-branch CI run `29375205622`, direct code inspection, the exact live bundle,
and a code-only architecture graph covering `packages/` and `apps/` (3,976 nodes,
8,756 edges). Documentation was inspected separately because no configured
semantic-extraction provider was available to Graphify.

Quantitative repository facts were measured locally:

- workspace projects: `pnpm -r list --depth -1 --json` (27 including root);
- TypeScript size: `find ... -print0 | xargs -0 wc -l` (70,632 lines across the
  application, packages, and evaluations at this checkpoint);
- P8 concentration: `wc -l packages/runtime/src/p8-turnkey.ts` (2,648 lines) and
  a function-declaration search (74 matches);
- bundle counts and costs: `report-manifest.json` and
  `execution-receipt.json` from the showcased run.

A separate Sonnet 5 critique of this analysis cost `$0.020124` and returned
`pass_with_notes`. Its useful corrections—method disclosure, reviewer
independence, economics, retrieval failure residue, privacy, copyright, and
verifier gaming risk—are incorporated above. This remains a software/product
audit, not legal advice, a penetration test, an expert review of the report's
subject matter, or a customer-demand study.
