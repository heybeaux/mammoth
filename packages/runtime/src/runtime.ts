import { mkdir, open, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  canonicalDigest,
  canonicalJson,
  validateClaimTransition,
  type Claim,
  type ClaimAssessment,
  type ClaimEvidenceEdge,
  type EvidenceArtifact,
  type SourceLineage,
} from '@mammoth/domain';
import { evaluateEvidencePolicy } from '@mammoth/evidence';
import {
  GovernanceCoordinator,
  LocalGovernanceStore,
} from '@mammoth/governance';
import { LocalJsonLedger } from '@mammoth/persistence';
import {
  compileReport,
  type ReportCompilerInput,
  type ReportManifest,
} from '@mammoth/report-compiler';
import {
  FileContentStore,
  snapshotSource,
  type SourceSnapshot,
} from '@mammoth/retrieval';
import { DurableWorkRuntime, LocalWorkStateStore } from '@mammoth/work-queue';
import {
  LocalWorkflowStore,
  WorkflowRuntime,
  type WorkflowDefinition,
} from '@mammoth/workflow';
import {
  RuntimeExecutionError,
  type RuntimeArtifactPaths,
  type RuntimeCharter,
  type RuntimeOptions,
  type RuntimeResult,
} from './types.js';

const WORKFLOW_NAME = 'mammoth.local-research-program';
const WORKFLOW_VERSION = 1;
const COMPILER_VERSION = '1.0.0';
const ZERO_USAGE = { costUsd: 0, tokens: 0, durationMs: 0 } as const;

/** Runs the deterministic local MVP program and returns only after durable output exists. */
export async function runResearchProgram(
  options: RuntimeOptions,
): Promise<RuntimeResult> {
  validateCharter(options.charter);
  const paths = artifactPaths(options.rootDirectory, options.charter.programId);
  await mkdir(paths.programDirectory, { recursive: true });
  const clock = options.now ?? (() => new Date());
  const workflowStore = new LocalWorkflowStore(paths.workflow);
  const workflow = new WorkflowRuntime(workflowStore, {
    now: clock,
  });
  let result: RuntimeResult | undefined;
  const definition: WorkflowDefinition<RuntimeCharter, RuntimeResult> = {
    name: WORKFLOW_NAME,
    version: WORKFLOW_VERSION,
    steps: [
      {
        id: 'evidence-first-runtime',
        execute: async ({ executionId }) => {
          result = await executePipeline(
            options,
            paths,
            executionId,
            `${options.charter.programId}:${WORKFLOW_NAME}:v${String(WORKFLOW_VERSION)}:evidence-first-runtime`,
          );
          return { kind: 'complete', output: result };
        },
      },
    ],
  };
  workflow.register(definition);
  const executionBase = `${options.charter.programId}:runtime:v${String(WORKFLOW_VERSION)}`;
  const snapshot = await workflowStore.load();
  const prior = Object.values(snapshot.executions)
    .filter(
      ({ id }) =>
        id === executionBase || id.startsWith(`${executionBase}:resume:`),
    )
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const alreadyCompleted = prior.find(({ status }) => status === 'completed');
  if (alreadyCompleted) return alreadyCompleted.output as RuntimeResult;
  const latest = prior.at(-1);
  const executionId =
    latest?.status === 'failed'
      ? `${executionBase}:resume:${String(prior.length)}`
      : (latest?.id ?? executionBase);
  if (!latest || latest.status === 'failed')
    await workflow.start(WORKFLOW_NAME, options.charter, executionId);
  await workflow.runUntilIdle();
  const completed = await workflow.get(executionId);
  if (completed?.status !== 'completed') {
    throw new RuntimeExecutionError(
      'WORKFLOW_FAILED',
      completed?.error ?? 'runtime workflow failed without an error',
    );
  }
  return (result ?? completed.output) as RuntimeResult;
}

