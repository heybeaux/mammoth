# Mammoth P7 Live Research Loop Checkpoint

> Status: frozen entry contract — implementation starts only after this plan is
> merged to `main`
>
> Baseline: `v0.6.0-research-topology`
>
> Target: `v0.7.0-live-research-loop`
>
> Prior receipt:
> [`evals/reports/v0.6.0-research-topology.md`](evals/reports/v0.6.0-research-topology.md)

## Naming boundary

This is checkpoint **P7 Live Research Loop** in `POST_MVP_ROADMAP.md`. It connects
the proved P6 topology to governed provider-backed model work and an operator
entry point. It is not architecture Phase 7 governance hardening, a managed
deployment, a hosted API, a desktop Observatory, or a live-provider quality
benchmark.

`ARCHITECTURE.md` remains normative. If this plan and the architecture appear to
conflict, preserve the architecture invariant, record the conflict, and stop
before weakening a gate.

## Outcome

P7 is complete when an operator can submit one validated charter through an
application service and CLI adapter, freeze a deterministic P6 topology, execute
its model work through a provider-neutral governed Activity, and inspect an
evidence-bound partial or complete dossier plus a read-only projection.

The first reference provider is a local OpenAI-compatible HTTP adapter exercised
against Ollama. A deterministic in-process provider remains mandatory for offline
CI. Provider calls emit proposals only. Deterministic code validates typed model
output, writes immutable artifacts to CAS, applies evidence-policy admission, and
commits authoritative state to Postgres. Temporal owns orchestration history,
retries, signals, cancellation delivery, queries, and replay evidence only.

The loop must survive duplicate delivery and restart without duplicating provider
work or charges, fail closed on model/profile/policy drift, preserve rejected
output and dissent without promoting it, stay within token/currency/wall-time/tool
budgets, and render no factual dossier sentence without a claim ID and named
evidence-policy verdict.

P7 does not claim that one provider response is high quality, that a local Ollama
exhibition predicts cloud-provider behavior, that all P6 cell roles have bespoke
prompts, or that hosted infrastructure, managed Temporal/Postgres, cloud secrets,
and the spatial Observatory are production ready.

## Entry gate

- [x] P6 code is merged, verified, tagged, and recorded in
      `evals/reports/v0.6.0-research-topology.md`.
- [x] `README.md`, `AGENTS.md`, `LOOP.md`, and `POST_MVP_ROADMAP.md` describe the
      proved P6 baseline and identify P7 as plan-first.
- [x] `docs/handoffs/2026-07-13-p7-live-research-loop.md` records the product gap,
      authority boundaries, adversarial cases, verification ladder, and traps.
- [ ] This P7 contract is independently reviewed and merged to `main` in a
      distinct entry PR containing no provider implementation.
- [ ] The integration branch and every implementation worktree are created or
      resynced from the merged P7-plan baseline before implementation claims.

No implementation slice may claim P7 progress until every unchecked entry item is
complete.

## Frozen entry decisions

### Application and operator boundary

- The application service is the operator port. The CLI is its first adapter and
  is never authoritative.
- The P7 CLI surface is `mammoth research run <charter>`, `research status`,
  `research inspect`, `research resume`, and `research cancel`.
- The service accepts a validated charter, immutable criterion reference, frozen
  P6 topology plan, model-work policy, model-profile version, and budget envelope.
- Stable P6 topology/workflow/cell identities are reused. P7 adds model-work and
  provider-attempt identities without replacing P6 IDs.
- Operator status and inspection reconstruct from Postgres/CAS. Temporal queries
  may expose orchestration diagnostics but never become product-state authority.

### Contract versions and provider boundary

