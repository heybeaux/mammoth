# `@mammoth/runtime`

Thin local composition for the MVP evidence-first loop. It accepts a pinned
charter and an injected retrieval transport, then durably executes retrieval,
snapshotting, deterministic location, claim proposal validation, named-policy
assessment, ledger persistence, and report compilation.

Unsupported proposals remain `unresolved`, are recorded in the ledger and report
manifest, and never appear as supported prose. Runtime state, CAS objects,
governance state, queue receipts, the report, traces, manifest, and completion
receipt are written beneath the program directory.

## Operator API

- `runResearchProgram` starts a charter or replays an interrupted execution.
- `getResearchProgramStatus` projects durable workflow and operator state without
  executing work.
- `resumeResearchProgram` resumes only an interrupted program, loading its
  original charter from durable workflow input.
- `cancelResearchProgram` writes a terminal cancellation marker and an
  idempotent partial receipt listing both completed and missing artifacts.
- `inspectResearchProgram` reports artifact presence, execution history, receipt
  data, and ledger counts without treating that projection as authoritative.

Cancellation is terminal: subsequent run and resume calls fail with
`PROGRAM_CANCELLED`, and pipeline stage boundaries check the durable marker before
performing later work. Completed artifacts are retained. Missing programs and
ineligible resumes fail with stable `PROGRAM_NOT_FOUND` and
`PROGRAM_NOT_RESUMABLE` codes.

The transport, resolver, clock, and root directory are injected. Retrieved input
is hostile and still passes through `@mammoth/retrieval` policy checks. Run tests
with `pnpm --filter @mammoth/runtime test`.
