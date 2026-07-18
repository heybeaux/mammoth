# P8 Turnkey Research Product Plan

## Status and authority

Status: **entry product contract. T1-T8 implementation is blocked until this plan
PR and the T0 acceptance-baseline PR are merged and implementation worktrees
resync from the later merge.**

Release target: `v0.8.0-turnkey-research`.

This plan preserves P7 v1 and defines a new P8 product layer. It does not revise
the frozen `P7_PLAN.md` or claim that merged P7 performed substantive research.
`ARCHITECTURE.md` remains normative; this document freezes the P8 outcome,
boundaries, contracts, delivery slices, verification, and stopping predicates.

## Baseline and reality boundary

Merged P7 baseline `2e35802` proves governed provider-backed cell execution,
typed model output, stable external-effect identities, budgets and cost receipts,
CAS/journal reconstruction, process-kill resume behavior, dossier structure,
projection, and operator controls.

It does not accept a question or theory, discover sources, pass source material to
semantic research cells, bind exact evidence spans, iterate from discovered gaps,
or render a comprehensive readable report. Its canonical prompt states that no
factual source material is included, its model budget permits zero tool calls, and
its request carries a charter digest rather than the human research brief. P8 is
the product composition connecting the existing retrieval, evidence, topology,
governance, workflow, provider, persistence, and report primitives.

## Frozen outcome

> A user supplies a question or theory in plain language. Mammoth converts it into
> a reviewable research charter, plans and executes iterative source discovery and
> evidence-bound analysis, stops under explicit sufficiency and budget criteria,
> and emits a comprehensive readable report whose factual sentences have exact
> immutable citations and whose uncertainties, dissent, and limitations remain
> visible.

Golden command:

```sh
mammoth research ask \
  "What impacts do data centers have on the communities and environment around them?" \
  --depth comprehensive \
  --budget-usd 20 \
  --output ./research/data-center-impacts
```

The user must not create request JSON, digests, topology IDs, prompt digests, or
environment cell lists. `status`, `inspect`, `resume`, `cancel`, and `export`
operate on the returned run ID or output directory.

## Product modes and scope

P8 ships two independently accepted modes:

- **report** — answer a question with balanced, current, evidence-bound synthesis;
- **explore** — investigate a theory through hypotheses, falsifiers, mechanism
  cards, prior art, counterexamples, and clearly labelled unresolved possibilities.

Comparison and decision-support briefs are normalized into one of those modes.
Original physical experiments, arbitrary code/shell/browser execution, and claims
of guaranteed truth, novelty, or exhaustive web coverage are out of scope.
Computational experiments remain gated and may not be marketed until a separate
deterministic sandbox/evaluator contract passes.

Presets are `quick`, `standard`, and `comprehensive`. They select explicit default
coverage, source diversity, cycle, time, token, currency, request, and byte
budgets. They do not weaken provenance or security.

The offline theory golden fixture asks whether locating flexible data-center loads
near constrained renewable generation can reduce curtailment without shifting
water, reliability, rate, or land burdens onto host communities. Its explore
bundle must contain competing hypotheses, confirming and disconfirming
observations, falsifiers, mechanism cards, a prior-art challenge, counterexamples,
unresolved alternatives, and no promotion through model agreement. T0 freezes the
exact fixture and expected relationships.

## Output bundle

Every completed or partial run produces on completion or explicit
export/reconstruction—even after early cancellation—a structurally valid bundle:

```text
report.md
report.html
executive-summary.md
sources.json
bibliography.md
report-manifest.json
coverage.json
unresolved.json
execution-receipt.json
```

The manifest contains a closed typed `ReportBlock`/`ReportSentence` AST. Every
externally verifiable declarative sentence is `kind: factual` and carries admitted
claim IDs, named policy verdicts, exact locators, immutable artifact digests, and
source lineage before rendering. Other closed kinds are `heading`, `question`,
`method`, `limitation`, `uncertainty`, `recommendation`, and `transition`, but they
are not arbitrary strings: every rendered sentence is a deterministic template
over typed fields. Method/cost fields bind execution receipts; uncertainty binds
unresolved or contradicted assessment IDs; limitations use typed reason codes;
recommendations separate and cite factual premise child nodes; headings,
questions, and transitions use a fixed vocabulary. Any externally verifiable
clause in any kind must instead be a factual child node with full provenance.
Unclassified prose is invalid. Markdown and HTML render only this AST, and the
verifier proves their normalized sentence sets exactly match the manifest. This
applies to summaries, tables, captions, methods, cost statements, bibliography
annotations, and partial output. Partial reports identify missing sections,
failed sources, budget/provider failures, unresolved contradictions, and stop
reason.