- Model-work request schema: `1.0.0`.
- Model-work result schema: `1.0.0`.
- Provider error schema: `1.0.0`.
- Model-work policy: `1.0.0`.
- Provider capability manifest: `1.0.0`.
- P7 application contract major: `1`.
- P7 workflow version: `1`.
- P7 projection extension: `1.0.0`.
- The provider-neutral port contains no SDK types. It accepts canonical request
  bytes plus typed limits and returns a typed provider envelope, usage, finish
  reason, concrete model identity, provider operation identity when available,
  and raw response bytes.
- Provider startup fails closed unless the configured profile resolves to one
  active immutable profile version, the concrete provider/model/checkpoint matches
  that version, and required capabilities are present.
- Aliases are configuration inputs only. Dispatch, receipts, artifacts, charges,
  lineage, and projections record the concrete model name/checkpoint returned by
  capability discovery and the immutable model-profile-version digest.
- The reference adapter uses the OpenAI-compatible chat-completions HTTP shape and
  is configured for a loopback Ollama endpoint by default. Non-loopback endpoints
  are cloud egress and require explicit policy approval.
- Offline CI uses a deterministic provider implementing the exact same port and
  public application boundary. Provider-dependent calls never enter offline CI.

### Egress, secrets, and retention

- Cloud egress defaults to deny. Every non-loopback request requires a versioned
  egress decision binding data classification, provider, concrete model,
  destination origin, allowed tools, prompt digest, model-work identity, and
  budget reservation.
- P7 mounts no model tools. A request or response that attempts tool, secret,
  network, policy, or authority escalation is rejected and preserved as residue.
- Secrets are referenced by environment-variable name at process composition and
  injected only into transport headers. Secret values are excluded from canonical
  requests, prompts, logs, CAS metadata, receipts, projections, fixtures, and Git.
- Prompts are classified and secret-scanned before dispatch. A detected secret or
  disallowed classification fails before a provider call.
- The default retention policy stores canonical prompt and raw provider-response
  bytes as encrypted-at-rest-ready CAS artifacts in the local profile, referenced
  only by digest and classification metadata. Logs, receipts, Postgres rows, and
  projections contain digests and redacted summaries, never raw content.
- A `discard_raw_after_validation` policy may omit raw bytes only after recording
  their digest, byte length, validation verdict, and deletion receipt. Rejected or
  ambiguous output is retained under the active policy for audit and reconciliation.

### Stable identities, idempotency, and retries

- A model-work identity binds program ID, topology ID/digest, cell ID, criterion
  ID/version/digest, work-item contract digest, prompt-template digest, canonical
  input digest, model-profile-version ID/digest, policy version/digest, tool
  contract digest, and output-schema digest.
- A provider-attempt identity additionally binds attempt ordinal and concrete
  provider/model/checkpoint. A retry caused only by Activity redelivery retains
  the same model-work and provider effect identities.
- The provider idempotency key derives from model-work identity, operation kind,
  provider, concrete model, and request digest. Receipt lookup and reconciliation
  happen before every retry.
- Completed effects return the existing receipt. An in-flight duplicate never
  starts a second call. An ambiguous provider outcome remains ambiguous until the
  adapter reconciles by provider operation/idempotency identity or policy permits
  a new attributed attempt.
- Retryable errors are `timeout_before_acceptance`, `rate_limited`,
  `provider_unavailable`, and `transport_interrupted_before_acceptance`.
- Non-retryable errors are `policy_denied`, `secret_detected`,
  `unsupported_capability`, `profile_drift`, `malformed_output`,
  `schema_incompatible`, `oversized_output`, `content_rejected`, and
  `budget_exhausted`.
- `ambiguous_delivery` and `late_response` require reconciliation and are never
  silently mapped to either retryable failure or success.

### Budget and cancellation authority

- The authoritative budget lifecycle reuses the P5/P6 reservation, provider-charge,
  settlement, release, and cancellation identities. P7 extends the recorded units
  to input tokens, output tokens, currency micros, wall-clock milliseconds, and
  tool calls.
- Reservation precedes dispatch. Settlement uses provider-reported usage bounded
  by the reservation; absent or inconsistent usage is a policy failure, not zero
  cost. Currency conversion policy and effective price version are recorded.
