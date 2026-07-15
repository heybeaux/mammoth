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

The historical local evidence list for this candidate was summary-only and is
not release evidence. It is superseded by the exact code-bearing PR #75 CI
records and the active coordinator ledger, which must name exact commands,
exit status, digest or immutable CI run, and review disposition before any
effect boundary opens.

Scoped human authorization receipt locator:

- Receipt locator: `telegram:agent:scout:direct:8274834197:2026-07-15T10:29:00-07:00`.
- Actor: Beaux.
- Authorization time: 2026-07-15T10:29:00-07:00.
- Maximum authorized spend: US$5 hard cap.
- Covered credentials/providers: existing Brave Search credential and existing
  OpenRouter/OpenAI-compatible model-provider credential only.
- Permitted effect boundary: exactly one P9 T6 Colibri live exhibition after
  code-bearing PR exact-head CI, independent review, merge, fresh main CI, and
  runtime P9 authority gate all pass with the same budget and distinct
  proposer/evaluator profile families.
- Explicit non-authority: P8 flags, offline fixture verification, green local
  tests, and this audit do not authorize metered live effects.

The next valid task is:

1. finish review/CI/merge of the offline-prep gate and live application; then
2. run the frozen T6 live exhibition and
   record the exact bundle, independent editorial and entailment audits, cost,
   latency, failures, code/security review, tag, release receipt, and final
   receipt-bearing main CI.
