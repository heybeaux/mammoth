# ADR 0005: Activity effect lifecycle and replay

- Status: proposed
- Date: 2026-07-13
- Checkpoint: `v0.3.0-temporal-control-plane`
- Contract: new `activity-effect` adapter kind, major `2`

## Context

P3 T3 requires every retryable Activity side effect to look up and map a
completed result before execution. A Temporal Activity may be delivered again
under a new workflow run, Activity attempt, worker, lease owner, or Postgres
fencing token. The external effect remains the same when its stable semantic
inputs remain the same.

P2 established the correct authority boundary: Postgres owns product state,
receipt metadata, audit, and outbox state; CAS owns immutable bytes; Temporal owns
orchestration history; and an external provider owns its effect. ADR 0003 also
freezes adapter major `1` and requires a new major when observable receipt,
replay, or fencing semantics change.

The existing major-`1` effect surfaces cannot satisfy T3 without such a semantic
change:

- the local receipt store is keyed only by an idempotency string and stores an
  opaque result without semantic or workflow attribution;
- the Postgres work adapter can insert partial/completed receipts but cannot look
  up and return a completed result;
- a stored Postgres receipt is tied to the delivery fence that created it, so a
  later legitimate lease cannot reuse it;
- the existing conformance suite proves restart replay for one string key, not
  result validation, concurrent duplicate delivery, ambiguous provider commit,
  or fence rollover.

Silently broadening those major-`1` meanings would make the P1/P2 contract receipt
false after the fact. T3 instead needs a new inward-facing contract whose effect
identity is stable across deliveries while work-state mutation remains fenced.

## Options considered

### 1. Widen the major-`1` receipt writer and side-effect executor

Add completed lookup, semantic attribution, typed result mapping, ambiguity, and
fence-independent replay to the existing adapter kinds as optional methods or
minor-version metadata.

Rejected. These are observable replay and fencing semantics, not optional
metadata. A caller that depends on them would not be compatible with a conforming
P2 adapter. ADR 0003 explicitly requires a new major for this change.

### 2. Upgrade every existing effect, receipt, and work adapter to major `2`

Replace the P2 adapter kinds and migrate all local and Postgres callers at once.

Rejected. T3 does not need to invalidate P2 work-state, receipt-writing, or local
runtime compatibility. A repository-wide replacement would increase migration
and rollback risk while obscuring which capability a Temporal-backed profile
actually requires.

### 3. Add a separately versioned `activity-effect` adapter kind at major `2`

Keep every existing major-`1` descriptor and behavior unchanged. Add one explicit
contract for stable Activity effect identity, attempt attribution, lifecycle,
completed lookup, result mapping, and ambiguous reconciliation. Require it only
for Temporal-backed P3 profiles.

Accepted. This is the smallest honest evolution: old adapters retain their
published meaning, while a profile cannot claim T3 support without the stronger
contract.

### 4. Store effect state in Temporal history or an Activity-local database

Use Temporal Activity results, memo/search attributes, or a private worker store
as the completed-effect lookup.

Rejected. Temporal is not the product receipt store, large bytes do not belong in
workflow history, and an Activity-local store cannot survive arbitrary worker
placement or provide Postgres transaction/audit guarantees.

## Decision

### Contract identity and compatibility

Introduce a new adapter kind named `activity-effect` with contract version
`2.0.0`. Its initial required capabilities are:

- stable semantic effect identity;
- attributable Activity delivery attempts;
- started, ambiguous, and completed effect lifecycle;
- completed-effect lookup and strict result mapping;
- provider idempotency and reconciliation by key;
- delivery-fence-independent effect replay;
- fenced work-state completion;
- cooperative cancellation and durable restart.

The existing `receipt-writer`, `side-effect-executor`, and `work-state-store`
major-`1` adapters remain valid and unchanged. They do not satisfy an
`activity-effect` requirement and must not advertise its capabilities. A
Temporal-backed production-like profile requires `activity-effect` major `2` in
addition to the applicable major-`1` adapters. A local/P2 profile may continue to
run without it, but cannot claim T3 Activity conformance.

This decision does not change the Temporal workflow adapter contract. Workflow
lifecycle and Activity-effect replay are independently versioned capabilities.

### Effect identity and delivery attribution

The stable provider key is the domain canonical digest of this strict identity:

```text
schemaVersion = 1
programId
workItemId
contractVersion
inputDigest
operationKind
```

`inputDigest` covers the complete normalized semantic input, including pinned
criterion, policy, provider, parser, compiler, template, destination, schema, and
expected authoritative revision where applicable. A semantic retrieval or
experiment attempt parameter belongs inside `inputDigest`.

Workflow ID, workflow run ID, Activity ID, Temporal delivery attempt, task queue,
worker, lease owner, fencing token, timestamps, random IDs, and
`continueAsNew` boundaries are delivery attribution. They are stored, but do not
alter the provider key. A change to any stable identity field creates new work; a
change only to delivery attribution is a retry or redelivery of the same effect.

