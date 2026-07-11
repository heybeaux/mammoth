import { createHash } from 'node:crypto';
import { mkdir, open, readFile, realpath, rename } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
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
  type RuntimeAuditArtifact,
  type RuntimeAuditEvent,
  type RuntimeBudgetAmount,
  type RuntimeCharter,
  type RuntimeOptions,
  type RuntimeResult,
} from './types.js';

const WORKFLOW_NAME = 'mammoth.local-research-program';
const WORKFLOW_VERSION = 1;
const COMPILER_VERSION = '1.0.0';
const ZERO_USAGE = { costUsd: 0, tokens: 0, durationMs: 0 } as const;
const DEFAULT_BUDGET = { costUsd: 0, tokens: 0, durationMs: 1_000 } as const;
type PipelineTarget =
  | 'snapshot'
  | 'budget'
  | 'assessment'
  | 'ledger'
  | 'report'
  | 'receipt';

/** Runs the deterministic local MVP program and returns only after durable output exists. */
export async function runResearchProgram(
  options: RuntimeOptions,
): Promise<RuntimeResult> {
  validateCharter(options.charter);
  const pinnedUsage = options.retrievalUsage ?? {
    estimated: ZERO_USAGE,
    actual: ZERO_USAGE,
  };
  validateUsage(pinnedUsage.estimated, 'estimated retrieval usage');
  validateUsage(pinnedUsage.actual, 'actual retrieval usage');
  const paths = artifactPaths(options.rootDirectory, options.charter.programId);
  await mkdir(paths.programDirectory, { recursive: true });
  await assertContainedDirectory(options.rootDirectory, paths.programDirectory);
  const clock = options.now ?? (() => new Date());
  const evaluationTimestamp = await persistCharter(
    paths.charter,
    options.charter,
    clock().toISOString(),
    pinnedUsage,
  );
  const workflowStore = new LocalWorkflowStore(paths.workflow);
  const workflow = new WorkflowRuntime(workflowStore, {
    now: clock,
  });
  let result: RuntimeResult | undefined;
  const stableKey = `${options.charter.programId}:${WORKFLOW_NAME}:v${String(WORKFLOW_VERSION)}`;
  const pipelineStep = (id: string, target: PipelineTarget) => ({
    id,
    execute: async () => {
      const stageResult = await executePipeline(
        options,
        paths,
        stableKey,
        target,
        evaluationTimestamp,
      );
      if (stageResult) {
        result = stageResult;
        return { kind: 'complete' as const, output: stageResult };
      }
      return { kind: 'advance' as const, state: { [id]: 'committed' } };
    },
  });
  const definition: WorkflowDefinition<RuntimeCharter, RuntimeResult> = {
    name: WORKFLOW_NAME,
    version: WORKFLOW_VERSION,
    steps: [
      pipelineStep('commit-budget', 'budget'),
      pipelineStep('snapshot-source', 'snapshot'),
      pipelineStep('assess-claims', 'assessment'),
      pipelineStep('persist-ledger', 'ledger'),
      pipelineStep('compile-report', 'report'),
      pipelineStep('commit-receipt', 'receipt'),
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
  workflowIdempotencyKey: string,
  target: PipelineTarget,
  evaluationTimestamp: string,
): Promise<RuntimeResult | undefined> {
  const { charter } = options;
  const logicalExecutionId = `${charter.programId}:runtime:v${String(WORKFLOW_VERSION)}`;
  const now = evaluationTimestamp;
  const nowMs = Date.parse(now);
  const usage = options.retrievalUsage ?? {
    estimated: ZERO_USAGE,
    actual: ZERO_USAGE,
  };
  const workId = `${charter.programId}:retrieve`;
  const governanceStore = new LocalGovernanceStore(paths.governance);
  const governance =
    (await governanceStore.load(() => now)) ??
    new GovernanceCoordinator(governanceStore, () => now);
  const accountId = `${charter.programId}:budget`;
  if (!governance.getBudgetAccount(accountId)) {
    await governance.createBudgetAccount(
      {
        id: accountId,
        programId: charter.programId,
        limit: charter.budgetLimit ?? DEFAULT_BUDGET,
      },
      'runtime-local',
    );
  }
  const reservationId = `${charter.programId}:budget:runtime`;
  if (!governance.getBudgetReservation(reservationId)) {
    await governance.reserveBudget(
      {
        id: reservationId,
        accountId,
        workItemId: workId,
        idempotencyKey: `${workflowIdempotencyKey}:budget`,
        amount: usage.estimated,
      },
      'runtime-local',
    );
  }
  await options.onStage?.('budget_committed');
  if (target === 'budget') {
    await appendRuntimeAudit(
      paths.audit,
      charter.programId,
      now,
      'stage.committed',
      'budget_committed',
    );
    return undefined;
  }

  const work = new DurableWorkRuntime(
    new LocalWorkStateStore(paths.queue),
    () => nowMs,
  );
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
  await validateSnapshotIntegrity(snapshot);
  await writeJson(paths.snapshot, {
    schemaVersion: 1,
    kind: 'source_snapshot',
    programId: charter.programId,
    snapshot,
    canonicalDigest: canonicalDigest(snapshot),
  });
  await options.onStage?.('snapshot_committed');
  if (target === 'snapshot') {
    await appendRuntimeAudit(
      paths.audit,
      charter.programId,
      now,
      'stage.committed',
      'snapshot_committed',
    );
    return undefined;
  }

  if (governance.getBudgetReservation(reservationId)?.state === 'reserved') {
    await governance.commitBudget(reservationId, usage.actual, 'runtime-local');
  }

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
    ...(charter.sourceExpiresAt ? { expiresAt: charter.sourceExpiresAt } : {}),
    ...(charter.sourceRevalidateAfter
      ? { revalidateAfter: charter.sourceRevalidateAfter }
      : {}),
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
  let revalidationSchedule;
  const revalidationDueAt =
    charter.sourceRevalidateAfter ?? charter.sourceExpiresAt;
  if (revalidationDueAt) {
    const scheduleId = `${charter.programId}:revalidate:snapshot`;
    if (!governance.getRevalidation(scheduleId)) {
      await governance.scheduleRevalidation(
        {
          id: scheduleId,
          programId: charter.programId,
          subjectType: 'evidence',
          subjectId: evidence.id,
          dueAt: revalidationDueAt,
        },
        'runtime-local',
      );
    }
    revalidationSchedule = governance.getRevalidation(scheduleId);
  }
  await writeJson(paths.revalidation, {
    schemaVersion: 1,
    kind: 'revalidation_schedule',
    programId: charter.programId,
    schedules: revalidationSchedule ? [revalidationSchedule] : [],
  });
  const assessed = await Promise.all(
    charter.proposals.map(async (proposal, index) => {
      const discoveredOffset = snapshot.parsedArtifact.text.indexOf(
        proposal.supportingQuote,
      );
      const startOffset = proposal.locator?.startOffset ?? discoveredOffset;
      const endOffset =
        proposal.locator?.endOffset ??
        startOffset + proposal.supportingQuote.length;
      if (
        proposal.locator &&
        (startOffset < 0 ||
          endOffset < startOffset ||
          snapshot.parsedArtifact.text.slice(startOffset, endOffset) !==
            proposal.supportingQuote)
      ) {
        throw new RuntimeExecutionError(
          'INVALID_LOCATOR',
          `declared locator does not select supporting quote for ${proposal.id}`,
        );
      }
      const verification =
        discoveredOffset < 0
          ? undefined
          : await options.verifyEntailment({
              claim: proposal,
              sourceText: snapshot.parsedArtifact.text,
              quote: proposal.supportingQuote,
              locator: { startOffset, endOffset },
              snapshotDigest: snapshot.contentDigest,
            });
      if (
        verification &&
        (!verification.receiptId.trim() ||
          !verification.verifierId.trim() ||
          !verification.verifierVersion.trim())
      ) {
        throw new RuntimeExecutionError(
          'CLAIM_COMMIT_DENIED',
          `entailment verification for ${proposal.id} lacks an attributable receipt`,
        );
      }
      const edge: ClaimEvidenceEdge | undefined =
        discoveredOffset < 0 || !verification?.entails
          ? undefined
          : {
              id: `${proposal.id}:edge:source`,
              claimId: proposal.id,
              evidenceId: evidence.id,
              stance: 'supports',
              entailment: 'direct',
              locator: {
                startOffset,
                endOffset,
              },
              extractedByWorkItemId: `${charter.programId}:locate:${String(index)}`,
              checkedByWorkItemId: `${charter.programId}:assess:${String(index)}`,
              extractionDigest: canonicalDigest({
                quote: proposal.supportingQuote,
                startOffset,
                snapshotDigest: snapshot.contentDigest,
                entailmentVerification: verification,
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
            ...(evidence.expiresAt ? { expiresAt: evidence.expiresAt } : {}),
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
          freshness: verdict.status === 'expired' ? 0 : 1,
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
      return { claim, assessment, edge, verification };
    }),
  );
  await writeJson(paths.assessments, {
    schemaVersion: 1,
    kind: 'claim_assessments',
    programId: charter.programId,
    claims: assessed.map(({ claim }) => claim),
    assessments: assessed.map(({ assessment }) => assessment),
    edges: assessed.flatMap(({ edge }) => (edge ? [edge] : [])),
    verifications: assessed.flatMap(({ claim, verification }) =>
      verification ? [{ claimId: claim.id, ...verification }] : [],
    ),
    canonicalDigest: canonicalDigest(
      assessed.map(({ claim, assessment, edge }) => ({
        claim,
        assessment,
        edge,
      })),
    ),
  });
  await options.onStage?.('claims_assessed');
  if (target === 'assessment') {
    await appendRuntimeAudit(
      paths.audit,
      charter.programId,
      now,
      'stage.committed',
      'claims_assessed',
    );
    return undefined;
  }

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
  if (target === 'ledger') {
    await appendRuntimeAudit(
      paths.audit,
      charter.programId,
      now,
      'stage.committed',
      'ledger_committed',
    );
    return undefined;
  }
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
  const unresolvedSection = unresolved.length
    ? [
        '## Unresolved',
        '',
        ...unresolved.map(
          ({ claim }) =>
            `- \`${claim.id}\` — unresolved; excluded from supported findings.`,
        ),
      ].join('\n')
    : '';
  const dossier = [compilation.report.markdown, unresolvedSection]
    .filter(Boolean)
    .join('\n\n');
  await writeDurable(paths.report, `${dossier}\n`);
  await writeJson(paths.manifest, manifest);
  await writeJson(paths.traces, compilation.report.traces);
  await options.onStage?.('report_compiled');
  if (target === 'report') {
    await appendRuntimeAudit(
      paths.audit,
      charter.programId,
      now,
      'stage.committed',
      'report_compiled',
    );
    return undefined;
  }
  const receiptBody = {
    id: manifest.receiptId,
    programId: charter.programId,
    executionId: logicalExecutionId,
    status: 'completed',
    publicationStatus: 'evidence_complete',
    snapshotDigest: snapshot.contentDigest,
    supportedClaimIds: supported.map(({ claim }) => claim.id),
    unresolvedClaimIds: unresolved.map(({ claim }) => claim.id),
    artifacts: {
      ledger: canonicalDigest(persisted),
      manifest: canonicalDigest(manifest),
      report: canonicalDigest(dossier),
      traces: canonicalDigest(compilation.report.traces),
    },
    issuedAt: now,
  };
  await writeJson(paths.receipt, {
    ...receiptBody,
    integrityHash: canonicalDigest(receiptBody),
  });
  await options.onStage?.('receipt_committed');
  await appendRuntimeAudit(
    paths.audit,
    charter.programId,
    now,
    'stage.committed',
    'receipt_committed',
  );
  await appendRuntimeAudit(
    paths.audit,
    charter.programId,
    now,
    'runtime.completed',
    'completed',
  );
  return {
    programId: charter.programId,
    executionId: logicalExecutionId,
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
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(charter.programId)) {
    throw new RuntimeExecutionError(
      'INVALID_CHARTER',
      'programId must be a path-safe identifier',
    );
  }
  new URL(charter.sourceUrl);
  if (charter.budgetLimit) validateUsage(charter.budgetLimit, 'budget limit');
  for (const [label, timestamp] of [
    ['sourceExpiresAt', charter.sourceExpiresAt],
    ['sourceRevalidateAfter', charter.sourceRevalidateAfter],
  ] as const) {
    if (timestamp !== undefined && !Number.isFinite(Date.parse(timestamp)))
      throw new RuntimeExecutionError('INVALID_CHARTER', `${label} is invalid`);
  }
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
  const resolvedRoot = resolve(root);
  const programDirectory = resolve(resolvedRoot, programId);
  const location = relative(resolvedRoot, programDirectory);
  if (location.startsWith('..') || location === '') {
    throw new RuntimeExecutionError(
      'INVALID_CHARTER',
      'program directory escapes or aliases the runtime root',
    );
  }
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
    snapshot: join(programDirectory, 'snapshot.json'),
    assessments: join(programDirectory, 'assessments.json'),
    charter: join(programDirectory, 'charter.json'),
    audit: join(programDirectory, 'audit.json'),
    revalidation: join(programDirectory, 'revalidation.json'),
  };
}

async function persistCharter(
  path: string,
  charter: RuntimeCharter,
  proposedTimestamp: string,
  retrievalUsage: {
    estimated: RuntimeBudgetAmount;
    actual: RuntimeBudgetAmount;
  },
): Promise<string> {
  const digest = canonicalDigest(charter);
  const runtimeOptionsDigest = canonicalDigest({ retrievalUsage });
  try {
    const existing = JSON.parse(await readFile(path, 'utf8')) as {
      schemaVersion?: unknown;
      kind?: unknown;
      digest?: unknown;
      charter?: unknown;
      evaluationTimestamp?: unknown;
      runtimeOptionsDigest?: unknown;
    };
    if (
      existing.schemaVersion !== 1 ||
      existing.kind !== 'runtime_charter' ||
      existing.digest !== digest ||
      canonicalDigest(existing.charter) !== digest ||
      existing.runtimeOptionsDigest !== runtimeOptionsDigest ||
      typeof existing.evaluationTimestamp !== 'string' ||
      !Number.isFinite(Date.parse(existing.evaluationTimestamp))
    ) {
      throw new RuntimeExecutionError(
        'INVALID_CHARTER',
        'resume charter differs from the pinned durable charter',
      );
    }
    return existing.evaluationTimestamp;
  } catch (error: unknown) {
    if (!isMissing(error)) throw error;
  }
  await writeJson(path, {
    schemaVersion: 1,
    kind: 'runtime_charter',
    workflow: { name: WORKFLOW_NAME, version: WORKFLOW_VERSION },
    digest,
    charter,
    evaluationTimestamp: proposedTimestamp,
    runtimeOptionsDigest,
    retrievalUsage,
  });
  return proposedTimestamp;
}

function validateUsage(value: RuntimeBudgetAmount, label: string) {
  if (
    !Number.isFinite(value.costUsd) ||
    value.costUsd < 0 ||
    !Number.isInteger(value.tokens) ||
    value.tokens < 0 ||
    !Number.isInteger(value.durationMs) ||
    value.durationMs < 0
  ) {
    throw new RuntimeExecutionError('INVALID_CHARTER', `${label} is invalid`);
  }
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

async function assertContainedDirectory(root: string, child: string) {
  const realRoot = await realpath(root);
  const realChild = await realpath(child);
  const location = relative(realRoot, realChild);
  if (location.startsWith('..') || location === '') {
    throw new RuntimeExecutionError(
      'INVALID_CHARTER',
      'program directory resolves outside the runtime root',
    );
  }
}

async function validateSnapshotIntegrity(
  snapshot: SourceSnapshot,
): Promise<void> {
  const content = await readFile(snapshot.contentObject.path);
  const parsed = await readFile(snapshot.parsedObject.path);
  if (
    canonicalDigestBytes(content) !== snapshot.contentDigest ||
    canonicalDigestBytes(parsed) !== snapshot.parsedObject.digest
  ) {
    throw new RuntimeExecutionError(
      'ARTIFACT_INTEGRITY_FAILED',
      'snapshot CAS object failed digest validation',
    );
  }
}

function canonicalDigestBytes(bytes: Uint8Array): string {
  // FileContentStore performs the authoritative digest check. Reuse its CAS URI
  // algorithm through a temporary-free canonical byte digest calculation.
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

export async function verifyRuntimeAudit(
  path: string,
): Promise<RuntimeAuditArtifact> {
  const input = JSON.parse(await readFile(path, 'utf8')) as unknown;
  if (
    !isRecord(input) ||
    input.schemaVersion !== 1 ||
    typeof input.streamId !== 'string' ||
    !Array.isArray(input.events) ||
    typeof input.eventCount !== 'number' ||
    typeof input.highWaterSequence !== 'number' ||
    typeof input.headHash !== 'string'
  )
    throw new RuntimeExecutionError(
      'ARTIFACT_INTEGRITY_FAILED',
      'invalid runtime audit envelope',
    );
  let previousHash = 'GENESIS';
  for (const [sequence, value] of input.events.entries()) {
    if (
      !isRecord(value) ||
      value.sequence !== sequence ||
      value.previousHash !== previousHash ||
      typeof value.eventHash !== 'string'
    )
      throw new RuntimeExecutionError(
        'ARTIFACT_INTEGRITY_FAILED',
        'runtime audit sequence is invalid',
      );
    const body = auditBody(value as unknown as RuntimeAuditEvent);
    if (canonicalDigest(body) !== value.eventHash)
      throw new RuntimeExecutionError(
        'ARTIFACT_INTEGRITY_FAILED',
        'runtime audit hash is invalid',
      );
    previousHash = value.eventHash;
  }
  if (
    input.eventCount !== input.events.length ||
    input.highWaterSequence !== input.events.length - 1 ||
    input.headHash !== previousHash
  )
    throw new RuntimeExecutionError(
      'ARTIFACT_INTEGRITY_FAILED',
      'runtime audit checkpoint is invalid',
    );
  return input as unknown as RuntimeAuditArtifact;
}

async function appendRuntimeAudit(
  path: string,
  programId: string,
  occurredAt: string,
  kind: RuntimeAuditEvent['kind'],
  stage: RuntimeAuditEvent['stage'],
) {
  let artifact: RuntimeAuditArtifact;
  try {
    artifact = await verifyRuntimeAudit(path);
  } catch (error: unknown) {
    if (!isMissing(error)) throw error;
    artifact = {
      schemaVersion: 1,
      streamId: `${programId}:runtime-audit`,
      events: [],
      eventCount: 0,
      highWaterSequence: -1,
      headHash: 'GENESIS',
    };
  }
  const eventId = `${programId}:${kind}:${stage}`;
  if (artifact.events.some((event) => event.eventId === eventId)) return;
  const body = {
    eventId,
    sequence: artifact.events.length,
    previousHash: artifact.headHash,
    kind,
    stage,
    programId,
    occurredAt,
  };
  const event: RuntimeAuditEvent = {
    ...body,
    eventHash: canonicalDigest(body),
  };
  artifact.events.push(event);
  artifact.eventCount = artifact.events.length;
  artifact.highWaterSequence = event.sequence;
  artifact.headHash = event.eventHash;
  await writeJson(path, artifact);
}

function auditBody(event: RuntimeAuditEvent) {
  return {
    eventId: event.eventId,
    sequence: event.sequence,
    previousHash: event.previousHash,
    kind: event.kind,
    stage: event.stage,
    programId: event.programId,
    occurredAt: event.occurredAt,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
