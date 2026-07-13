# ADR 0006: Research-cell and model-lineage contract authority

## Status

Accepted for P4 contract implementation.

## Context

P4 introduces research-cell plans, positions, reviews, dissent, synthesis, and
model-lineage metadata. These artifacts are created around model work, but they
must not become an alternate truth authority. Mammoth already has source lineage
for evidence derivation; model lineage is a separate concern about provider,
family, checkpoint, fine-tune, aliases, shared derivation, and unknown ancestry.

The architectural invariants require that model agreement never promotes a
claim, deterministic services validate and commit mutations, criterion drift
remains inspectable, and rejected proposals are retained with reason codes.

## Options

1. Treat research-cell outputs as authoritative ledger records.
2. Store research-cell outputs as untyped transcript artifacts and rely on later
   reviewers.
3. Define versioned domain contracts and pure policies that admit or reject cell
   proposals before persistence or workflow code can treat them as usable inputs.

## Decision

Use option 3.

The domain package owns versioned Zod contracts, canonical identity/digest
functions, model-lineage graph validation, correlation assessment, and pure
admission policies. Research positions and reviews remain proposals until these
policies admit them. Synthesis is limited to admitted claim IDs. Unknown lineage
is explicit and conservative. Aliases, shared derivation, same family/checkpoint,
or ancestry do not count as independent model support.

Source lineage and model lineage remain distinct domain concepts. Source lineage
continues to describe evidence/source derivation. Model lineage describes model
profile versions and correlation risk. Neither lineage type by itself promotes
truth.

## Consequences

- Persistence and workflow packages can store and transport these contracts later
  without redefining P4 authority.
- A larger panel of agreeing positions cannot support an unsupported claim.
- Self-review and correlated-review cases are mechanically rejectable.
- Criterion edits must be represented as drift or explicit branches.
- Rejected proposals and reason codes are first-class audit residue.
- Future schema changes require explicit versioning instead of silently changing
  cell semantics.

## Evidence

The P4 T1-T2 domain tests cover unsupported agreement, alias and unknown lineage,
self-review, valid cross-family review, criterion drift, missing references,
cyclic and dangling lineage, noncanonical digests, synthesis restrictions, and
rejected-residue retention.
