# M4 completion audit

## Audit scope and standard

This is an independent audit of commit
`6572008f0898914425667826edaa795f52242afd` (`origin/main` at the time of
inspection). It maps the M4 acceptance contract in `MVP_PLAN.md` and the
checkpoint rules in `AGENTS.md` and `LOOP.md` to current, inspectable evidence.
An implementation or lower-level test is not treated as proof of the clean
checkout checkpoint unless the M4 verifier and receipt exercise it.

Status meanings:

- **Proven** — direct current evidence covers the stated scope.
- **Weak** — relevant implementation or tests exist, but they do not prove the
  complete acceptance statement.
- **Missing** — a required command, receipt, integration scenario, or state does
  not exist.

## M4 acceptance matrix

| Acceptance requirement                                                                    | Status      | Current evidence and finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add `pnpm verify:mvp` and an evaluation receipt under `evals/reports/`                    | **Missing** | Root `package.json` defines gates through `verify:m3`, but no `verify:mvp`. `evals/reports/` contains Phase 0/1/2, M2, and M3 receipts only. This prevents M4 from being invoked or independently reproduced.                                                                                                                                                                                                                                                                                                                         |
| Install, format check, lint, typecheck, test, and build are green from a clean checkout   | **Weak**    | `.github/workflows/ci.yml` does run frozen install, format check, lint, typecheck, test, and build. GitHub Actions run `29133508489` succeeded for the audited default-branch commit. However, there is no M4 clean-checkout receipt recording these commands, environment, commit, and results as one acceptance run.                                                                                                                                                                                                                |
| Phase 0, Phase 1, and Phase 2 verifiers remain green                                      | **Weak**    | The named scripts exist in `package.json`; phase receipts describe their intended coverage. Current CI runs `verify:evidence`, `verify:audit`, and `eval:offline`, but does **not** run `verify:phase-1` or `verify:phase-2`. No M4 receipt captures all phase gates on the audited commit.                                                                                                                                                                                                                                           |
| Every report fact maps to a claim, named policy, exact locator, and snapshot digest       | **Weak**    | `packages/report-compiler/test/compiler.test.ts` directly asserts a sentence trace containing claim ID, assessment ID, policy ID/version, locator, and digest. `packages/runtime/test/runtime.test.ts` also checks policy metadata and an exact byte-span locator. This is strong component/runtime evidence, but no black-box M4 verifier traverses every rendered fact in the produced dossier and validates its bindings against the persisted ledger/CAS.                                                                         |
| Unsupported, unresolved, contradicted, or expired claims cannot render as supported facts | **Weak**    | Compiler tests explicitly reject candidate and stale evidence, and the runtime fixture proves an unresolved claim is persisted but excluded. `evals/mvp/src/verify-fixture.ts` requires an unresolved or contradicted fixture claim, but that fixture validator does not execute report compilation. There is no explicit end-to-end contradicted-claim case, and no explicit compiler case for a claim whose status is `expired`; the existing stale-evidence test is related but not equivalent to the full four-state requirement. |
| Restart injection loses no state and duplicates no external side effect                   | **Weak**    | `packages/runtime/test/runtime.test.ts` injects interruption after `ledger_committed`, resumes using a fresh logical runtime, and asserts one evidence record and one queue receipt. Workflow and work-queue suites cover additional restart/idempotency windows. M1's contract requires forced restart at **each step**, while the composed M2 runtime exposes one tested interruption boundary; no black-box M4 matrix demonstrates every runtime stage or records artifact digests before and after recovery.                      |
| Budget exhaustion fails closed                                                            | **Weak**    | `packages/governance/test/budgets.test.ts` proves an over-budget reservation throws and creates denial audit events. The composed runtime initializes a fixed, zero-usage local budget, but has no input/configuration that drives a research program to exhaustion. There is no CLI/runtime M4 scenario proving the program fails closed, persists the denial, and avoids unsupported output/effects.                                                                                                                                |
| Cancellation emits an honest partial receipt                                              | **Proven**  | Runtime tests cancel after the ledger boundary and assert `publicationStatus: partial`, digests for completed artifacts, missing report/manifest/traces, terminal state, no repeat retrieval, and immutable ledger. Spawned-process CLI tests also cancel interrupted work, read the durable receipt, and verify repeated cancellation is idempotent. An M4 aggregate receipt is still absent, but the behavior itself has direct end-to-end coverage.                                                                                |
| Revalidation is scheduled for stale or volatile evidence                                  | **Missing** | `packages/governance/test/revalidation.test.ts` proves the standalone scheduler's lease and retry behavior. The composed runtime never calls `governance.revalidation.schedule`; its produced `governance.json` therefore has no acceptance-level schedule tied to stale or volatile evidence. No fixture charter declares volatility/freshness policy that drives scheduling.                                                                                                                                                        |
| CLI run, status, resume, cancel, and inspect behavior is covered end to end               | **Proven**  | `apps/cli/test/cli.test.ts` launches the built executable as new OS processes and covers all five commands, JSON and human output, error exits, traversal/symlink rejection, idempotent rerun, interrupted resume, and cancellation. `pnpm verify:m3` is the direct gate.                                                                                                                                                                                                                                                             |
| Artifacts remain readable after a new process starts                                      | **Proven**  | The spawned-process CLI suite runs `status` and `inspect` in brand-new processes and verifies receipt, ledger summary, executions, and report presence from durable disk state. Runtime restart tests independently reconstruct state from the program directory.                                                                                                                                                                                                                                                                     |
| README quickstart and known limitations match shipped behavior                            | **Missing** | The quickstart accurately lists the implemented CLI flow at a high level, but it is incomplete for acceptance: it does not use the checked-in runnable charter path, omits `resume` and `cancel` command examples, and the development gate list omits `format:check` and `verify:mvp`. There is no **Known limitations** section documenting local checked-in-file retrieval, deterministic proposals, fixed local budget behavior, lack of runtime revalidation scheduling, or explicitly deferred MVP scope.                       |
| Checkpoint is merged to default branch and CI is green                                    | **Missing** | The audited default branch is green at run `29133508489`, but it contains M3, not M4. The current M4 branch has no M4 changes or PR, so the acceptance checkpoint is not merged. Existing CI also omits phase-1, phase-2, M2, M3, and MVP verifier commands, meaning its green result is narrower than the checkpoint contract.                                                                                                                                                                                                       |

