# P9 T5 review-remediation evidence

This immutable repository snapshot records the evidence used to reconcile the
16 actionable CodeRabbit findings on PR #68. It does not claim independent
review approval or exact-head CI; those remain external merge gates.

## Candidate and runtime identity

- PR: <https://github.com/heybeaux/mammoth/pull/68>
- Reviewed head: `50596212634ecfbd7eabb3d0ce01c763e8dece1c`
- Remediation commits: `e679d129ead3459166ec9c2e58fcab43cccb6508`,
  `0c18531`, `a5bf21cf9a16b4db82af8474e49c64dcebe3fc0e`
- Durable T5/T6 coordinator session:
  `agent:scout:subagent:acb0ab44-1153-4ce8-86b3-131f2c9b23d5`
- Initial coordinator run: `570424fd-2fe3-4686-ad56-3c00cf4db71c`
- Review-remediation restart run: `e73860fa-989a-4999-b5ea-52801a195193`
- Recorded coordinator model: `openai-codex/gpt-5.5`
- Focused review-fix worker: Codex-native task `/root/p9_t5_review_fix`.
  That runtime does not expose a separate stable run identifier or resolved
  model identifier to the repository, so none is invented here.

## Source snapshot

Every finding below is anchored to reviewed commit
`50596212634ecfbd7eabb3d0ce01c763e8dece1c`. The final column is the SHA-256
digest of the exact GitHub review-comment body captured during remediation.

