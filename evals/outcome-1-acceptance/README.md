# Outcome 1 acceptance contract

This package freezes the first black-box contract under `CORE_THESIS.md`: an
unfamiliar plain-language question must produce a question-derived, reviewable
research preview before any external effect, then eventually produce separate
reader and audit projections from one authoritative run.

The four visible cases intentionally span unrelated technical, policy, and
scientific problems. Their corpora are synthetic and explicitly labelled; they
test the product contract and evidence lineage, not live facts.

Commands:

```sh
pnpm --filter @mammoth/outcome-1-acceptance typecheck
pnpm --filter @mammoth/outcome-1-acceptance test:harness
pnpm --filter @mammoth/outcome-1-acceptance test
```

`test:harness` must remain green. It validates fixture closure, fingerprint
normalization, cross-fixture leakage detection, reader/audit authority binding,
and tamper rejection.

`test` invokes the real top-level `mammoth investigate` path for all four
questions. It requires the four approved preview artifacts, a successful
`awaiting_approval` result, materially question-derived plans and teams, and zero
effects. Missing generic product surfaces or fixture leakage fail the
no-hardcoding gate. The completion-side reader/audit predicates remain frozen
for the accepted-plan execution slice; they must not be weakened to merge a
partial implementation.