## Checkpoint and operating-loop requirements

| Checkpoint requirement                                                                                         | Status                              | Current evidence and finding                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One local deterministic research program runs end to end and emits an inspectable evidence-bound dossier       | **Proven**                          | M2 runtime tests execute the checked-in RFC 2606 fixture through retrieval, snapshots, parsing, claim proposal/assessment, persistence, compilation, manifest, traces, and receipts. M3 exposes and inspects the durable program directory. |
| Survives interruption with the same terminal state, no lost authoritative state, and no duplicated side effect | **Weak**                            | The tested `ledger_committed` interruption succeeds and lower-level packages test other durable boundaries. The requirement says restart at each step; the composed runtime does not provide a complete forced-restart matrix.              |
| Required repository verification ladder, including active-loop verifiers, passes and is recorded               | **Missing**                         | There is no single current receipt for `format:check`, lint, typecheck, test, build, evidence, audit, phase-1, phase-2, M2, M3, MVP, and offline evaluation. CI does not execute the latter five phase/M-stage gates.                       |
| Independent review attacks invariants and failure modes                                                        | **Weak**                            | M2 and M3 review documents exist and cover important issues. M4 has this audit and a separate security review assignment, but no completed M4 verifier result exists yet.                                                                   |
| Evaluation receipt records commits/PRs, exact tests, limitations, and next action                              | **Missing**                         | No M4 receipt exists. Existing receipts do not describe an M4 commit/PR, a clean-checkout command transcript, or final limitations.                                                                                                         |
| `MVP_PLAN.md` reflects proved reality                                                                          | **Proven (current incompleteness)** | The plan correctly leaves “Black-box MVP verification and clean-checkout receipt” unchecked and does not record the checkpoint. It must remain unchecked until the missing evidence above is produced and merged.                           |
| `v0.1.0-mvp` is ready to record only after every item passes                                                   | **Missing**                         | No acceptance verifier/receipt proves every item, M4 is not merged, and the current package version remains `0.0.0`. Recording the checkpoint now would contradict the plan.                                                                |