- Duplicate provider receipts settle once. A late response after cancellation may
  record cost and residue but cannot commit a model proposal after the cancellation
  fence.
- Mid-topology exhaustion stops new dispatch, cancels or drains in-flight work
  according to policy, settles observed charges, releases unused reservations, and
  produces an honest partial dossier.
- Cancellation is tested before call, during call, after response before CAS,
  after CAS before admission, during settlement, and during synthesis.

### Typed output and authority

- Provider output parses into typed observations, claim proposals, evidence
  references, assumptions, dissent, and proposed falsifiers. Free-text citations
  and provider assertions are never evidence-policy verdicts.
- Parsing, size limits, exact-key validation, canonicalization, secret scanning,
  prompt-injection classification, locator resolution, claim atomicity, and
  evidence-policy assessment are deterministic services.
- Only the evidence/admission application service may commit claims, assessments,
  and report-manifest facts. Provider adapters, Activities, workflows, the CLI,
  and projections cannot write authoritative epistemic state directly.
- Unsupported claims, agreement-only support, criterion drift, correlated
  consensus, malformed output, and self-review remain inspectable rejected residue.
- Every rendered factual sentence resolves through the report manifest to an
  admitted claim, immutable evidence locator/snapshot digest, and named assessment
  policy. A partial dossier must label missing, failed, cancelled, and unresolved
  cells.

### Persistence and migration

- P7 authoritative additions begin at forward-only migration `8`, after P6
  migration `7`.
- Migration `8` records immutable model-work identities, provider attempts,
  capability/egress decisions, CAS artifact references, usage and cost settlement,
  validation/admission verdicts, cancellation fences, and reconstruction links.
- Existing P5/P6 budget, provider-charge, topology, research-cell, Activity-effect,
  and outbox records remain the authority where their contracts already fit. New
  rows reference rather than duplicate them.
- Empty, migration-7 upgrade, duplicate replay, interrupted migration, and
  Postgres/CAS reconstruction cases are release evidence.

Changes to authority, privacy, deployment, provider-data handling, or these frozen
boundaries require an ADR before implementation integration.

## Path ownership and delivery lanes

The coordinator owns cross-package contracts, integration, PRs, CI repair,
receipt, tag, and the final checkpoint claim. Workers must stop with a conflict
note before editing outside their owned paths.

### Lane A — provider-neutral contracts and conformance

Owned paths:

- `packages/domain/src/model-work.ts`
- `packages/domain/test/model-work.test.ts`
- `packages/workflow/src/p7-contract.ts`
- `packages/workflow/test/p7-contract.test.ts`
- provider-port package and conformance tests created for P7
- `evals/fixtures/p7/contracts/**`

Allowed changes: schemas, stable identities, profile/capability resolution,
provider error classification, canonical request/result envelopes, deterministic
provider, and conformance fixtures.

Non-owned paths: concrete HTTP transport, Postgres migrations, Temporal worker,
CLI, projection, CI, and receipt.

Verification: affected unit/typecheck/build gates and the P7 contract-manifest
gate.

Handoff recipient: coordinator/integrator.

### Lane B — governed provider effect and authoritative state

Owned paths:

- concrete OpenAI-compatible adapter package created for P7
- `packages/work-queue/src/**` and focused tests
- `packages/persistence/src/**` and focused tests
- `packages/postgres-adapter/src/**`, migration `8`, and focused tests
- `packages/production-cas/src/**` and focused tests
- `packages/governance/src/**` and focused tests
- `evals/fixtures/p7/provider/**`

Allowed changes: transport, egress decision, secret-safe request composition,
effect lookup/reconciliation, raw CAS artifacts, validation residue, provider
attempts, usage/cost, reservation/settlement/release, cancellation fences,
migration, and reconstruction.

Non-owned paths: topology planner semantics, report admission authority,
Observatory projection, CLI, CI, and receipt.

