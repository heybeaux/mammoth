# Phase 0 deterministic evaluation

Run `pnpm eval:offline` (or `tsx scripts/verify-phase-0.ts`) to evaluate the JSON corpus.

The corpus traces its fixture shapes to SwarmLab's ground-store verification, handoff-guard, and audit-forgery experiments. Mammoth's implementation is self-contained and deterministic: no model or provider is used as a policy executor.

Covered exit gates:

- a non-entailing citation remains unresolved;
- expired evidence produces an expired verdict;
- model observations alone remain untrusted;
- omitted semantic handoff metadata is rejected;
- receipt mutation invalidates its integrity hash;
- audit sequence mutation breaks stream verification.

## Development receipt

**Claim:** the Phase 0 constitution and deterministic failure harness are implemented.

**Changes:** strict workspace/CI foundations, domain schemas and lifecycle guards,
deterministic evidence and handoff policies, receipt/audit integrity checks, and
SwarmLab-derived offline fixtures.

**Verification:** formatting, lint, typecheck, 19 unit tests, package builds,
`verify:evidence`, `verify:audit`, and `eval:offline` all pass locally on Node 22.

**Risks and unverified areas:** this phase intentionally does not include Postgres,
CAS, Temporal, source acquisition, model providers, report compilation, or live stack
adapters. The fixture corpus is an initial constitutional gate, not a complete
epistemic evaluation suite.

**Next action:** begin Phase 1 with immutable source snapshots and an evidence-first
vertical slice while preserving these gates as release invariants.
