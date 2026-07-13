# P3 Activity contract reconciliation

> Status: pre-implementation contract audit; T3 is not implemented
>
> Audited baseline: `origin/main` at
> `4d85f4d4009a025b905a9f2ebdda548aa85e08b0`
>
> Scope: P3 T3 Activity catalog, effect identity, attribution, failure policy,
> receipt mapping, and required P2 port/schema reconciliation

## Verdict and stop condition

The eleven T3 Activity responsibilities can be frozen, but the current P2
effect-receipt surface cannot implement their required replay semantics. In
particular, it has no production completed-effect lookup, stores no typed result
mapping or semantic attribution, and rejects reuse of a completed effect after a
lease is reclaimed with a new fence. T3 source implementation must therefore stop
until an ADR chooses the contract-evolution path and records its migration and
compatibility consequences.

The ADR must choose one of these designs:

1. introduce an Activity effect/attempt contract under adapter major `2`, migrate
   P2 work and receipt storage, and make the production profile require it; or
2. add a separately versioned Activity-effect port beside the frozen major-`1`
   receipt writer and side-effect executor, leaving their observable semantics
   unchanged.

The first option is recommended because a completed effect must be reusable across
delivery fences while work-state completion remains fenced. Treating that as an
additive helper on the existing contract would contradict ADR 0003's rule that a
change to observable fencing, replay, or receipt behavior requires a new major.
The ADR must also confirm that producer Activities put immutable bytes in CAS and
return references, while the `artifact-commit` Activity publishes authoritative
Postgres metadata. Raw source, parsed text, and report bytes must not be carried
through workflow history.

This review freezes the target behavior below for the ADR and implementation. It
does not change an adapter contract, migration, Activity registration, or test.

## Stable identity and invocation envelope

The provider key is the domain `canonicalDigest` of this strict value:

```typescript
interface EffectIdentityV1 {
  schemaVersion: 1;
  programId: string;
  workItemId: string;
  contractVersion: string;
  inputDigest: `sha256:${string}`;
  operationKind: ActivityOperationKindV1;
}
```

`inputDigest` is recomputed from canonical, runtime-validated semantic input. It
includes every pinned value capable of changing the effect: criterion and policy
versions, request body and governed target, provider identity and contract,
parser/compiler/template version, frozen ledger revision, destination, and
schema version as applicable. `operationKind` is the stable Activity/effect name
from the catalog below. This reconciles P3's “activity and attempt inputs” wording
with Architecture section 15.4: semantic retrieval or experiment attempt
parameters belong in `inputDigest`; the Temporal delivery attempt does not.

The following are attribution only and are excluded from the key: workflow ID,
run ID, Temporal Activity ID, Temporal delivery attempt, task token, task queue,
worker identity, lease owner, fencing token, timestamps, random IDs, mutable URL
aliases, and `continueAsNew` run boundaries. A retry or redelivery recomputes the
same key. A changed semantic input creates a new key and is new work, not a retry.

Every invocation must validate this envelope before an external call or mutation:

```typescript
interface ActivityInvocationV1<TInput> {
  schemaVersion: 1;
  activityType: ActivityTypeV1;
  contractVersion: string;
  programId: string;
  workItemId: string;
  input: TInput;
  inputDigest: `sha256:${string}`;
  workflow: {
    workflowId: string;
    runId: string;
    activityId: string;
    attempt: number;
    taskQueue: string;
  };
  lease?: {
    owner: string;
    fencingToken: number;
  };
}
```

The work item is resolved from Postgres and must agree on `programId`, work kind,
contract version, input digest, and current lifecycle state. Workflow/run and
Activity delivery metadata are appended to an attempt record. A lease/fence is
required for a work-state transition, but is not part of immutable effect
identity. Missing, synthesized, or mismatched attribution is poison input.

## Frozen Activity catalog

Names are versioned in their envelope rather than embedded in Temporal function
names. Each producer returns typed IDs and CAS references, not authoritative
object graphs or unbounded bytes.

