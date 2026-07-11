# Mammoth MVP acceptance verifier

This package is an independent black-box verifier for the local MVP. It resolves
the CLI from `apps/cli/package.json`, spawns a new Node process for every command,
uses only checked-in offline source bytes, and imports no Mammoth implementation
package when checking durable output.

The verifier independently recomputes CAS byte digests, canonical artifact and
receipt digests, traverses every dossier sentence through its trace, claim,
assessment, named policy, evidence edge, exact locator, and immutable snapshot,
and rejects unsupported rendering or tampered artifacts. It also covers
idempotent replay, restart convergence, cancellation partial truth, all five CLI
commands, and fresh-process readability.

Run it with:

```sh
pnpm --filter @mammoth/mvp-acceptance verify
```

The root `verify:mvp` script is intentionally owned by the integration task.
