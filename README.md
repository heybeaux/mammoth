# mammoth

Local-first, hybrid, long-horizon epistemic engine.

## Development

Mammoth requires Node.js 22 or later and pnpm 8.15.6. From the repository root:

```sh
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm verify:evidence
pnpm verify:audit
pnpm eval:offline
```

Run `pnpm format` to format tracked source and documentation, or
`pnpm format:check` to check formatting without changing files.

Workspace packages live under `apps/`, `packages/`, `workers/`, and `evals/`.
Packages should extend `tsconfig.base.json` and expose the applicable `build`,
`typecheck`, and `test` scripts; root commands run those scripts recursively.
