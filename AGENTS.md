# Mammoth Worker Contract

## Mission and authority

Build Mammoth from merged P7 substrate commit `2e35802` into the P8 Turnkey
Research Product defined by `P8_PLAN.md`. P7 proved governed provider execution,
durable receipts, reconstruction, dossier structure, and operator controls. It did
**not** prove question-driven discovery, evidence extraction, iterative research,
or a comprehensive user-ready report.

`ARCHITECTURE.md` remains normative. `P8_PLAN.md` is the active acceptance and
stopping authority, and `LOOP.md` is the execution protocol. Before the P8 entry
plan and separate T0 acceptance-baseline PR merge, work is limited to inventory,
contract discovery, ADRs, fixtures, spike reports, and planning. Implementation
worktrees must be created or resynced from the T0 merge commit.

No worker may claim Mammoth is a turnkey research product until the black-box
data-center command and every P8 release predicate pass on merged `main`.

## Required reading and assignment record

Read, in order:

1. `AGENTS.md`;
2. `P8_PLAN.md`;
3. `ARCHITECTURE.md` sections 6, 11-16, 21, 23-25, and 27-32;
4. `P7_PLAN.md` and the actual merged P7 implementation/evidence;
5. `LOOP.md`;
6. `docs/reviews/p8-coordinator-ledger.md`;
7. relevant packages, tests, ADRs, and fixtures.

Every assignment must record:

- task ID, objective, and acceptance evidence;
- runtime, session key, run ID, and resolved model;
- worktree, branch, and base SHA;
- owned and prohibited paths;
- contracts allowed to change;
- dependencies and integration predecessor;
- exact verification commands;
- handoff recipient and independent reviewer.

Do not silently broaden an assignment. Stop with a conflict note before editing
outside owned paths. The coordinator alone reconciles cross-package contracts.

## Coordinator and delegation

The coordinator owns the integration branch, active ledger, cross-package
contracts, root manifests and lockfile unless explicitly assigned, CI decisions,
release receipt, tag, and final product claim. Mammoth has four execution slots:
the coordinator retains one and runs at most three implementation lanes at once.

Path-disjoint P8 lanes are:

- **A — intake/contracts:** research brief, charter, criterion, coverage, plan,
  cycle, and publication contracts;
- **B — discovery/retrieval/security:** search port/adapters, governed egress,
  acquisition, snapshots, parsing, exact locators, and hostile-content controls;
- **C — authority/admission:** migrations, Postgres/CAS authority, claim/span
  admission, entailment, lineage, freshness, contradiction, and budgets;
- **D — orchestration/operator:** semantic topology, iterative cycle controller,
  Temporal Activities, application service, and CLI;
- **E — report/projection:** admitted-only manifest, Markdown/HTML compiler,
  bibliography, inspection, and read-only projection;
- **F — verification/release:** offline fixtures, adversarial verifier, CI, live
  exhibition, independent review, receipt, and tag.

Record actual dependencies per assignment: B needs A search/snapshot contracts; C
needs A identities and B manifests; D needs A, B, and C ports; E needs A and C
ledger views and composes with D; F may draft after T0 but cannot certify before
public composition. Work may overlap only after inputs merge and paths remain
disjoint. Contract changes serialize; dependents resync. An author never
self-certifies a release gate.

## Worker liveness and durable ownership

Use these exact states:

- **spawn requested** — delegation was accepted but execution is unproved;
- **active** — the matching runtime registry reports the same worker running;
- **producing** — active plus a fresh attributable artifact, diff, test, or report;
- **completed** — a handoff was returned;
- **integrated** — the coordinator reviewed and incorporated it;
- **retired** — its lease was explicitly closed after audit;
- **merged/verified** — default branch and CI prove the result.

OpenClaw and Codex-native registries are separate. A Telegram turn ending does not
end an OpenClaw worker. Branches, worktrees, commits, and prose are not liveness
proof. Before replacement, prove the previous worker terminal or absent in its own
registry, inspect its session/process/worktree/diff and fresh timestamps, preserve
useful output, mark its lease retired, then use a fresh worktree. Never assign two
workers to one worktree or overlapping paths.

## Product and epistemic invariants

- A user supplies plain-language input; user-authored internal JSON, digests,
  topology IDs, or environment cell lists are not part of the golden path.
