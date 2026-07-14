# P8 Turnkey Research Delivery Loop

## Mission

P8 Turnkey Research is complete as the local CLI release specified by
`P8_PLAN.md`: plain-language question or theory in, iterative evidence-bound
research and a comprehensive cited report bundle out. Preserve all P2-P8
authority, durability, isolation, lineage, review, and effect-receipt invariants
in any follow-up work.

## Slice 0: reconcile and freeze

Before implementation delegation:

1. fetch and inspect merged `main`, PRs, CI, tags, worktrees, and receipts;
2. record exactly what P7 proves and reconcile stale docs without inventing a P7
   release receipt or tag;
3. merge `P8_PLAN.md`, this loop, `AGENTS.md`, and the coordinator ledger;
4. merge the separate T0 acceptance-baseline PR with both golden corpora,
   thresholds, typed expected artifacts, rubric, adversarial outcomes, verifier
   manifest, ADRs, receipt schema, and non-production provider-spike report;
5. create an integration worktree and one fresh worktree per assigned lane from
   the merged T0 SHA;
6. run one bounded runtime/model probe and prove registry identity, resolved
   model, fresh marker, and artifact before starting a real lane;
7. prove one lane end to end, then activate at most two additional lanes.

## Durable coordinator ledger

`docs/reviews/p8-coordinator-ledger.md` is the cross-turn ownership authority. Each
row records task, state, runtime, session/run/model, worktree, branch, base SHA,
owned paths, dependencies, last registry proof, last artifact proof, handoff and
commit, integration, blockers, and replacement audit.

At the start of every coordinator turn:

1. fetch `origin/main` and reconcile PR/CI state;
2. read the P8 plan and ledger;
3. inspect OpenClaw and Codex-native registries separately;
4. inspect listed worktrees, branches, processes, diffs, and fresh artifacts;
5. update ownership and liveness using only observed evidence;
6. continue the highest unproved P8 predicate.

A status request produces a ledger-backed update only. It never authorizes a
respawn, merge, tag, destructive cleanup, or release claim.

## Delivery sequence

```text
P7 reality and evidence reconciliation
  -> P8 entry contract
  -> T0 golden corpora, thresholds, verifier manifest, rubric, and ADR freeze
  -> natural-language intake, charter, criterion, and report contract
  -> provider-neutral discovery and governed source snapshots
  -> parsing, spans, entailment, lineage, freshness, and claim admission
  -> persisted semantic topology and role-specific evidence packets
  -> bounded coverage-gap, contradiction, and falsification cycles
  -> admitted-only report manifest and Markdown/HTML exports
  -> operator/API inspection, resume, cancel, and partial-report behavior
  -> restart, budget, security, and adversarial acceptance
  -> offline golden-path verifier and clean-checkout ladder
  -> obtain live-exhibition credential and billing authorization
  -> non-author review, code PR, and code-bearing main CI
  -> mandatory live exhibition and exact-bundle editorial review
  -> annotated code tag, receipt-only PR, and final receipt-bearing main CI
```

Contracts land before consumers. Discovery needs intake/search contracts;
authority needs snapshot identities; orchestration needs discovery and authority
ports; reporting needs admitted ledger views. Verification fixtures may begin once
contracts freeze but cannot certify a composition that does not exist.

## Execution cycle

1. **Orient** — reconcile plan, ledger, main, CI, worktrees, workers, dependencies,
   migrations, receipts, and the highest unproved predicate.
2. **Claim** — define one bounded task with owner, paths, base SHA, contracts,
   dependencies, exact gates, adversarial risks, and independent reviewer.
3. **Launch** — use a fresh worktree, prove the exact runtime/model pair with a
   bounded probe, then verify active and producing states.
4. **Build** — implement the smallest vertical contract-to-receipt slice.
5. **Attack** — test hostile sources, authority drift, duplicate effects, budget
   exhaustion, cancellation, crashes, future schemas, and malformed model output.
6. **Review** — inspect dependency direction, hidden stores, direct authority
   writes, deleted rejection residue, synthetic citations, report-added facts,
   unsafe tools, and process-order assumptions.
7. **Verify** — run lane gates, the offline data-center path, all existing phase
   verifiers through P7, `verify:p8`, and the clean-checkout ladder.
8. **Integrate** — coordinator reviews and serially incorporates commits, resyncs
   dependents, pushes, opens/updates PR, repairs CI, and resolves review findings.
9. **Reconcile** — update plan, ledger, roadmap, receipt, and tag only from proof.
10. **Continue** — claim the next unproved predicate; a green slice is not a pause.

## Research product loop

The implemented product must execute and persist this bounded state machine:

```text
frame question/theory
  -> compile charter, subquestions, coverage, falsifiers, and stop policy
  -> independently propose typed search queries
  -> governed search and source selection
  -> acquire, snapshot, parse, classify, and chunk hostile sources
  -> extract atomic claims and exact evidence spans
  -> independently assess entailment, lineage, freshness, and contradictions
  -> deterministically admit or reject claims
  -> update coverage and unresolved-gap map
  -> generate gap/falsification queries and repeat within policy
  -> independent critique
  -> stop or continue
  -> synthesize admitted claims into a manifest
  -> render and publish the report bundle
```

Stop decisions are deterministic and consider mandatory coverage, per-section
evidence sufficiency, critical unsupported conclusions, unresolved contradictions,
new-source/query information gain, configured saturation rounds, maximum cycles,
wall time, tokens, currency, request/byte limits, and cancellation. Budget or
provider exhaustion yields an honest partial report, never fabricated completion.

## Failure and recovery

- Retry transient effects only when the stable effect identity makes retry safe.
- After two identical failures, change strategy or request independent diagnosis.
- After three, quarantine and record root cause; never weaken or delete a gate.
- Preserve rejected proposals, failed migrations, contradictions, dissent, partial
  output, source bytes, and diagnostics.
- Before replacing a worker, prove terminal/absence in the correct registry, audit
  its process/session/worktree/diff, preserve output, retire the lease, and use a
  fresh worktree.
- Resolve authority ambiguity with an ADR before implementation continues.
- During external outages, continue valid offline work without claiming the live
  service gate.

## Human escalation

Escalate only for irreversible/destructive actions, missing credentials or billing
authority, unresolved legal/licensing or security incidents, a product decision
that changes authority/privacy/distribution/deployment, a blocker surviving three
strategies with no useful work left, or acceptance genuinely requiring human
judgment. Routine reversible design, delegation, PR, CI repair, and sequencing are
coordinator decisions.

## Stopping condition

P8 stopped only when the plain-language data-center command produced the complete
report bundle; every factual sentence passed claim/policy/locator/snapshot
provenance; mandatory coverage was covered or explicitly insufficient; at least
one evidence-driven follow-up cycle was proved; dissent, contradictions,
uncertainty, limitations, method, cost, and partiality remained visible; restart,
idempotency, budgets, cancellation, and adversarial security passed; independent
review was non-blocking; and merged-main CI, release receipt, and the annotated
P8 tag proved the exact candidate. Future release loops must define their own
stopping condition before implementation begins.
