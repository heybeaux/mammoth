# Autonomous P2 Delivery Loop

## Mission

Operate continuously and autonomously until the `v0.2.0-production-data`
checkpoint in `P2_PLAN.md` is merged, verified, and ready to record. Finish the P1
contract freeze, then deliver Postgres ledger, content-addressed artifacts,
transactional work/effect/outbox state, the production-like local profile, and the
read-only Observatory projection.

Routine design choices, reversible architecture decisions recorded in ADRs,
failures with an in-scope workaround, worker delegation, PRs, reviews, CI repair,
and sequencing do not require human contact.

## Roles

- **Coordinator/integrator:** owns priorities, contracts, live worker state,
  integration, CI, receipts, and the checkpoint decision.
- **Builder:** implements one path-bounded slice and its tests.
- **Adversarial verifier:** attacks concurrency, transactions, migration, tamper,
  restart, idempotency, backup/restore, and fail-closed behavior.
- **Architecture reviewer:** checks dependency direction, authority boundaries,
  adapter isolation, schema evolution, and Observatory read-only semantics.
- **Receipt auditor:** independently reconciles executed evidence with the active
  checklist and final report.

Roles may rotate. The author of a slice does not self-certify its exit gate. Keep
one slot for coordination/integration and parallelize only path-disjoint tasks.

## Worker lifecycle

1. The coordinator writes a bounded assignment with owned paths, non-owned paths,
   permitted contracts, acceptance commands, dependencies, and handoff recipient.
2. Spawn the worker through the native delegation mechanism.
3. Immediately verify the worker through the live agent-status tool.
4. Record status precisely: spawn requested, active, completed, integrated, or
   merged/verified.
5. Require the handoff format in `AGENTS.md`.
6. Review the diff and evidence before integration; never merge a worker assertion
   on trust.
7. Release the ownership boundary only after the handoff is accepted or abandoned.

If a worker disappears or delegation fails, preserve its worktree, record the
failure, reclaim the bounded task, and continue. A branch or commit is not a live
worker.

## The loop

1. **Orient** — fetch the default branch; inspect worktrees, open PRs, CI, live
   workers, `P2_PLAN.md`, ADRs, migrations, and evaluation receipts. Identify the
   highest-value unblocked P2 predicate.
2. **Claim** — define the smallest testable slice, owner, paths, dependencies,
   contract impact, failure risks, acceptance command, and reviewer.
3. **Delegate** — assign independent implementation, adversarial verification,
   migration review, or projection work when ownership does not overlap. Prove
   activity through the live status tool.
4. **Build** — implement deterministic domain/application behavior first, then
   production adapters. Keep transactions, clocks, IDs, network calls, storage,
   and external effects injectable.
5. **Attack** — test negative paths: concurrent writers, stale revisions, process
   death before/after commits, duplicate delivery, truncated artifacts, tampering,
   migration interruption, unready services, poison outbox rows, and restore.
6. **Review** — inspect the diff independently for authority drift, cross-adapter
   imports, hidden stores, missing constraints, unsafe retries, fake receipts, and
   UI write paths.
7. **Verify** — run package checks, `pnpm verify:adapters`, the active P2 slice
   gate, and the repository ladder. Capture executed evidence under
   `evals/reports/`.
8. **Integrate** — sync, resolve conflicts without discarding work, commit scoped
   paths, push, open a PR, repair CI, incorporate review, merge, then verify the
   default branch.
9. **Reconcile** — update `P2_PLAN.md` and the P2 receipt only from merged evidence.
   Record exact commit, commands, results, limitations, and next predicate.
10. **Continue** — if the P2 stopping condition is false, immediately begin the
    next loop. A green PR, completed slice, or P1 freeze is not a pause point.

Git, database constraints, migration ledgers, CI, verifier output, integrity
checks, and receipts outrank prose or worker confidence.

## Integration order

Use this dependency order unless a written ADR proves a safer alternative:

```text
P1 contract freeze
  -> Postgres lifecycle + migrations
  -> transactional ledger + audit/outbox
  -> content-addressed artifacts
  -> work/effect/outbox durability
  -> production-like restart + backup/restore harness
  -> Observatory projection
  -> clean-checkout P2 verifier + receipt
```

Schema and migration ownership is serialized. Tests, adversarial fixtures,
documentation, and projection schema may proceed in parallel when paths are
disjoint.

## Failure and recovery

Classify each failure as code/test, contract mismatch, migration/data, concurrency,
integration conflict, CI/environment, architecture ambiguity, security/integrity,
or external dependency.

- Retry a transient failure only with evidence that retry is safe.
- After two identical failures, change strategy or assign an independent reviewer.
- After three, quarantine the approach, document root cause, and choose an
  alternative. Never weaken, skip, or delete a gate to get green.
- Preserve unrelated work, failed migrations, red results, and diagnostic
  artifacts.
- Never repair schema drift by deleting data or recreating a volume unless the
  test explicitly owns disposable state.
- If a service is unavailable, continue contract, fixture, documentation, or
  in-memory work that remains valid; do not claim the production gate passed.
- Resolve architecture ambiguity in an ADR before implementation makes it an
  accidental contract.

## Human escalation

Do not send progress updates or request routine confirmation. Escalate to Beaux
only when one of these is true:

- the full P2 stopping condition is satisfied;
- an irreversible or destructive action outside disposable test infrastructure is
  required;
- missing credentials, account authority, billing, legal/licensing input, or a
  security incident has no safe local alternative;
- a product decision materially changes the checkpoint criterion, data authority,
  privacy boundary, or public distribution model and cannot be resolved from the
  architecture or an ADR;
- the same hard blocker remains after three documented loop strategies and no
  useful in-scope P2 work remains;
- acceptance genuinely requires human judgment rather than deterministic proof.

Otherwise choose the safest reversible option, document it, and continue.

## Stopping condition

Stop the autonomous loop only when:

- every entry and delivery gate in `P2_PLAN.md` is true;
- all required migrations and checksums are recorded;
- `pnpm verify:p2` and the complete verification ladder pass from a clean checkout;
- forced concurrency, crash, restart, tamper, outbox, and backup/restore evidence
  passes against the production-like local profile;
- the Observatory projection fixture is deterministic and integrity-bearing;
- `evals/reports/v0.2.0-production-data.md` matches executed evidence;
- default-branch CI is green at the recorded commit;
- `v0.2.0-production-data` is ready to record.

Then send Beaux one concise report containing:

- achieved checkpoint, default-branch commit, and merged PRs;
- exact gates and results;
- production-like run and restore commands;
- adapter descriptors, migration version, and receipt location;
- Observatory projection fixture and digest;
- known limitations and deferred Temporal/research-cell scope;
- recommended P3 loop.

Do not describe P2 as Temporal-complete, research-cell-complete, UI-complete, or
architecture-complete.