async function executePipeline(
  options: RuntimeOptions,
  paths: RuntimeArtifactPaths,
  executionId: string,
  workflowIdempotencyKey: string,
): Promise<RuntimeResult> {
  const { charter } = options;
  const now = (options.now ?? (() => new Date()))().toISOString();
  const nowMs = Date.parse(now);
  const work = new DurableWorkRuntime(
    new LocalWorkStateStore(paths.queue),
    () => nowMs,
  );
  const workId = `${charter.programId}:retrieve`;
  const queued = work.enqueue({
    id: workId,
    programId: charter.programId,
    kind: 'retrieve-and-snapshot',
    queue: 'retrieval',
    input: { sourceUrl: charter.sourceUrl },
    idempotencyKey: `${workflowIdempotencyKey}:retrieve`,
  });
  let snapshot: SourceSnapshot;
  if (queued.state === 'succeeded') {
    snapshot = queued.output as SourceSnapshot;
  } else {
    const claimed = work.claim('retrieval', 'runtime-local', 60_000);
    if (!claimed || claimed.item.id !== workId)
      throw new Error('RETRIEVAL_WORK_NOT_CLAIMABLE');
    const sideEffect = await work.executeExactlyOnce({
      idempotencyKey: `${workflowIdempotencyKey}:snapshot`,
      execute: async (idempotencyKey) => ({
        providerReceiptId: `local:${canonicalDigest(idempotencyKey)}`,
        result: await snapshotSource(
          { url: charter.sourceUrl },
          new FileContentStore(join(paths.programDirectory, 'cas')),
          {
            transport: options.transport,
            ...(options.resolveHost
              ? { resolveHost: options.resolveHost }
              : {}),
            ...(options.now ? { now: options.now } : {}),
          },
        ),
      }),
    });
    snapshot = sideEffect.result;
    work.complete(workId, claimed.leaseToken, snapshot);
  }
  await options.onStage?.('snapshot_committed');

  const governanceStore = new LocalGovernanceStore(paths.governance);
  const governance =
    (await governanceStore.load(() => now)) ??
    new GovernanceCoordinator(governanceStore, () => now);
  const accountId = `${charter.programId}:budget`;
  if (!governance.budgets.getAccount(accountId)) {
    governance.budgets.createAccount(
      {
        id: accountId,
        programId: charter.programId,
        limit: { costUsd: 0, tokens: 0, durationMs: 1_000 },
      },
      'runtime-local',
    );
  }
  const reservationId = `${charter.programId}:budget:runtime`;
  if (!governance.budgets.getReservation(reservationId)) {
    governance.budgets.reserve(
      {
        id: reservationId,
        accountId,
        workItemId: workId,
        idempotencyKey: `${workflowIdempotencyKey}:budget`,
        amount: ZERO_USAGE,
      },
      'runtime-local',
    );
  }
  if (governance.budgets.getReservation(reservationId)?.state === 'reserved') {
    governance.budgets.commit(reservationId, ZERO_USAGE, 'runtime-local');
  }
  await governance.checkpoint();

  const lineage: SourceLineage = {
    id: `${charter.programId}:lineage:source`,
    lineageType: 'primary',
    parentLineageIds: [],
    independenceScore: 1,
  };
  const evidence: EvidenceArtifact = {
    id: `${charter.programId}:evidence:snapshot`,
    programId: charter.programId,
    kind: 'web_snapshot',
    sourceUri: snapshot.finalUrl,
    retrievedAt: snapshot.retrievedAt,
    contentDigest: snapshot.contentDigest,
    storageUri: `cas://${snapshot.contentDigest}`,
    mediaType: snapshot.mediaType,
    byteLength: snapshot.contentSize,
    parserId: snapshot.parsedArtifact.parserId,
    parserVersion: snapshot.parsedArtifact.parserVersion,
    parsedArtifactId: `${charter.programId}:artifact:parsed`,
    sourceLineageId: lineage.id,
    upstreamEvidenceIds: [],
    injectionRisk: 'low',
    dataClassification: 'public',
  };
  const assessed = charter.proposals.map((proposal, index) => {
    const startOffset = snapshot.parsedArtifact.text.indexOf(
      proposal.supportingQuote,
    );
    const edge: ClaimEvidenceEdge | undefined =
      startOffset < 0
        ? undefined
        : {
            id: `${proposal.id}:edge:source`,
            claimId: proposal.id,
            evidenceId: evidence.id,
            stance: 'supports',
            entailment: 'direct',
            locator: {
              startOffset,
              endOffset: startOffset + proposal.supportingQuote.length,
            },
            extractedByWorkItemId: `${charter.programId}:locate:${String(index)}`,
            checkedByWorkItemId: `${charter.programId}:assess:${String(index)}`,
            extractionDigest: canonicalDigest({
              quote: proposal.supportingQuote,
              startOffset,
              snapshotDigest: snapshot.contentDigest,
            }),
          };
    const verdict = evaluateEvidencePolicy({
      claimId: proposal.id,
      artifacts: [
        {
          id: evidence.id,
          kind: evidence.kind,
          retrievedAt: evidence.retrievedAt,
          contentDigest: evidence.contentDigest,
          sourceLineageId: evidence.sourceLineageId,
        },
      ],
      edges: edge
        ? [
            {
              claimId: edge.claimId,
              evidenceId: edge.evidenceId,
              stance: edge.stance,
              entailment: edge.entailment,
              locator: {
                ...(edge.locator.startOffset === undefined
                  ? {}
                  : { startOffset: edge.locator.startOffset }),
                ...(edge.locator.endOffset === undefined
                  ? {}
                  : { endOffset: edge.locator.endOffset }),
              },
            },
          ]
        : [],
      evaluatedAt: now,
    });
    const assessment: ClaimAssessment = {
      id: `${proposal.id}:assessment`,
      claimId: proposal.id,
      policyId: charter.evidencePolicyId,
      policyVersion: charter.evidencePolicyVersion,
      verdict: verdict.status,
      reasonCodes: verdict.reasons,
      metrics: {
        evidenceCoverage: verdict.trusted ? 1 : 0,
        directEntailmentCoverage: verdict.trusted ? 1 : 0,
        sourceIndependence: verdict.trusted ? 1 : 0,
        freshness: 1,
        reproducibility: 1,
        contradictionWeight: 0,
        correlatedVerifierRisk: 0,
      },
      evidenceIds: verdict.acceptedEvidenceIds,
      evaluatedAt: now,
      evaluatorDigest: canonicalDigest({
        policyId: charter.evidencePolicyId,
        policyVersion: charter.evidencePolicyVersion,
        verdict,
      }),
    };
    const candidate: Claim = {
      id: proposal.id,
      programId: charter.programId,
      criterionId: charter.criterionId,
      version: 1,
      kind: 'external_fact',
      canonicalText: proposal.canonicalText,
      subject: proposal.subject,
      predicate: proposal.predicate,
      object: proposal.object,
      status: 'candidate',
      observedAt: now,
      recordedAt: now,
      contradictedByClaimIds: [],
      canonicalDigest: canonicalDigest({
        canonicalText: proposal.canonicalText,
        subject: proposal.subject,
        predicate: proposal.predicate,
        object: proposal.object,
      }),
    };
    const transition = validateClaimTransition(candidate, verdict.status, {
      authority: 'evidence_policy',
      assessment,
    });
    if (!transition.ok)
      throw new Error(`CLAIM_COMMIT_DENIED:${transition.code}`);
    const claim: Claim = {
      ...candidate,
      status: verdict.status,
      assessmentId: assessment.id,
    };
    return { claim, assessment, edge };
  });
  await options.onStage?.('claims_assessed');

  const ledger = new LocalJsonLedger(paths.ledger);
  await ledger.transact((draft) => {
    if (draft.evidence.some(({ id }) => id === evidence.id)) return;
    draft.sourceLineages.push(lineage);
    draft.evidence.push(evidence);
    draft.claims.push(...assessed.map(({ claim }) => claim));
    draft.assessments.push(...assessed.map(({ assessment }) => assessment));
    draft.claimEvidenceEdges.push(
      ...assessed.flatMap(({ edge }) => (edge ? [edge] : [])),
    );
  });
  const persisted = await ledger.read();
  await options.onStage?.('ledger_committed');
  const supported = assessed.filter(
    ({ claim }) => claim.status === 'supported',
  );
  const unresolved = assessed.filter(
    ({ claim }) => claim.status !== 'supported',
  );
  const manifest: ReportManifest = {
    id: `${charter.programId}:manifest`,
    programId: charter.programId,
    version: 1,
    templateId: `${charter.programId}:template`,
    claimIds: assessed.map(({ claim }) => claim.id),
    hypothesisIds: [],
    experimentRunIds: [],
    unresolvedIssueIds: unresolved.map(({ claim }) => claim.id),
    sourceFreshnessEvaluatedAt: now,
    compilerVersion: COMPILER_VERSION,
    outputArtifactIds: [`${charter.programId}:dossier`],
    receiptId: `${charter.programId}:receipt`,
  };
  const compilerInput: ReportCompilerInput = {
    manifest,
    template: {
      id: manifest.templateId,
      requiredStatuses: supported.length > 0 ? ['supported'] : [],
      sections: [
        {
          id: `${charter.programId}:findings`,
          title: charter.title,
          facts: supported.map(({ claim }) => ({
            id: `${claim.id}:fact`,
            sectionId: `${charter.programId}:findings`,
            textTemplate: claim.canonicalText,
            renderingData: {},
            claimIds: [claim.id],
            status: 'supported',
          })),
        },
      ],
    },
    claims: persisted.claims,
    assessments: persisted.assessments,
    evidence: persisted.evidence,
    edges: persisted.claimEvidenceEdges,
  };
  const compilation = compileReport(compilerInput);
  if (!compilation.ok) {
    throw new RuntimeExecutionError(
      'REPORT_COMPILATION_FAILED',
      compilation.issues.map(({ code }) => code).join(','),
    );
  }
  await writeDurable(paths.report, `${compilation.report.markdown}\n`);
  await writeJson(paths.manifest, manifest);
  await writeJson(paths.traces, compilation.report.traces);
  await options.onStage?.('report_compiled');
  const receiptBody = {
    id: manifest.receiptId,
    programId: charter.programId,
    executionId,
    status: 'completed',
    publicationStatus: 'evidence_complete',
    snapshotDigest: snapshot.contentDigest,
    supportedClaimIds: supported.map(({ claim }) => claim.id),
    unresolvedClaimIds: unresolved.map(({ claim }) => claim.id),
    artifacts: {
      ledger: canonicalDigest(persisted),
      manifest: canonicalDigest(manifest),
      report: canonicalDigest(compilation.report.markdown),
      traces: canonicalDigest(compilation.report.traces),
    },
    issuedAt: now,
  };
  await writeJson(paths.receipt, {
    ...receiptBody,
    integrityHash: canonicalDigest(receiptBody),
  });
  await governance.checkpoint();
  return {
    programId: charter.programId,
    executionId,
    status: 'completed',
    publicationStatus: 'evidence_complete',
    supportedClaimIds: receiptBody.supportedClaimIds,
    unresolvedClaimIds: receiptBody.unresolvedClaimIds,
    snapshotDigest: snapshot.contentDigest,
    paths,
  };
}