## README and CI audit

The README describes Phase 0–2, M2 runtime composition, and the M3 CLI without
obvious overclaiming. Its phrase “checked-in `sourcePath`” is directionally
correct, but the quickstart uses a nonexistent generic `./charter.json` instead
of the repository fixture and gives no copy/setup sequence for its relative
source file. A clean user cannot paste the documented commands and expect the
example to work. The README also has no known-limitations section, despite M4
requiring one.

CI's base quality ladder is sound and uses a frozen lockfile on Node 22. Its
acceptance coverage is insufficient because it stops after the Phase 0 aliases
and offline evaluation. A green CI badge therefore does not currently mean the
Phase 1, Phase 2, runtime, CLI, or M4 gates ran.

## Prioritized gaps

1. Add a deterministic `verify:mvp` harness and M4 receipt that run from a clean
   checkout and inspect generated artifacts rather than merely invoking existing
   unit tests.
2. Integrate stale/volatile evidence revalidation scheduling into the composed
   runtime and prove it in the black-box artifact set.
3. Add a runtime/CLI budget-exhaustion fixture that produces an auditable,
   durable fail-closed outcome with no unsupported dossier or duplicate effect.
4. Extend fail-closed report acceptance to explicit unsupported, unresolved,
   contradicted, and expired claim scenarios, including black-box trace
   validation for every rendered sentence.
5. Expand composed-runtime crash injection to every meaningful durable stage and
   compare terminal/artifact/receipt identity after each restart.
6. Update CI to execute phase-1, phase-2, M2, M3, and MVP gates; then capture the
   successful default-branch run in the receipt.
7. Make the README quickstart directly runnable and add accurate known
   limitations. Only after the M4 PR is merged and the expanded CI is green
   should `v0.1.0-mvp` be recorded.

## Verdict

**M4 is not complete at the audited commit.** Core M2/M3 behavior is substantial
and several acceptance behaviors are directly proven, but the mandatory M4
verifier, clean-checkout receipt, runtime revalidation and exhaustion scenarios,
README limitations, expanded CI gate, and merged checkpoint evidence are absent.

---

## Resolution addendum — implemented M4 worktree

This addendum re-audits the shared `feat/m4-mvp-acceptance` worktree after M4
implementation. The worktree is based on `734cf51` plus the unstaged M4 changes;
it is not yet merged to `origin/main`. On this exact worktree, the auditor ran
`pnpm verify:mvp` successfully. The command completed frozen-lockfile install,
format check, lint, typecheck, all tests, build, Phase 0 aliases, Phase 1, Phase 2,
M2, M3, and the independent spawned-process MVP verifier. The independent
verifier also passed when invoked directly.

### Prior-gap resolution