Verification: provider conformance, hostile transport fixtures, native Postgres
migration/restart, CAS integrity, and budget/idempotency/cancellation gates.

Handoff recipient: coordinator/integrator.

### Lane C — live topology application and operator entry

Owned paths:

- application-service package created for P7
- `packages/temporal-adapter/src/p7-*`
- `packages/temporal-adapter/test/p7-*`
- `packages/report-compiler/src/**` and focused tests
- `apps/cli/src/**` and focused tests
- `evals/fixtures/p7/loop/**`

Allowed changes: start/resume/cancel/status/inspect application port, P6 topology
composition, governed model Activity, deterministic admission call, partial/complete
dossier compilation, Temporal recovery/replay, and CLI adapter.

Non-owned paths: provider-specific transport internals, migration schema outside
explicit integration, projection, CI, and receipt.

Verification: application black-box tests, CLI tests, Temporal live recovery, and
report provenance gates.

Handoff recipient: coordinator/integrator.

### Lane D — projection, acceptance, and independent attack

Owned paths:

- `packages/observatory-projection/src/**` and focused tests
- `evals/p7-acceptance/**`
- `evals/fixtures/p7/adversarial/**`
- `scripts/verify-p7.ts`
- root scripts and `.github/workflows/ci.yml`
- P7 release receipt and checkpoint-status documentation

Allowed changes: fail-closed read-only projection, adversarial fixtures,
non-recursive verifier orchestration, clean-checkout evidence, independent review
record, final receipt, and release metadata.

Non-owned paths: production authority, provider transport, model-work contracts,
and workflow implementation except reviewed blocking fixes handed back to owners.

Verification: projection tests, verifier self-tests, full clean-checkout ladder,
live-provider exhibition protocol, and receipt integrity.

Handoff recipient: coordinator/integrator.

### Independent reviewer

The reviewer owns no implementation path and must attack:

- provider or CLI authority drift;
- alias/checkpoint and prompt/contract drift;
- secrets or raw content in logs, rows, receipts, fixtures, or projections;
- duplicate calls, charges, admission, artifacts, or settlement;
- model output bypassing deterministic validation;
- unsupported claims or agreement becoming facts;
- cancellation fences and late responses;
- Temporal shadow state and restart reconstruction;
- verifier fixtures that reimplement production logic; and
- weakened P2-P6 gates or missing visible CI enforcement.

Every blocking fix requires re-review before merge.

## Delivery slices

### T1 — Contract manifest and ADRs

- Publish provider-neutral request/result/error, capability, model-work identity,
  typed output, and application-port contracts.
- Freeze exact dependency direction and public schemas in a checked fixture.
- Add ADRs for raw-output retention and the local OpenAI-compatible reference
  provider/application boundary before dependent implementation merges.

Exit evidence: exact-key and digest-drift fixtures pass; domain has no HTTP,
database, Temporal, SDK, or secret dependency.

### T2 — Governed provider adapter

- Implement deterministic and OpenAI-compatible providers behind one port.
- Prove capability discovery, concrete model pinning, loopback/cloud classification,
  secret-safe headers, typed errors, output bounds, and reconciliation behavior.

Exit evidence: adapter conformance and hostile HTTP fixtures pass without external
network access; one separately authorized Ollama exhibition records the concrete
local model and limitations.

### T3 — Authoritative effects, artifacts, and budgets

- Add migration `8`, provider-attempt repository, CAS artifact references,
  Activity-effect integration, egress decisions, validation residue, usage/cost,
  reservation/settlement/release, and cancellation fencing.
- Prove duplicate delivery and restart cannot duplicate calls or charges.

Exit evidence: empty/upgrade/interrupted migration, native Postgres restart, CAS
digest corruption, duplicate/ambiguous delivery, budget, and cancellation gates
pass.

### T4 — Application service, Temporal topology, and CLI