## Golden-path acceptance corpus

The release question is the data-center question in the golden command. A frozen
offline corpus must include primary government/regulatory and utility/grid
documents, peer-reviewed or technical research, local/community and Indigenous or
environmental-justice perspectives, industry claims, critical
analysis, a known contradiction, derivative/duplicated sources, a stale source,
an unsupported claim, a malicious prompt-injection document, and malformed or
hostile retrieval fixtures.

Mandatory topic accounting:

1. electricity demand, grid capacity, reliability, rates, and generation mix;
2. operational and embodied greenhouse-gas emissions;
3. water withdrawal/consumption, cooling, drought stress, and thermal effects;
4. land use, habitat, construction disturbance, materials, and e-waste;
5. local air pollution, backup generation, noise, traffic, and visual impacts;
6. employment, taxes, infrastructure investment, and economic benefits;
7. housing, public services, utility allocation, and opportunity costs;
8. environmental justice, Indigenous/local participation, siting, and governance;
9. variation by facility type, climate, grid, cooling design, scale, and lifecycle;
10. mitigation, trade-offs, policy options, disputed findings, and evidence gaps.

“Comprehensive” means every mandatory dimension is supported to its configured
sufficiency threshold or explicitly reported insufficient. It never means only a
word count or source count.

Required report structure: direct answer/executive summary; scope/definitions;
methods/source criteria; environmental effects; community/economic effects;
distributional and environmental-justice analysis; benefits/counterarguments;
context comparison; mitigations/policy options; conflicts/uncertainties/gaps;
conclusion; references and provenance appendix.

## Frozen architecture decisions

### Authority and orchestration

Postgres stores authoritative product state and CAS stores immutable bytes.
Temporal orchestrates using stable IDs, cursors, and revisions only and reconstructs
after restart. P7 model/effect receipts are referenced, not duplicated. All P8
mutations are proposals validated and committed by deterministic services.

### Tool mediation

Models remain tool-free (`toolCalls: 0`). They propose versioned typed search,
selection, extraction, assessment, gap, critique, and synthesis work. Governed
Activities execute search, retrieval, parsing, and publication with allowlisted
contracts, credentials, classifications, budgets, stable effect IDs, and receipts.
Source-reading workers receive bounded parsed data and no retrieval or execution
tools. Retrieved text is hostile data and never policy.

### Discovery and sources

P8 introduces a provider-neutral search port. An entry ADR/spike chooses the first
live adapter between a locally operated metasearch option and a key-backed hosted
provider based on result quality, licensing, cost, determinism, and operability.
The frozen offline adapter is mandatory for CI. Search results/snippets are never
evidence.

Acquisition stores requested/final URL, redirect chain, DNS/policy decisions,
retrieval time, media type, byte count, response metadata, raw digest, parser ID,
parsed digest, robots/licensing metadata, and stable receipt. P8 v1 supports HTML,
plain text, JSON, and text-layer PDF. OCR-heavy images, audio, video, paywall or
CAPTCHA bypass are out of scope.

### Evidence and citations

Documents are parsed and chunked outside authority. `EvidenceSpan` binds raw
snapshot digest, parsed-artifact digest, parser identity/version, locator
coordinate-space/version, exact quote/span digest, and—where available—a mapping
to raw bytes or PDF page coordinates. Parser upgrades create new parsed artifacts;
they never reinterpret an old locator. Claim proposals are atomic. Extraction and
entailment models propose independently recorded verdicts and cannot self-certify.
Deterministic policy validates the exact span/quote/digests, freshness, lineage,
and required independent verifier record before support/contradiction/unresolved
admission. URLs and model citation strings are insufficient.

### Semantic topology and iteration

P8 introduces versioned `AcquisitionWorkflowV1` and `ResearchCycleV1` subworkflows
outside the closed P6 v1 cell/dependency enums. They perform charter/query/search/
acquisition/extraction/assessment/gap work and feed typed admitted artifacts into
unchanged P6 landscape, divergence, prior-art, falsification, and synthesis cells.
A future widened topology requires a new version and ADR; P6 v1 is never silently
extended. The persisted P8 plan derives from charter, subquestions, coverage, and
dependencies—never environment cell IDs. Explore mode preserves P6 isolation,
commit-before-reveal, blind review, and correlation-aware review.