Every effect record stores provider, key, all stable identity fields, lifecycle
state, provider receipt, result schema, canonical result digest, typed result,
timestamps, and its originating delivery attribution. Every delivery attempt is
also retained separately with workflow/run/Activity IDs, Temporal attempt, task
queue, worker, lease/fence, heartbeat progress, outcome, and typed failure code.

### Lifecycle and completed-result mapping

The durable lifecycle is monotonic:

```text
absent -> started -> ambiguous -> completed
                  \------------> completed
absent -------------------------> completed  (one owned local transaction only)
```

- `started` means attributable intent is durable; it does not prove the provider
  committed.
- `ambiguous` means the call may have committed but no validated completion is
  locally durable. The next attempt must reconcile by the same provider key.
- `completed` contains the validated provider receipt and typed result. It is
  terminal and cannot be overwritten, deleted, or replaced by a different result.
- the direct `absent -> completed` transition is permitted only when one owned
  Postgres transaction creates the local effect and its completed mapping, or
  when CAS create-or-verify supplies the equivalent digest constraint. A remote
  provider call must durably record intent first.

Failures, retry exhaustion, poison input, and cancellation belong to attributable
attempt/work records and honest partial receipts. They do not fabricate a
completed effect. A completed lookup uses `(provider, idempotencyKey)`, then
validates program, work item, operation, contract, input digest, result schema,
and result digest before returning the registered typed result. Any mismatch is a
non-retryable identity conflict and makes no provider call.

The lookup order is fixed: validate invocation and recompute digests; resolve the
attributable work item; append the delivery attempt; look up completion; reconcile
started/ambiguous state; call the provider only if still required; validate and
persist completion; then advance work state with the current fence.

### Effect identity is not a delivery fence

A fencing token prevents a stale worker from mutating current work state. It does
not define whether an external effect already occurred. The effect record retains
the original attempt and fence for attribution, but completion lookup is keyed by
stable effect identity.

After lease rollover, a current delivery may reuse a validated completion created
under an older fence. Only the current lease/fence may mark the work item complete
or commit a new fenced product transition. A stale delivery may report a
provider result for reconciliation, but cannot advance work state. Concurrent or
late reports converge only when their provider receipt, result schema, result
digest, and stable identity agree; disagreement fails closed and remains
inspectable.

### Provider boundary and ambiguous effects

No Postgres record claims exactly-once remote execution. Providers that can create
an external effect must accept the stable key or support query/reconciliation by
that key. A provider that supports neither is not automatically retryable. It
must use an owned durable dispatcher or terminate with an ambiguous partial
receipt and human reconciliation.

Read-only retrieval may be repeated after an ambiguous response because the
remote read is not a provider mutation. Each request attempt remains attributable,
but only one validated CAS/result mapping is admitted for the stable effect. A
retry that observes different bytes must preserve the competing observation and
fail closed for reconciliation rather than silently replace a completion.

### CAS-reference payload rule

Raw source bytes, parsed text, report bodies, traces, manifests, logs, and other
unbounded artifacts do not cross the workflow/Activity boundary or live in
Temporal history. A producer Activity writes immutable bytes through the CAS
port, verifies the digest, and returns only a strict reference containing digest,
size, media/schema metadata, and storage URI.

An `artifact-commit` Activity later verifies the referenced bytes and publishes
their authoritative metadata in Postgres. CAS create-or-verify and the Postgres
metadata commit have distinct operation kinds and receipts. A failed metadata
commit may leave an inspectable orphan; retry verifies/reuses it and never deletes
referenced bytes. This preserves ADR 0003's CAS-before-metadata ordering.

### Forward-only Postgres migration

Implement the major-`2` contract with new schema objects rather than silently
changing the meaning of `mammoth_effect_receipts`. The forward migration must
provide, at minimum:

- an Activity work-attribution record keyed to the existing work item, containing
  program, Activity type, contract version, and semantic input digest;
- an append-only Activity attempt record containing workflow/run/Activity IDs,
  Temporal attempt, task queue, worker, lease/fence, heartbeat checkpoint,
  outcome, and typed failure;
- one Activity effect record unique by `(provider, idempotency_key)`, containing
  all stable identity fields, monotonic lifecycle state, provider receipt, result
  schema, canonical result digest, typed result, and lifecycle timestamps;
- constraints that prevent identity/result changes after completion and allow
  multiple operation kinds for one work item/fence;
- indexes for completed lookup, ambiguous reconciliation, work attribution,
  workflow/run inspection, and poison/retry diagnostics;
- transaction boundaries that atomically commit local effect completion with its
  owned product/audit/outbox transition where Postgres owns all participants.

Existing major-`1` tables and rows remain readable and unchanged. They are not
automatically promoted to major-`2` completions. A migration may import a legacy
receipt only when every stable identity and typed result field can be
deterministically reconstructed and validated; otherwise legacy work continues on
the legacy path. New Temporal Activity work must use only the major-`2` path and
must never fall back to a weaker major-`1` lookup.

Migrations are forward-only and checksummed. No down migration deletes Activity
attempts, effects, ambiguous states, or receipts.

### Upgrade, rollback, and verification

