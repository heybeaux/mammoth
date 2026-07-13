import { canonicalDigest } from '@mammoth/domain';
import {
  ObservatoryProjectionInputV1Schema,
  ObservatoryProjectionV1Schema,
  type ObservatoryProjectionInputV1,
  type ObservatoryProjectionV1,
} from './types.js';

function compareId(left: { id: string }, right: { id: string }): number {
  return left.id.localeCompare(right.id);
}

function edgeStatus(
  claimStatus: ObservatoryProjectionInputV1['claims'][number]['status'],
): ObservatoryProjectionV1['edges'][number]['status'] {
  if (claimStatus === 'expired' || claimStatus === 'revoked') return 'expired';
  if (claimStatus === 'contradicted') return 'rejected';
  if (
    claimStatus === 'observed' ||
    claimStatus === 'candidate' ||
    claimStatus === 'unresolved'
  )
    return 'unresolved';
  return 'active';
}

/** Builds a deterministic, read-only view from validated authoritative snapshots. */
export function buildObservatoryProjectionV1(
  input: unknown,
): ObservatoryProjectionV1 {
  const source = ObservatoryProjectionInputV1Schema.parse(input);
  validateRelationships(source);

  const assessments = new Map(
    source.assessments.map((assessment) => [assessment.id, assessment]),
  );
  const claimStatuses = new Map(
    source.claims.map((claim) => [claim.id, claim.status]),
  );
  const nodes: ObservatoryProjectionV1['nodes'] = [
    ...source.claims.map((claim) => {
      const assessment = claim.assessmentId
        ? assessments.get(claim.assessmentId)
        : undefined;
      return {
        kind: 'claim' as const,
        id: claim.id,
        canonicalText: claim.canonicalText,
        status: claim.status,
        ...(assessment
          ? {
              assessmentId: assessment.id,
              assessmentVerdict: assessment.verdict,
              policyId: assessment.policyId,
              policyVersion: assessment.policyVersion,
            }
          : {}),
        reasonCodes: assessment?.reasonCodes ?? [],
      };
    }),
    ...source.evidence.map((evidence) => ({
      kind: 'evidence' as const,
      id: evidence.id,
      evidenceKind: evidence.kind,
      contentDigest: evidence.contentDigest,
      storageUri: evidence.storageUri,
      sourceLineageId: evidence.sourceLineageId,
      retrievedAt: evidence.retrievedAt,
    })),
  ].sort(compareId);

  const evidenceEdges: ObservatoryProjectionV1['edges'] =
    source.claimEvidenceEdges.map((edge) => ({
      id: edge.id,
      from: edge.evidenceId,
      to: edge.claimId,
      kind: edge.stance,
      status: edgeStatus(claimStatuses.get(edge.claimId) ?? 'unresolved'),
      locator: edge.locator,
    }));
  const dependencyEdges: ObservatoryProjectionV1['edges'] =
    source.claimDependencies.map((edge) => ({
      id: edge.id,
      from: edge.claimId,
      to: edge.dependsOnClaimId,
      kind: 'depends_on',
      status: edgeStatus(claimStatuses.get(edge.claimId) ?? 'unresolved'),
      dependencyKind: edge.kind,
    }));

  const temporalExecution = source.temporalExecution
    ? {
        ...source.temporalExecution,
        events: [...source.temporalExecution.events].sort(compareTimeline),
        logs: [...source.temporalExecution.logs].sort(compareLog),
      }
    : undefined;
  const withoutDigest = {
    schemaVersion: 1 as const,
    generatedAt: source.generatedAt,
    sourceRevision: String(source.authoritativeRevision),
    program: {
      id: source.program.id,
      title: source.program.title,
      question: source.program.question,
      status: source.program.status,
      criterionId: source.criterion.id,
      criterionVersion: source.criterion.version,
      evidencePolicyId: source.program.evidencePolicyId,
      updatedAt: source.program.updatedAt,
    },
    nodes,
    edges: [...evidenceEdges, ...dependencyEdges].sort(compareId),
    timeline: [
      ...source.auditEvents,
      ...(temporalExecution?.events ?? []),
    ].sort(compareTimeline),
    ...(temporalExecution ? { temporalExecution } : {}),
    dossier: {
      manifestId: source.dossier.manifestId,
      artifactId: source.dossier.artifactId,
      sentences: [...source.dossier.traces].sort((left, right) =>
        left.factNodeId.localeCompare(right.factNodeId),
      ),
      excludedClaims: [...source.dossier.excludedClaims].sort((left, right) =>
        left.claimId.localeCompare(right.claimId),
      ),
    },
    integrity: {
      authoritativeRevision: source.authoritativeRevision,
      auditHeadHash: source.auditHeadHash,
      complete: source.complete,
      omissions: [...source.omissions].sort(),
    },
  };
  return ObservatoryProjectionV1Schema.parse({
    ...withoutDigest,
    integrity: {
      canonicalDigest: canonicalDigest(withoutDigest),
      ...withoutDigest.integrity,
    },
  });
}

