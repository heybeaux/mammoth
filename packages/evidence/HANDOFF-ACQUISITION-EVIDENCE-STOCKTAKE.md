# Handoff — Acquisition/Evidence Composition Stocktake (LOOP predicates 2–4)

## Task and status

- **Lane**: Mammoth Outcome 1 — acquisition/evidence composition stocktake.
- **Session**: `agent:scout:subagent:910bc0c9-953a-41c4-b368-9d72a2b9cf1f`.
- **Branch**: `feat/core-query-evidence-lane` (base `5637851ad9ecc7f3368d40e5200def07e36af4fc`).
- **Status**: complete within the owned write set. Stocktake finished; two
  additive, domain-generic seams implemented with focused tests. Full
  predicate 2–4 composition requires runtime/CLI orchestration outside this
  lane's write set (documented below for the coordinator).
- **Effect ceiling honored**: strictly no-effect. No network calls, no
  providers, no push/PR/merge/tag. The Engram completion memory POST in
  `MEMORY_INSTRUCTIONS.md` was skipped because it requires a network call the
  lane's ceiling prohibits; noted here and in the final report instead.

## Owned paths changed

- `packages/evidence/src/span-derivation.ts` (new)
- `packages/evidence/src/index.ts` (one added export line)
- `packages/evidence/test/span-derivation.test.ts` (new)
- `packages/retrieval/src/discovery.ts` (new)
- `packages/retrieval/src/index.ts` (one added export line)
- `packages/retrieval/test/discovery.test.ts` (new)
- `packages/evidence/HANDOFF-ACQUISITION-EVIDENCE-STOCKTAKE.md` (this file)

No other paths were touched. No install-created mode diffs were present at
staging time.

## Contracts

**None changed.** Both seams are additive exports that consume existing
`@mammoth/domain` contracts unchanged:

- `P9EntailmentLocatorSchema` / `canonicalDigest` (evidence seam)
- `SelectedRetrievalCandidate`, `P9RetrievalResidueLedger`,
  `canonicalizeAcquisitionUrl`, and the plan's search-query/source-class
  target shapes (retrieval seam)

No schema, enum, or cross-package type was modified.

## Reusable governed ports (stocktake inventory)

All of the following are domain-generic and reusable as-is for the arbitrary
question slice:

- **Retrieval transport and policy** — `retrieveSource` with
  `DEFAULT_RETRIEVAL_POLICY` (https-only, port 443, 5 MB, 5 redirects, 15 s),
  typed `AcquisitionFailure`.
- **SSRF hardening** — `canonicalizeAcquisitionUrl` (strips fragments and
  trailing dots, rejects embedded credentials), `authorizeAcquisitionHop`
  (DNS pinning, private-address blocklist, redirect origin lock,
  `DNS_ANSWER_CHANGED` detection), `assertPermittedUrl`.
- **Preservation** — sha256 content-addressed store (`FileContentStore`),
  `snapshotSource`, deterministic bounded parsing (`BoundedParserRegistry`,
  `sniffMediaType`, honest `MediaSupportDecision` for unsupported media).
- **Retrieval truth ledger** — `P9RetrievalResidueLedger` (every selected
  candidate must reach a typed terminal residue),
  `buildTruthfulRetrievalAttempt`, honest robots `not_checked` / rights
  `unknown` helpers.
- **Claim admission** — `evaluateP9ClaimAdmission` (independent-evaluator
  gate: binding digests, locator length equality, quote-in-context,
  self-review and same-profile-version rejection, hostile-instruction
  rejection, semantic deltas), `assertEveryP9FactualSentenceAdmitted`,
  `rejectedP9ClaimResidue`.
- **Plan/execution contracts** — accepted plan chain assertion
  (`assertP9AcceptedPlanChain`), `PlanCoverageAssessment` and stop/
  contradiction schemas already cover predicate 4's plan-relative residue
  needs; no new evidence/retrieval code was required for predicate 4.

## New seams added in this lane

### 1. `packages/retrieval/src/discovery.ts` — predicate 2 seam

`selectPlannedAcquisitionCandidates` turns externally supplied
`DiscoveredSourceHint`s (a hint, never evidence) into
`SelectedRetrievalCandidate`s **only** when traceable to the accepted plan's
search queries and source-class targets. Deterministic content-bound
candidate IDs (`discovered:<16 hex>`), canonical-URL dedup, https-only by
default, optional per-class capacity. Every rejection is preserved as typed
residue (`query_not_planned`, `source_class_not_planned`,
`url_not_permitted`, `duplicate_source`,
`source_class_capacity_exhausted`). `unservedPlannedSourceClasses` reports
plan-relative discovery gaps before acquisition. Source classes are assigned
by inspectable caller policy (pack data), never inside this module — no
hostnames, topics, or source families appear in the code.

