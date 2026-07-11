# ADR 0003: Transaction and orchestration ownership

- Status: accepted
- Date: 2026-07-10
- Checkpoint: `v0.2.0-production-data`

## Context

Mammoth must replace its single-host stores without allowing the Postgres adapter,
the later Temporal adapter, or an external provider to imply atomicity they do not
own. The P2 checkpoint adds Postgres and content-addressed storage while Temporal
remains P3. The boundary must therefore be stable before production adapter code
or migrations make an accidental contract.

Postgres is authoritative for product and epistemic state. Temporal is later
authoritative for workflow history, timers, signals, retries, and orchestration
progress. Artifact bytes are immutable in the CAS, while their metadata and
authoritative references live in Postgres. External providers cannot participate
in a Postgres transaction.

## Options considered

1. Treat a Temporal workflow as the transaction coordinator for Postgres, CAS,
   and provider effects.
2. Let each repository or adapter open and commit its own transaction.
3. Give one application transaction boundary ownership of each authoritative
   mutation, use Postgres for atomic state plus audit/outbox writes, and coordinate
   CAS and provider effects through explicit prepare/verify/idempotency protocols.

## Decision

Use option 3.

### Postgres transaction ownership

An application service owns the transaction boundary for one authoritative
mutation. It passes a transaction-scoped context to repositories; repositories do
not independently commit, and concrete adapters do not import one another. Claim,
assessment, evidence metadata, work/effect state, receipt metadata, audit records,
and outbox rows required by that mutation commit or roll back together.

Optimistic revisions, unique provider idempotency keys, lease fencing tokens, and
referential constraints are checked inside that transaction. A rejected mutation
creates neither an authoritative revision nor an outbox event. Publishers consume
committed outbox rows and are at-least-once; consumers deduplicate by stable event
identity.

### CAS boundary

CAS bytes are written and digest-verified before a Postgres transaction publishes
authoritative metadata that references them. The metadata transaction revalidates
the expected digest and records the immutable locator. A failed metadata commit
may leave an unreferenced object, which reconciliation reports and may quarantine;
it must never fabricate metadata or delete referenced bytes. Reads verify the
digest and fail closed on missing, truncated, or tampered content.

### Provider-effect boundary

No database claim of exactly-once execution is permitted. Before dispatch,
Postgres commits attributable work state and a stable provider idempotency key.
The provider must honor that key when it can create an external effect. Mammoth
records the returned provider receipt in a later transaction. Retries use the same
key and replay a completed receipt. An ambiguous remote-commit crash remains
visible and is reconciled; it is not converted into a fake success receipt.

### Temporal responsibility

P2 does not add Temporal. The local workflow adapter continues to own local
execution state under contract major 1. In P3, Temporal will own workflow history,
timers, signals, retry scheduling, cancellation delivery, and deterministic
orchestration. Workflow code carries stable identifiers and reconstructs product
state from Postgres; it does not become the product query store or directly mutate
authoritative tables. Database and network work occurs in Activities through
application ports.

Temporal retries do not enlarge a Postgres transaction and do not prove a provider
effect happened once. Activities use stable idempotency keys, short Postgres
transactions, and existing receipts. `continueAsNew` carries identifiers rather
than authoritative object graphs.

### Health and readiness

Health means an adapter can answer its own diagnostic. Readiness to accept
authoritative work requires healthy status, reachable dependencies, compatible
contract major and capabilities, current checksummed schema, and a successful
integrity check. Any missing or degraded prerequisite fails readiness closed.

Adapter contract major `1` is frozen. Additive optional metadata may use a minor
version; removing, retyping, weakening, or changing the observable semantics of a
field, transition, transaction, fencing, receipt, or integrity gate requires a new
major and migration/conformance evidence.

## Consequences

- Postgres provides atomicity only for state inside one database transaction.
- Temporal can replay orchestration without becoming epistemic authority.
- Provider effects rely on stable provider idempotency and honest ambiguous-state
  recovery, not distributed-transaction claims.
- CAS/database split failures are inspectable through orphan reconciliation.
- Outbox delivery is at-least-once and idempotent; rolled-back mutations are never
  publishable.
- Cross-adapter composition stays in application services and ports.
- P2 can ship without Temporal while preserving the contract P3 must consume.

## Evidence

- `pnpm verify:adapters` exercises local workflow, ledger, work-state,
  completed-effect replay, CAS deduplication, invalid-digest, and tamper behavior.
- `packages/adapter-contracts/test/descriptors.test.ts` freezes concrete local
  descriptors, contract major `1`, and fail-closed production-like readiness.
- P2 delivery must add transaction rollback, concurrent revision, atomic outbox,
  provider replay, orphan reconciliation, restart, and backup/restore evidence to
  `evals/reports/v0.2.0-production-data.md`.
