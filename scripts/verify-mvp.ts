import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const executeFile = promisify(execFile);
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(repository, 'apps/cli/dist/bin.js');
const fixtureSource = join(repository, 'evals/fixtures/mvp/source-rfc2606.txt');
const sourceDigest =
  'sha256:02950ec26917b3cf2f613fd1ec16b4d2f8fd376fb9b3aa3e72f881d9d8ecc331';
const supportedClaimId = 'claim:example-com-reserved';
const unresolvedClaimId = 'claim:example-com-https-guarantee';

interface CommandResult {
  stdout: string;
  stderr: string;
}

async function main(): Promise<void> {
  await stat(cli).catch(() => {
    throw new Error(
      'MVP_VERIFY_CLI_NOT_BUILT: run pnpm --filter @mammoth/cli build',
    );
  });
  const temporary = await mkdtemp(join(tmpdir(), 'mammoth-mvp-blackbox-'));
  const keep = process.env.MAMMOTH_KEEP_VERIFY_ARTIFACTS === '1';
  try {
    const root = join(temporary, 'state');
    const completeInput = await writeOperatorInput(
      temporary,
      'mvp-blackbox-complete',
      { revalidate: true },
    );

    const paused = await command([
      'run',
      completeInput,
      '--root',
      root,
      '--max-steps',
      '2',
      '--json',
    ]);
    assertEqual(paused.command, 'run', 'bounded run command');
    assertEqual(paused.status, 'paused', 'bounded run status');
    assertEqual(paused.publicationStatus, 'partial', 'bounded publication');

    const statusBefore = await command([
      'status',
      'mvp-blackbox-complete',
      '--root',
      root,
      '--json',
    ]);
    assertEqual(statusBefore.status, 'paused', 'fresh-process paused status');
    assertEqual(statusBefore.completed, false, 'paused completed flag');

    const resumed = await command([
      'resume',
      'mvp-blackbox-complete',
      '--root',
      root,
      '--json',
    ]);
    assertEqual(resumed.command, 'resume', 'resume command');
    assertEqual(resumed.status, 'completed', 'resume terminal status');
    assertEqual(
      resumed.publicationStatus,
      'evidence_complete',
      'publication status',
    );
    assertStringArray(resumed.supportedClaimIds, [supportedClaimId]);
    assertStringArray(resumed.unresolvedClaimIds, [unresolvedClaimId]);
    assertEqual(resumed.snapshotDigest, sourceDigest, 'snapshot oracle digest');

    const statusAfter = await command([
      'status',
      'mvp-blackbox-complete',
      '--root',
      root,
      '--json',
    ]);
    assertEqual(statusAfter.status, 'completed', 'fresh-process completion');
    assertEqual(statusAfter.completed, true, 'completed flag');
    assertArtifactPresence(statusAfter.artifacts);

    const inspection = await command([
      'inspect',
      'mvp-blackbox-complete',
      '--root',
      root,
      '--json',
    ]);
    const programDirectory = join(root, 'mvp-blackbox-complete');
    await verifyArtifacts(inspection, programDirectory);
    verifyRevalidation(
      record(inspection.revalidation, 'revalidation projection'),
      'mvp-blackbox-complete',
    );
    await verifyCommittedBudget(programDirectory);

    const queueBefore = await readJson(join(programDirectory, 'queue.json'));
    const repeated = await command([
      'run',
      completeInput,
      '--root',
      root,
      '--json',
    ]);
    assertEqual(repeated.status, 'completed', 'idempotent rerun status');
    const queueAfter = await readJson(join(programDirectory, 'queue.json'));
    assertEqual(
      canonicalJson(queueAfter),
      canonicalJson(queueBefore),
      'completed rerun must not duplicate queue work or external receipts',
    );

    const cancelInput = await writeOperatorInput(
      temporary,
      'mvp-blackbox-cancel',
    );
    const cancelPaused = await command([
      'run',
      cancelInput,
      '--root',
      root,
      '--max-steps',
      '1',
      '--json',
    ]);
    assertEqual(cancelPaused.status, 'paused', 'cancellation setup pause');
    const cancelled = await command([
      'cancel',
      'mvp-blackbox-cancel',
      '--root',
      root,
      '--json',
    ]);
    assertEqual(cancelled.status, 'cancelled', 'cancel status');
    const cancellation = record(cancelled.cancellation, 'cancellation');
    assertEqual(cancellation.reason, 'operator request', 'cancellation reason');
    const partialState = record(
      cancellation.partialState,
      'cancellation.partialState',
    );
    assert(
      Object.keys(partialState).length > 0,
      'cancellation partial receipt must identify preserved workflow state',
    );
    assertInstant(cancellation.requestedAt, 'cancellation requestedAt');
    assertInstant(cancellation.completedAt, 'cancellation completedAt');
    const cancellationReceipt = record(
      cancelled.cancellationReceipt,
      'cancellation receipt',
    );
    verifyCancellationReceipt(cancellationReceipt);
    const cancelledInspect = await command([
      'inspect',
      'mvp-blackbox-cancel',
      '--root',
      root,
      '--json',
    ]);
    assertEqual(
      record(cancelledInspect.status, 'cancel inspect status').status,
      'cancelled',
      'durable cancelled status',
    );
    assertEqual(
      canonicalJson(cancelledInspect.cancellationReceipt),
      canonicalJson(cancellationReceipt),
      'durable cancellation receipt projection',
    );
    assert(
      cancelledInspect.receipt === undefined,
      'cancelled partial program must not emit a completion receipt',
    );
    assert(
      cancelledInspect.report === undefined,
      'cancelled partial program must not emit a dossier',
    );
    await verifyDurableCancellation(
      join(root, 'mvp-blackbox-cancel'),
      cancellation,
    );

    const deniedInput = await writeOperatorInput(
      temporary,
      'mvp-blackbox-budget-denied',
      { denyBudget: true },
    );
    const denied = await failedCommand([
      'run',
      deniedInput,
      '--root',
      root,
      '--json',
    ]);
    assertEqual(denied.error, 'COMMAND_FAILED', 'budget denial error envelope');
    assertEqual(
      denied.message,
      'reservation exceeds remaining budget',
      'budget denial message',
    );
    await verifyBudgetDenial(join(root, 'mvp-blackbox-budget-denied'));

    const spoofInput = await writeOperatorInput(
      temporary,
      'mvp-blackbox-spoof',
      { spoofVerification: true },
    );
    const spoofed = await failedCommand([
      'run',
      spoofInput,
      '--root',
      root,
      '--json',
    ]);
    assert(
      `${String(spoofed.error)}:${String(spoofed.message)}`.includes(
        'UNTRUSTED_ENTAILMENT',
      ),
      'arbitrary verifier authority was not rejected by name',
    );
    await verifySpoofFailedClosed(join(root, 'mvp-blackbox-spoof'));

    const tamperedRoot = join(temporary, 'tampered');
    await cp(programDirectory, tamperedRoot, { recursive: true });
    const receiptPath = join(tamperedRoot, 'receipt.json');
    const tamperedReceipt = record(await readJson(receiptPath), 'receipt');
    tamperedReceipt.integrityHash = `sha256:${'0'.repeat(64)}`;
    await writeFile(receiptPath, `${JSON.stringify(tamperedReceipt)}\n`);
    await expectFailure(
      () =>
        verifyArtifacts(
          { ...inspection, receipt: tamperedReceipt },
          tamperedRoot,
        ),
      'receipt integrity hash',
    );
    const tamperedAudit = structuredClone(
      record(inspection.audit, 'audit tamper source'),
    );
    const tamperedEvents = records(
      tamperedAudit.events,
      'tampered audit events',
    );
    const event = tamperedEvents[2] ?? fail('missing audit tamper target');
    event.stage = 'completed';
    await expectFailure(
      () =>
        Promise.resolve().then(() => {
          verifyAudit(tamperedAudit, 'mvp-blackbox-complete');
        }),
      'audit stage',
    );
    const tamperedCancellation = structuredClone(cancellationReceipt);
    tamperedCancellation.integrityHash = `sha256:${'0'.repeat(64)}`;
    await expectFailure(
      () =>
        Promise.resolve().then(() => {
          verifyCancellationReceipt(tamperedCancellation);
        }),
      'cancellation receipt integrity',
    );

    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        verifier: 'mammoth-mvp-blackbox-v1',
        programId: 'mvp-blackbox-complete',
        checks: [
          'built-cli-fresh-processes',
          'pause-resume',
          'status-inspect',
          'claim-policy-locator-snapshot-traces',
          'cas-digests',
          'receipt-and-artifact-integrity',
          'budget-reservation-and-commit',
          'budget-denial-before-transport',
          'durable-revalidation-schedule',
          'verifier-authority-spoof-rejection',
          'idempotent-rerun',
          'durable-honest-partial-cancellation',
          'tamper-rejection',
        ],
        ...(keep ? { artifactRoot: temporary } : {}),
      })}\n`,
    );
  } catch (error: unknown) {
    process.stderr.write(
      `MVP_VERIFY_FAILED:${error instanceof Error ? error.message : String(error)}\nartifactRoot=${temporary}\n`,
    );
    throw error;
  } finally {
    if (!keep) await rm(temporary, { recursive: true, force: true });
  }
}

async function verifyCommittedBudget(directory: string): Promise<void> {
  const governance = record(
    await readJson(join(directory, 'governance.json')),
    'governance',
  );
  const budgets = record(governance.budgets, 'governance.budgets');
  const accounts = records(budgets.accounts, 'governance.budgets.accounts');
  const reservations = records(
    budgets.reservations,
    'governance.budgets.reservations',
  );
  assertEqual(accounts.length, 1, 'runtime budget account count');
  assertEqual(reservations.length, 1, 'runtime budget reservation count');
  const account = accounts[0] ?? fail('missing runtime budget account');
  const reservation = reservations[0] ?? fail('missing runtime reservation');
  assertEqual(reservation.accountId, account.id, 'reservation account');
  assertEqual(reservation.state, 'committed', 'reservation terminal state');
  const limit = record(account.limit, 'budget limit');
  const spent = record(account.spent, 'budget spent');
  for (const unit of ['costUsd', 'tokens', 'durationMs']) {
    const maximum = number(limit[unit], `budget limit ${unit}`);
    const actual = number(spent[unit], `budget spent ${unit}`);
    assert(actual <= maximum, `budget ${unit} exceeded its pinned limit`);
  }
  const audit = records(budgets.audit, 'governance.budgets.audit');
  assertEqual(
    audit.map((event) => event.kind).join(','),
    'budget.account_created,budget.reserved,budget.committed',
    'budget audit lifecycle',
  );
}

async function verifyDurableCancellation(
  directory: string,
  cancellation: Record<string, unknown>,
): Promise<void> {
  const workflow = record(
    await readJson(join(directory, 'workflow.json')),
    'cancelled workflow store',
  );
  const executions = record(workflow.executions, 'workflow.executions');
  const entries = Object.values(executions).map((value, index) =>
    record(value, `workflow.executions[${String(index)}]`),
  );
  assertEqual(entries.length, 1, 'cancelled execution count');
  const execution = entries[0] ?? fail('missing cancelled execution');
  assertEqual(execution.status, 'cancelled', 'persisted cancellation status');
  assertEqual(
    canonicalJson(execution.cancellation),
    canonicalJson(cancellation),
    'persisted cancellation partial receipt',
  );
}

async function verifyBudgetDenial(directory: string): Promise<void> {
  assert(
    !(await fileExists(join(directory, 'queue.json'))),
    'budget-denied run created queue state before authorization',
  );
  assert(
    !(await fileExists(join(directory, 'snapshot.json'))),
    'budget-denied run invoked transport or committed a snapshot',
  );
  const governance = record(
    await readJson(join(directory, 'governance.json')),
    'denied governance',
  );
  const budgets = record(governance.budgets, 'denied governance budgets');
  const audit = records(budgets.audit, 'denied budget audit');
  assert(
    audit.some(
      (event) =>
        event.kind === 'budget.reservation_denied' &&
        event.outcome === 'denied' &&
        event.reason === 'budget_exhausted',
    ),
    'budget denial was not durably audited',
  );
}

async function verifySpoofFailedClosed(directory: string): Promise<void> {
  for (const name of [
    'ledger.json',
    'manifest.json',
    'dossier.md',
    'receipt.json',
  ]) {
    assert(
      !(await fileExists(join(directory, name))),
      `spoofed verification emitted authoritative artifact ${name}`,
    );
  }
  const workflow = record(
    await readJson(join(directory, 'workflow.json')),
    'spoof workflow',
  );
  const executions = Object.values(
    record(workflow.executions, 'spoof executions'),
  ).map((entry, index) => record(entry, `spoof execution ${String(index)}`));
  assert(
    executions.some(
      (execution) =>
        execution.status === 'failed' &&
        String(execution.error).includes('UNTRUSTED_ENTAILMENT'),
    ),
    'spoof rejection was not preserved in durable workflow state',
  );
}

function verifyRevalidation(
  artifact: Record<string, unknown>,
  programId: string,
): void {
  assertEqual(artifact.schemaVersion, 1, 'revalidation schema');
  assertEqual(artifact.programId, programId, 'revalidation program');
  const schedules = records(artifact.schedules, 'revalidation schedules');
  assertEqual(schedules.length, 1, 'revalidation schedule count');
  const schedule = schedules[0] ?? fail('missing revalidation schedule');
  assertEqual(schedule.subjectType, 'evidence', 'revalidation subject type');
  assertEqual(
    schedule.subjectId,
    `${programId}:evidence:snapshot`,
    'revalidation subject',
  );
  assertEqual(
    schedule.dueAt,
    '2099-01-01T00:00:00.000Z',
    'revalidation due time',
  );
}

function verifyCancellationReceipt(receipt: Record<string, unknown>): void {
  const body = { ...receipt };
  delete body.integrityHash;
  assertEqual(
    receipt.integrityHash,
    canonicalDigest(body),
    'cancellation receipt integrity',
  );
  assertEqual(receipt.status, 'cancelled', 'cancellation receipt status');
  const completed = array(
    receipt.completedStages,
    'cancellation completed stages',
  );
  const omitted = array(receipt.omittedStages, 'cancellation omitted stages');
  const stages = [
    'budget_committed',
    'snapshot_committed',
    'claims_assessed',
    'ledger_committed',
    'report_compiled',
    'receipt_committed',
  ];
  assert(
    completed.every((stage) => stages.includes(String(stage))),
    'cancellation receipt contains an unknown completed stage',
  );
  assert(
    omitted.every((stage) => stages.includes(String(stage))),
    'cancellation receipt contains an unknown omitted stage',
  );
  assertEqual(
    canonicalJson([...completed, ...omitted].sort()),
    canonicalJson([...stages].sort()),
    'cancellation completed/omitted partition',
  );
  assert(
    omitted.includes('receipt_committed'),
    'partial cancellation must omit completion receipt stage',
  );
}

async function writeOperatorInput(
  directory: string,
  programId: string,
  options: {
    revalidate?: boolean;
    denyBudget?: boolean;
    spoofVerification?: boolean;
  } = {},
): Promise<string> {
  const path = join(directory, `${programId}.json`);
  await writeFile(
    path,
    `${JSON.stringify({
      schemaVersion: 1,
      charter: {
        programId,
        criterionId: 'criterion:mvp-example-domains:v1',
        title: 'Reserved example domains',
        question:
          'Which example domain is reserved, and is HTTPS reachability guaranteed?',
        sourceUrl: 'https://www.rfc-editor.org/rfc/rfc2606.txt',
        evidencePolicyId: 'policy:public-direct-locator-v1',
        evidencePolicyVersion: '1.0.0',
        ...(options.revalidate
          ? { sourceRevalidateAfter: '2099-01-01T00:00:00.000Z' }
          : {}),
        ...(options.denyBudget
          ? {
              budgetLimit: { costUsd: 0, tokens: 0, durationMs: 0 },
            }
          : {}),
        proposals: [
          {
            id: supportedClaimId,
            canonicalText: 'IANA reserves example.com for use as an example.',
            subject: 'IANA',
            predicate: 'reserves for use as an example',
            object: 'example.com',
            supportingQuote:
              'The Internet Assigned Numbers Authority (IANA) also currently has the\nfollowing second level domain names reserved which can be used as examples.\n\nexample.com',
            locator: { startOffset: 95, endOffset: 253 },
          },
          {
            id: unresolvedClaimId,
            canonicalText:
              'IANA guarantees that example.com remains reachable over HTTPS.',
            subject: 'IANA',
            predicate: 'guarantees HTTPS reachability',
            object: 'example.com',
            supportingQuote: 'No HTTPS guarantee appears in this source.',
          },
        ],
      },
      verifications: {
        [supportedClaimId]: {
          entails: true,
          receiptId: 'verification:rfc2606-example-com',
          verifierId: options.spoofVerification
            ? 'operator-self-attestation'
            : 'mvp-deterministic-fixture-verifier',
          verifierVersion: '1.0.0',
        },
        [unresolvedClaimId]: {
          entails: false,
          receiptId: 'verification:rfc2606-no-https-guarantee',
          verifierId: 'mvp-deterministic-fixture-verifier',
          verifierVersion: '1.0.0',
        },
      },
      sourceFixture: {
        path: fixtureSource,
        digest: sourceDigest,
        mediaType: 'text/plain',
      },
      ...(options.denyBudget
        ? {
            retrievalUsage: {
              estimated: { costUsd: 0, tokens: 0, durationMs: 1 },
              actual: { costUsd: 0, tokens: 0, durationMs: 1 },
            },
          }
        : {}),
    })}\n`,
  );
  return path;
}

async function command(
  args: readonly string[],
): Promise<Record<string, unknown>> {
  const result = await rawCommand(args);
  assert(!result.stderr.trim(), `unexpected stderr: ${result.stderr}`);
  const lines = result.stdout.trim().split('\n');
  assertEqual(lines.length, 1, 'JSON mode must emit exactly one stdout line');
  const commandName = args[0] ?? 'unknown';
  return record(JSON.parse(lines[0] ?? ''), `CLI ${commandName} output`);
}

async function rawCommand(args: readonly string[]): Promise<CommandResult> {
  const result = await executeFile(process.execPath, [cli, ...args], {
    cwd: repository,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  return { stdout: result.stdout, stderr: result.stderr };
}

async function failedCommand(
  args: readonly string[],
): Promise<Record<string, unknown>> {
  try {
    await rawCommand(args);
  } catch (error: unknown) {
    const failure = error as {
      stdout?: unknown;
      stderr?: unknown;
      code?: unknown;
    };
    assertEqual(failure.stdout ?? '', '', 'failed command stdout');
    assert(
      typeof failure.stderr === 'string' && failure.stderr.trim().length > 0,
      'failed command omitted JSON stderr',
    );
    const lines = failure.stderr.trim().split('\n');
    assertEqual(lines.length, 1, 'failed command stderr line count');
    return record(
      JSON.parse(lines[0] ?? ''),
      `CLI ${args[0] ?? '<unknown>'} failure`,
    );
  }
  return fail(`command unexpectedly succeeded: ${args.join(' ')}`);
}

async function verifyArtifacts(
  inspection: Record<string, unknown>,
  directory: string,
): Promise<void> {
  assertEqual(inspection.command, 'inspect', 'inspection command');
  const charterEnvelope = record(inspection.charter, 'charter envelope');
  const charter = record(charterEnvelope.charter, 'pinned charter');
  assertEqual(
    charterEnvelope.digest,
    canonicalDigest(charter),
    'pinned charter digest',
  );
  const ledger = record(inspection.ledger, 'ledger');
  const manifest = record(inspection.manifest, 'manifest');
  const assessmentsExport = record(inspection.assessments, 'assessments');
  const receipt = record(inspection.receipt, 'receipt');
  const audit = record(inspection.audit, 'audit');
  const traces = array(inspection.traces, 'traces');
  const report = text(inspection.report, 'report');

  const claims = records(ledger.claims, 'ledger.claims');
  const assessments = records(ledger.assessments, 'ledger.assessments');
  const evidence = records(ledger.evidence, 'ledger.evidence');
  const edges = records(ledger.claimEvidenceEdges, 'ledger.claimEvidenceEdges');
  const supported = requiredById(claims, supportedClaimId, 'supported claim');
  const unresolved = requiredById(
    claims,
    unresolvedClaimId,
    'unresolved claim',
  );
  assertEqual(supported.status, 'supported', 'supported claim status');
  assertEqual(unresolved.status, 'unresolved', 'unresolved claim status');
  assert(
    report.includes(text(supported.canonicalText, 'supported canonicalText')),
    'dossier omits supported fact',
  );
  assert(
    !report.includes(
      text(unresolved.canonicalText, 'unresolved canonicalText'),
    ),
    'unresolved claim rendered as factual prose',
  );
  assert(
    report.includes(`\`${unresolvedClaimId}\``),
    'unresolved claim is not visibly identified',
  );
  assertStringArray(manifest.claimIds, [supportedClaimId, unresolvedClaimId]);
  assertStringArray(manifest.unresolvedIssueIds, [unresolvedClaimId]);

  assertEqual(traces.length, 1, 'supported sentence trace count');
  const trace = record(traces[0], 'trace');
  assertEqual(trace.sentence, supported.canonicalText, 'trace sentence');
  const bindings = records(trace.bindings, 'trace.bindings');
  assertEqual(bindings.length, 1, 'trace binding count');
  const binding = bindings[0] ?? fail('missing trace binding');
  assertEqual(binding.claimId, supportedClaimId, 'binding claim');
  const assessment = requiredById(
    assessments,
    String(binding.assessmentId),
    'bound assessment',
  );
  assertEqual(assessment.verdict, 'supported', 'assessment verdict');
  assertEqual(binding.policyId, assessment.policyId, 'named policy ID');
  assertEqual(
    binding.policyVersion,
    assessment.policyVersion,
    'named policy version',
  );
  const artifact = requiredById(
    evidence,
    String(binding.evidenceId),
    'bound evidence',
  );
  assertEqual(
    binding.snapshotDigest,
    artifact.contentDigest,
    'snapshot binding',
  );
  assertEqual(binding.snapshotDigest, sourceDigest, 'source digest oracle');
  const edge = edges.find(
    (candidate) =>
      candidate.claimId === supportedClaimId &&
      candidate.evidenceId === artifact.id,
  );
  assert(edge, 'no claim-evidence edge for trace binding');
  assertEqual(
    canonicalJson(binding.locator),
    canonicalJson(record(edge.locator, 'edge.locator')),
    'exact locator binding',
  );
  const locator = record(binding.locator, 'binding.locator');
  assertEqual(locator.startOffset, 95, 'locator start');
  assertEqual(locator.endOffset, 253, 'locator end');

  const snapshotEnvelope = record(
    await readJson(join(directory, 'snapshot.json')),
    'snapshot envelope',
  );
  const snapshot = record(snapshotEnvelope.snapshot, 'snapshot');
  assertEqual(
    snapshotEnvelope.canonicalDigest,
    canonicalDigest(snapshot),
    'snapshot metadata digest',
  );
  const contentObject = record(snapshot.contentObject, 'content CAS object');
  const parsedObject = record(snapshot.parsedObject, 'parsed CAS object');
  await assertFileDigest(
    text(contentObject.path, 'content object path'),
    text(snapshot.contentDigest, 'snapshot digest'),
  );
  await assertFileDigest(
    text(parsedObject.path, 'parsed object path'),
    text(parsedObject.digest, 'parsed digest'),
  );

  const exportedClaims = records(assessmentsExport.claims, 'export claims');
  const exportedAssessments = records(
    assessmentsExport.assessments,
    'export assessments',
  );
  assertEqual(
    canonicalJson(exportedClaims),
    canonicalJson(claims),
    'assessment claim export',
  );
  assertEqual(
    canonicalJson(exportedAssessments),
    canonicalJson(assessments),
    'assessment export',
  );

  const receiptBody = { ...receipt };
  delete receiptBody.integrityHash;
  assertEqual(
    receipt.integrityHash,
    canonicalDigest(receiptBody),
    'receipt integrity hash',
  );
  const receiptArtifacts = record(receipt.artifacts, 'receipt artifacts');
  assertEqual(
    receiptArtifacts.ledger,
    canonicalDigest(ledger),
    'ledger receipt digest',
  );
  assertEqual(
    receiptArtifacts.manifest,
    canonicalDigest(manifest),
    'manifest receipt digest',
  );
  assertEqual(
    receiptArtifacts.traces,
    canonicalDigest(traces),
    'traces receipt digest',
  );
  assertEqual(
    receiptArtifacts.report,
    canonicalDigest(report.endsWith('\n') ? report.slice(0, -1) : report),
    'report receipt digest',
  );
  verifyAudit(audit, String(charter.programId));
}

