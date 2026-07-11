# M3 Operator CLI: Adversarial Acceptance Review

Status: pre-implementation independent review  
Scope: `MVP_PLAN.md` M3 only; this document specifies acceptance evidence and
does not certify an implementation.

## Contract under review

M3 is an operating surface over the durable runtime, not a second source of
truth. The CLI may request state transitions, but deterministic runtime code must
validate and commit them. A successful command must be explainable from durable
state after the invoking process has exited.

The release-facing commands are:

```text
mammoth run <charter>
mammoth status <program>
mammoth resume <program>
mammoth cancel <program>
mammoth inspect <program>
```

Acceptance tests must execute the built package's declared `bin` entrypoint in a
new OS process. Importing a command handler into Vitest is useful unit coverage,
but is not M3 evidence.

## Process harness and observable protocol

The black-box test builds once, resolves the executable from the package's `bin`
field, and invokes it with `spawnSync(process.execPath, [bin, ...args])`. Each
invocation receives a fresh environment containing only the required inherited
process variables plus `MAMMOTH_HOME=<absolute temporary directory>`. Tests must
set `cwd` to a directory outside both the charter directory and `MAMMOTH_HOME` so
success cannot depend on repository-relative paths.

For every command assert all of the following, not just file existence:

- `signal === null`, the expected numeric `status`, and no timeout;
- stdout is exactly one newline-terminated UTF-8 JSON object; parsing must not
  require stripping logs, ANSI codes, banners, or progress output;
- stderr is empty on success and contains one concise diagnostic on failure;
- the response includes `schemaVersion`, `command`, `programId`, and a stable
  machine-readable `status` or `error.code` as appropriate;
- returned paths are absolute, canonical paths contained by `MAMMOTH_HOME`;
- a second process can perform the next command using only the program ID and
  `MAMMOTH_HOME`; no object, descriptor, current directory, or environment state
  from the first process may be reused;
- the child closes normally with no descendant process, lock, or temporary file
  left behind.

The exact exit-code contract should be frozen as follows:

| Code | Meaning                                                                                                                        | Examples                                                                              |
| ---: | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
|  `0` | Command was accepted and its claimed result is durable. Querying a completed, paused, or cancelled program is also successful. | run completed; cancel committed; repeated cancel reports already cancelled            |
|  `2` | Invocation or charter input is invalid. No program transition occurred.                                                        | missing argument, unknown flag, malformed JSON/schema, invalid or escaping program ID |
|  `3` | The requested program does not exist beneath this Mammoth home.                                                                | status/resume/cancel/inspect unknown ID                                               |
|  `4` | The program exists, but the requested transition conflicts with durable state.                                                 | resume completed program, resume while actively leased, incompatible runtime version  |
|  `5` | Execution, integrity, policy, or durable I/O failed. Partial state may exist and must be inspectable.                          | retrieval failure, corrupt state, failed receipt verification, interrupted run        |

Signals retain the platform's normal signal result; the CLI must not translate an
uncaught `SIGKILL` into a false successful receipt. Unknown internal errors map to
`5`, never `0`. Error stdout must still contain the JSON error envelope; human
detail belongs on stderr and must not expose charter contents or secrets.

## Command-by-command spawned-process assertions

### `run`

Spawn `mammoth run <absolute-valid-charter>` with the checked-in offline fixture
adapter/configuration. Assert exit `0`, response status `completed`, and a single
durable program directory. Re-run the exact command in a new process and assert
it is idempotent: same program ID, execution identity, snapshot digest, artifact
digests, receipt integrity hash, and no additional external-effect receipt.

Spawn with relative and absolute charter paths from unrelated working
directories; both must resolve the same input bytes. Modify the charter under the
same program ID and assert exit `4` (or `2` if rejected before ID allocation), no
silent reuse, and no mutation of the original artifacts.

### `status`

Spawn against running/interrupted, completed, cancelled, and missing programs.
Assert the projection includes the durable lifecycle state, current/last stage,
attempt or execution identity, timestamps, unresolved claim count, and the latest
named failure/block reason without reading or mutating source evidence. Two status
calls must produce semantically equal output and byte-identical durable files.
Missing is exit `3`; corruption is exit `5`, not `3` and not a newly initialized
program.

### `resume`

Kill a `run` child immediately after each exposed durable-stage hook, then spawn
`resume` using only the program ID. Assert it continues from committed state to
the same semantic oracle as an uninterrupted run. It must reuse stable
idempotency keys and never duplicate snapshots, claims, assessments, audit
events, or external-effect receipts. Resume after a second interruption must
remain convergent.

Resume of an interrupted/failed retryable program is exit `0` once terminal
state is durably committed. Resume of completed or cancelled state is exit `4`
and leaves every artifact byte unchanged. Concurrent resume processes must not
both own the lease: at most one exits `0`; the loser exits `4`, or observes and
returns the already durable terminal result without performing work.

### `cancel`

Start `run` as a long-lived child with a deterministic blocking fixture. Spawn
`cancel` from another process. Assert cancel exits `0` only after a durable
cancellation request/decision exists. The worker cooperatively stops before the
next effect, emits an honest partial receipt, preserves committed artifacts, and
reaches `cancelled`. A second cancel is idempotent exit `0` with identical receipt
and audit sequence.

Cancel immediately before and after every stage commit. In every case assert:

- no stage after the observed cancellation boundary starts;
- any already completed effect has exactly one receipt;
- temporary files are absent and valid completed CAS objects remain readable;
- the partial receipt enumerates completed, omitted, and in-flight stages and
  never claims `completed` or `evidence_complete` publication;
