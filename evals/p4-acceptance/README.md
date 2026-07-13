# P4 acceptance verifier

`pnpm verify:p4` runs the code-owned research-cell contract gates. It validates
the frozen adversarial fixture manifest, executes the domain admission policy,
authoritative persistence, migration/restart, workflow carriage, deterministic
projection, and read-only operator inspection suites, and runs the native
Postgres lifecycle against the P4 migration.

The verifier is non-recursive and never trusts a receipt's status field. Every
gate must resolve to an existing executable package script and exit successfully.