| Activity type              | Stable operation kinds                                                                | Authoritative/effect boundary                                                                                                                                                                                                             | Completed result mapping                                                                                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `retrieval`                | `retrieval.fetch`, `artifact.cas-put.raw`                                             | Governed read-only provider request, then create-or-verify raw bytes in CAS. Retrieval cannot admit a claim. Duplicate read requests after an ambiguous crash are observable attempts; only one keyed CAS/result mapping may be admitted. | Requested/final governed target, redirect chain, response status/media metadata, retrieval instant supplied to the Activity, raw CAS digest/size/URI, provider request receipt when available. |
| `snapshot`                 | `snapshot.metadata-commit`                                                            | Verify raw CAS bytes and transactionally publish source-lineage/evidence metadata in Postgres.                                                                                                                                            | Evidence ID, lineage ID, raw digest, authoritative revision, audit ID, and outbox ID.                                                                                                          |
| `parsing`                  | `parser.execute`, `artifact.cas-put.parsed`                                           | Run the pinned parser in a bounded sandbox, treat output as untrusted, and create-or-verify parsed bytes in CAS.                                                                                                                          | Parser ID/version, raw digest, parsed digest/size/URI, media type, sandbox execution receipt.                                                                                                  |
| `claim-proposal-admission` | `claim.proposal-admit`                                                                | Runtime-validate model proposals and transactionally insert candidate/observed proposals only; never accept them as supported.                                                                                                            | Proposal IDs, committed revision, audit ID, outbox ID, and deterministic rejection codes.                                                                                                      |
| `assessment`               | `claim.assess`                                                                        | Evaluate a named evidence policy and transactionally commit its assessment and eligible claim transition. Model agreement is not an input to truth promotion.                                                                             | Assessment ID, policy ID/version, verdict, claim status/version, committed revision, audit ID, and outbox ID.                                                                                  |
| `ledger-mutation`          | `ledger.mutate`                                                                       | Apply other validated claim, edge, dependency, lineage, or status mutations in one Postgres transaction with audit/outbox.                                                                                                                | Mutation ID, before/after revision, changed entity IDs, audit ID, and outbox ID.                                                                                                               |
| `report-compilation`       | `report.compile`, `artifact.cas-put.report`                                           | Read a frozen Postgres revision, compile deterministically, reject unsupported prose, and create-or-verify report/trace/manifest bytes in CAS.                                                                                            | Manifest ID/version, frozen revision, report/trace/manifest digests and CAS URIs, compiler/template versions, coverage verdict.                                                                |
| `artifact-commit`          | `artifact.metadata-commit`                                                            | Verify an existing CAS object and transactionally publish authoritative metadata/reference. It never overwrites bytes.                                                                                                                    | Artifact ID, digest/size/media/schema/role, authoritative revision, audit ID, and outbox ID.                                                                                                   |
| `outbox-publication`       | `outbox.publish`                                                                      | Publish one committed row to one destination with the stable dispatch key, then durably acknowledge it.                                                                                                                                   | Outbox ID, destination, dispatch key, provider receipt, dispatched instant, and acknowledgement row identity.                                                                                  |
| `revalidation`             | `revalidation.complete` plus the nested retrieval/snapshot/assessment operation kinds | Reacquire a scheduled subject, compare immutable digests, traverse affected assessments, and atomically complete/reschedule the durable schedule.                                                                                         | Schedule ID/generation, prior/current digests, `fresh`/`changed`/`failed`, child receipt IDs, completion receipt, and next schedule ID/due time when required.                                 |
| `human-gate-handoff`       | `human-gate.open`, `human-gate.notify`                                                | Transactionally open one durable gate, then optionally notify through a provider. A later human decision is a signal-backed, human-attributed mutation and is not this Activity's result.                                                 | Gate ID/state/expiry, gate-open audit/receipt, notification destination/key/provider receipt. Decision actor/reason/receipt remain separate.                                                   |

The default task-queue mapping is: `retrieval` and `snapshot` to `retrieval`;
`parsing` to `local-small`; proposal admission, assessment, ledger mutation,
report compilation, artifact commit, and outbox publication to
`research-control`; `revalidation` to `retrieval`; and human-gate handoff to
`human-gate`. A recorded routing decision may select another compatible queue,
but it does not change effect identity.

CAS create-or-verify is a sub-effect used by producer Activities because bytes
must be durable before a later metadata commit. The generic `artifact-commit`
Activity publishes their authoritative metadata. This preserves ADR 0003's CAS
ordering without putting large payloads in Temporal history.

## Completed-effect record and lookup protocol