| Prior gap                                                            | Current status                                          | Current evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No `verify:mvp` or M4 receipt                                        | **Resolved locally**                                    | Root `package.json` defines the complete `verify:mvp` ladder. `evals/mvp-acceptance/src/verify.ts` launches the built CLI in clean temporary directories and `evals/mvp-acceptance/src/integrity.ts` independently validates durable artifacts without importing Mammoth packages. `evals/reports/v0.1.0-mvp.md` exists. Both the aggregate and direct verifier passed during this audit.                                                                                                                                                                                                               |
| No runtime revalidation schedule                                     | **Resolved**                                            | The runtime durably schedules each captured evidence artifact at snapshot time plus 24 hours. Runtime tests assert the exact schedule, and the independent verifier requires a scheduled item tied to ledger evidence with a due date later than receipt issuance.                                                                                                                                                                                                                                                                                                                                      |
| Budget exhaustion only had component evidence                        | **Resolved by required sub-gate, with a naming defect** | `verify:mvp` necessarily runs `verify:phase-2`; `packages/governance/test/budgets.test.ts` directly proves over-budget reservation denial, unchanged open reservation state, and denial audit events. The M4 helper named `invalidAndBudgetInputsFailClosed` does **not** exercise exhaustion—it adds an unsupported `budget` field and proves strict charter rejection. The receipt correctly attributes actual exhaustion proof to Phase 2, so the acceptance requirement is covered, but the helper name/comment should not be cited as exhaustion evidence.                                         |
| Unsupported/unresolved/contradicted/expired exclusion was incomplete | **Resolved across gates**                               | The independent verifier traverses every rendered sentence and rejects any binding whose claim or assessment is not supported; it also proves the runtime's unresolved claim is excluded and recorded in the manifest. The required Phase 1 gate now includes table-driven compiler tests for `candidate`, `unresolved`, `contradicted`, and `expired` claims plus stale evidence.                                                                                                                                                                                                                      |
| Restart coverage too narrow                                          | **Partially resolved / residual weakness**              | M4 spawns a fresh process after a post-receipt workflow interruption and compares snapshot and semantic digests plus exactly-one effect receipt. Runtime tests cover interruption after ledger commit and after receipt commit, while workflow/work-queue suites cover durable replay and provider idempotency. This proves the M4 restart bullet well. It still does not literally inject a fresh-process crash at every declared composed-runtime stage (`snapshot_committed`, `claims_assessed`, `ledger_committed`, `report_compiled`, `receipt_committed`) as M1's stricter exit wording requests. |
| CI omitted active gates                                              | **Resolved in workflow, pending remote proof**          | `.github/workflows/ci.yml` now invokes Phase 1, Phase 2, M2, M3, and independent MVP acceptance in addition to the base ladder. Because these changes are unmerged, no default-branch GitHub Actions run has executed this expanded workflow yet.                                                                                                                                                                                                                                                                                                                                                       |
| README was not paste-runnable and lacked limitations                 | **Resolved**                                            | The quickstart uses checked-in `examples/mvp-charter.json` and a stable program ID. The limitations section accurately states local JSON/CAS and workflow constraints, deterministic proposal behavior, parsing limits, integrity semantics, publication status, and deferred surfaces. One minor documentation omission remains: the prose mentions `resume` and `cancel`, but the command block demonstrates only run/status/inspect.                                                                                                                                                                 |
| No merged checkpoint evidence                                        | **Not resolved**                                        | `origin/main` remains at `6572008`; the M4 worktree changes are not merged and have no expanded-CI result. The receipt's “PR #6 — ... (this receipt)” is prospective rather than current evidence.                                                                                                                                                                                                                                                                                                                                                                                                      |

### Current acceptance verdict

The implemented M4 worktree **passes the complete local `pnpm verify:mvp` gate**
and materially satisfies the behavioral M4 acceptance matrix. The independent
artifact verifier is a strong improvement: it recomputes CAS and receipt digests,
checks every rendered provenance chain and exact locator, verifies exactly-once
effects and revalidation, exercises all CLI commands in new processes, validates
honest cancellation, and detects tampering.

The checkpoint itself is **not yet complete** because the explicit final
acceptance condition—merge to the default branch with CI green—has not happened.
The evaluation receipt must not describe PR #6 as delivered until the real PR is
merged, and the expanded default-branch CI run must be linked or identified as
the final proof. The coordinator should also decide whether M1's literal
“restart at each step” wording requires adding the remaining stage-injection
matrix before merge; current coverage proves multiple critical crash windows but
not every declared stage.
