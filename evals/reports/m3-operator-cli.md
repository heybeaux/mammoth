# M3 operator CLI receipt

## Outcome

The `mammoth` executable provides `run`, `status`, `resume`, `cancel`, and
`inspect` over the durable local runtime. Commands emit stable JSON envelopes for
automation or concise human output and use documented exit codes for invalid
input, missing programs, state conflicts, and execution/integrity failures.

## Verification

`pnpm verify:m3` builds the declared executable and launches it in new OS
processes from an unrelated working directory. The suite covers all commands,
fresh-process artifact readability, idempotent rerun, interrupted resume,
terminal partial cancellation receipts, unknown programs, traversal rejection,
and a pre-existing program-directory symlink with an outside sentinel.

M4 remains responsible for the full clean-checkout acceptance matrix and final
checkpoint receipt.