Every cycle snapshots coverage, contradictions, source diversity, information
gain, budgets, and stop/continue rationale. Follow-up queries must arise from
observed gaps or falsification needs. Deterministic stop policy considers mandatory
coverage, per-section sufficiency, critical unsupported conclusions, unresolved
contradictions, novelty saturation, maximum cycles, currency/tokens/time/requests/
bytes, cancellation, and provider availability.

### Synthesis and publication

The compiler stages are manifest builder -> typed AST -> deterministic renderers.
A model may propose outline, selection, ordering, and non-factual transitions.
Factual sentence text is produced from admitted fact nodes by deterministic
templates; any desired free-form factual sentence must re-enter claim proposal,
independent entailment, and admission before it can enter the AST. Editorial model
review is advisory for relevance, balance, clarity, duplication, and
counterarguments; it is never epistemic authority.

## Versioned contracts

The T0 contract baseline freezes workflow/application major `p8.v1`, topology and
cycle versions, canonicalization rules, and stable identity derivations before
consumers. Search identity includes program/charter/query version and provider
policy; retrieval identity includes canonical request, destination policy, and
snapshot version; model identity follows P7 work identity; report/publication
identity includes admitted-ledger revision, template/profile, and manifest digest.
Freeze these versioned P8 envelopes before consumers:

- `ResearchBrief`: input mode, question/theory, audience, geography, timeframe,
  depth, output, constraints, risk, and budgets;
- `QuestionCharter`: normalized question, definitions, subquestions, criterion,
  admissible/prohibited evidence, falsifiers, coverage, gates, and stop policy;
- `SearchPlan`, `SearchQuery`, and `SearchCandidate`;
- `RetrievalRequest`, `RetrievalReceipt`, and `SourceSnapshotManifest`;
- `ParsedDocument`, `DocumentChunk`, `EvidenceSpan`, and `EvidenceLocator`;
- `ClaimProposal`, `EntailmentVerdict`, `SourceLineageAssessment`, and admission
  residue linked to existing evidence-policy contracts;
- `CoverageGap`, `ResearchCycle`, and `CycleDecision`;
- `ReportBlock`, `ReportSentence`, `ReportManifest`, rendered artifact records,
  and `PublicationReceipt`.

Reuse existing Program, DecisionCriterion, EvidenceArtifact, Claim, Assessment,
budget, model-work, and effect schemas where semantics match. Never silently
change a P7 v1 digest; introduce a new version and migration.

Forward-only allocation is: migration 9 for brief/charter/program identities;
migration 10 for search/retrieval effects, snapshots, parsed artifacts, and spans;
migration 11 for lineage, claim proposal/admission residue, cycles/gaps, and
program-wide budgets; migration 12 for report manifests, artifacts, and publication
receipts. Each includes stable identities, constraints, optimistic revisions/
fences, and outbox links as applicable. Test empty, migration-8 upgrade, every
intermediate upgrade, interruption, repetition, and future-version states.

Before every search, fetch, parser, or model effect, one authoritative transaction
atomically reserves from the program-wide currency/token/time/request/byte budget
and creates the stable effect record. Exactly one settlement, release, or
ambiguous-delivery reconciliation consumes that reservation. Concurrent P6/P7/P8
work cannot observe and spend the same remainder.

## Security and adversarial contract

Fail closed on:

- malicious queries/URLs, private/link-local/credentialed origins, SSRF, redirect
  policy escape, DNS rebinding/TOCTOU, and destination-origin drift;
- oversized or compressed bodies, decompression/archive bombs, MIME confusion,
  parser crash, malicious PDF, and unsupported media;
- prompt injection requesting tools, secrets, authority, budget, or policy changes;
- secret or classified-data egress, missing provider policy, and non-allowlisted
  tool/effect requests;
- search result treated as evidence, URL without snapshot, fabricated digest,
  nonexistent/out-of-range locator, quote mismatch, or non-entailing citation;
- stale/mutated sources, syndicated copies presented as independent, hidden
  contradiction, unsupported consensus, or model direct-authority writes;
- duplicate search/fetch/model effects or charges, ambiguous delivery, runaway
  cycles, starvation, cancellation races, stale fences, and crash/restart before
  or after every durable boundary;
- renderer-added facts, broken citations, omitted dissent/limitations, CAS tamper,
  future schemas/authority, and replay/projection/report digest drift.

