# v0.1.0 MVP acceptance receipt

## Checkpoint predicate

`pnpm verify:mvp` composes the Phase 0, Phase 1, Phase 2, M2 runtime, M3 CLI,
and M4 black-box gates. The final black-box process runs the checked-in quickstart
charter through the built CLI in a fresh temporary program root, then starts new
CLI processes for `status` and `inspect` and reads the durable artifacts directly.

The gate asserts that the supported claim has a named assessment, the unsupported
claim remains unresolved and absent from dossier prose, the manifest preserves the
unresolved issue, and the terminal receipt binds the immutable snapshot digest.
Phase 2 and runtime tests within the composed command cover restart, retry,
lease expiry, idempotent external effects, budget exhaustion, cancellation,
revalidation, and durable recovery. M3 covers all five operator commands and
fresh-process readability.

## Release verification

The CI job runs frozen-lockfile installation, format check, lint, typecheck, tests,
build, evidence and audit verification, offline evaluation, and `verify:mvp` from
a clean GitHub checkout. The checkpoint is ready only when that job is green on
the default branch; a green feature-branch run is evidence but not completion.

Known limitations and the deterministic demo command are maintained in `README.md`.
The broader architecture items explicitly deferred in `MVP_PLAN.md` are not part
of this receipt.