function validateCharter(charter: RuntimeCharter): void {
  const required = [
    charter.programId,
    charter.criterionId,
    charter.title,
    charter.question,
    charter.sourceUrl,
    charter.evidencePolicyId,
    charter.evidencePolicyVersion,
  ];
  if (required.some((value) => !value.trim()) || charter.proposals.length === 0)
    throw new RuntimeExecutionError(
      'INVALID_CHARTER',
      'required charter field missing',
    );
  new URL(charter.sourceUrl);
  if (
    new Set(charter.proposals.map(({ id }) => id)).size !==
    charter.proposals.length
  )
    throw new RuntimeExecutionError('INVALID_CHARTER', 'duplicate proposal id');
  for (const proposal of charter.proposals) {
    if (
      !proposal.id.trim() ||
      !proposal.canonicalText.trim() ||
      !proposal.subject.trim() ||
      !proposal.predicate.trim() ||
      !proposal.object.trim() ||
      !proposal.supportingQuote.trim()
    )
      throw new RuntimeExecutionError(
        'INVALID_CHARTER',
        'invalid claim proposal',
      );
    if (/[.!?]\s+\S/.test(proposal.canonicalText.trim()))
      throw new RuntimeExecutionError(
        'INVALID_CHARTER',
        'claim proposal is not atomic',
      );
  }
}

function artifactPaths(root: string, programId: string): RuntimeArtifactPaths {
  const programDirectory = join(root, programId);
  return {
    programDirectory,
    ledger: join(programDirectory, 'ledger.json'),
    workflow: join(programDirectory, 'workflow.json'),
    queue: join(programDirectory, 'queue.json'),
    governance: join(programDirectory, 'governance.json'),
    report: join(programDirectory, 'dossier.md'),
    manifest: join(programDirectory, 'manifest.json'),
    traces: join(programDirectory, 'traces.json'),
    receipt: join(programDirectory, 'receipt.json'),
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeDurable(path, `${canonicalJson(value)}\n`);
}

async function writeDurable(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${String(process.pid)}.${crypto.randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, path);
  const directory = await open(dirname(path), 'r');
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}