- Models propose typed work; deterministic code validates, executes, and commits.
- Models have no arbitrary browser, shell, or direct authority tools.
- Search results and snippets are discovery hints, never evidence.
- No factual report sentence without a claim ID.
- No admitted claim without a named evidence-policy verdict.
- Every factual sentence traverses claim -> assessment -> exact locator ->
  immutable source snapshot.
- Model agreement never promotes truth. Source quantity never proves independence.
- Evidence, source bytes, prompts, configurations, and effect receipts are
  immutable and content-addressed.
- Contradictions, dissent, unresolved gaps, stale evidence, failures, and partial
  completion remain visible.
- Report rendering may not introduce facts absent from the admitted manifest.
- External effects use stable idempotency keys, budgets, cancellation fences, and
  attributable cost/effect receipts.
- Postgres/CAS is authoritative; Temporal carries identifiers and reconstructs.
- Memory and model output are proposals, not truth.

A green test that violates an invariant is a failing implementation. A successful
provider call, completed cells, or structurally valid dossier is not proof of
research quality.

## Package boundaries

- `packages/domain`: pure versioned schemas/state machines; no I/O or SDKs.
- `packages/workflow`: deterministic P8 workflow contracts and runtime ports.
- `packages/search-port`: provider-neutral typed discovery contracts.
- `packages/retrieval`: hostile-input acquisition, immutable snapshots, parsing,
  and security; retrieval cannot promote claims.
- `packages/evidence`: canonical evidence, entailment, lineage, policy, audit, and
  admission primitives.
- `packages/persistence` and Postgres/CAS adapters: authoritative repositories,
  ledgers, migrations, fences, effects, and publication records.
- `packages/report-compiler`: manifest validation and deterministic rendering;
  prose may not add factual nodes.
- `packages/governance`: budgets, classification, egress, gates, revalidation,
  cancellation, and fail-closed policy.
- Temporal adapters orchestrate only and never become a shadow product store.
- Observatory projections are read-only and non-authoritative.
- Apps and adapters depend inward through ports; adapters do not import each other.

One worker owns a file or package at a time. Cross-package exports, migrations,
root scripts, CI, and lockfile changes require one named owner.

## Shared-checkout safety

Inspect `git status --short --branch` before editing and preserve unexpected work.
Never use `git reset --hard`, `git clean`, broad restore, force push, destructive
rebase, `git add .`, or `git add -A`. Never amend another worker's commit, format
the repository during concurrent edits, hand-edit generated output, or use legacy
P3-P7 worktrees for P8. Prefer one fresh branch and worktree per lane.

## Implementation discipline

Build the smallest vertical slice satisfying a measured P8 gate. Keep clocks, IDs,
network calls, storage, parsers, and effects injectable. Validate every trust
boundary, use strict types and exhaustive unions, and classify errors by
retryability and policy effect. ADRs are required for architecture choices.
Migrations are forward-only and test empty, upgrade, interrupted, and repeated
states. Never add fake receipts, test bypasses, embedded secrets, or recovery that
works only in process order.

## Verification ladder

During work, run affected tests, typecheck, build, and the lane verifier. Handoffs
must include P8 golden-path evidence relevant to the lane, not only package tests.
Before merge or checkpoint, run the complete existing ladder through
`pnpm verify:p7`, plus a non-recursive `pnpm verify:p8` that is visible in CI.
Also run format, lint, typecheck, tests, and build from a clean checkout.

The deterministic P8 verifier uses a frozen data-center corpus and must not require
the public web or paid providers. Live search/model exhibitions are separate and
must record provider/model identity, source snapshots, configuration/prompt/report
digests, costs, runtime, failures, and limitations. Never claim a command passed
unless it ran and its exact result is recorded.

## Handoffs, review, and completion

Every handoff includes:

```text
Task / state / runtime+session+run+model / owned paths / base SHA
commit or PR / contracts changed / tests and golden-path evidence
risks and unverified areas / blockers / next owner and integration predecessor
```

The coordinator reviews diffs and evidence before integration. Blocking review
findings return to the original owner and require independent re-review. Workers
do not rebase or force-push the integration branch. An item is done only when its
acceptance evidence exists, required gates pass, it is merged, and the P8 plan,
ledger, and receipt reflect reality. Continue to the highest unproved predicate;
do not stop because one task or PR is green.