function validateRelationships(source: ObservatoryProjectionInputV1): void {
  if (source.criterion.programId !== source.program.id)
    throw new Error('criterion does not belong to projected program');
  const claims = new Set(source.claims.map(({ id }) => id));
  const evidence = new Set(source.evidence.map(({ id }) => id));
  const assessments = new Map(
    source.assessments.map((assessment) => [assessment.id, assessment]),
  );
  const lineages = new Set(source.sourceLineages.map(({ id }) => id));
  assertUnique(source.claims, 'claim');
  assertUnique(source.evidence, 'evidence');
  assertUnique(source.assessments, 'assessment');
  assertUnique(source.claimEvidenceEdges, 'claim evidence edge');
  assertUnique(source.claimDependencies, 'claim dependency');
  assertUnique(source.sourceLineages, 'source lineage');
  assertUnique(source.auditEvents, 'audit event');
  for (const claim of source.claims) {
    if (claim.programId !== source.program.id)
      throw new Error(`claim ${claim.id} does not belong to projected program`);
    if (claim.assessmentId) {
      const assessment = assessments.get(claim.assessmentId);
      if (!assessment)
        throw new Error(`claim ${claim.id} references unknown assessment`);
      if (assessment.claimId !== claim.id)
        throw new Error(
          `claim ${claim.id} references another claim's assessment`,
        );
      if (
        ['supported', 'contradicted', 'unresolved', 'expired'].includes(
          claim.status,
        ) &&
        assessment.verdict !== claim.status
      )
        throw new Error(`claim ${claim.id} disagrees with its assessment`);
    }
  }
  for (const assessment of source.assessments) {
    if (!claims.has(assessment.claimId))
      throw new Error(`assessment ${assessment.id} references unknown claim`);
    if (assessment.evidenceIds.some((id) => !evidence.has(id)))
      throw new Error(
        `assessment ${assessment.id} references unknown evidence`,
      );
  }
  for (const artifact of source.evidence) {
    if (artifact.programId !== source.program.id)
      throw new Error(
        `evidence ${artifact.id} does not belong to projected program`,
      );
    if (!lineages.has(artifact.sourceLineageId))
      throw new Error(`evidence ${artifact.id} references unknown lineage`);
  }
  for (const edge of source.claimEvidenceEdges)
    if (!claims.has(edge.claimId) || !evidence.has(edge.evidenceId))
      throw new Error(`edge ${edge.id} has a dangling reference`);
  for (const edge of source.claimDependencies)
    if (!claims.has(edge.claimId) || !claims.has(edge.dependsOnClaimId))
      throw new Error(`dependency ${edge.id} has a dangling reference`);
  for (const excluded of source.dossier.excludedClaims)
    if (!claims.has(excluded.claimId))
      throw new Error(`excluded claim ${excluded.claimId} is unknown`);
  for (const event of source.auditEvents) {
    if (event.claimIds.some((id) => !claims.has(id)))
      throw new Error(`audit event ${event.id} references unknown claim`);
    if (event.evidenceIds.some((id) => !evidence.has(id)))
      throw new Error(`audit event ${event.id} references unknown evidence`);
  }
  const evidenceById = new Map(source.evidence.map((item) => [item.id, item]));
  const edgesByPair = new Map(
    source.claimEvidenceEdges.map((edge) => [
      `${edge.claimId}\u0000${edge.evidenceId}`,
      edge,
    ]),
  );
  for (const trace of source.dossier.traces) {
    for (const binding of trace.bindings) {
      if (!claims.has(binding.claimId) || !evidence.has(binding.evidenceId))
        throw new Error(
          `dossier fact ${trace.factNodeId} has a dangling binding`,
        );
      const assessment = assessments.get(binding.assessmentId);
      const artifact = evidenceById.get(binding.evidenceId);
      const edge = edgesByPair.get(
        `${binding.claimId}\u0000${binding.evidenceId}`,
      );
      if (
        !assessment ||
        assessment.claimId !== binding.claimId ||
        assessment.policyId !== binding.policyId ||
        assessment.policyVersion !== binding.policyVersion ||
        !assessment.evidenceIds.includes(binding.evidenceId) ||
        artifact?.contentDigest !== binding.snapshotDigest ||
        JSON.stringify(edge?.locator) !== JSON.stringify(binding.locator)
      )
        throw new Error(
          `dossier fact ${trace.factNodeId} does not match authoritative provenance`,
        );
    }
  }
  const orderedEvents = [...source.auditEvents].sort(
    (left, right) => left.sequence - right.sequence,
  );
  for (const [index, event] of orderedEvents.entries()) {
    if (event.sequence !== index + 1)
      throw new Error(`audit sequence gap at ${String(index + 1)}`);
    const previous = orderedEvents[index - 1];
    if (event.previousHash !== (previous?.eventHash ?? 'GENESIS'))
      throw new Error(
        `audit predecessor mismatch at ${String(event.sequence)}`,
      );
  }
  const finalEvent = orderedEvents.at(-1);
  if (finalEvent && finalEvent.eventHash !== source.auditHeadHash)
    throw new Error('audit head does not match the final projected event');
  if (source.temporalExecution) {
    const execution = source.temporalExecution;
    assertUnique(execution.events, 'Temporal operation event');
    assertUnique(
      execution.runChain.map(({ runId }) => ({ id: runId })),
      'Temporal run',
    );
    const auditIds = new Set(source.auditEvents.map(({ id }) => id));
    const runIds = new Set(execution.runChain.map(({ runId }) => runId));
    for (const [index, run] of execution.runChain.entries()) {
      const previous = execution.runChain[index - 1];
      if (
        run.continuedFromRunId !==
        (previous === undefined ? undefined : previous.runId)
      )
        throw new Error(
          `Temporal run ${run.runId} breaks continue-as-new chain`,
        );
    }
    if (execution.runChain.at(-1)?.runId !== execution.runId)
      throw new Error('Temporal current run does not match run chain head');
    for (const event of execution.events) {
      if (event.workflowId !== execution.workflowId || !runIds.has(event.runId))
        throw new Error(`Temporal event ${event.id} belongs to another run`);
      if (event.attempt > execution.attempt)
        throw new Error(
          `Temporal event ${event.id} references a future attempt`,
        );
      if (event.authoritativeRevision > source.authoritativeRevision)
        throw new Error(
          `Temporal event ${event.id} references a future authoritative revision`,
        );
      if (
        event.admittedAuditEventId &&
        !auditIds.has(event.admittedAuditEventId)
      )
        throw new Error(
          `Temporal event ${event.id} references unknown admitted audit event`,
        );
    }
    for (const log of execution.logs) {
      if (log.workflowId !== execution.workflowId || !runIds.has(log.runId))
        throw new Error('Temporal operation log belongs to another run');
      if (log.attempt !== undefined && log.attempt > execution.attempt)
        throw new Error('Temporal operation log references a future attempt');
    }
    const retryEvents = execution.events.filter(
      ({ kind }) => kind === 'retry',
    ).length;
    if (execution.metrics.retryCount !== retryEvents)
      throw new Error('Temporal retry metric disagrees with the timeline');
    const duplicatePreventionLogs = execution.logs.filter(
      ({ event }) => event === 'duplicate_effect_prevented',
    ).length;
    if (execution.metrics.duplicateEffectsPrevented !== duplicatePreventionLogs)
      throw new Error(
        'Temporal duplicate-effect metric disagrees with operation logs',
      );
    const failClosedStartupLogs = execution.logs.filter(
      ({ event }) => event === 'fail_closed_startup',
    ).length;
    if (execution.metrics.failClosedStartupCount !== failClosedStartupLogs)
      throw new Error(
        'Temporal fail-closed startup metric disagrees with operation logs',
      );
  }
}

function compareTimeline(
  left: { occurredAt: string; id: string },
  right: { occurredAt: string; id: string },
): number {
  return (
    left.occurredAt.localeCompare(right.occurredAt) ||
    left.id.localeCompare(right.id)
  );
}

function compareLog(
  left: { occurredAt: string; event: string },
  right: { occurredAt: string; event: string },
): number {
  return (
    left.occurredAt.localeCompare(right.occurredAt) ||
    left.event.localeCompare(right.event)
  );
}

function assertUnique(records: readonly { id: string }[], kind: string): void {
  const ids = new Set<string>();
  for (const record of records) {
    if (ids.has(record.id))
      throw new Error(`duplicate ${kind} id ${record.id}`);
    ids.add(record.id);
  }
}
