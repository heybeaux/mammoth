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

The next valid task is either:

1. add a P9 live-readiness authority gate that proves explicit credential and
   billing authorization without performing effects; or
2. after explicit authorization exists, run the frozen T6 live exhibition and
   record the exact bundle, independent editorial and entailment audits, cost,
   latency, failures, code/security review, tag, release receipt, and final
   receipt-bearing main CI.
