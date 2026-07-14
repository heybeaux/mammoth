# ADR 0008: P7 provider and application boundary

## Status

Accepted for P7 implementation.

## Context

P7 connects P6 topology execution to real model-provider effects and an operator
CLI. Without a strict inward-facing boundary, provider SDK types, aliases,
orchestration state, or CLI behavior could become accidental authority. The first
reference transport is OpenAI-compatible HTTP against loopback Ollama, while
offline CI must remain deterministic and network-free.

## Options

1. Let the CLI call a provider SDK and write research state directly.
2. Put provider calls inside workflow code and reconstruct product state from
   Temporal history.
3. Define a provider-neutral effect port and one application-service port. Keep
   providers proposal-only, deterministic validation and admission inside the
   application layer, Postgres/CAS authoritative, Temporal orchestration-only,
   and the CLI a replaceable adapter.

## Decision

Use option 3.

`@mammoth/domain` owns pure versioned model-work identities, policies, typed
proposal output, and error classifications. `@mammoth/provider-port` depends only
on the domain and exposes canonical bytes, typed limits, concrete provider/model/
checkpoint identity, usage, finish reason, provider operation identity, and raw
response bytes. It exposes no SDK types.

The P7 application service depends inward on domain, workflow, and provider-port
contracts. It alone composes deterministic parsing, validation, evidence-policy
assessment, CAS writes, budget settlement, and authoritative persistence. Temporal
delivers and retries typed work but owns no product state. The CLI invokes only
the application port for run, resume, cancel, status, and inspect.

The deterministic provider and OpenAI-compatible provider implement the same
port. Capability discovery resolves aliases to a concrete immutable model and
checkpoint before dispatch. Dispatch, effects, artifacts, costs, and projections
record that concrete identity. Profile or capability drift fails closed.

## Consequences

- Offline CI can prove the public application boundary without network access.
- Provider transports can change without moving authority or SDK types inward.
- Operator surfaces cannot bypass validation or reconstruct from Temporal shadow
  state.
- An additional composition layer is required, but its dependency direction and
  authority are mechanically testable.

## Evidence

The checked P7 contract manifest freezes versions, dependency direction, and
authority. T1 tests reject extra fields and digest drift. Later gates must prove
provider conformance, hostile transport behavior, application black-box behavior,
Postgres/CAS reconstruction, Temporal replay, and CLI non-authority.
