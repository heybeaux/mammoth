# Autonomous P3 Delivery Loop

## Mission

Operate continuously and autonomously until the `v0.3.0-temporal-control-plane`
checkpoint in `P3_PLAN.md` is merged, verified, and ready to record. Preserve the
completed P2 Postgres/CAS authority boundary, then deliver the Temporal adapter,
deterministic workflows, idempotent Activities, signals, queries, cancellation,
replay, crash/restart recovery, and Temporal-linked Observatory projection
metadata.

Routine design choices, reversible architecture decisions recorded in ADRs,
failures with an in-scope workaround, worker delegation, PRs, reviews, CI repair,
and sequencing do not require human contact.

## Roles

- **Coordinator/integrator:** owns priorities, contracts, live worker state,
  integration, CI, receipts, and the checkpoint decision.
- **Builder:** implements one path-bounded slice and its tests.
- **Adversarial verifier:** attacks workflow replay, versioning, duplicate
  Activity delivery, signal races, cancellation, worker/service restart,
  idempotency, and fail-closed startup.
- **Architecture reviewer:** checks dependency direction, authority boundaries,
  adapter isolation, Temporal/Postgres responsibility boundaries, and Observatory
  read-only semantics.
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
   workers, `P3_PLAN.md`, `P2_PLAN.md`, ADRs, Temporal service state, and
   evaluation receipts. Identify the highest-value unblocked P3 predicate.
2. **Claim** — define the smallest testable slice, owner, paths, dependencies,
   contract impact, failure risks, acceptance command, and reviewer.
3. **Delegate** — assign independent implementation, adversarial verification,
   replay/version review, or projection work when ownership does not overlap.
   Prove activity through the live status tool.
4. **Build** — implement deterministic workflow/application behavior first, then
   Temporal adapter plumbing. Keep transactions, clocks, IDs, network calls,
   storage, workflow clients, and external effects injectable.
5. **Attack** — test negative paths: nondeterministic workflow code, replay
   failure, stale workflow versions, process death before/after commits, duplicate
   Activity delivery, heartbeat timeout, stale signals, cancellation races,
   unready services, poison Activity input, and restart.
6. **Review** — inspect the diff independently for authority drift, cross-adapter
   imports, hidden stores, missing constraints, unsafe retries, fake receipts, and
   UI write paths.
7. **Verify** — run package checks, `pnpm verify:adapters`, the active P3 slice
   gate, and the repository ladder. Capture executed evidence under
   `evals/reports/`.
8. **Integrate** — sync, resolve conflicts without discarding work, commit scoped
   paths, push, open a PR, repair CI, incorporate review, merge, then verify the
   default branch.
9. **Reconcile** — update `P3_PLAN.md` and the P3 receipt only from merged
   evidence. Record exact commit, commands, results, limitations, and next
   predicate.
10. **Continue** — if the P3 stopping condition is false, immediately begin the
    next loop. A green PR, completed slice, or entry-gate freeze is not a pause
    point.

Git, database constraints, migration ledgers, CI, verifier output, integrity
checks, Temporal replay tests, and receipts outrank prose or worker confidence.

## Integration order

Use this dependency order unless a written ADR proves a safer alternative:

```text
P2 reconfirmation
  -> Temporal lifecycle + adapter descriptor
  -> deterministic workflow definitions + versioning
  -> idempotent Activities + receipt mapping
  -> signals, queries, cancellation, human gates
  -> crash/restart/replay harness
  -> Temporal-linked Observatory projection fixture
  -> clean-checkout P3 verifier + receipt
```

Workflow contract and Activity ownership is serialized. Tests, adversarial
fixtures, documentation, and projection fixture work may proceed in parallel when
paths are disjoint.

## Failure and recovery

Classify each failure as code/test, contract mismatch, workflow nondeterminism,
replay/versioning, Activity idempotency, signal/cancellation race, integration
conflict, CI/environment, architecture ambiguity, security/integrity, or external
dependency.

- Retry a transient failure only with evidence that retry is safe.
- After two identical failures, change strategy or assign an independent reviewer.
- After three, quarantine the approach, document root cause, and choose an
  alternative. Never weaken, skip, or delete a gate to get green.
- Preserve unrelated work, failed migrations, red results, and diagnostic
  artifacts.
- Never repair schema or Temporal-history drift by deleting data or recreating a
  volume unless the test explicitly owns disposable state.
- If a service is unavailable, continue contract, fixture, documentation, or
  in-memory work that remains valid; do not claim the production gate passed.
- Resolve architecture ambiguity in an ADR before implementation makes it an
  accidental contract.

## Human escalation

Do not send progress updates or request routine confirmation. Escalate to Beaux
only when one of these is true:

- the full P3 stopping condition is satisfied;
- an irreversible or destructive action outside disposable test infrastructure is
  required;
- missing credentials, account authority, billing, legal/licensing input, or a
  security incident has no safe local alternative;
- a product decision materially changes the checkpoint criterion, data authority,
  privacy boundary, public distribution model, or Temporal deployment model and
  cannot be resolved from the architecture or an ADR;
- the same hard blocker remains after three documented loop strategies and no
  useful in-scope P3 work remains;
- acceptance genuinely requires human judgment rather than deterministic proof.

Otherwise choose the safest reversible option, document it, and continue.

## Stopping condition

Stop the autonomous loop only when:

- every entry and delivery gate in `P3_PLAN.md` is true;
- Temporal adapter descriptors, workflow versions, signal/query surface, Activity
  retry policy, and `continueAsNew` policy are recorded;
- `pnpm verify:p3` and the complete verification ladder pass from a clean checkout;
- deterministic replay, duplicate Activity delivery, crash, restart, cancellation,
  signal, query, and service-recovery evidence passes against the production-like
  local profile;
- the Temporal-linked Observatory projection fixture is deterministic and
  integrity-bearing;
- `evals/reports/v0.3.0-temporal-control-plane.md` matches executed evidence;
- default-branch CI is green at the recorded commit;
- `v0.3.0-temporal-control-plane` is ready to record.

Then send Beaux one concise report containing:

- achieved checkpoint, default-branch commit, and merged PRs;
- exact gates and results;
- Temporal service, worker, and recovery commands;
- adapter descriptors, workflow versions, Activity/idempotency policy, and receipt
  location;
- Temporal-linked Observatory projection fixture and digest;
- known limitations and deferred research-cell/UI/managed-deployment scope;
- recommended P4 loop.

Do not describe P3 as research-cell-complete, UI-complete, managed-hosting-complete,
or architecture-complete.