- Compose P6 planning with provider-backed cell work and deterministic admission.
- Expose start/resume/cancel/status/inspect through an application port and CLI
  adapter, with stable identities and reconstruction from Postgres/CAS.
- Preserve honest partial state across failure, exhaustion, and cancellation.

Exit evidence: offline black-box CLI loop, process/worker/client/local-Temporal
restart, history replay, bounded carry, and reconstruction gates pass.

### T5 — Dossier and read-only projection

- Compile admitted results into a provenance-complete dossier and preserve failed,
  rejected, cancelled, dissenting, and unresolved residue.
- Extend the projection with model work, provider attempts, artifacts, usage/cost,
  validation/admission, and topology linkage without raw content or write paths.

Exit evidence: unsupported provider claims cannot render as facts; future
authority, broken references, missing CAS objects, secret leakage, and digest
corruption fail closed.

### T6 — Acceptance, receipt, and release

- Add `pnpm verify:p7` as a non-recursive wrapper over code-owned P7 gates and a
  visible default-branch CI step.
- Run the full clean-checkout ladder, independent attack/re-review, and local
  provider exhibition.
- Merge code, create annotated tag `v0.7.0-live-research-loop`, then merge the
  final receipt and verify default-branch CI.

Exit evidence: every stopping predicate is mapped to executable proof and exact
receipt evidence.

## Required adversarial fixtures

Fixtures call production-shaped public boundaries. A manifest or verifier that
reimplements production logic is not evidence.

- provider alias resolves to a different concrete model before dispatch and after
  capability discovery;
- unknown provider, unsupported capability, inactive profile, mutable profile
  revision, checkpoint drift, prompt drift, tool-contract drift, criterion drift,
  and output-schema drift;
- malformed JSON, duplicate keys, truncated UTF-8, oversized output, unknown
  fields, schema incompatibility, non-atomic claims, invalid locators, and raw
  free-text citations;
- prompt injection attempts tool, secret, network, policy, classification,
  criterion, evidence-verdict, or authority escalation;
- cloud egress denied for missing policy, wrong provider/model/origin, disallowed
  classification, absent reservation, or changed prompt digest;
- secret present in prompt, headers diagnostics, provider error, raw artifact,
  Postgres row, log, receipt, dossier, fixture, or projection;
- timeout before acceptance, timeout after ambiguous acceptance, rate limit,
  outage, connection reset, malformed error, late response, and unreconciled
  provider operation;
- duplicate dispatch before call, during call, after provider response, after CAS,
  after validation, after admission, after charge, and after completed receipt;
- input/output token, currency, wall-time, and tool-call exhaustion before dispatch
  and mid-topology; missing and inconsistent usage;
- cancellation before call, during call, after response before CAS, after CAS
  before admission, during settlement, during synthesis, and late response after
  cancellation;
- unsupported agreement, correlated consensus, self-review, and popularity remain
  non-authoritative and visible;
- provider output attempts to introduce an unreferenced factual dossier sentence;
- one cell fails or is cancelled and the offline loop returns an honest partial
  dossier with preserved residue;
- client, workflow worker, Activity worker, application process, and local Temporal
  service restart at durable boundaries;
- raw-output/CAS digest corruption, provider-receipt tampering, future authority,
  broken projection reference, stale fencing token, and reconstruction from
  Postgres/CAS;
- migration `8` empty install, migration-7 upgrade, duplicate application,
  interrupted migration, and unsupported future schema.

## Verification

During implementation, run affected package tests, typecheck, build, and focused
P7 gates. Before integration, prove a clean frozen install and run:

```sh
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm verify:evidence
pnpm verify:audit
pnpm verify:phase-1
pnpm verify:phase-2
pnpm verify:adapters
pnpm verify:m2
pnpm verify:m3
pnpm verify:mvp
pnpm verify:p2
pnpm verify:p3
pnpm verify:p4
pnpm verify:p5
pnpm verify:p6
pnpm verify:p7
pnpm eval:offline
```