A completed lookup is by `(provider, idempotencyKey)`, but a hit is usable only
after validating all immutable identity fields and the registered result schema:

```typescript
interface CompletedEffectV1<TResult> extends EffectIdentityV1 {
  id: string;
  provider: string;
  idempotencyKey: `sha256:${string}`;
  state: 'completed';
  originalAttribution: {
    workflowId: string;
    runId: string;
    activityId: string;
    activityAttempt: number;
    taskQueue: string;
    leaseOwner?: string;
    fencingToken?: number;
  };
  providerReceipt: unknown;
  resultSchema: string;
  resultDigest: `sha256:${string}`;
  result: TResult;
  startedAt: string;
  completedAt: string;
}
```

Each Activity type registers a strict result parser for the mapping in the
catalog. The stored `resultDigest` is recomputed before return. Provider, key,
program, work item, operation kind, contract version, input digest, result schema,
and digest must all match. Any mismatch is `effect_identity_conflict`, is
non-retryable, and makes no provider call.

The execution order for every retryable effect is:

1. validate the invocation and semantic input; recompute `inputDigest` and key;
2. resolve the attributable work item and append the delivery attempt;
3. look up a completed effect and, on an exact match, map and return its result;
4. inspect started/ambiguous state and query the provider by the same key when the
   provider protocol supports reconciliation;
5. durably record intent when required, call the provider with the exact key, and
   validate its result;
6. atomically persist completion plus the owned local transition where Postgres
   owns both; otherwise persist the completed effect before work completion;
7. fence only the current work-state transition, then acknowledge the Activity.

A completed effect created under an older fence remains valid evidence of that
effect. A reclaimed worker may map it to the current delivery, but only the
current fence may advance work state. A provider that can create an external
effect but cannot deduplicate or query by key cannot be automatically retried; it
requires an owned durable dispatcher or an ambiguous partial receipt and human
reconciliation.

## Failure, retry, timeout, and heartbeat policy

Activity code returns typed failure codes. Message matching, catch-all retries,
and the current generic `retryable: boolean` are insufficient.

These codes are eligible for a Temporal retry with the same key:

- `dependency_unavailable`, `network_timeout`, `connection_reset`,
  `provider_throttled`, eligible `provider_5xx`, `database_deadlock`,
  `database_serialization`, and `worker_interrupted`;
- `provider_result_ambiguous` only when the next attempt first reconciles by key.

These codes are non-retryable for the same invocation:

- `invalid_input`, `unsupported_contract`, `attribution_mismatch`,
  `effect_identity_conflict`, `security_denied`, `egress_denied`, `budget_denied`,
  `digest_mismatch`, `integrity_failure`, `stale_fence`, `stale_revision`,
  `referential_integrity`, `policy_denied`, `unsupported_media`,
  `deterministic_parser_rejection`, `deterministic_compiler_rejection`, and
  `invalid_provider_result`.

`stale_revision` is a workflow-level reread/recompute condition. If the mutation
is still valid, the workflow schedules new semantic work with a new expected
revision and input digest; blindly retrying the old Activity cannot succeed.

The initial Temporal policy is frozen as follows. Durations are ceilings, not
promises; service readiness is handled before dispatch rather than with a
schedule-to-start timeout.

| Activity type              | Schedule-to-close | Start-to-close | Heartbeat timeout | Maximum attempts | Backoff                          |
| -------------------------- | ----------------: | -------------: | ----------------: | ---------------: | -------------------------------- |
| `retrieval`                |            10 min |          2 min |            15 sec |                5 | 1 sec, coefficient 2, max 30 sec |
| `snapshot`                 |             5 min |          1 min |              none |                5 | 1 sec, coefficient 2, max 30 sec |
| `parsing`                  |            15 min |          5 min |            30 sec |                3 | 2 sec, coefficient 2, max 1 min  |
| `claim-proposal-admission` |             2 min |         30 sec |              none |                3 | 1 sec, coefficient 2, max 10 sec |
| `assessment`               |             2 min |         30 sec |              none |                3 | 1 sec, coefficient 2, max 10 sec |
| `ledger-mutation`          |             2 min |         30 sec |              none |                5 | 1 sec, coefficient 2, max 10 sec |
| `report-compilation`       |            10 min |          5 min |            30 sec |                3 | 2 sec, coefficient 2, max 1 min  |
| `artifact-commit`          |             5 min |          1 min |              none |                5 | 1 sec, coefficient 2, max 30 sec |
| `outbox-publication`       |            10 min |          1 min |            15 sec |               10 | 1 sec, coefficient 2, max 1 min  |
| `revalidation`             |            30 min |          5 min |            15 sec |                5 | 5 sec, coefficient 2, max 2 min  |
| `human-gate-handoff`       |             5 min |         30 sec |              none |                5 | 1 sec, coefficient 2, max 30 sec |

