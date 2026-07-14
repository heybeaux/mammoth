# ADR 0009 — P8 versioned contracts, canonical identities, and migration allocation

- Status: accepted (T0 baseline)
- Date: 2026-07-14
- Deciders: P8 coordinator; independent T0 reviewer
- Scope: contract majors, canonicalization, identity derivations, and forward-only
  migration numbering for the P8 turnkey research product

## Context

Merged P7 (`2e35802`) freezes `ModelWorkRequest`/`ModelWorkResult` 1.0.0, provider
attempt/effect identities, budget receipts, and the P6 v1 topology enums.
`P8_PLAN.md` requires the P8 contract baseline to be frozen before any consumer
lane starts: envelope majors, canonicalization rules, stable identity derivations,
and migration allocation. Without this freeze, lanes B-E would each invent
incompatible identities and the acceptance verifier could not bind expected
artifacts to stable IDs.

## Options considered

1. **Reuse P7 identities without new P8 domains.** This would preserve the
   smallest contract surface, but it would overload P7 model-work and effect
   digests with discovery, retrieval, cycle, and publication semantics that P7
   never proved. It would also make parser upgrades and report-manifest replay
   ambiguous.
2. **Let each lane define local identity labels.** This would let lanes move
   faster initially, but dependent lanes would need reconciliation after the
   fact, and the T0 verifier could not freeze expected artifacts before
   implementation.
3. **Adopt domain-separated `p8.v1` envelopes with forward-only migration
   allocation.** This keeps P7 digests immutable, gives every external effect and
   authority record an explicit semantic domain, and lets T0 freeze measurable
   acceptance artifacts before consumers.

## Evidence

- Merged P7 commit `2e35802` proves governed model-work identities, provider
  effect receipts, budget settlement, CAS/journal reconstruction, and dossier
  projection, but not P8 discovery, retrieval snapshots, evidence spans, cycles,
  or publication identities.
- `P8_PLAN.md` requires versioned `p8.v1` envelopes, migration allocation 9-12,
  and stable identity derivations before T1-T8 consumers start.
- `evals/fixtures/p8/verifier-manifest.json` binds expected T0 artifacts to
  these digest domains, making later `verify:p8` acceptance mechanically
  measurable from frozen fixtures rather than lane-local conventions.

## Decision

### 1. Contract major

All new P8 envelopes carry contract family `p8.v1`. Envelope schema versions start
at `1.0.0` and follow the P7 convention: breaking change ⇒ new major and a new
digest domain; additive optional fields ⇒ minor. A P7 `v1` digest is never
reinterpreted; semantic change introduces a new versioned envelope plus migration.

Frozen `p8.v1` envelopes (all Zod schemas in `@mammoth/domain` unless noted):

| Envelope                                                                   | Version | Notes                                                                               |
| -------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------- |
| `ResearchBrief`                                                            | 1.0.0   | plain-language input, mode, depth preset, budgets                                   |
| `QuestionCharter`                                                          | 1.0.0   | normalized question, subquestions, criterion ref, coverage, falsifiers, stop policy |
| `SearchPlan` / `SearchQuery` / `SearchCandidate`                           | 1.0.0   | `@mammoth/search-port`                                                              |
| `RetrievalRequest` / `RetrievalReceipt` / `SourceSnapshotManifest`         | 1.0.0   | `@mammoth/retrieval` contracts                                                      |
| `ParsedDocument` / `DocumentChunk` / `EvidenceSpan` / `EvidenceLocator`    | 1.0.0   | locator coordinate spaces versioned independently                                   |
| `ClaimProposal` / `EntailmentVerdict` / `SourceLineageAssessment`          | 1.0.0   | admission residue links to existing evidence-policy contracts                       |
| `CoverageGap` / `ResearchCycle` / `CycleDecision`                          | 1.0.0   | cycle snapshots and deterministic stop decisions                                    |
| `ReportBlock` / `ReportSentence` / `ReportManifest` / `PublicationReceipt` | 1.0.0   | closed sentence kinds per `P8_PLAN.md`                                              |

