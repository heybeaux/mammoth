# P3 Lane A Temporal Lifecycle Handoff

Date: 2026-07-11

## Scope

Implemented the P3 T1 foundation for a Temporal workflow-orchestrator adapter
without moving product authority out of Postgres/CAS.

Owned changes:

- `packages/temporal-adapter`
- `packages/adapter-contracts`
- `packages/production-profile`
- `docs/OPERATIONS.md`
- `infra/production-profile.env.example`
- `pnpm-lock.yaml`

## Design Decisions

- Added a new `workflow-orchestrator` adapter kind under contract major `1`.
- Kept the existing local `workflow-store` contract separate so Temporal history
  cannot become Mammoth's product state store.
- Published the Temporal capability set for workflow history, signals, queries,
  timers, retries, versioning, `continueAsNew`, namespace readiness, task-queue
  readiness, durable restart, cancellation, and health reporting.
- Implemented fail-closed startup through descriptor compatibility plus explicit
  service, namespace, and task-queue readiness checks.
- Used the Temporal CLI `server start-dev` lifecycle for local/CI-compatible
  infrastructure, with no managed Temporal account and no embedded credentials.

## Verification

Passed:

- `pnpm install --frozen-lockfile`
- `pnpm --filter @mammoth/adapter-contracts test`
- `pnpm --filter @mammoth/temporal-adapter test`
- `pnpm --filter @mammoth/production-profile test`
- `pnpm typecheck`
- `pnpm build`
- `pnpm test`
- `pnpm lint`
- `pnpm format:check`
- `pnpm verify:adapters`
- `MAMMOTH_PG_PASSWORD=temporary-p3-secret MAMMOTH_PROFILE_ROOT=/tmp/mammoth-p3-lane-a-profile pnpm verify:p2`

Observed but expected:

- `pnpm verify:p2` without `MAMMOTH_PG_PASSWORD` failed closed at the production
  profile lifecycle and backup gates because no credential is embedded or
  defaulted.
- `command -v temporal` returned no binary in this worktree environment, so live
  Temporal service startup was not exercised here.

## Integration Risks

- The Temporal dev lifecycle requires the operator/CI image to provide a
  compatible `temporal` CLI binary before live service startup gates can run.
- The task-queue readiness probe requires a visible Temporal task queue; later P3
  worker slices must start pollers before claiming the full T1/P3 live gate.
- No workflow definitions, Activities, replay harness, or Observatory Temporal
  linkage were added in this lane.