- `status` and `inspect` from new processes report `cancelled` and the same
  cancellation receipt;
- `resume` exits `4` unless an explicit future uncancel operation is designed and
  separately audited.

### `inspect`

Spawn after completed, interrupted/failed, and cancelled runs. Assert it performs
no state mutation and returns a structural inventory, integrity verdict, and
canonical paths for every artifact class. It must expose unsupported,
unresolved, contradicted, failed, and cancelled results rather than filtering to
green output. Inspect exits `5` on a digest mismatch, dangling reference, missing
required receipt, audit tail gap, or path escape and identifies the failed check.

Run inspect with the network disabled and after renaming the original charter;
all authoritative artifacts must still be understandable from the program
directory. Capture file metadata and digests before and after inspect and assert
no file was created, rewritten, touched, or deleted.

## Program directory and artifact inspection

The CLI must make the following logical classes discoverable without knowing
private implementation details: lifecycle/workflow state, queue and leases,
governance/budget state, raw and parsed immutable snapshots, epistemic ledger,
claim assessments, audit events/checkpoints, dossier, report manifest, report
traces, external-effect receipts, terminal or partial program receipt, and
runtime/schema version metadata.

The M3 verifier must parse these artifacts and independently assert:

1. Every report fact resolves through trace -> claim -> assessment -> named
   policy/version -> edge with an exact in-bounds locator -> immutable snapshot
   digest. Recompute file/CAS and receipt hashes independently.
2. Unsupported, unresolved, contradicted, expired, revoked, or unassessed claims
   do not appear as supported prose, but remain visible in inspect output.
3. Every manifest entry names an existing artifact with the expected digest and
   every emitted authoritative artifact is declared. No `.tmp` file is accepted.
4. Audit events have contiguous sequence/checkpoint evidence sufficient to
   detect a deleted final event; a valid prefix is not mistaken for a complete
   run.
5. Cancellation and failure receipts describe partial truth: completed stages,
   absent outputs, failure/cancellation code, effect receipts, and integrity
   hash. Missing dossier/manifest after early cancellation is expected, not
   repaired by inspect.
6. Files remain readable and equivalent after the producing process exits and a
   wholly new process starts. Open file descriptors and in-memory maps are not
   evidence.

## Hostile charter and filesystem matrix

Run every attack in its own temporary Mammoth home with a sentinel file outside
the home. After each invocation, recursively inspect the home and assert the
sentinel and all paths outside the home are byte-identical.

- Supply `programId` values `../escape`, `..`, `.`, `/absolute`, `a/b`, `a\\b`,
  percent/double-percent encoded traversal, NUL/control characters, Unicode
  separator lookalikes, trailing dot/space, and an overlong identifier. All must
  exit `2` before `mkdir`, workflow creation, retrieval, or audit success.
- Use a valid program ID whose destination already exists as a symlink to an
  outside directory, and replace an intermediate program/CAS directory with a
  symlink between validation and write. The command must fail closed with exit
  `5`; it must not follow the link or report successful durability.
- Put symlinks at expected artifact filenames and CAS digest locations, including
  dangling links and links to devices/FIFOs. `run`, `resume`, and any repair path
  must reject them. `status`/`inspect` must report integrity failure without
  opening a blocking device or mutating the target.
- Pass a charter through a symlink, a FIFO/device, a directory, a file larger
  than the configured maximum, invalid UTF-8, duplicate JSON keys, unknown
  schema fields, malformed URL, duplicate proposal IDs, non-atomic facts, empty
  locators, and unsupported schema versions. Inputs must be bounded and fail
  before an external effect.
- Set fixture-controlled IDs and titles to traversal strings and shell syntax
  such as `$(touch sentinel)`, backticks, quotes, newlines, glob characters, and
  leading `-`. Assert they are treated as data, never as path fragments or shell
  commands, and no diagnostic log injection creates a fake success line.
- Race directory replacement and two `run` processes for the same program. The
  containment check must be at the opened handle/write boundary, not only a
  vulnerable `resolve()` precheck. Exactly one canonical program branch may
  commit.

At minimum, containment requires rejecting path-like program IDs, resolving the
configured root once, refusing symlink components for authoritative writes, and
using exclusive/atomic creation where ownership matters. A lexical
`startsWith(root)` check alone does not pass.

## Invalid state and tamper attacks

After a valid run, independently alter one artifact at a time: truncate JSON,
change a snapshot byte, change a locator, delete an assessment, swap program IDs,
alter an idempotency key, remove the final audit event, replace a receipt, and
change runtime/schema version metadata. For each mutation:

- `status` may report a named `integrity_failed` projection but must not report a
  healthy completed program;
- `inspect` exits `5` and identifies the exact invariant/reference/digest class;
- `resume` exits `5` without fetching, overwriting, normalizing, or silently
  reconstructing tampered authoritative state;
- subsequent clean inspection sees the same tampered bytes (diagnosis is
  read-only); repair, if ever added, must be a separate explicit operation.

## Minimum M3 exit gate

Add a black-box verifier callable from a clean checkout. It must build the CLI,
spawn real child processes for every command and state, and include traversal,
symlink, tamper, concurrency, interruption, cancellation, and idempotent replay
cases. The minimum gate is:

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm verify:phase-2
pnpm verify:m2
pnpm verify:m3
```

`verify:m3` fails if it only calls command handlers in-process, only checks that
files exist, reuses the producer process, relies on the live network, or omits
negative exit-code assertions. Passing M3 proves the local operator surface; it
does not by itself prove the broader M4 checkpoint.