Robots and licensing metadata are recorded. Default policy follows explicit
machine-readable denial, never bypasses authentication/paywalls/CAPTCHAs, records
unknown/conflicting terms, and limits published quotations. Any allowlisted
operator override is explicit, attributable, receipted, and cannot weaken access
controls. Credentials exist only inside the executing Activity. Parsers and
source-reading models run in a separate process/container with no network, no
ambient filesystem or secrets, read-only declared input, CPU/memory/time/output
limits, cancellation/kill receipts, and version/digest identity.

## Delivery slices

### T0 — Entry contract and reconciliation

Merge this entry plan and baseline reconciliation. Then merge a distinct T0
acceptance-baseline PR containing both golden corpus manifests, coverage and
sufficiency thresholds, independent-source-family diversity thresholds, typed
expected artifacts, editorial rubric, adversarial expected outcomes, verifier
manifest, receipt schema, version/identity ADRs, and a bounded non-production
search-provider spike report. That ADR also freezes the selected first live
adapter, robots/licensing policy, credential/preflight model, and fallback. Recreate
implementation worktrees from the T0 merge.

Gate: both black-box acceptance paths are mechanically measurable before product
code; P7 is described honestly as substrate; no T1-T8 delegation occurs first.

### T1 — Contract freeze, intake, and charter

First merge a contract-only integration gate for all `p8.v1` schemas, canonical
identities, ports, and fixtures. Resync consumers, then implement `research ask`,
`ResearchBrief`, deterministic defaults, charter preview, subquestions, criterion,
coverage, falsifiers, budgets, and versioning. Clarify only ambiguity that
materially changes scope; otherwise record defaults.

Gate: the single data-center sentence deterministically creates and persists a
valid charter; material edits create linked versions; no handcrafted JSON.

### T2 — Governed discovery and acquisition

Implement search port, offline fixture adapter, selected live adapter, typed query
planning, selection/deduplication/lineage hints, effect/cost receipts, HTML/text/
JSON/PDF acquisition, immutable snapshots, parsing, locators, and hostile-input
controls.

Gate: a diverse frozen corpus is discovered/acquired with exact receipts and
locators; snippets cannot enter evidence; all retrieval attacks fail safely.

### T3 — Evidence admission bridge

Implement atomic claim/span extraction, snapshot/locator resolution, quote
integrity, entailment, quality, freshness, lineage/correlation, contradiction,
named-policy admission, and preserved rejection residue.

Gate: fabricated/irrelevant/correlated/stale evidence is rejected; contradictory
credible evidence remains visible; every admitted claim traverses authority.

### T4 — Semantic topology and iterative controller

Implement persisted `AcquisitionWorkflowV1`/`ResearchCycleV1` around unchanged P6
v1 semantic cells. Pass real question, evidence packets, prior admitted claims,
contradictions, coverage gaps, and dependency artifacts. Persist cycle snapshots
and deterministic decisions; generate bounded gap/falsification follow-up work;
preserve P6 isolation and blind review.

Gate: inspection shows meaningful role/subquestion/evidence ownership; a seeded
gap causes an initial cycle plus at least one evidence-driven follow-up; restart
duplicates no effects or claims. A sufficient first cycle does not force another.

### T5 — Evidence-bound report compiler

Build admitted-only typed report AST, outline/selection planning, deterministic
factual templates, executive summary, methods, balanced harms/benefits, context
table, uncertainty/dissent/gaps, limitations, bibliography, Markdown and HTML.
Free-form factual prose must re-enter evidence admission.

Gate: every mandatory topic is supported or explicitly insufficient; zero
unsupported factual sentences; both exports resolve to identical manifest facts.

### T6 — Turnkey operator and inspection

Complete ask/status/inspect/resume/cancel/export, presets, human-readable progress,
local and explicit cloud profiles, output-directory recovery, citation traversal,
read-only projection, and honest partial output. Freeze `mammoth init`, `mammoth
doctor`, and `mammoth up` as the turnkey boundary: from a clean supported machine
with a container runtime and either an installed local model runtime or one cloud
profile, `init` creates validated non-secret configuration, `up` starts/checks the
packaged Postgres/CAS/Temporal/search profile, and `doctor` validates migrations,
service health, provider capability/credentials, writable stores/output, and
budget policy with actionable fail-closed diagnostics.

Gate: a clean-profile test runs `init`, `up`, `doctor`, and the golden command with
only the enumerated prerequisite, without internal JSON/cell variables/manual
service wiring, and understands the output without CAS inspection.

### T7 — Recovery, security, and adversarial verification

Exercise every durable boundary, duplicate/ambiguous effects, budgets, cancellation,
provider/parser failures, future schemas, tampered CAS, hostile sources, report
integrity, deterministic replay, and forward-only migrations.

