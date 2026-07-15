# ADR 0011 — Mammoth 2.0 program boundary and solution status

- Status: proposed (P9 entry plan)
- Date: 2026-07-14
- Deciders: P9 coordinator; independent entry-plan reviewer
- Inputs: `MAMMOTH_2.md`, `ADVERSARIAL_ANALYSIS_POST_P8.md`, P8 live exhibition

## Context

P8 proved that Mammoth can produce a useful evidence-bound report in one domain.
The approved 2.0 direction extends the product toward hard coding, mathematics,
and project problems: research the system, propose competing theories, design and
run experiments, implement candidates in isolation, and return measured solutions.

There are three architectural risks:

1. collapsing research and arbitrary tool execution into an ungoverned agent;
2. allowing plausible/model-generated proposals to be represented as solved;
3. creating a second solver authority store disconnected from Mammoth's evidence,
   budget, provenance, and durable execution substrate.

## Decision

### One core, two product programs

Mammoth retains one epistemic and governance core with two explicit programs:

- `research ask` for evidence-bound investigation and reports;
- `lab solve` for research-driven hypotheses, bounded intervention, evaluation,
  and solution portfolios.

`lab solve` is not implemented or released by P9. P9 makes live research truthful
and generalizes question-derived planning. P11 will require a separate plan,
acceptance baseline, sandbox/evaluator contracts, and release evidence.

### Models propose; deterministic authority executes and admits

Models may propose problem interpretations, plans, hypotheses, experiments,
patches, proof steps, and result interpretations. They receive no implicit shell,
network, repository-write, package-manager, compiler, accelerator, secret, merge,
or publication authority.

Deterministic services validate closed contracts, allocate budgets, issue scoped
grants, execute bounded tools, record receipts, evaluate mechanical results, and
commit authoritative transitions. Human approval remains required for external
publication, third-party repository writes, merges/releases, destructive actions,
and any effect whose authority cannot be safely predeclared.

### Solution status is explicit and policy-owned

The closed solution states are:

- `proposed`;
- `proxy_supported`;
- `experimentally_supported`;
- `refuted`;
- `formally_verified`;
- `inconclusive`;
- `blocked`.

Promotion requires a named deterministic policy over admitted evidence and exact
experiment/formal-verification receipts. Model agreement, self-review, prose,
confidence, test count, or benchmark improvement alone cannot promote status.
Every promotion record includes `policyId` and `policyVersion`, plus the exact
`receiptId`, `verifierId`, and `verifierVersion` where applicable. These
identifiers bind the transition to the policy and verifier that authorized it so
later policy or verifier changes cannot reinterpret an existing status.

Proxy evidence records why it is a proxy and which target validation remains.
Mathematical formal verification records exact checker, version, imports, axioms,
artifact digest, and trust assumptions. Experimental support records repository,
environment, data, model, workload, evaluator, repetitions, uncertainty, and
invalid-run policy.

### Solver state remains in existing authority planes

Problem contracts, hypotheses, experiments, runs, patches, verdicts, and solution
portfolios use versioned domain contracts; Postgres remains authoritative; CAS
stores immutable code/data/result artifacts; Temporal orchestrates stable IDs and
reconstructs; governance owns grants/budgets; report compilation renders admitted
state. Engram may retain navigation memory but never promotes solution truth.

## Rejected alternatives

### Turn Mammoth into a general autonomous coding agent

Rejected because ambient tools, hidden state, and conversational authority would
defeat the core provenance, budget, security, and replay guarantees.

### Create a separate solver product with its own state

Rejected because duplicate authority would make research evidence, experiment
results, and solution claims diverge and would discard the existing substrate.

### Treat every passing patch as solved

Rejected because tests can be incomplete, benchmarks can be confounded, proxies
can differ from targets, and local improvements can violate unmeasured constraints.

## Consequences

- P9 ships only trustworthy general research and forward product vocabulary.
- P10 measures general research value before solver expansion.
- P11 must freeze sandbox, repository, tool, evaluator, and solution-verdict
  contracts before executable solver work.
- The Colibri exhibition may be designed early, but no upstream change or solved
  claim is made until the target profile and evaluator contract pass.
- UI and CLI must display solution status and missing validation prominently.