function verifyAudit(audit: Record<string, unknown>, programId: string): void {
  assertEqual(audit.schemaVersion, 1, 'audit schema version');
  assertEqual(audit.streamId, `${programId}:runtime-audit`, 'audit stream ID');
  const events = records(audit.events, 'audit.events');
  const expectedStages = [
    'budget_committed',
    'snapshot_committed',
    'claims_assessed',
    'ledger_committed',
    'report_compiled',
    'receipt_committed',
    'completed',
  ];
  assertEqual(events.length, expectedStages.length, 'audit event count');
  let previousHash = 'GENESIS';
  for (const [sequence, event] of events.entries()) {
    assertEqual(event.sequence, sequence, 'audit sequence');
    assertEqual(event.stage, expectedStages[sequence], 'audit stage');
    assertEqual(event.programId, programId, 'audit program ID');
    assertEqual(event.previousHash, previousHash, 'audit previous hash');
    const body = { ...event };
    delete body.eventHash;
    assertEqual(event.eventHash, canonicalDigest(body), 'audit event hash');
    previousHash = text(event.eventHash, 'audit event hash');
  }
  assertEqual(audit.eventCount, events.length, 'audit checkpoint count');
  assertEqual(
    audit.highWaterSequence,
    events.length - 1,
    'audit high-water sequence',
  );
  assertEqual(audit.headHash, previousHash, 'audit checkpoint head');
}