Workflow contract: `AcquisitionWorkflowV1` and `ResearchCycleV1` are new versioned
subworkflows (`workflowVersion: 1` within family `p8.v1`). The P6 v1 cell and
dependency enums are not extended; widening requires a new topology version and a
new ADR.

Existing `Program`, `DecisionCriterion`, `EvidenceArtifact`, `Claim`, `Assessment`,
budget, model-work, and effect schemas are reused unchanged where semantics match.

### 2. Canonicalization

All P8 identities reuse `canonicalJson`/`canonicalDigest` from
`packages/domain/src/digest.ts`: object keys sorted, `undefined` omitted,
non-finite numbers rejected, UTF-8 encoded, `sha256:<hex>` digests. No alternate
canonicalization is permitted in P8. Byte artifacts (snapshots, parsed artifacts,
rendered reports) are digested as raw bytes, not JSON.

### 3. Identity derivations (domain-separated)

Each identity digest is `canonicalDigest([label, version, value-without-digest-field])`
following `modelWorkIdentityDigest`. Frozen labels:

| Identity         | Label                      | Inputs                                                                                         |
| ---------------- | -------------------------- | ---------------------------------------------------------------------------------------------- |
| Brief            | `p8-research-brief`        | normalized brief fields (not raw CLI argv)                                                     |
| Charter          | `p8-question-charter`      | brief digest, normalized question, subquestions, criterion version, coverage spec, stop policy |
| Search effect    | `p8-search-effect`         | program ID, charter digest, query version + canonical query, provider policy ID, cycle ID      |
| Retrieval effect | `p8-retrieval-effect`      | canonical request (method, URL, headers subset), destination policy ID, snapshot version       |
| Snapshot         | `p8-source-snapshot`       | raw byte digest, final URL, retrieval receipt ID                                               |
| Parsed artifact  | `p8-parsed-artifact`       | raw digest, parser ID + version, parse options                                                 |
| Evidence span    | `p8-evidence-span`         | parsed digest, locator space + version, exact offsets, quote digest                            |
| Model work       | (P7) `model-work-identity` | unchanged P7 derivation                                                                        |
| Report manifest  | `p8-report-manifest`       | admitted-ledger revision, template/profile version, ordered block IDs                          |
| Publication      | `p8-publication`           | report-manifest digest, renderer ID + version, output profile                                  |

Idempotency keys for external effects are the corresponding effect identity
digests; retries reuse the identity and are reconciled exactly once
(settle/release/ambiguous), matching the P7 effect lifecycle (ADR 0005).

### 4. Migration allocation (forward-only)

- **Migration 9** — brief/charter/program identity tables.
- **Migration 10** — search/retrieval effects, snapshots, parsed artifacts, spans.
- **Migration 11** — lineage, claim proposal/admission residue, cycles/gaps, and
  program-wide budget reservation ledger.
- **Migration 12** — report manifests, rendered artifacts, publication receipts.

Each migration ships stable identities, uniqueness constraints on identity
digests, optimistic revisions/fences, and outbox links, and is tested against
empty, migration-8 upgrade, every intermediate upgrade, interruption, repetition,
and future-version states. The frozen P4 migration files are never edited.

### 5. Budget authority

Before every search, fetch, parser, or model effect, one authoritative Postgres
transaction reserves from the program-wide currency/token/time/request/byte budget
and inserts the stable effect row. Exactly one settlement, release, or
ambiguous-delivery reconciliation consumes the reservation. P6/P7/P8 work cannot
observe and spend the same remainder.

## Consequences

- Lanes B-E consume these labels and versions as-is; changing any of them requires
  a coordinator-serialized contract PR and dependent resync.
- The T0 verifier manifest binds expected artifacts to these identity labels, so
  acceptance is mechanically measurable before product code exists.
- New evidence semantics (e.g., OCR locators) require new versions, never
  reinterpretation of frozen ones.
