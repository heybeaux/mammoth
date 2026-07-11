# M2 Runtime Composition: Independent Acceptance Review

Status: pre-implementation adversarial review  
Scope: `MVP_PLAN.md` M2 only; this is a proposed black-box acceptance contract,
not evidence that M2 passes.

## Review basis

This checklist derives from the M2 stage sequence in `MVP_PLAN.md`, the system
invariants in `ARCHITECTURE.md` section 6, the evidence/report rules in sections
13 and 25, the hostile-input and fail-closed rules in sections 23 and 27, and
the recovery/testing rules in sections 31 and 33. Existing public APIs establish
the current implementation boundary:

- `@mammoth/retrieval` retrieves, hashes, parses, and stores raw and parsed
  artifacts; its tests already cover SSRF redirects, byte limits, media types,
  executable HTML removal, CAS deduplication, and CAS corruption.
- `@mammoth/evidence` evaluates direct, fresh, locator-specific evidence and
  keeps model-only evidence untrusted.
- `@mammoth/persistence` validates a referentially complete ledger and commits a
  local JSON snapshot via fsync and atomic rename.
- `@mammoth/report-compiler` only renders typed fact nodes whose statuses,
  assessments, immutable snapshot digests, and exact locators agree.
- `@mammoth/workflow`, `@mammoth/work-queue`, and `@mammoth/governance` already
  have package tests for restart, lease recovery, idempotent effects, budgets,
  human gates, and revalidation. M2 must compose these properties; package-local
  success is not sufficient evidence.

## Required black-box fixture

Use one checked-in fixture and an injected transport, clock, ID source, digest
store root, and crash hook. The fixture must be usable with the network disabled
and contain at least:

1. one public-source statement that directly entails a supported claim;
2. its exact locator in a raw immutable snapshot;
3. either two mutually contradictory claims/evidence edges or one deliberately
   insufficient claim that remains `contradicted` or `unresolved`;
4. hostile text that tells the reader to alter policy, budget, destination, or
   output, and which is retained as source data but has no control-plane effect;
5. fixed timestamps, IDs, bytes, expected digests, and expected terminal state.

The fixture oracle must be checked in separately from runtime-produced output.
An expected digest calculated only by the system under test is circular evidence.

## Stage-by-stage acceptance assertions

