# P2 acceptance verifier

This package is the adversarial acceptance skeleton for `P2_PLAN.md`. It fails
closed: an absent service, unregistered capability, or non-zero executable gate is
reported as `missing` or `failed`, and the process exits non-zero.

Gate IDs and their semantic requirements live in `src/verifier.ts`. P1 and the
coordinator-owned `packages/postgres-adapter` have fixed targets. Other concrete
package names remain unfrozen. Their coordinator must add
`evals/p2-acceptance/capabilities.json` with this shape when executable acceptance
commands exist:

```json
{
  "gates": {
    "d3-content-addressed-artifacts": {
      "requiredPath": "coordinator-owned/path/package.json",
      "command": [
        "pnpm",
        "--filter",
        "coordinator-owned-package",
        "test:acceptance"
      ]
    }
  }
}
```

The verifier executes the command; it does not accept a package's assertion that
the gate passed. Only `pnpm` command entries are accepted. Registration does not
imply acceptance, and no P2 result is green until every static gate executes and
returns zero against the production-like local profile.
