# Initial MVP evaluation receipt

> Status: clean-checkout gate passed; pending merge and default-branch CI
>
> Checkpoint: `v0.1.0-mvp`
>
> The complete ladder passed from a detached clean checkout of revision
> `26a5a6e`. Default-branch completion remains an external merge/CI gate.

## Criterion

Mammoth must run one local, deterministic, evidence-first research program end
to end, survive a fresh-process pause/resume boundary, fail closed under denied
budget and unsupported evidence, and emit an inspectable dossier whose factual
sentences resolve through named policy assessments and exact locators to pinned
immutable source bytes.

## Deterministic oracle

- Fixture: `evals/fixtures/mvp/fixture.json`
- Supported claim: `claim:example-com-reserved`
- Unresolved and excluded claim: `claim:example-com-https-guarantee`
- RFC source digest:
  `sha256:02950ec26917b3cf2f613fd1ec16b4d2f8fd376fb9b3aa3e72f881d9d8ecc331`
- Hostile-source digest:
  `sha256:e934e0c8cedcfc674bad1ad7757a33614b024714028a18a6f374acb5c5d01ce8`
- The release gate uses checked-in bytes through the CLI's pinned fixture
  transport. It does not depend on live network content.

## Final verification ladder

Run exactly:

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
pnpm eval:offline
pnpm --filter @mammoth/mvp-fixture verify
pnpm verify:mvp
```

Record results:

| Gate                           | Result  | Evidence                                            |
| ------------------------------ | ------- | --------------------------------------------------- |
| Frozen install                 | pass    | pnpm 8.15.6; lockfile SHA-256 `b3243286…c898`       |
| Formatting                     | pass    | `pnpm format:check`                                 |
| Lint                           | pass    | `pnpm lint`                                         |
| Typecheck                      | pass    | `pnpm typecheck` across 13 workspace projects       |
| Unit/integration tests         | pass    | 116 tests across package and acceptance suites      |
| Build                          | pass    | `pnpm build`; bundled Node 22 CLI produced          |
| Phase 0 evidence/audit/offline | pass    | cases=4, checks=7                                   |
| Phase 1                        | pass    | 21 tests                                            |
| Phase 2                        | pass    | 31 tests plus 10 repeated workflow-concurrency runs |
| Fixture oracle                 | pass    | pinned RFC and hostile-source digests verified      |
| Black-box MVP                  | pass    | 14 fresh-process, security, and integrity checks    |
| Default-branch CI              | pending | merge revision and workflow URL                     |

## Black-box evidence required

`pnpm verify:mvp` must launch `node apps/cli/dist/bin.js` in a fresh child process
for every operator command and independently verify:

- bounded run, durable status, fresh-process resume, completion, and inspection;
- supported and unresolved claims remain distinct;
- every report sentence trace resolves to a claim, assessment, named policy and
  version, claim-evidence edge, exact locator, and immutable snapshot digest;
- raw and parsed CAS bytes reproduce their declared SHA-256 digests;
- manifest, traces, dossier, ledger, assessments export, and completion receipt
  agree, and receipt integrity detects tampering;
- audit events are contiguous, hash-chained, checkpointed, complete, and exposed
  through the CLI;
- a completed rerun does not duplicate retrieval or side-effect receipts;
- denied budget invokes transport zero times and leaves an honest durable denial;
- volatile evidence creates a durable revalidation schedule;
- cancellation persists an integrity-bearing partial receipt naming completed
  and omitted stages and emits no false completion dossier or receipt;
- arbitrary operator-supplied verifier strings cannot promote a claim without
  the trusted deterministic verifier contract;
- artifacts remain readable by a later process.

## Current limitations and pending evidence

The current working-tree black-box verifier proves built-CLI run/pause/resume,
artifact traces, raw and parsed CAS digests, completion and cancellation receipt
integrity, sequenced audit projection, idempotent rerun, budget exhaustion before
transport, durable revalidation, verifier-authority spoof rejection, and explicit
tamper rejection.

The complete clean-checkout ladder and root verifier now pass. Final acceptance
remains pending only until this integration branch is merged and its
default-branch CI run is green.

Do not record `v0.1.0-mvp`, tag a release, or report the checkpoint complete while
any row or limitation above remains pending.

## Final checkpoint metadata

Fill only after all gates pass:

```text
revision: 26a5a6e5eb793bfa5b30715eba9623a308720a55
pull requests: #1-#9 merged; final hardening PR pending
verified at: 2026-07-10 18:28 America/Vancouver
node: v22.22.2
pnpm: 8.15.6
lockfile digest: b3243286d7838fdc85a80741691f0fb1c2230151c6a7654f3b9de58d77a0c898
CLI artifact root: ephemeral verifier output (or retained failure path)
known deferred scope: Parliament, novelty, experiment runner, stack adapters,
desktop observatory, hosted API, pipelines SDK, hosted multi-tenancy
```