| Comment                                                                          | Original path                                            | Body SHA-256                                                       |
| -------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------ |
| [3588636058](https://github.com/heybeaux/mammoth/pull/68#discussion_r3588636058) | `docs/reviews/p9-coordinator-ledger.md`                  | `50d197e119f7394c458fb7c68fbea508d52858af6bfabe777d52424a314266d7` |
| [3588636066](https://github.com/heybeaux/mammoth/pull/68#discussion_r3588636066) | `evals/fixtures/p9/report-corpus/technical-colibri.json` | `993daf2246568c8d573cdbca74e735723f168aa58d09902ba1f22bf926d514ff` |
| [3588636100](https://github.com/heybeaux/mammoth/pull/68#discussion_r3588636100) | `packages/domain/src/p9-execution.ts`                    | `c9b1a14d689762a127a7196c7d613eb83b48f0355b894da744feecbc61200ef0` |
| [3588636106](https://github.com/heybeaux/mammoth/pull/68#discussion_r3588636106) | `packages/domain/src/p9-execution.ts`                    | `cc6ad1dfeff6075b8000e7e0a003fbcdf25a2fd7055dcbc06ebed9ce486efa82` |
| [3588636113](https://github.com/heybeaux/mammoth/pull/68#discussion_r3588636113) | `packages/domain/src/p9-execution.ts`                    | `b3e53ba1d23f2f5b669129f9d2cf0e64f1c7cc7e4e3ca26bc1820374c5b4a6f5` |
| [3588636118](https://github.com/heybeaux/mammoth/pull/68#discussion_r3588636118) | `packages/governance/src/p9-plan-coverage.ts`            | `e947a6cca1b076e09b6b96e65da3f2912a2afaad18715c92b1b37acb1dff8b7c` |
| [3588636125](https://github.com/heybeaux/mammoth/pull/68#discussion_r3588636125) | `packages/governance/src/p9-plan-coverage.ts`            | `15c52ae940a708c516e746651d94f3e35616e5bd4dee78468a2d6818396853f7` |
| [3588636132](https://github.com/heybeaux/mammoth/pull/68#discussion_r3588636132) | `packages/governance/src/p9-plan-coverage.ts`            | `c1848afd08bae35e3a0019d44620af399b21b5d80172d56c0406db0d84682110` |
| [3588636140](https://github.com/heybeaux/mammoth/pull/68#discussion_r3588636140) | `packages/governance/src/p9-plan-coverage.ts`            | `da061a6044583e890d3c6edd950672445c4fc99233646d80e7b718d31bf3784f` |
| [3588636152](https://github.com/heybeaux/mammoth/pull/68#discussion_r3588636152) | `packages/runtime/src/p9-generic-research.ts`            | `0175fccfddfd4cd3960132ef1407799f5b3249b2f55f0a4ee5cd3df36a08bc12` |
| [3588636158](https://github.com/heybeaux/mammoth/pull/68#discussion_r3588636158) | `packages/runtime/src/p9-generic-research.ts`            | `f27408b2991a20f34a256e135fb720ae4e92586ba8f4294f38b99ca4111be346` |
| [3588636167](https://github.com/heybeaux/mammoth/pull/68#discussion_r3588636167) | `packages/runtime/src/p9-generic-research.ts`            | `60565d8c363798f78f91d76fde67ea3583c75454d784757115dfaaa8ffeb121c` |
| [3588636176](https://github.com/heybeaux/mammoth/pull/68#discussion_r3588636176) | `packages/runtime/src/p9-generic-research.ts`            | `bf20dda3510e4eaca0d739fb90b304b1ee810f3ea1788d0c60c5461c4455af81` |
| [3588636181](https://github.com/heybeaux/mammoth/pull/68#discussion_r3588636181) | `packages/runtime/src/p9-generic-research.ts`            | `489195dccb9fd1f303cfe646e294faeb908c5ecda269e5ba771fa9eed5fe9fb3` |
| [3588636186](https://github.com/heybeaux/mammoth/pull/68#discussion_r3588636186) | `packages/runtime/src/p9-generic-research.ts`            | `b0b93fe6540e4ded372c79ed7c8cef050828de4d72d0f3dce9652b3713979913` |
| [3588636196](https://github.com/heybeaux/mammoth/pull/68#discussion_r3588636196) | `scripts/verify-p9.ts`                                   | `591adbbd5b0f89e50d0dc768ea286eacf3e628fd5a6b6b499c114b1ba77b8495` |

## Finding reconciliation

| Comment    | Reconciliation                                                                                                                                                                                  | Executable evidence                                                                                                                             |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 3588636058 | Replaced unauditable prose with this source snapshot, runtime identity, exact command-result digests, and explicit external-gate status.                                                        | This artifact and the updated T5 ledger record.                                                                                                 |
| 3588636066 | The unsupported 40% claim is insufficient and cannot render.                                                                                                                                    | `verify:p9`: `T5 unsupported quantification cannot render`.                                                                                     |
| 3588636100 | Unknown-cost residue must be unique and exactly equal to the reservation IDs.                                                                                                                   | `p9-execution.test.ts`: `rejects unknown-cost identity substitution and duplicates`.                                                            |
| 3588636106 | Receipt counts are cross-field consistent, including selected/terminal outcomes, parser failures, proposal decisions, and critical admissions.                                                  | `p9-execution.test.ts`: `rejects impossible candidate, parser, decision, and critical counts`.                                                  |
| 3588636113 | `finishedAt` cannot precede `startedAt`.                                                                                                                                                        | `p9-execution.test.ts`: `rejects reverse execution time and a self-referential receipt digest`.                                                 |
| 3588636118 | Coverage labels come from a digest-bound evidence record tied to exact proposal, admission, attempt, and snapshot identities.                                                                   | `p9-plan-coverage.test.ts`: `accepts only digest-bound evidence labels linked to the exact attempt`.                                            |
| 3588636125 | Thresholds reject non-finite, fractional, and out-of-range values.                                                                                                                              | `p9-plan-coverage.test.ts`: `rejects duplicate claims, attempts, stop findings, and invalid thresholds`; `verify:p9` malformed-threshold case.  |
| 3588636132 | Claims, attempts, admission IDs, and stop findings are unique.                                                                                                                                  | The same governance duplicate test.                                                                                                             |
| 3588636140 | Failed freshness and required stop criteria create authoritative coverage gaps.                                                                                                                 | `p9-plan-coverage.test.ts`: `propagates freshness and failed stop requirements into authoritative gaps`; `verify:p9` stale-evidence case.       |
| 3588636152 | Runtime parses and binds proposal, plan, receipt, pack, actor, policy, timestamps, and exact accepted-plan content before any budget authority.                                                 | `verify:p9`: digest-valid but content-divergent chain and malformed-threshold rejection cases.                                                  |
| 3588636158 | Locator declarations and parser receipts use the actual UTF-16 code-unit coordinate space.                                                                                                      | `verify:p9`: `T5 locators and parser receipts use the actual UTF-16 coordinate space`.                                                          |
| 3588636167 | A shared deterministic detector evaluates statements, quotes, and bounded source context; hostile evidence is rejected and absent from output.                                                  | `verify:p9`: `T5 hostile source instructions are deterministically rejected before rendering`.                                                  |
| 3588636176 | Factual sentences cite exact admission, verdict, evidence span, snapshot, coordinate space, and offsets; contradictions are typed, locator-bound manifest records and a visible report section. | `p9-execution.test.ts`: `requires locator-bound citations and typed contradictions`; `verify:p9`: locator-bound provenance/contradictions case. |
| 3588636181 | Stop checks and coverage assessment share one plan-relevance predicate and use bound evidence metadata.                                                                                         | `p9-plan-coverage.test.ts`: `does not count dense but irrelevant admitted prose`; negative canned-corpus `verify:p9` case.                      |
| 3588636186 | The receipt cannot claim a self-digest; every remaining artifact digest hashes the exact serialized bytes.                                                                                      | Domain reverse-time/self-digest test; `verify:p9`: exact serialized-byte digest case.                                                           |
| 3588636196 | The verifier requires a typed failed parser receipt and matching parser-failure residue.                                                                                                        | `verify:p9`: unrelated report residue assertion.                                                                                                |

## Local command-result evidence

All commands ran fail-fast at candidate
`a5bf21cf9a16b4db82af8474e49c64dcebe3fc0e` on 2026-07-15 PDT.
The log digests below are SHA-256 hashes of the complete captured stdout/stderr.

| Command             | Result                                                                                   | Log SHA-256                                                        |
| ------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `pnpm format:check` | PASS                                                                                     | `7fb05ba783c12f40d578da7fe35ef75a882605e5769e1e743264c35374e337ca` |
| `pnpm lint`         | PASS                                                                                     | `b75ca6986b59b6001f85219ac00c20432e177cf541fcf2088a271ae2d9bf8193` |
| `pnpm typecheck`    | PASS                                                                                     | `a0fddd198e5036bc040a91a0014e6ef9232ba3ef0aae7b853ceb1b781b5dab49` |
| `pnpm test`         | PASS                                                                                     | `82758a55ca6e73f52c01ef76c010f1017dd8c139d4ffee2179a8818a05054b66` |
| `pnpm build`        | PASS                                                                                     | `a4f90413ed7530359c5062b79374d627b2940522d88c4df063fb0ef59d4323c0` |
| `pnpm verify:p8`    | PASS; manifest `sha256:d154c6e1df6bfdb41f5222643f33862fa4eb15531af75ce6194171150077298f` | `9457aa57fc07b9f1d093e4085b28fc4190476fdee287c1b8dd4931a22ab9f1e9` |
| `pnpm verify:p9`    | PASS; T5 generic execution passes, T6 remains blocked                                    | `89fd21b0284a1752ba5fc228a51d82be76736ba5cdd5b4fa8ebcc8bfeddc55ac` |

## Remaining external gates

- Push the remediation commits to PR #68.
- Obtain a fresh independent review of the new exact head; the original 16
  thread states are not treated as reviewer approval merely because code exists.
- Run exact-head PR CI, then detached clean-checkout verification before merge.
- After merge, require fresh default-branch CI before T6 starts.