Heartbeats contain only validated resumable progress: byte/page/chunk index,
provider operation ID, and partial CAS digest. They never contain secrets or an
authoritative verdict. Retrieval heartbeats after bounded chunks and redirects;
parsing and report compilation heartbeat only between bounded units; revalidation
heartbeats between child operations; publication heartbeats only while a provider
exposes meaningful bounded progress. Database transactions and short metadata
commits do not heartbeat. Cancellation is checked before calls and at heartbeat
boundaries. An observed provider commit during cancellation is still reconciled
and receipted.

Poison input is recorded once with code, input digest, program/work and workflow
attribution, then made non-retryable. Retry exhaustion records the final typed
failure and honest partial receipt. Poison outbox rows remain queryable and are
never silently skipped or deleted.

## Receipt boundaries and crash matrix

The required durable seams are:

1. before completed lookup;
2. after lookup and before intent;
3. after intent commit and before provider call;
4. after provider commit and before completed-receipt commit;
5. during the owned Postgres transaction;
6. after completed-receipt commit and before work-state completion;
7. after work-state completion and before Activity acknowledgement;
8. during heartbeat timeout or cancellation reconciliation.

At seams 1–3 a retry uses the same key. At seam 4 it queries/deduplicates at the
provider or records an ambiguous partial receipt. At seam 5 all locally owned
state, audit, receipt, and outbox changes commit or roll back together. At seams
6–7 completed lookup returns the recorded result and the current fence alone
advances any unfinished work state. Cancellation never deletes a CAS object,
provider effect, accepted mutation, or prior receipt.

The shared conformance matrix must cover concurrent duplicate delivery, duplicate
after completion/restart, crash before and after provider commit, crash after
receipt commit, transaction rollback, fence rollover, key/input collision,
heartbeat timeout, poison input, retry exhaustion, cancellation at every seam,
and independent Activity-worker, Temporal-worker, Temporal-service, Postgres, and
caller restart. Assertions are provider call counts, Postgres/CAS equality, typed
receipt equality, and outbox destination counts—not merely workflow completion.

Activity-specific assertions are: redirects cannot change the governed target
unnoticed; CAS duplicate puts verify bytes; parser limits cannot be escaped;
proposal admission cannot support a claim; assessment names its policy; ledger
rollback emits no audit/outbox; report compilation rejects unsupported prose;
outbox identity is per destination; failed/changed revalidations remain visible;
and gate opening, notification, expiry, and human decision remain distinct.

## Conflicts with current P2 ports and tests

