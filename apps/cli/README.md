# `@mammoth/cli`

Local MVP operator commands:

```text
mammoth run <charter.json> [--root PATH] [--json]
mammoth status <program> [--root PATH] [--json]
mammoth resume <program> [--root PATH] [--json]
mammoth cancel <program> [--root PATH] [--json]
mammoth inspect <program> [--root PATH] [--json]
```

The input document is strict JSON with `schemaVersion`, `charter`, and an
`verifications` map keyed by claim ID. It may include a
`sourceFixture` containing a relative `path`, pinned SHA-256 `digest`, and media
type. The CLI copies and pins that explicitly named read-only source; its
transport serves it only for the charter URL. Missing and negative verifications
fail closed to unresolved claims.

For the initial MVP, the CLI does not treat arbitrary operator-supplied verifier
strings as evidence authority. A positive support verdict is accepted only when
the source digest, URL, policy, criterion, claim text, exact quote, locator, and
verifier identity exactly match the checked RFC 2606 fixture oracle. Every other
positive verdict fails with `UNTRUSTED_ENTAILMENT`. General verifier plugins and
governed human attestations are deliberately deferred.

The operator document may pin `charter.budgetLimit`,
`charter.sourceRevalidateAfter`, and a top-level `retrievalUsage` containing
strict non-negative `estimated` and `actual` cost, token, and duration values.
These are forwarded unchanged to the runtime. `status` reports the durable
`revalidation.json` artifact and `inspect` exposes its schedule projection.

`--max-steps N` stops after N distinct durable runtime stage receipts and records
the execution as paused. `status` and `inspect` are read-only durable
projections. `cancel` uses the workflow store's atomic cancellation transition.
`resume` resumes paused work or delegates failed work to the runtime's stable
replay behavior; cancelled and completed executions are not resumable.
Cancellation writes `cancellation-receipt.json`, including an integrity hash,
completed and omitted stages, timestamps, reason, and captured workflow state.
`inspect` exposes that receipt and the runtime `audit.json` chain.

Set `MAMMOTH_WORKFLOW_BACKEND=temporal` to route the existing `run`, `status`,
`resume`, `cancel`, and `inspect` commands through the Temporal research-program
client. Each invocation establishes its own Temporal connection and addresses a
stable workflow ID derived from the charter program ID plus
`MAMMOTH_CRITERION_VERSION` and `MAMMOTH_BRANCH_ID` (defaulting to
`criterion-v1` and `main`). Temporal-backed bounded `--max-steps` execution is
rejected explicitly rather than silently changing its semantics.

## P9 plan-first research application

P9 adds a separate, plan-first operator surface while preserving the P8
`research ask` behavior:

```text
mammoth research plan "QUESTION" --proposal proposal.json --output ./research/slug
mammoth research preview ./research/slug
mammoth research accept ./research/slug [--actor ID]
mammoth research revise ./research/slug --proposal revision.json [--actor ID]
mammoth research run ./research/slug/research-plan.json [--output PATH]
mammoth research inspect ./research/slug/run
mammoth research doctor --p9
```

`plan` persists the strict typed proposal and deterministic preview; it does not
pretend locally supplied JSON is accepted authority. `accept` writes the immutable
plan and acceptance receipt only after deterministic policy validation. Rejected
revisions remain separate and cannot replace the currently accepted plan chain.

The explicitly labelled `--offline-corpus PATH` run mode composes the frozen P9
fixture runtime and exact-bundle verifier without network or paid effects. A live
run fails before invoking any adapter unless all P9-specific authorization,
search/model credentials, search/model billing authority, an immutable complete
price catalog, an accepted plan, and distinct proposer/evaluator profile families
are present. The repository does not ship a live P9 executor yet, so the normal
binary also reports `live_executor_unavailable` rather than falling back to P8 or
inventing authority.
