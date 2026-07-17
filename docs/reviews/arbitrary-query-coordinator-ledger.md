# Arbitrary-query coordinator ledger

## 2026-07-16 — orientation and bounded lane launch

- **Current predicate:** accepted preview authority must bind to an immutable
  executable plan before any governed effect can occur.
- **Baseline:** PR #140 supplies only a no-effect `mammoth investigate` preview;
  it returns `awaiting_approval` and does not execute the research product path.
- **Authority:** `origin/main` includes PR #141 merge
  `5637851ad9ecc7f3368d40e5200def07e36af4fc`; its fresh-main CI run
  `29559667727` succeeded.
- **Integration:** `/private/tmp/mammoth-core-query-integration`, branch
  `feat/core-thesis-arbitrary-query`, at `5637851ad9ecc7f3368d40e5200def07e36af4fc`.
- **Durable control:** managed TaskFlow `56206e6d-363b-486b-94bc-1f315f859d0d`,
  controller `mammoth/core-thesis-arbitrary-query`. An initial incorrectly
  parent-bound flow was retired before any worker or effect started.
- **Lanes requested (all strictly no-effect):** plan/authority binding,
  retrieval/evidence stocktake, and reader/audit projection stocktake. Each has a
  separate fresh worktree and disjoint write set; completion evidence and live
  ownership must be checked before integration.
- **Effect authority:** none. No provider, search, or paid effect may run.
- **Next action:** reconcile lane handoffs, independently review the smallest
  plan/authority seam, then integrate and claim plan-driven discovery.