Gate: offline adversarial fixtures and process-kill/restart pass without duplicate
effects, charges, claims, or publication and without losing red results.

### T8 — Acceptance, exhibition, and release

Add non-recursive `pnpm verify:p8` to CI; run clean-checkout full ladder and a
non-author architecture/security review; merge and verify exact code-bearing
`main`; separately authorize and run the mandatory live data-center exhibition;
complete editorial/output review of that exact bundle; create annotated
`v0.8.0-turnkey-research` at the code-bearing SHA; then merge a receipt-only PR
recording the tag and code SHA and verify final receipt-bearing `main` CI. The tag
intentionally targets the code-bearing merge while final `main` may be the later
receipt commit.

Gate: every stopping predicate below is evidenced by the exact candidate.

## Deterministic evaluation and thresholds

The offline verifier is the release authority. It requires:

- 100% factual report sentences with valid claim/policy/locator/snapshot traces;
- zero fabricated sources/citations and zero critical unsupported claims;
- 100% mandatory-topic accounting: sufficiently covered or explicitly deficient;
- configured primary, technical/scientific, government/regulatory, industry, and
  community perspective diversity with source-family independence;
- every seeded contradiction and material dissent retained;
- no search snippet admitted as evidence;
- seeded stale, duplicated, irrelevant, injection, malformed, and unsupported
  fixtures rejected for the expected named reason;
- at least one follow-up cycle derived from a detected evidence gap;
- idempotent replay of one stable run, and canonical authority/report-manifest
  equivalence under injected frozen clocks for independent fixture runs, excluding
  execution-specific receipt identities;
- process-kill/restart with no duplicate effects, charges, admissions, or publish;
- budget/cancellation/provider failure producing honest deterministic partiality;
- structural editorial gates for required sections, balance accounting,
  counterargument presence, duplication limits, and readability bounds.

Exact sufficiency and independent-source-family diversity defaults are frozen in
the merged T0 fixture/rubric ADR before T1-T8 delegation; they cannot be relaxed
by an implementation lane. Subjective clarity/usefulness judgment belongs in the
independent editorial review receipt, not deterministic `verify:p8`.

## Live exhibition and receipt

The live exhibition uses the golden command and public sources but cannot replace
offline gates. It is mandatory for the P8 release claim and requires explicit
provider credential/billing authorization before T8; missing authorization blocks
release but not offline implementation. Its receipt records candidate SHA, date,
machine/profile, search and
model providers/models, full configuration and prompt digests, query/effect/source
snapshot identities, report/manifests/artifact digests, elapsed time, tokens,
requests, bytes, currency cost, cycle decisions, failures, limitations, and exact
verification commands/results. Screenshots are presentation evidence only.

The final release receipt also records plan/code/receipt PRs, independent reviewers
and findings, migrations, clean-checkout gates, merged-main CI run, golden bundle
digests, live-exhibition receipt, and annotated tag target.

## Explicit non-goals

- hosted multi-tenant SaaS, accounts, billing, collaboration, or managed hosting;
- polished desktop/3D Observatory before credible CLI output;
- unbounded autonomous browsing or arbitrary shell/browser tools;
- paywall, CAPTCHA, robots, licensing, or access-control circumvention;
- legal/medical/financial professional conclusions;
- multilingual or globally exhaustive coverage;
- OCR-heavy archives, image-only evidence, audio/video transcription;
- original physical experimentation or continuous monitoring after delivery;
- broad provider benchmarking or citation-style perfection;
- guaranteed truth, novelty, or completeness of the public web.

## Ownership and integration

Use lanes A-F from `AGENTS.md`. Coordinator owns this plan, root contracts,
integration, dependency reconciliation, root scripts/lockfile/CI unless assigned,
receipt, and tag. No implementation begins from legacy P3-P7 worktrees. All
assignments and liveness evidence live in the coordinator ledger.

## Stopping condition

P8 is complete only when the natural-language data-center command produces the
entire report bundle; every factual sentence passes provenance; all mandatory
dimensions are covered or explicitly insufficient; an evidence-driven follow-up
cycle is demonstrated; contradictions, dissent, uncertainty, method, limitations,
cost, and partiality remain visible; restart/idempotency/budgets/cancellation and
all adversarial gates pass; independent review is non-blocking; and the exact
merged-main candidate is proven by CI, release receipt, and annotated tag.

Until then, say precisely which predicate is unproved. Do not call Mammoth a
turnkey research product.
