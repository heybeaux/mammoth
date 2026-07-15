# P9 T6 live authority audit

This audit records the first T6 coordination step after PR #70 merged. It is not
a live exhibition receipt and does not authorize any metered provider call.

## Snapshot

- Audit time: 2026-07-15T16:31:33Z.
- Worktree: `/private/tmp/mammoth-p9-t6-live-authority`.
- Branch: `feat/p9-t6-live-authority`.
- Base: `fe0c96f646d6a5821a43dff814affe53dadf621e`.
- Merge proof: PR #70 merged as `fe0c96f646d6a5821a43dff814affe53dadf621e`.
- Exact merged-main CI: GitHub Actions run `29432359193` passed at
  `fe0c96f646d6a5821a43dff814affe53dadf621e`.

## Authority requirements

`P9_PLAN.md` T6 requires one separately authorized non-data-center live
exhibition before release. The verification section also requires explicit
credential and billing authorization for live exhibitions, plus exact
provider/model/configuration/cost/latency/failure evidence.

`LOOP.md` escalates new credentials or billing. It also says release work cannot
certify missing composition and that green slices are not P9 completion.

## Observed local state

- Repository search found no P9 live-exhibition authorization artifact.
- `printenv | rg '^MAMMOTH_(P9|P8|SEARCH|OPENAI|PROVIDER)'` returned no
  variables in this process.
- The only CLI live-readiness gate found is P8-specific:
  `apps/cli/src/p8-operator.ts` checks `MAMMOTH_P8_LIVE_RESEARCH`,
  `MAMMOTH_SEARCH_BRAVE_API_KEY`,
  `MAMMOTH_SEARCH_BRAVE_BILLING_AUTHORIZATION`,
  `MAMMOTH_P8_PROVIDER_BASE_URL`, and `MAMMOTH_P8_PROVIDER_MODEL`.
- No P9-specific live operator or P9-specific billing authorization variable was
  found in the current codebase.
- `gh pr list --repo heybeaux/mammoth --state open` returned no open PRs at audit
  time.

## Decision

T6 is unblocked past the T5 merge/CI prerequisite but blocked before live effects.
No P8 credential, P8 billing flag, prior live exhibition, or offline verifier
result is treated as P9 live authority.

## Offline preparation update

After merged-main CI `29433309477` passed at
`21513a22a03cbfdd329f18ecc91ba0dfd4e56654`, the offline-prep candidate
`/private/tmp/mammoth-p9-t6-continue` preserved the remaining valid
manifest-level factual-grounding hardening and added a P9-specific live authority
gate. The gate checks only local environment/configuration state and performs no
search, provider, billing, tag, release, or network effect.

Required P9 authority inputs are distinct from P8 authority:

- `MAMMOTH_P9_LIVE_RESEARCH=authorized`;
- `MAMMOTH_P9_LIVE_BILLING_AUTHORIZATION=authorized`;
- positive finite `MAMMOTH_P9_LIVE_BUDGET_USD` no greater than US$5;
- `MAMMOTH_SEARCH_BRAVE_API_KEY`;
- `MAMMOTH_P9_PROVIDER_BASE_URL`;
- distinct `MAMMOTH_P9_PROPOSER_MODEL` and
  `MAMMOTH_P9_EVALUATOR_MODEL` identities;
- `MAMMOTH_P9_PROVIDER_API_KEY_ENV` naming a populated provider key variable.

Local evidence at this candidate:

- `pnpm install --frozen-lockfile` PASS;
- `pnpm --filter @mammoth/domain test -- p9-execution.test.ts` PASS;
- `pnpm --filter @mammoth/runtime test` PASS;
- `pnpm --filter @mammoth/cli test -- p9-live-authority.test.ts` PASS;
- `pnpm --filter @mammoth/cli typecheck` PASS;
- `pnpm format:check` PASS;
- `pnpm lint` PASS;
- `pnpm typecheck` PASS;
- `pnpm test` PASS;
- `pnpm build` PASS;
- `pnpm verify:p2` PASS after setting a short local
  `MAMMOTH_PROFILE_ROOT=/tmp/mmp2-p9t6`, local test `MAMMOTH_PG_PASSWORD`, and
  `MAMMOTH_PG_PORT=55442`;
- `pnpm verify:p3` PASS;
- `pnpm verify:p4` PASS;
- `pnpm verify:p5` PASS;
- `pnpm verify:p6` PASS;
- `pnpm verify:p7` PASS;
- `pnpm verify:p8` PASS;
- `pnpm verify:p9` PASS with
  `T6 live_authority_gate=pass blocked_pending_authorization`.

Beaux explicitly supplied P9 live authority on 2026-07-15 for the existing
Brave/model-provider credentials with a hard maximum spend of US$5. That clears
the human authorization predicate but does not permit effects until the complete
environment gate passes at the actual effect boundary.

The next valid task is:

1. finish review/CI/merge of the offline-prep gate and live application; then
2. run the frozen T6 live exhibition and
   record the exact bundle, independent editorial and entailment audits, cost,
   latency, failures, code/security review, tag, release receipt, and final
   receipt-bearing main CI.
