# Mammoth P7 Live Research Loop Handover

> Handover baseline: `main` at P6 receipt merge
> `337b76c4ba2170fdd6e2c32db8e0b3e812c74090`
>
> Proven code baseline: `v0.6.0-research-topology`, code-bearing merge
> `6685f193c3c2669f5cd8da8b46c78b7ffeeabf40`
>
> Status: P6 complete; P7 acceptance contract not yet frozen

## Read this first

Mammoth is a verified research operating-system kernel. It can plan, persist,
schedule, recover, synthesize, and project a deterministic multi-cell topology,
but it is not yet a turnkey live-research product. P7 should close that exact gap:
connect the proven P6 topology to governed model work and an operator entry point.

Do not start provider, CLI, workflow, or persistence implementation from this
handover alone. The first P7 deliverable is a distinct `P7_PLAN.md` entry PR that
freezes scope and acceptance. Once merged, recreate or resync every implementation
worktree from that plan baseline.

Authoritative reading order:

1. `AGENTS.md` and `LOOP.md`.
2. `P6_PLAN.md` and `evals/reports/v0.6.0-research-topology.md`.
3. `POST_MVP_ROADMAP.md`, especially P7.
4. `ARCHITECTURE.md` sections 6, 10-18, 22-24, 27-33, 38, and 40-44.
5. `docs/OBSERVATORY.md` for projection work.
6. The public contracts and tests in `packages/domain`, `packages/workflow`,
   `packages/work-queue`, `packages/governance`, `packages/temporal-adapter`,
   `packages/persistence`, `packages/postgres-adapter`, `packages/report-compiler`,
   `packages/observatory-projection`, and `apps/cli`.

## What is in our hands

- P2: authoritative Postgres/CAS data plane, migrations, lifecycle, backup, and
  production-profile gates.
- P3: Temporal control plane with deterministic workflows, typed Activities,
  cancellation, replay, bounded history, and local recovery evidence.
- P4: immutable research-cell and model-lineage contracts with correlation-aware
  admission and self-review rejection.
- P5: commit-before-reveal divergence, blind review, preserved dissent and residue,
  authoritative cell budgets, and honest partial cancellation.
- P6: versioned landscape, divergence, prior-art, falsification, experiment, and
  synthesis templates; deterministic topology planner/scheduler; topology budgets
  and persistence; Temporal parent/child execution; evidence-aware synthesis; and
  read-only topology projection.
- A full clean-checkout ladder through `pnpm verify:p6`, enforced in CI.

The P6 receipt is the exact proof. Prose, test names, and worker confidence do not
expand its claims.

## The gap P7 must close

Today, P6 live Activities execute deterministic boundary receipts, not actual
research workers backed by model providers. The MVP CLI does not expose a P6
topology entry point. There is no hosted API, managed deployment, or full
Observatory product UI.

P7 should deliver one narrow vertical loop:

```text
operator request
  -> validated charter and frozen topology plan
  -> governed provider-neutral model work item
  -> idempotent Temporal Activity and provider/effect receipt
  -> typed observation/proposal artifacts in CAS
  -> deterministic claim/evidence/policy admission
  -> preserved review, dissent, failure, and budget state
  -> evidence-bound dossier and read-only projection
```

The model is a worker, never the authority. A polished response, model agreement,
or successful provider call cannot promote a claim.

## Decisions the P7 plan must freeze

Do not let these emerge accidentally in code:

- P7 release label and exact baseline.
- Operator surface: extend the CLI first, or introduce an application service with
  CLI as its initial adapter. Do not make the CLI authoritative.
- Provider-neutral request/result/error schemas and their versioning.
- Model-profile resolution, alias pinning, provider capability discovery, and
  fail-closed startup behavior.
- The first reference adapter and whether it is local, cloud, or OpenAI-compatible.
  Offline deterministic stubs are mandatory regardless.
- Secrets injection, cloud-egress policy, data classification, tool mounting,
  provider allowlists, and raw-output retention/redaction boundaries.
- Stable IDs for model work, provider attempts, raw artifacts, usage/cost,
  cancellation, and completed effect receipts.
- Retry classification for timeout, rate limit, malformed output, policy denial,
  provider outage, and ambiguous delivery.
- Budget reservation/settlement rules for tokens, currency, wall time, and tool
  use, including duplicate delivery and partial cancellation.
- Typed output conversion and which deterministic service may validate/commit each
  proposed mutation.
- P7 migration start after P6 migration `7`, if new authoritative state is needed.
- Offline verifier gates, live exhibition protocol, receipt schema, and stopping
  predicates.