| Stage                      | Positive black-box assertion                                                                                                                                                                                        | Fail-closed assertion                                                                                                                                                                                                     | Durable evidence                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Charter                    | A valid charter creates exactly one program with pinned criterion ID/version/digest, evidence policy ID, budget, stop conditions, and deterministic branch identity.                                                | Missing criterion/policy/budget, mismatched criterion digest, or a semantic edit under the same criterion ID is rejected before work is enqueued.                                                                         | Program and criterion record plus audit event.                                                               |
| Retrieve                   | The injected public URL is fetched once under an explicit retrieval policy and the final URL, redirects, timestamp, status, headers, and media type are recorded.                                                   | Private/link-local targets, unsafe schemes, credentials, unsafe redirect destinations, timeout, excessive bytes, disallowed media, and non-2xx responses create no accepted evidence or claim.                            | Attributable work item and retrieval failure/success receipt; no hidden live-network dependency.             |
| Snapshot                   | Exact raw bytes and parsed bytes receive independently verifiable SHA-256 CAS objects; repeated execution reuses the same objects.                                                                                  | Failed hash/write/read-back, digest mismatch, or corrupted existing CAS object blocks evidence persistence and compilation.                                                                                               | Raw and parsed digest/path/size plus receipt.                                                                |
| Parse                      | A pinned parser ID/version produces deterministic text; executable HTML and hostile instructions remain non-authoritative data.                                                                                     | Invalid encoding, malformed supported input, unsupported media type, or parser drift is a named failure and cannot fall back to untracked text.                                                                           | Parsed artifact digest linked to the raw snapshot.                                                           |
| Locate                     | Each proposed edge identifies a non-empty, in-bounds locator whose selected raw/parsed span actually entails the claim.                                                                                             | Empty, reversed, out-of-bounds, wrong-artifact, or merely topical locators cannot become supporting edges.                                                                                                                | Locator, evidence ID, extraction digest, extractor work item, and distinct checker work item where required. |
| Propose claims             | Proposals are atomic, schema-valid, criterion-bound, versioned, and remain non-authoritative until deterministic validation.                                                                                        | A model/proposer cannot write `supported`, attach an invented assessment, change the charter, increase budget, enqueue tools, or introduce a fact from prompt-injection text.                                             | Proposal receipt/raw proposal (if retained), then a separately attributable deterministic commit.            |
| Assess                     | Fixed ledger input yields a named policy ID/version and deterministic verdict. Fresh direct support can support; the negative fixture becomes explicitly unresolved or contradicted.                                | Model agreement, missing artifact, missing locator, non-direct entailment, stale evidence, unknown lineage, or policy failure never yields support. Contradiction is preserved rather than overwritten.                   | Assessment, reason codes, accepted evidence IDs, metrics, evaluator digest, and audit event.                 |
| Persist                    | Claims, evidence, lineages, edges, assessments, and dependencies commit atomically with valid references and a monotonic revision. A fresh process reads the same state.                                            | Dangling IDs, duplicate IDs, invalid graphs/lineage, partial transactions, malformed state, and save failure are rejected without acknowledging progress.                                                                 | Durable ledger plus revision/audit checkpoint.                                                               |
| Compile dossier            | The report contains a supported section and a visible unresolved/contradicted section. Every factual sentence trace resolves through claim, assessment, named policy, evidence, exact locator, and snapshot digest. | Candidate, unsupported, stale, expired-as-current, contradicted-as-supported, unresolved-as-supported, undeclared, or unassessed claims cannot render as supported facts. Rendering cannot add a second factual sentence. | Markdown, structural traces, manifest, and compilation receipt.                                              |
| Emit manifest and receipts | Manifest IDs exactly describe emitted artifacts, claims, unresolved issues, compiler version, freshness time, and receipt. Every meaningful external effect has one verifiable receipt.                             | Missing/tampered receipt, undeclared output, missing unresolved issue, mismatched template, or audit sequence/tail gap makes the run non-successful.                                                                      | Manifest, integrity-verifiable receipts, audit sequence, and terminal program state.                         |

## Cross-stage and restart matrix

Run the same program once without faults to establish the terminal oracle. Then,
in a fresh program directory for each row, terminate immediately before and
immediately after the authoritative commit of every meaningful stage:

```text
charter, retrieve, snapshot-raw, snapshot-parsed, parse, locate,
proposal-validation, assessment, ledger-commit, report-commit,
manifest-commit, receipt-commit, terminal-state-commit
```

After each termination, instantiate an entirely new runtime (no reused objects or
in-memory store), resume by stable program ID, and assert:

- the final semantic state and artifact digests equal the no-fault oracle;
- each authoritative ledger mutation appears exactly once;
- retrieval/external-effect invocation count is at most once when a committed
  provider result/receipt exists, using the same stable idempotency key on retry;
- incomplete local CAS writes are either safely reused after verification or
  ignored; no corrupt object is accepted;
- leases expire and stale workers cannot acknowledge or mutate work;
- retryable failures use bounded deterministic backoff, while contract,
  integrity, policy, and evidence-insufficient failures do not retry as transient;
- poison work reaches a visible dead-letter/quarantine state with its attempts,
  inputs, error, and parent block reason inspectable;
- audit sequence/checkpoint verification still detects a missing final event;
- restart never silently recreates a changed charter, criterion, policy, clock,
  parser version, or compiler version.

Also run two runtimes concurrently against the same program. Exactly one may own
the program branch/lease; optimistic concurrency must reject stale mutations.

## Security and governance attacks

- Embed instructions in fixture HTML to change policy, claim status, report
  prose, tool permissions, destination URL, budget, and filesystem path. Assert
  byte-for-byte source preservation where appropriate but zero control-plane
  mutation attributable to those instructions.
- Exercise IPv4, IPv6, IPv4-mapped IPv6, hostname-to-private-IP, and redirect-to-
  private-IP inputs. Assert transport is never invoked for a denied destination.
- Attempt `../`, absolute-path, symlink, and CAS-digest path escapes in every
  fixture-controlled identifier or output name. Assert no write escapes the
  program directory/CAS root.
