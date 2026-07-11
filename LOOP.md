# Autonomous MVP Loop

## Mission

Operate continuously and autonomously until the initial checkpoint in
`MVP_PLAN.md` is merged and verified. Routine design choices, failures with an
in-scope workaround, PRs, reviews, CI repair, and sequencing do not require human
contact.

## Roles

- **Coordinator/integrator:** owns priorities, contracts, tracked state,
  integration, and the checkpoint decision.
- **Builder:** implements one isolated slice and its tests.
- **Verifier/reviewer:** independently attacks invariants, failure modes, security,
  and acceptance evidence; the slice author does not self-certify completion.

Roles may rotate. Delegated tasks must be concrete, bounded, and path-disjoint.
One integrator owns shared contracts and merges.

## The loop

1. **Orient** — sync and inspect the default branch, worktree, CI, architecture,
   current MVP item, and existing evaluation receipts. Identify the highest-value
   unblocked failure or missing acceptance condition.
2. **Plan** — reduce it to the smallest testable vertical slice. Record owner,
   paths, dependencies, acceptance command, risks, and handoff.
3. **Delegate** — parallelize implementation, adversarial tests, review, or docs
   only when paths and contracts do not overlap.
4. **Build** — implement deterministic core behavior first, then ports and adapters.
   Preserve idempotency, typed boundaries, fail-closed policy, and inspectability.
5. **Review** — inspect the diff independently. Test negative cases, interruption,
   replay, security boundaries, and architectural dependency direction.
6. **Verify** — run package-local checks, the active phase gate, then the full
   repository ladder in `AGENTS.md`. Capture significant exit-gate evidence under
   `evals/reports/`.
7. **Integrate** — sync, resolve conflicts without discarding other work, commit
   scoped paths, push, open a PR, repair CI until green, review, merge, and verify
   the default branch.
8. **Checkpoint** — update the MVP checklist or evaluation receipt with commits,
   PRs, exact tests, limitations, and next action. If the checkpoint predicate is
   false, immediately begin the next loop.

Git, CI, verifier output, and receipts outrank worker assertions. A merged phase is
not a reason to pause.

## Failure and recovery

Classify failures as code/test, integration conflict, CI/environment,
architectural ambiguity, security, or external dependency.

- Retry transient failures with evidence.
- After two identical failures, change strategy or assign an independent reviewer.
- After three, quarantine the approach, document root cause, and choose an
  alternative. Never weaken or delete a gate to get green.
- Preserve unrelated work and failed-result evidence.
- If an external service is unavailable, use a deterministic local fixture or
  adapter when the architecture permits and document the limitation.
- Record architectural ambiguity in an ADR before implementation locks it in.

## Human escalation

Do not send progress updates or request routine confirmation. Escalate to Beaux
only when one of these is true:

- the initial MVP checkpoint is merged and all acceptance gates pass;
- an irreversible or destructive action outside the repository is required;
- missing credentials, account authority, billing, legal input, or a security
  incident has no safe local alternative;
- a product decision materially changes the criterion or security boundary and
  cannot be resolved from the architecture or an ADR;
- the same hard blocker remains after three documented loop strategies and no
  useful in-scope work remains;
- acceptance genuinely requires human judgment rather than deterministic proof.

Otherwise choose the safest reversible option, document it, and continue.

## Stopping condition

Stop the autonomous loop only when every acceptance item in `MVP_PLAN.md` is true
from a clean checkout, required CI is green on the default branch, an MVP evaluation
receipt exists, known limitations are documented, and `v0.1.0-mvp` is ready to
record. Then send one concise report containing:

- achieved checkpoint and merged PRs/commit;
- exact gates and results;
- demo command and artifact location;
- known limitations and deferred scope;
- recommended next post-MVP loop.

Never describe this checkpoint as architecture-complete or v1.
