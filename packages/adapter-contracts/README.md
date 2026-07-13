# `@mammoth/adapter-contracts`

Versioned startup contracts and behavioral conformance gates for Mammoth adapters.

`assertAdapterCompatibility` validates the configured adapter profile, contract
major, health, and required capabilities before work starts. It fails closed and
reports every incompatibility found.

The conformance helpers exercise observable behavior rather than structural
TypeScript compatibility:

- `verifyWorkflowStoreConformance` checks durable reopen, atomic concurrent
  mutation, no lost updates, and rollback after a failed transaction.
- `verifyWorkflowRuntimeConformance` checks that a Temporal-style runtime
  descriptor satisfies the additive contract-major-1 requirement, starts ready,
  and shuts down idempotently.
- `verifyEpistemicLedgerConformance` checks ordered revisions across independent
  adapter instances, durable reopen, and rollback after a failed transaction.
- `verifyWorkStateStoreConformance` checks durable state across independent
  adapter instances, unique receipt retention, and rollback.
- `verifyEffectReceiptConformance` checks that a completed provider effect is not
  executed again after runtime restart.
- `verifyContentAddressedStoreConformance` checks deterministic addressing,
  deduplication, durable reads, invalid digests, and fail-closed corruption reads.

Production adapters must run these same helpers against their real backing
services. Passing the local fixture does not certify a future adapter.

Run the current gate from the repository root:

```sh
pnpm verify:adapters
```