- Put a sentinel secret in transport configuration. Assert it appears in none of
  the source snapshots, parsed artifacts, report, manifest, audit events, errors,
  or receipts.
- Exhaust budget before retrieval and between every later stage. Assert no new
  external action starts without a successful reservation, unused reservation is
  released, actual use is committed, and denial leaves an honest inspectable
  partial state rather than a successful report.
- Cancel before and after each stage commit. Assert no later work/effect begins,
  completed evidence is preserved, terminal state is `cancelled`, and the partial
  receipt lists completed and omitted stages without claiming dossier completion.

## Missing or underspecified M2 contracts

These must be decided in the runtime API or an ADR before its implementation can
be independently certified:

1. **Runtime input/output schema:** no checked-in M2 composition contract yet
   defines program-directory layout, terminal result union, stable error codes,
   or which artifact IDs the caller receives.
2. **Fixture-to-domain mapping:** retrieval snapshots do not directly construct
   the richer domain `EvidenceArtifact` (program, lineage, parser, storage URI,
   classification, injection risk, receipt). Ownership of that deterministic
   mapping is unspecified.
3. **Claim proposal/locator contract:** no current public API defines how claims
   and edges are proposed, how offsets are proven in bounds, or how extractor
   and verifier work-item identities are separated.
4. **Assessment adapter:** `@mammoth/evidence` returns a lightweight verdict,
   while the ledger/compiler require the richer domain `ClaimAssessment` with a
   policy version, metrics, evaluator digest, and ID. The conversion and status
   transition transaction must be deterministic and explicit.
5. **Contradiction adjudication:** the current evidence policy evaluates support
   only and returns no `contradicted` verdict. M2 needs a named deterministic rule
   for the required contradiction path, or must explicitly choose the unresolved
   fixture path.
6. **Atomicity across stores:** ledger JSON, CAS, workflow state, queue state,
   audit, report, manifest, and receipts are distinct durable boundaries. The
   recovery protocol (write ordering, idempotency key, reconciliation, and orphan
   handling) is not yet a cross-package contract.
7. **Receipt meaning:** CAS writes are local effects while retrieval may be an
   external effect. Which stages require receipts, their schema, integrity chain,
   and when a receipt makes a stage replay-safe need one composition-level rule.
8. **Audit tail completeness:** receipt integrity and event-chain checks exist,
   but the runtime must define the expected terminal sequence/checkpoint so a
   cleanly truncated tail cannot look valid.
9. **Version pinning on resume:** workflow definition, fixture, parser, policy,
   and compiler versions must be persisted and checked. Behavior on an incompatible
   new process version is unspecified.
10. **Publication semantics:** M2 says “compile dossier” but does not define report
    publication status. It must not imply `human_approved`; a deterministic MVP
    run should remain a clearly named draft/evidence-complete state.
11. **Unresolved rendering evidence:** the compiler currently requires at least
    one evidence binding for every rendered fact, including unresolved facts.
    Define whether “no evidence found” is an unresolved issue rather than a factual
    node, or provide context/uncertain evidence with an exact locator.
12. **Assessment uniqueness:** ledger validation does not currently reject
    duplicate assessment IDs or multiple assessments for a claim, while the
    compiler's map selects one by input order. Runtime composition must select an
    assessment deterministically and preserve history without order-dependent
    publication.
13. **Network-free fixture policy:** the words “public-source fixture” do not say
    whether acceptance may depend on the live public URL. M2 verification should
    use checked-in response bytes plus injected transport; a separate live smoke
    test may be non-blocking because current-world drift cannot be a deterministic
    release gate.
14. **Cancellation/partial-receipt owner:** M2 composes cancellation but no public
    contract currently identifies who constructs the honest partial receipt or
    how downstream report/manifest work is suppressed.

## Minimum M2 exit command

Add one M2 verifier that runs the fixture, structural dossier checks, the entire
restart matrix, and the negative/security cases above. It should be callable from
a clean checkout and must include at least:

```sh
pnpm verify:phase-2
pnpm --filter @mammoth/runtime test
pnpm verify:m2
```

`verify:m2` must fail if it merely finds expected files. It must parse and validate
all durable schemas, independently recompute CAS and receipt digests, traverse
every report trace, compare restart output with the golden semantic oracle, and
confirm the unresolved/contradicted path remains visible.
