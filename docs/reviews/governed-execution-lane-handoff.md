# Governed execution lane — handoff

Lane: `feat/core-query-governed-execution` (worktree base `b0c9c72`).
Scope: governed no-effect execution of released acquisition intents, offline
fixture authority issuer, reader/audit bundle composition, and the
`mammoth investigate --execute` operator path.

## What this lane adds

- `packages/runtime/src/investigate-offline-authority.ts` — offline fixture
  issuer (`offline-fixture-issuer/v1`). Deterministically mints a schema-valid
  `P9LiveAuthorityReceipt` bound to the exact plan digest and question. Origins
  use the reserved `.invalid` TLD; the issuer is never trusted by default and
  only becomes usable when the operator explicitly pins it.
- `packages/runtime/src/investigate-governed-execution.ts` — fail-closed
  executor. `verifyExecutionAuthority` re-verifies the release decision, intent
  set/plan/question digest bindings, pinned issuer, authority↔release receipt
  binding, validity window, and required effect kinds before any adapter is
  touched. Execution is three phases: plan-bound discovery with typed rejected
  hints; per-intent retrieval → deterministic parsing → immutable snapshots →
  bounded span derivation → claim proposal → independent entailment evaluation →
  admission with typed rejection residue; falsification probes adjudicated to
  residue. Refuses with `no_admissible_evidence` when nothing is admitted.
- `packages/runtime/src/investigate-offline-sources.ts` — operator-declared
  offline source catalog validated by schema; builds strictly no-effect
  search/retrieval adapters. Retrieval only ever returns declared bytes.
- `packages/runtime/src/investigate-reader-bundle.ts` — composes the reader +
  audit bundle. Reader report contains only verbatim admitted evidence with
  numeric citations; a forbidden-pattern gate refuses any leak of audit
  internals; refuses to compose without renderable admitted evidence or without
  rejection residue; every artifact is digest-chained into
  `execution-receipt.json`.
- `apps/cli/src/investigate-operator.ts` — new `--execute` path: question →
  preview → recorded approval (explicit `--approve` required) → immutable plan →
  derived intents → offline fixture authority → release evaluation (issuer only
  via explicit `--trusted-issuer`) → governed execution → bundle files. Refused
  releases write refusal artifacts and execute nothing. `--plan` path also
  gained `--trusted-issuer`.

## Invariants preserved

- No topic branching anywhere; all subjects derive from the digest-bound plan.
- No network, provider, or paid effect on any path; e2e runs with poisoned
  provider keys in the environment.
- Authorization is never implicit; unpinned or wrong issuer refuses closed.
- Models propose, deterministic code validates; proposer and evaluator profiles
  are independent for every adjudicated claim.
- Rejected work is preserved as typed residue, never repaired or hidden.

## Verification (all green at this head)

- `pnpm --filter @mammoth/runtime test` — 139/139
- `pnpm --filter @mammoth/cli test` — 52/52 (requires
  `pnpm --filter @mammoth/temporal-adapter build` in a fresh worktree)
- `pnpm --filter outcome-1-acceptance test` and `test:harness` (now includes
  `governed-execution-e2e.ts`: arbitrary question through the public CLI,
  frozen outcome-1 bundle verifier, unpinned/wrong-issuer negative paths)
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build`
- `pnpm verify:p8`, `pnpm verify:p9`

## Review notes

Builder agent terminated mid-lane; the coordinator completed verification,
fixed a lint violation in `investigate-reader-bundle.ts` (destructuring guard
instead of non-null assertion), and independently reviewed every file and test
before integration.