function assertArtifactPresence(value: unknown): void {
  const presence = record(value, 'artifact presence');
  for (const name of [
    'charter.json',
    'workflow.json',
    'queue.json',
    'governance.json',
    'ledger.json',
    'snapshot.json',
    'assessments.json',
    'manifest.json',
    'traces.json',
    'dossier.md',
    'receipt.json',
    'audit.json',
    'revalidation.json',
  ]) {
    assertEqual(presence[name], true, `artifact ${name}`);
  }
}

async function assertFileDigest(path: string, expected: string): Promise<void> {
  const bytes = await readFile(path);
  assertEqual(digest(bytes), expected, `CAS digest ${path}`);
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error: unknown) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return false;
    }
    throw error;
  }
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(normalize);
  const source = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(source)
      .sort()
      .filter((key) => source[key] !== undefined)
      .map((key) => [key, normalize(source[key])]),
  );
}

function canonicalDigest(value: unknown): string {
  return digest(new TextEncoder().encode(canonicalJson(value)));
}

function digest(value: Uint8Array): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function record(value: unknown, name: string): Record<string, unknown> {
  assert(
    typeof value === 'object' && value !== null && !Array.isArray(value),
    `${name} must be an object`,
  );
  return value as Record<string, unknown>;
}

function records(value: unknown, name: string): Record<string, unknown>[] {
  return array(value, name).map((entry, index) =>
    record(entry, `${name}[${String(index)}]`),
  );
}

