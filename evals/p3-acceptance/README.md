# P3 acceptance verifier

`pnpm verify:p3` runs code-owned Temporal control-plane gates. It executes
fail-closed adapter startup tests, the real SDK capability probe, process/service
recovery tests, and the deterministic Temporal-linked Observatory projection.

The verifier never trusts a checked-in receipt's `passed` field. Each gate must
resolve to an existing package script and exit successfully. The repository's
full clean-checkout ladder remains a separate checkpoint requirement.
