# `@mammoth/runtime`

Thin local composition for the MVP evidence-first loop. It accepts a pinned
charter and an injected retrieval transport, then durably executes retrieval,
snapshotting, deterministic location, claim proposal validation, named-policy
assessment, ledger persistence, and report compilation.

Unsupported proposals remain `unresolved`, are recorded in the ledger and report
manifest, and never appear as supported prose. Runtime state, CAS objects,
governance state, queue receipts, the report, traces, manifest, and completion
receipt are written beneath the program directory.

The transport, resolver, clock, and root directory are injected. Retrieved input
is hostile and still passes through `@mammoth/retrieval` policy checks. Run tests
with `pnpm --filter @mammoth/runtime test`.
