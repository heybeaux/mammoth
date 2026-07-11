# Initial MVP evaluation receipt

> Status: pending final clean-checkout gate
>
> Checkpoint: `v0.1.0-mvp`
>
> This document is an evaluation receipt template, not a declaration that the
> checkpoint has passed. Replace each pending result with exact command output
> only after running the final ladder from a clean checkout on the default branch.

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

| Gate                           | Result                           | Evidence                                               |
| ------------------------------ | -------------------------------- | ------------------------------------------------------ |
| Frozen install                 | pending                          | command output and lockfile digest                     |
| Formatting                     | pending                          | `pnpm format:check`                                    |
| Lint                           | pending                          | `pnpm lint`                                            |
| Typecheck                      | pending                          | `pnpm typecheck`                                       |
| Unit/integration tests         | pending                          | test file and test counts                              |
| Build                          | provisional pass on working tree | `pnpm build`                                           |
| Phase 0 evidence/audit/offline | pending                          | verifier output                                        |
| Phase 1                        | pending                          | verifier output                                        |
| Phase 2                        | pending                          | verifier output                                        |
| Fixture oracle                 | pending                          | one-line JSON result                                   |
| Black-box MVP                  | provisional pass on working tree | `{"ok":true,"verifier":"mammoth-mvp-blackbox-v1",...}` |
| Default-branch CI              | pending                          | workflow run URL and revision                          |

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

Final acceptance remains pending until those provisional results survive the
complete clean-checkout ladder, the verifier is wired to the root command, all
results are merged, and default-branch CI is green. The table above must then be
updated with exact test counts, revision, and CI evidence.

Do not record `v0.1.0-mvp`, tag a release, or report the checkpoint complete while
any row or limitation above remains pending.

## Final checkpoint metadata

Fill only after all gates pass:

```text
revision: pending
pull requests: pending
verified at: pending
node: pending
pnpm: pending
lockfile digest: pending
CLI artifact root: ephemeral verifier output (or retained failure path)
known deferred scope: Parliament, novelty, experiment runner, stack adapters,
desktop observatory, hosted API, pipelines SDK, hosted multi-tenancy
```