Deployment order is: apply and verify the migration; deploy the major-`2` adapter
and conformance surface; require it in Temporal profile readiness; then enable
Temporal Activity dispatch. A mixed deployment fails readiness closed when the
profile requires `activity-effect` major `2` but the descriptor, schema, or
capability is absent.

Upgrade tests must cover empty install, P2-to-P3 upgrade with legacy work and
receipts intact, interrupted migration, checksum drift, adapter restart, Postgres
restart, backup/restore, and a concurrent worker running the legacy P2 path. The
upgrade must not reinterpret or duplicate a legacy provider effect.

Application rollback disables new Activity dispatch and may restore a P2 binary
that ignores the additive schema. It does not reverse the database migration or
delete major-`2` rows. Once P3 work exists, a P2 binary may continue P2 operations
but cannot resume or reconcile P3 Activities. Re-enabling P3 must map the retained
major-`2` results without another provider call.

Conformance must prove canonical-key stability, completed lookup before provider
execution, strict result validation, concurrent duplicate convergence, provider
commit/receipt crash recovery, fence rollover, stale-worker rejection, heartbeat
timeout, cancellation races, poison input, retry exhaustion, process/service
restart, and exact Postgres/CAS/outbox equality. Existing P1/P2 adapter, migration,
ledger, work/outbox, CAS, production-profile, and backup/restore gates remain
mandatory regression evidence.

## Consequences

- Major-`1` adapter claims remain true and existing P2 profiles remain compatible.
- Temporal-backed profiles gain one explicit readiness requirement instead of
  inferring T3 safety from weaker receipt writers.
- Effect identity and delivery fencing are independently enforceable: an old
  completion can be reused while a stale worker remains unable to mutate work.
- Completed results become typed, digest-verified, attributable, and replayable;
  ambiguous provider outcomes remain visible rather than becoming fake success.
- Postgres gains additive Activity-effect and attempt state plus migration and
  operational complexity.
- Legacy receipts are not silently upgraded, so mixed P2/P3 operation needs an
  explicit routing boundary.
- CAS writes may leave verified orphans after metadata failure; reconciliation
  remains required and destructive cleanup remains prohibited for referenced
  bytes.
- Temporal history stays bounded to stable identifiers, typed state, and CAS
  references rather than product artifacts.

## Unblocked implementation order

Once this ADR is integrated, the next slices are:

1. add the pure Activity invocation, identity, failure, heartbeat, and result
   schemas plus canonical key fixtures for all eleven catalog Activities;
2. add the `activity-effect` major-`2` adapter kind, descriptor requirements, and
   shared in-memory conformance suite without modifying major-`1` behavior;
3. add the forward-only Postgres migration and implement completed lookup,
   lifecycle transitions, result mapping, attempt attribution, and fenced work
   completion;
4. split retrieval, snapshot metadata, parsing, and artifact metadata around CAS
   references, preserving hostile-input and integrity gates;
5. implement idempotent proposal admission, assessment, and ledger mutations with
   stable result mapping and atomic audit/outbox writes;
6. wrap report compilation at a frozen revision and persist report/trace/manifest
   CAS objects before authoritative artifact metadata;
7. add completed dispatch lookup for outbox publication, revalidation receipt
   roll-up, idempotent gate opening, and separate notification effects;
8. register the frozen retry/timeout/heartbeat policies in the Temporal worker and
   run the duplicate/crash/restart matrix against the production-like profile.

Slices 4–7 depend on slices 1–3. They may then proceed in path-disjoint lanes.
Workflow and Activity contract changes remain serialized by the coordinator.

## Evidence

- `docs/reviews/p3-activity-contract-reconciliation.md` freezes the eleven
  Activity responsibilities, stable keys, attributable envelope, result mapping,
  retry policy, receipt/crash seams, and exact P2 conflicts.
- ADR 0003, currently stored as
  `docs/adr/0003-transaction-and-orchestration-ownership.md`, establishes
  Postgres/CAS/Temporal/provider authority and the major-version compatibility
  rule. The assignment's `0003-postgres-cas-authority.md` name is not present on
  the audited default branch.
- `packages/work-queue/test/receipts.test.ts` and
  `packages/adapter-contracts/test/local-conformance.test.ts` prove legacy
  completed replay but not major-`2` semantics.
- `packages/postgres-adapter/test/work-outbox.test.ts` proves P2 fencing,
  transactional completion/outbox insertion, partial receipts, dispatch
  uniqueness, and poison visibility; it also exposes the missing lookup and
  fence-rollover behavior.
- `packages/postgres-adapter/test/ledger.test.ts`,
  `packages/retrieval/test/retrieval.test.ts`,
  `packages/report-compiler/test/compiler.test.ts`, and governance tests are the
  mandatory domain-specific regression base for T3 Activities.
- `P3_PLAN.md` requires the accepted ADR before code depends on a changed contract
  and requires duplicate Activity delivery, completed lookup, retry/timeout
  classification, receipt linkage, and production-like recovery evidence.

This ADR is architectural evidence only. It does not implement or verify T3.