function array(value: unknown, name: string): unknown[] {
  assert(Array.isArray(value), `${name} must be an array`);
  return value;
}

function text(value: unknown, name: string): string {
  assert(typeof value === 'string' && value.length > 0, `${name} must be text`);
  return value;
}

function number(value: unknown, name: string): number {
  assert(
    typeof value === 'number' && Number.isFinite(value) && value >= 0,
    `${name} must be a finite non-negative number`,
  );
  return value;
}

function assertInstant(value: unknown, name: string): void {
  const instant = text(value, name);
  assert(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(instant) &&
      Number.isFinite(Date.parse(instant)),
    `${name} must be a UTC millisecond instant`,
  );
}

function requiredById(
  values: readonly Record<string, unknown>[],
  id: string,
  name: string,
): Record<string, unknown> {
  return (
    values.find((value) => value.id === id) ?? fail(`${name} missing: ${id}`)
  );
}

function assertStringArray(value: unknown, expected: readonly string[]): void {
  const actual = array(value, 'string array');
  assert(
    actual.every((entry) => typeof entry === 'string'),
    'array contains non-string value',
  );
  assertEqual(canonicalJson(actual), canonicalJson(expected), 'string array');
}

async function expectFailure(
  operation: () => Promise<void>,
  message: string,
): Promise<void> {
  try {
    await operation();
  } catch (error: unknown) {
    assert(
      error instanceof Error && error.message.includes(message),
      `unexpected tamper failure: ${String(error)}`,
    );
    return;
  }
  fail(`tampering did not fail: ${message}`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

function assertEqual(
  actual: unknown,
  expected: unknown,
  message: string,
): void {
  if (actual !== expected) {
    fail(
      `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function fail(message: string): never {
  throw new Error(message);
}

await main();
