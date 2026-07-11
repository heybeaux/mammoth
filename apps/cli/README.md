# `@mammoth/cli`

The local operator surface for Mammoth's durable runtime.

```sh
mammoth run charter.json [--root .mammoth]
mammoth status program-id [--root .mammoth]
mammoth resume program-id [--root .mammoth]
mammoth cancel program-id [--root .mammoth]
mammoth inspect program-id [--root .mammoth]
```

Add `--json` for stable machine-readable output. The default root is
`$MAMMOTH_HOME` or `.mammoth` beneath the current directory. Exit codes are `0`
for success, `2` for invalid input, `3` for a missing program, `4` for a state
conflict, and `5` for an execution, integrity, policy, or storage failure.

The charter is the `RuntimeCharter` JSON shape. For deterministic offline runs it
may additionally include `sourcePath`, resolved relative to the charter file. The
declared `sourceUrl` remains the evidence URI; the local file supplies its bytes.
Mammoth stores an operator copy in the confined program directory so a later
process can resume with the same source configuration.

Program IDs are restricted to letters, digits, `.`, `_`, `:`, and `-` and may not
contain path separators. This is a deliberate security boundary: operator commands
never resolve a program outside the configured root.