| Current path                                                                       | Factual conflict with T3                                                                                                                                                                                                                                                                                                                                                                  | Required reconciliation/evidence                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/work-queue/src/receipts.ts`                                              | `SideEffectReceipt` has only a string key, timestamps, opaque result, and provider receipt ID. `InMemoryReceiptStore` is keyed only by that string and has no provider, program/work, operation, contract/input digest, result schema, workflow attribution, ambiguity state, or concurrency control.                                                                                     | Replace or version the receipt/effect port with strict identity and result codecs; test mismatched attribution/result digest, concurrent duplicates, ambiguous reconciliation, and fence rollover.                                                                                                                                  |
| `packages/work-queue/src/types.ts`                                                 | `WorkFailure` is message plus boolean; `WorkItem` has program/kind but no contract/input digest or Temporal attempt attribution. The local lease token is also a string while Postgres uses a numeric fence.                                                                                                                                                                              | Add typed failure codes and a normalized attributable work/attempt contract without making delivery metadata part of effect identity. Extend `packages/work-queue/test/queue.test.ts` and `durable-runtime.test.ts`.                                                                                                                |
| `packages/work-queue/src/runtime.ts`                                               | `executeExactlyOnce` can replay a local completed result, but it does not validate attribution, record ambiguity, reconcile a provider, or atomically bind completion to a fenced work transition.                                                                                                                                                                                        | Retain it only as a legacy major-`1` implementation or adapt it to the ADR-selected new port; expand `packages/work-queue/test/receipts.test.ts` beyond string-key replay.                                                                                                                                                          |
| `packages/adapter-contracts/src/conformance.ts`                                    | `ExactlyOnceEffectRuntime` accepts only `idempotencyKey` and callback. Its conformance test proves one effect after restart, not result validation, concurrent delivery, ambiguous provider commit, poison input, or fence rollover.                                                                                                                                                      | Version the conformance contract and add the full shared Activity-effect matrix. `packages/adapter-contracts/test/local-conformance.test.ts` must run it for local and production implementations.                                                                                                                                  |
| `packages/postgres-adapter/src/migrations.ts`                                      | `mammoth_work_items` lacks `program_id`, work/activity kind, queue, contract version, and input digest. There is no attempt table. `mammoth_effect_receipts` lacks operation/input/result schemas and workflow attribution; it has no started/ambiguous state. `unique (work_id, fencing_token, state)` also permits only one receipt of a state per work fence, regardless of operation. | Add a forward-only migration for attributable work, attempt history, effect identity/lifecycle, typed result/digest, and indexes. Test empty install, upgrade, interruption, checksum drift, and restart.                                                                                                                           |
| `packages/postgres-adapter/src/work-outbox.ts`                                     | `EffectInput` is private and write-only. `PostgresWorkState` has no `get` or completed lookup/result return. `insertReceipt` treats a different fence as conflicting, so a legitimate reclaimed delivery cannot reuse the old completion. `WorkStateConflictError` marks stale fence and identity conflict retryable alike.                                                               | Expose inward-facing lookup/intent/complete ports; separate immutable effect attribution from the current work fence; return a validated result; split typed retry classifications. Extend `packages/postgres-adapter/test/work-outbox.test.ts` with exact lookup order, mismatch, rollover, concurrent duplicate, and crash cases. |
| `packages/postgres-adapter/src/work-outbox.ts` (`PostgresOutbox`)                  | `acknowledge` returns only inserted/not inserted and does not load or validate the existing dispatch key/result. A remote commit before acknowledgement can be published twice unless the destination honors or can query `dispatchKey`.                                                                                                                                                  | Add completed dispatch lookup and exact existing-result validation before publish; test provider commit/ack crash and a conflicting dispatch key/result.                                                                                                                                                                            |
| `packages/postgres-adapter/src/ledger.ts` and `packages/persistence/src/ledger.ts` | The common `EpistemicLedger` port exposes only `read`/`transact`; expected revision is Postgres-specific, mutation IDs default to random UUIDs, and there is no lookup that maps a duplicate mutation to its prior revision/result.                                                                                                                                                       | Add an application mutation command/result port that accepts stable identity and expected revision and atomically records result, audit, and outbox. Preserve `packages/postgres-adapter/test/ledger.test.ts` rollback/referential tests and add duplicate mapping.                                                                 |
| `packages/retrieval/src/retrieve.ts`, `snapshot.ts`, and `parse.ts`                | `snapshotSource` combines request, CAS writes, and parsing. Errors are message strings, `readBounded` exposes no progress callback, and the returned object contains bytes before snapshotting.                                                                                                                                                                                           | Split the three catalog Activities around CAS references, add typed errors/progress/cancellation hooks, and preserve all SSRF, redirect, size, media, parser, CAS dedupe, and tamper cases in `packages/retrieval/test/retrieval.test.ts`.                                                                                          |
| `packages/report-compiler/src/compiler.ts`                                         | Compilation is correctly a pure typed result, but persistence is performed elsewhere and there is no frozen-revision Activity input or completed artifact mapping.                                                                                                                                                                                                                        | Keep the compiler pure; wrap it with frozen Postgres reads, CAS outputs, and later artifact metadata commit. Preserve every negative case in `packages/report-compiler/test/compiler.test.ts`.                                                                                                                                      |
| `packages/governance/src/revalidation.ts`                                          | A lease is owner/time based rather than fence based; completion accepts an arbitrary receipt ID and cannot validate child effect receipts or schedule generation.                                                                                                                                                                                                                         | Add a durable, fenced Activity-facing completion command and roll-up receipt validation; preserve lease recovery/retry tests in `packages/governance/test/revalidation.test.ts` and restart tests.                                                                                                                                  |
| `packages/governance/src/human-gates.ts`                                           | Gate identity and decision attribution are durable, but open is not idempotent-by-result and notification has no separate provider receipt. Expiry occurs on reads using the local clock.                                                                                                                                                                                                 | Add idempotent gate-open mapping and separate notification effect; T4 must drive expiry by deterministic workflow timer while Postgres remains the decision record. Preserve `packages/governance/test/human-gates.test.ts` denial/expiry rules.                                                                                    |
| `packages/runtime/src/runtime.ts`                                                  | The MVP composes retrieval/snapshot/parsing, assessment/promotion, local ledger mutation, filesystem report writes, and one local snapshot receipt in a sequential function. Keys are string concatenations and the receipt does not cover every side effect.                                                                                                                             | Refactor only after the new contracts exist. Reuse current domain logic behind Activities and preserve `packages/runtime/test/runtime.test.ts`, `hardening.test.ts`, and `concurrency.test.ts` as regression evidence; they are not T3 delivery evidence.                                                                           |

The P2 tests named above prove useful primitives. None exercises a real Temporal
Activity redelivery or the full production-like crash matrix, so none proves T3.

## Minimal dependency-ordered implementation slices

1. **ADR and contract version decision.** Record the selected major/version path,
   CAS-reference payload rule, effect lifecycle, result mapping, and migration
   compatibility. No T3 source slice is unblocked before acceptance.
2. **Pure Activity contract package/surface.** Add strict invocation, effect
   identity, result, failure, heartbeat, and key-derivation schemas with canonical
   digest fixtures for all eleven Activity types. This slice changes no adapter.
3. **Port and conformance upgrade.** Add completed lookup, intent/ambiguity,
   completion, attempt attribution, and fenced work-transition ports. Add shared
   in-memory duplicate/crash/fence/result-conflict conformance before Postgres.
4. **Forward-only Postgres reconciliation.** Migrate attributable work, attempts,
   effect lifecycle/results, and outbox dispatch lookup. Implement the new ports
   and run empty/upgrade/interruption/restart plus concurrent duplicate tests.
5. **Retrieval vertical slice.** Split retrieval, snapshot metadata, parsing, and
   artifact metadata around CAS references; preserve hostile-input tests and add
   duplicate delivery, heartbeat timeout, cancellation, and provider ambiguity.
6. **Authoritative mutation slice.** Implement proposal admission, assessment,
   and ledger mutation with stable mutation mapping, expected revisions, and
   atomic receipt/audit/outbox results. Treat stale revisions as workflow replan.
7. **Compilation/artifact slice.** Wrap the pure compiler at a frozen revision,
   persist immutable report/trace/manifest bytes, and commit metadata separately.
8. **Publication and governance slice.** Implement outbox lookup/publish/ack,
   revalidation roll-up, gate opening, and separate notification receipts.
9. **Temporal registration and adversarial gate.** Register policies from this
   catalog in the T1/T2 worker, run forced duplicate delivery and all crash seams
   against the production-like profile, then add the results to `verify:p3`.

Slices 5–8 may proceed in parallel only after slices 1–4 are integrated. Workflow
and Activity contract ownership remains serialized. T4 human decisions and timer-
driven expiry remain outside T3 even though the T3 handoff Activity must preserve
their boundary.

## Acceptance evidence required before T3 can be claimed

- the ADR is accepted and the chosen contract version appears in descriptors and
  production-profile requirements;
- canonical key fixtures prove Temporal attempt/run/fence changes do not change a
  key, while any semantic input/operation/work/program change does;
- every Activity uses a strict input and result schema and the catalog policy;
- completed lookup occurs before provider invocation and validates result mapping;
- duplicate delivery, fence rollover, crash, timeout, cancellation, poison, and
  retry exhaustion pass in memory and real Postgres/CAS;
- the production-like Temporal profile proves one provider effect, publication,
  artifact metadata commit, and accepted mutation at the required identities;
- existing retrieval, report, governance, work-queue, Postgres ledger/outbox, P2,
  adapter, and MVP gates remain green.

Until that evidence exists, the accurate status is **T3 contract audited and
blocked on ADR**, not implemented, integrated, or verified.
