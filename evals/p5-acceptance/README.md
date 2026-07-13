# P5 acceptance verifier

`pnpm verify:p5` runs the code-owned isolated-divergence and blind-review gates.
It freezes the adversarial fixture manifest, requires every gate target to exist,
and rejects the checkpoint if the production Postgres migration registry does not
contain a forward-only P5 migration after P4 migration `5`.

The verifier is non-recursive and never trusts a receipt status field. It runs
the package gates that own P5 contracts, persistence, workflow/recovery shells,
projection, and operator inspection.