### 2. `packages/evidence/src/span-derivation.ts` — predicate 3 seam

`deriveBoundedEvidenceSpans` produces exact, offset-bound spans from one
parsed snapshot body: deterministic sentence segmentation within an
evaluator-visible window, whitespace-trimmed offsets that reproduce exactly
via `body.slice(start, end)`, quote dedup, caller-supplied exclusion policy,
and hostile-instruction **flagging** (never silent dropping — downstream
admission rejects with visible residue). `boundedEvidenceContext` expands a
span to its sentence neighbourhood so the independent evaluator sees the
same bounded context the proposer saw. `buildEntailmentLocatorForSpan` binds
a span to an immutable snapshot as a schema-valid `P9EntailmentLocator` and
fails closed (`span_body_binding_mismatch`, `span_context_binding_mismatch`)
when the span does not reproduce from the claimed body.

The evidence test suite proves end-to-end composition: derived span →
locator → claim proposal → independent verdict →
`evaluateP9ClaimAdmission(...) === 'admitted'`, plus fail-closed behavior on
a tampered body.

## Missing seams and confirmed drift (outside this write set)

The coordinator owns these; they block the honest arbitrary-question slice:

1. **Pinned topic URLs in runtime** —
   `packages/runtime/src/p9-live-application.ts` contains
   `P9_LIVE_MANDATORY_SOURCE_CANDIDATES` with hard-coded topic URLs and a
   topic-conditional `inferSourceClass` keyed on hostnames. Both violate the
   product invariant against topic logic in generic branches. The discovery
   seam in this lane is the generic replacement: plan-derived queries feed a
   `P9LiveSearchAdapter` (the Brave adapter already implements this generic
   interface), hints get source classes from pack policy, and
   `selectPlannedAcquisitionCandidates` gates selection.
2. **Offset-less runtime span derivation** —
   `packages/runtime/src/p9-live-span-derivation.ts` derives quotes without
   offsets and carries source-family (GitHub-chrome) heuristics. It should
   migrate to `deriveBoundedEvidenceSpans` / `buildEntailmentLocatorForSpan`
   so locators carry real offsets that admission can verify. Until then the
   runtime and evidence packages duplicate sentence-context logic
   (`boundedP9SentenceContext` in `p9-generic-research.ts`).
3. **Exhibition-specific narrative gate** — `assertReadableNarrative` in
   `p9-generic-research.ts` uses exhibition-tuned prose regexes; it will
   misjudge arbitrary-question output.
4. **Closed domain-pack enum** — `ResearchDomainPackIdSchema` in
   `packages/domain/src/p9-planning.ts` is a closed 4-value enum, so
   arbitrary questions cannot mint a pack identity. Contract change —
   serialize through the coordinator.
5. **Lineage gaps (honest placeholders)** — robots `not_checked` and rights
   `unknown` are truthful but unresolved; live acquisition at scale should
   decide whether to check robots and record the decision as residue.

## Verification (commands and results)

Run from the repository root; all green at handoff time:

- `pnpm --filter @mammoth/retrieval test` — 46 passed (46).
- `pnpm --filter @mammoth/evidence test` — 34 passed (34).
- `pnpm --filter @mammoth/retrieval typecheck && pnpm --filter @mammoth/retrieval build` — clean.
- `pnpm --filter @mammoth/evidence typecheck && pnpm --filter @mammoth/evidence build` — clean.
- `npx eslint` over the four new files — clean.
- `npx prettier --check` over the four new files — clean.

## Risks

- Sentence-context logic now exists in both evidence (new, offset-bound) and
  runtime (legacy). Divergence risk until the runtime migrates; migration is
  a deletion, not a merge.
- `deriveBoundedEvidenceSpans` uses a simple sentence-boundary regex; bodies
  dominated by tables, code, or abbreviation-heavy prose will yield coarse
  spans. Bounds are caller-tunable; parser receipts already record extraction
  fidelity.
- `selectPlannedAcquisitionCandidates` trusts caller-assigned source classes.
  This is intentional (policy is pack data), but the coordinator must ensure
  class assignment itself is inspectable and plan-bound.

## Blockers

None within the lane. The Engram memory POST was intentionally skipped under
the no-effect ceiling (see status).

## Next unproved predicate

Coordinator composition: drive accepted plan → planned discovery
(`selectPlannedAcquisitionCandidates`) → governed acquisition/snapshot →
`deriveBoundedEvidenceSpans` → independent entailment → admission through the
normal `mammoth investigate` CLI path, replacing the pinned-URL runtime path
(drift items 1–2 above), then re-run four-domain holdout acceptance.