`verify:p7` is a non-recursive TypeScript wrapper around code-owned gates. At
minimum it runs:

1. frozen P7 contract/adversarial manifest validation;
2. provider-port conformance and hostile transport fixtures;
3. model-work identity/profile/capability/egress/secret gates;
4. Activity idempotency, reconciliation, CAS, usage/cost, budget, and
   cancellation gates;
5. migration-8 and native Postgres restart/reconstruction gates;
6. offline application/CLI end-to-end partial and complete dossier gates;
7. live local-Temporal provider-work recovery and replay gates;
8. dossier provenance and unsupported-claim rejection gates; and
9. read-only projection integrity and leakage gates.

The root script must not call `verify:p7` recursively and must not fold or weaken
any P2-P6 command. CI includes a named `Verify P7 live research loop` step.

### Live-provider exhibition

The Ollama exhibition is separate from offline CI and records:

- date, Git revision, OS/runtime, endpoint origin classification, provider, exact
  model/checkpoint or immutable local model digest, and capability manifest;
- model-profile version/digest, charter/topology/criterion/work-item/prompt/policy/
  tool/output-schema digests, temperature/seed where supported, and timeout;
- provider operation ID when available, input/output/total tokens, wall time,
  currency cost (zero for local), CAS request/response/result digests, failures,
  retries, and reconciliation state;
- every admitted/rejected claim and assessment-policy verdict, final dossier/
  manifest/projection digests, and known limitations.

One successful exhibition proves integration only. It does not establish model
quality, reproducibility, or production readiness.

## Receipt schema

`evals/reports/v0.7.0-live-research-loop.md` records:

- plan PR/merge, ADRs, implementation PR/merge, receipt PR/merge, annotated tag,
  final default-branch revision, and exact CI run URLs;
- migration version/checksum and empty/upgrade/interrupted/restart evidence;
- exact commands, environment profile, gate counts, results, and omitted gates;
- schema/policy/workflow/application/projection versions and stable identity
  formulas;
- provider adapter, deterministic fixture, Ollama exhibition record, concrete
  model identity, usage/cost, CAS artifacts, and explicit limitations;
- restart, duplicate/ambiguous delivery, cancellation, budget, secret/egress,
  admission, dossier provenance, and reconstruction evidence;
- independent findings, blocking fixes, re-review result, and residual risks.

## Stopping condition

P7 is complete only when all of the following are true:

- this plan is merged first and implementation is based on that merge;
- the application/CLI can run, resume, cancel, status, and inspect one P6 topology
  through provider-backed governed model work;
- deterministic validation and evidence policy, never provider output or agreement,
  own claim admission and dossier facts;
- provider/model/profile/prompt/policy/tool/schema identities are pinned and drift
  fails closed;
- egress, secrets, raw artifacts, usage/cost, budgets, duplicate/ambiguous
  delivery, cancellation, and late responses satisfy the frozen contracts;
- authoritative state reconstructs from Postgres/CAS across process, worker,
  client, and local Temporal restart without duplicate provider effects or charges;
- complete and honest partial dossiers preserve provenance, dissent, rejection,
  failure, cancellation, and unresolved state;
- the projection is read-only, contains no raw prompt/response or secret, and
  fails closed on broken/future authority;
- `verify:p7` is non-recursive, adversarial, green from a clean checkout, and
  visibly enforced by default-branch CI while every earlier gate remains green;
- an independently reviewed local Ollama exhibition proves the reference adapter
  against one concrete model and records limitations without claiming quality;
- the code-bearing merge is tagged `v0.7.0-live-research-loop`;
- the final receipt is merged and its default-branch CI run is green; and
- `README.md`, `AGENTS.md`, `LOOP.md`, and `POST_MVP_ROADMAP.md` reflect the proved
  P7 reality and identify the next unproved checkpoint without expanding claims.

Until every predicate holds, status is **P7 in progress**, not complete.