Any change to authority, privacy, deployment, or provider-data handling requires
an ADR before implementation integration.

## Recommended delivery lanes

Keep one coordinator slot free. Prove one bounded worker route end-to-end before
fan-out, and give each worker path-disjoint ownership.

### Lane A — model-work contracts and conformance

Own provider-neutral schemas, model-profile resolution, capability negotiation,
typed results/errors, canonical identities, and deterministic conformance fixtures.
Keep provider SDKs, HTTP, secrets, and databases out of `packages/domain`.

### Lane B — governed provider Activity and authoritative receipts

Own the first adapter, Activity boundary, egress decision, idempotency, raw CAS
artifacts, usage/cost receipts, budget lifecycle, retry classification, and any
forward-only migration. Provider output writes proposals only.

### Lane C — topology application service and operator entry

Own the application port that starts/resumes/cancels/inspects a P6 topology and
the CLI adapter over it. Reuse stable P6 topology/workflow IDs. Do not import
Postgres or Temporal internals into the CLI.

### Lane D — acceptance, projection, and independent attack

Own fail-closed projection extensions, adversarial fixtures, `verify:p7`, CI
visibility, and independent review. The reviewer must not author implementation
changes and must re-review every blocking fix.

## Minimum adversarial cases for the P7 plan

- provider alias resolves to a different concrete model after dispatch;
- unknown or unsupported provider capability;
- malformed, truncated, oversized, or schema-incompatible output;
- prompt-injection content attempts tool, secret, policy, or authority escalation;
- cloud egress denied by classification or missing policy;
- secret appears in prompt, log, raw artifact, projection, or receipt;
- provider timeout, rate limit, outage, ambiguous delivery, and late response;
- duplicate dispatch before call, during call, after response, and after receipt;
- token/currency budget exhaustion before dispatch and mid-topology;
- cancellation before call, during call, after response before commit, and during
  settlement;
- model-profile, criterion, work-item, tool-contract, or prompt digest drift;
- provider output attempts to introduce an unreferenced factual dossier sentence;
- unsupported agreement and correlated consensus remain non-authoritative;
- worker, client, process, and local Temporal service restart at durable boundaries;
- raw-output/CAS digest corruption, future authority, broken projection reference,
  and reconstruction from Postgres/CAS;
- an offline end-to-end loop that returns a partial dossier honestly when one cell
  fails or is cancelled.

Fixtures must call production-shaped public boundaries. A manifest or verifier
that reimplements the production logic is not evidence.

## Verification contract to carry forward

P7 must keep every existing gate independently runnable:

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
pnpm verify:adapters
pnpm verify:m2
pnpm verify:m3
pnpm verify:mvp
pnpm verify:p2
pnpm verify:p3
pnpm verify:p4
pnpm verify:p5
pnpm verify:p6
pnpm verify:p7
pnpm eval:offline
```

`verify:p7` does not exist yet. The P7 plan must define it as a non-recursive
wrapper around code-owned gates and require a visible default-branch CI step.
Provider-dependent calls must not enter offline CI. A live run records the concrete
provider/model, date, prompt and contract digests, seed where available, usage,
cost, raw artifacts, failures, and limitations, and remains an exhibition unless
a replicated protocol says otherwise.

## Known traps

- Do not turn Temporal history into product state; reconstruct from Postgres/CAS.
- Do not let provider SDK types leak into domain or application contracts.
- Do not record a provider alias where a concrete version/checkpoint is required.
- Do not charge twice after ambiguous delivery; stable effect identity and receipt
  lookup happen before a retry.
- Do not store secrets in prompts, logs, artifacts, receipts, fixtures, or Git.
- Do not let the CLI, projection, model memory, consensus, or raw model output
  become authoritative.
- Do not weaken P2-P6 verifier commands to make P7 pass.
- Regenerate `pnpm-lock.yaml` after workspace dependency changes and prove a clean
  frozen install; warm worktrees can hide missing builds or stale dependencies.
- Keep the established P2 lifecycle/backup gates independent from Temporal and P7.
- A prepared worktree or accepted delegation is not proof of an active worker.

## First concrete move

Create a clean worktree from current `origin/main`, verify the P6 receipt and
default-branch CI, inspect existing model/profile and Activity seams, then draft
`P7_PLAN.md`. The entry PR should contain contracts and acceptance only—not
provider implementation. Require independent adversarial review of the plan,
merge it, resync implementation worktrees, and only then begin the smallest
vertical slice.

Do not deploy on Friday.
