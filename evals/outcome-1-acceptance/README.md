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

`test` is deliberately red on the reset baseline. It invokes the real CLI for
all four questions and fails until the normal `research investigate` path emits
the four approved preview artifacts with zero effects. Missing generic product
surfaces also fail the no-hardcoding gate. The contract must not be disabled,
marked todo, or weakened to merge a partial implementation.
