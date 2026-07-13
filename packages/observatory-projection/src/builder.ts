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
    ...source.cells.map((cell) => ({
      kind: 'research_cell' as const,
      id: cell.id,
      cellPlanId: cell.cellPlanId,
      cellPlanVersion: cell.cellPlanVersion,
      branchId: cell.branchId,
      role: cell.role,
      status: cell.status,
      criterionId: cell.criterionId,
      criterionVersion: cell.criterionVersion,
      criterionDigest: cell.criterionDigest,
    })),
    ...source.positions.map((position) => ({
      kind: 'position' as const,
      id: position.id,
      status: position.status,
      criterionId: position.criterionId,
      criterionVersion: position.criterionVersion,
      criterionDigest: position.criterionDigest,
      modelProfileId: position.modelProfileVersionId,
      claimIds: [...position.claimIds].sort(),
      evidenceIds: [...position.evidenceIds].sort(),
    })),
    ...source.reviews.map((review) => ({
      kind: 'review' as const,
      id: review.id,
      assignmentId: review.assignmentId,
      verdict: review.verdict,
      status: review.status,
      reviewerModelProfileId: review.reviewerModelProfileVersionId,
    })),
    ...source.modelLineages.map((lineage) => ({
      kind: 'model_lineage' as const,
      id: lineage.id,
      provider: lineage.provider,
      family: lineage.family,
      checkpoint: lineage.checkpoint,
      modelProfileVersion: lineage.modelProfileVersion,
      unknownLineage: lineage.unknownLineage,
      ...(lineage.correlationGroupId === undefined
        ? {}
        : { correlationGroupId: lineage.correlationGroupId }),
    })),
    ...source.correlations.map((correlation) => ({
      kind: 'correlation' as const,
      id: correlation.id,
      policyVersion: correlation.policyVersion,
      score: correlation.score,
      status: correlation.status,
      reasonCodes: [...correlation.reasonCodes].sort(),
      modelLineageIds: [...correlation.modelLineageIds].sort(),
      contractDigest: correlation.contract.canonicalDigest,
    })),
    ...source.dissentReports.map((dissent) => ({
      kind: 'dissent' as const,
      id: dissent.id,
      status: dissent.status,
      reasonCodes: [...dissent.reasonCodes].sort(),
      positionIds: [...dissent.positionIds].sort(),
      claimIds: [...dissent.claimIds].sort(),
      evidenceIds: [...dissent.evidenceIds].sort(),
      criterionId: dissent.contract.criterionRef.criterionId,
      criterionVersion: dissent.contract.criterionRef.criterionVersion,
      criterionDigest: dissent.contract.criterionRef.criterionDigest,
      contractDigest: dissent.contract.canonicalDigest,
    })),
    ...source.rejectedResidue.map((residue) => ({
      kind: 'rejected_residue' as const,
      id: residue.id,
      sourceKind: residue.sourceKind,
      reasonCodes: [...residue.reasonCodes].sort(),
      retainedArtifactDigest: residue.retainedArtifactDigest,
    })),
    ...source.receipts.map((receipt) => ({
      kind: 'receipt' as const,
      id: receipt.id,
      workItemId: receipt.workItemId,
      status: receipt.status,
      artifactDigest: receipt.artifactDigest,
    })),
    ...source.isolationRuns.map((run) => ({
      kind: 'p5_isolation' as const,
      id: run.id,
      workflowId: run.workflowId,
      isolationProtocolVersion: run.isolationProtocolVersion,
      sanitizedContextContractVersion: run.sanitizedContextContractVersion,
      assignmentPolicyVersion: run.assignmentPolicyVersion,
      positionId: run.positionId,
      reviewId: run.reviewId,
      assignmentId: run.assignmentId,
      sanitizedContextDigest: run.sanitizedContextDigest,
      committedPositionDigest: run.committedPositionDigest,
      sequenceState: isolationSequenceState(run),
      authorAgentId: run.authorAttribution.authorAgentId,
      authorModelProfileVersionId:
        run.authorAttribution.authorModelProfileVersionId,
      reservationId: run.reservation.reservationId,
      reservedUsd: run.reservation.amountUsd,
      consumedUsd: run.settlement?.consumedUsd ?? 0,
      releasedUsd: run.settlement?.releasedUsd ?? 0,
      ...(run.cancellationReceiptId === undefined
        ? {}
        : { cancellationReceiptId: run.cancellationReceiptId }),
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
  const cellEdges: ObservatoryProjectionV1['edges'] = [
    ...source.positions.flatMap((position) => [
      {
        id: `${position.id}:proposed_by:${position.cellId}`,
        from: position.cellId,
        to: position.id,
        kind: 'has_position' as const,
        status: projectionStatus(position.status),
      },
      {
        id: `${position.id}:model:${position.modelProfileVersionId}`,
        from: position.modelProfileVersionId,
        to: position.id,
        kind: 'proposed_by' as const,
        status: projectionStatus(position.status),
      },
      ...position.claimIds.map((claimId) => ({
        id: `${position.id}:claim:${claimId}`,
        from: position.id,
        to: claimId,
        kind: 'references_claim' as const,
        status: projectionStatus(position.status),
      })),
      ...position.evidenceIds.map((evidenceId) => ({
        id: `${position.id}:evidence:${evidenceId}`,
        from: position.id,
        to: evidenceId,
        kind: 'references_evidence' as const,
        status: projectionStatus(position.status),
      })),
    ]),
    ...source.reviews.flatMap((review) => [
      {
        id: `${review.id}:cell:${review.cellId}`,
        from: review.cellId,
        to: review.id,
        kind: 'reviews' as const,
        status: projectionStatus(review.status),
      },
      {
        id: `${review.id}:position:${review.positionId}`,
        from: review.id,
        to: review.positionId,
        kind: 'reviews' as const,
        status: projectionStatus(review.status),
      },
      {
        id: `${review.id}:model:${review.reviewerModelProfileVersionId}`,
        from: review.reviewerModelProfileVersionId,
        to: review.id,
        kind: 'reviewed_by' as const,
        status: projectionStatus(review.status),
      },
      ...review.receiptIds.map((receiptId) => ({
        id: `${review.id}:receipt:${receiptId}`,
        from: review.id,
        to: receiptId,
        kind: 'emitted_receipt' as const,
        status: projectionStatus(review.status),
      })),
    ]),
    ...source.modelLineages.flatMap((lineage) =>
      lineage.parentModelLineageIds.map((parentId) => ({
        id: `${lineage.id}:derived_from:${parentId}`,
        from: lineage.id,
        to: parentId,
        kind: 'derived_from' as const,
        status: 'active' as const,
      })),
    ),
    ...source.correlations.flatMap((correlation) =>
      correlation.modelLineageIds.map((lineageId) => ({
        id: `${correlation.id}:lineage:${lineageId}`,
        from: correlation.id,
        to: lineageId,
        kind: 'correlates_with' as const,
        status:
          correlation.status === 'independent'
            ? ('active' as const)
            : ('unresolved' as const),
      })),
    ),
    ...source.dissentReports.flatMap((dissent) => [
      ...dissent.positionIds.map((positionId) => ({
        id: `${dissent.id}:position:${positionId}`,
        from: dissent.id,
        to: positionId,
        kind: 'dissents_from' as const,
        status: projectionStatus(dissent.status),
      })),
      ...dissent.claimIds.map((claimId) => ({
        id: `${dissent.id}:claim:${claimId}`,
        from: dissent.id,
        to: claimId,
        kind: 'references_claim' as const,
        status: projectionStatus(dissent.status),
      })),
      ...dissent.evidenceIds.map((evidenceId) => ({
        id: `${dissent.id}:evidence:${evidenceId}`,
        from: dissent.id,
        to: evidenceId,
        kind: 'references_evidence' as const,
        status: projectionStatus(dissent.status),
      })),
    ]),
    ...source.rejectedResidue.map((residue) => ({
      id: `${residue.id}:source:${residue.sourceId}`,
      from: residue.id,
      to: residue.sourceId,
      kind: 'rejected_for' as const,
      status: 'rejected' as const,
    })),
    ...source.cells.flatMap((cell) =>
      cell.receiptIds.map((receiptId) => ({
        id: `${cell.id}:receipt:${receiptId}`,
        from: cell.id,
        to: receiptId,
        kind: 'emitted_receipt' as const,
        status: projectionStatus(cell.status),
      })),
    ),
    ...source.isolationRuns.flatMap((run) => [
      {
        id: `${run.id}:position:${run.positionId}`,
        from: run.id,
        to: run.positionId,
        kind: 'references_claim' as const,
        status: isolationProjectionStatus(run),
      },
      {
        id: `${run.id}:review:${run.reviewId}`,
        from: run.id,
        to: run.reviewId,
        kind: 'reviews' as const,
        status: isolationProjectionStatus(run),
      },
      {
        id: `${run.id}:reservation:${run.reservation.receiptId}`,
        from: run.id,
        to: run.reservation.receiptId,
        kind: 'emitted_receipt' as const,
        status: isolationProjectionStatus(run),
      },
      ...(run.settlement === undefined
        ? []
        : [
            {
              id: `${run.id}:settlement:${run.settlement.receiptId}`,
              from: run.id,
              to: run.settlement.receiptId,
              kind: 'emitted_receipt' as const,
              status: isolationProjectionStatus(run),
            },
          ]),
      ...run.partialResultReceiptIds.map((receiptId) => ({
        id: `${run.id}:partial:${receiptId}`,
        from: run.id,
        to: receiptId,
        kind: 'emitted_receipt' as const,
        status: 'unresolved' as const,
      })),
    ]),
  ];

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
    edges: [...evidenceEdges, ...dependencyEdges, ...cellEdges].sort(compareId),
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
  const cells = new Set(source.cells.map(({ id }) => id));
  const cellsById = new Map(source.cells.map((cell) => [cell.id, cell]));
  const cellPlanIds = new Set(source.cells.map(({ contract }) => contract.id));
  const positions = new Set(source.positions.map(({ id }) => id));
  const reviews = new Set(source.reviews.map(({ id }) => id));
  const modelLineages = new Set(source.modelLineages.map(({ id }) => id));
  const correlations = new Set(source.correlations.map(({ id }) => id));
  const residues = new Set(source.rejectedResidue.map(({ id }) => id));
  const receipts = new Set(source.receipts.map(({ id }) => id));
  assertUnique(source.claims, 'claim');
  assertUnique(source.evidence, 'evidence');
  assertUnique(source.assessments, 'assessment');
  assertUnique(source.claimEvidenceEdges, 'claim evidence edge');
  assertUnique(source.claimDependencies, 'claim dependency');
  assertUnique(source.sourceLineages, 'source lineage');
  assertUnique(source.auditEvents, 'audit event');
  assertUnique(source.cells, 'cell');
  assertUnique(source.positions, 'position');
  assertUnique(source.reviews, 'review');
  assertUnique(source.modelLineages, 'model lineage');
  assertUnique(source.correlations, 'correlation');
  assertUnique(source.dissentReports, 'dissent');
  assertUnique(source.rejectedResidue, 'rejected residue');
  assertUnique(source.receipts, 'receipt');
  assertUnique(source.isolationRuns, 'P5 isolation run');
  assertAcyclic(
    source.sourceLineages.map(({ id, parentLineageIds }) => ({
      id,
      parents: parentLineageIds,
    })),
    'source lineage',
  );
  assertAcyclic(
    source.modelLineages.map(({ id, parentModelLineageIds }) => ({
      id,
      parents: parentModelLineageIds,
    })),
    'model lineage',
  );
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
  for (const cell of source.cells) {
    assertRecordDigest(cell, 'cell');
    assertNotFutureAuthority(cell, source.authoritativeRevision, 'cell');
    if (cell.programId !== source.program.id)
      throw new Error(`cell ${cell.id} does not belong to projected program`);
    if (
      cell.cellPlanId !== cell.contract.id ||
      cell.programId !== cell.contract.programId ||
      cell.criterionId !== cell.contract.criterionRef.criterionId ||
      cell.criterionVersion !== cell.contract.criterionRef.criterionVersion ||
      cell.criterionDigest !== cell.contract.criterionRef.criterionDigest ||
      cell.branchId !== cell.contract.branchId
    )
      throw new Error(`cell ${cell.id} drifts from authoritative contract`);
    if (
      cell.criterionId !== source.criterion.id ||
      cell.criterionVersion !== source.criterion.version ||
      cell.criterionDigest !== source.criterion.canonicalDigest
    )
      throw new Error(`cell ${cell.id} has criterion drift`);
    for (const receiptId of cell.receiptIds)
      if (!receipts.has(receiptId))
        throw new Error(`cell ${cell.id} references unknown receipt`);
  }
  for (const position of source.positions) {
    assertRecordDigest(position, 'position');
    assertNotFutureAuthority(
      position,
      source.authoritativeRevision,
      'position',
    );
    if (!cells.has(position.cellId))
      throw new Error(`position ${position.id} references unknown cell`);
    if (!modelLineages.has(position.modelProfileVersionId))
      throw new Error(
        `position ${position.id} references unknown model lineage`,
      );
    if (position.claimIds.some((id) => !claims.has(id)))
      throw new Error(`position ${position.id} references unknown claim`);
    if (position.evidenceIds.some((id) => !evidence.has(id)))
      throw new Error(`position ${position.id} references unknown evidence`);
    if (
      position.id !== position.contract.id ||
      cellsById.get(position.cellId)?.cellPlanId !==
        position.contract.cellPlanId ||
      position.modelProfileVersionId !==
        position.contract.modelProfileVersionId ||
      position.criterionVersion !==
        position.contract.criterionRef.criterionVersion
    )
      throw new Error(
        `position ${position.id} drifts from authoritative contract`,
      );
    if (
      position.criterionId !== source.criterion.id ||
      position.criterionVersion !== source.criterion.version ||
      position.criterionDigest !== source.criterion.canonicalDigest
    )
      throw new Error(`position ${position.id} has criterion drift`);
    if (
      position.rejectedResidueId !== undefined &&
      !residues.has(position.rejectedResidueId)
    )
      throw new Error(`position ${position.id} references unknown residue`);
  }
  for (const review of source.reviews) {
    assertRecordDigest(review, 'review');
    assertNotFutureAuthority(review, source.authoritativeRevision, 'review');
    if (!cells.has(review.cellId))
      throw new Error(`review ${review.id} references unknown cell`);
    if (!positions.has(review.positionId))
      throw new Error(`review ${review.id} references unknown position`);
    if (!modelLineages.has(review.reviewerModelProfileVersionId))
      throw new Error(`review ${review.id} references unknown model lineage`);
    if (
      review.id !== review.contract.id ||
      review.positionId !== review.contract.targetPositionId ||
      review.assignmentId !== review.contract.assignmentId ||
      review.reviewerModelProfileVersionId !==
        review.contract.reviewerModelProfileVersionId ||
      review.verdict !== review.contract.verdict
    )
      throw new Error(`review ${review.id} drifts from authoritative contract`);
    for (const receiptId of review.receiptIds)
      if (!receipts.has(receiptId))
        throw new Error(`review ${review.id} references unknown receipt`);
  }
  for (const lineage of source.modelLineages) {
    assertRecordDigest(lineage, 'model lineage');
    assertNotFutureAuthority(
      lineage,
      source.authoritativeRevision,
      'model lineage',
    );
    for (const parentId of lineage.parentModelLineageIds)
      if (!modelLineages.has(parentId))
        throw new Error(`model lineage ${lineage.id} has dangling parent`);
  }
  for (const correlation of source.correlations) {
    assertRecordDigest(correlation, 'correlation');
    assertNotFutureAuthority(
      correlation,
      source.authoritativeRevision,
      'correlation',
    );
    for (const lineageId of correlation.modelLineageIds)
      if (!modelLineages.has(lineageId))
        throw new Error(
          `correlation ${correlation.id} references unknown lineage`,
        );
  }
  for (const dissent of source.dissentReports) {
    assertRecordDigest(dissent, 'dissent');
    assertNotFutureAuthority(dissent, source.authoritativeRevision, 'dissent');
    if (dissent.contract.programId !== source.program.id)
      throw new Error(`dissent ${dissent.id} belongs to another program`);
    if (!cellPlanIds.has(dissent.contract.cellPlanId))
      throw new Error(`dissent ${dissent.id} references unknown cell plan`);
    if (
      dissent.contract.criterionRef.criterionId !== source.criterion.id ||
      dissent.contract.criterionRef.criterionVersion !==
        source.criterion.version ||
      dissent.contract.criterionRef.criterionDigest !==
        source.criterion.canonicalDigest
    )
      throw new Error(`dissent ${dissent.id} references unknown criterion`);
    if (dissent.positionIds.some((id) => !positions.has(id)))
      throw new Error(`dissent ${dissent.id} references unknown position`);
    if (dissent.claimIds.some((id) => !claims.has(id)))
      throw new Error(`dissent ${dissent.id} references unknown claim`);
    if (dissent.evidenceIds.some((id) => !evidence.has(id)))
      throw new Error(`dissent ${dissent.id} references unknown evidence`);
  }
  for (const residue of source.rejectedResidue) {
    assertRecordDigest(residue, 'rejected residue');
    assertNotFutureAuthority(
      residue,
      source.authoritativeRevision,
      'rejected residue',
    );
    const knownSource =
      (residue.sourceKind === 'position' && positions.has(residue.sourceId)) ||
      (residue.sourceKind === 'review' && reviews.has(residue.sourceId)) ||
      (residue.sourceKind === 'cell' && cells.has(residue.sourceId)) ||
      (residue.sourceKind === 'correlation' &&
        correlations.has(residue.sourceId));
    if (!knownSource)
      throw new Error(`rejected residue ${residue.id} has a dangling source`);
  }
  for (const receipt of source.receipts) {
    assertRecordDigest(receipt, 'receipt');
    assertNotFutureAuthority(receipt, source.authoritativeRevision, 'receipt');
  }
  for (const run of source.isolationRuns) {
    assertRecordDigest(run, 'P5 isolation run');
    assertNotFutureAuthority(
      run,
      source.authoritativeRevision,
      'P5 isolation run',
    );
    if (!positions.has(run.positionId))
      throw new Error(`P5 isolation run ${run.id} references unknown position`);
    if (!reviews.has(run.reviewId))
      throw new Error(`P5 isolation run ${run.id} references unknown review`);
    if (
      !receipts.has(run.reservation.receiptId) ||
      (run.settlement !== undefined &&
        !receipts.has(run.settlement.receiptId)) ||
      run.partialResultReceiptIds.some((id) => !receipts.has(id)) ||
      run.retryReceiptIds.some((id) => !receipts.has(id)) ||
      run.effectReceiptIds.some((id) => !receipts.has(id)) ||
      (run.cancellationReceiptId !== undefined &&
        !receipts.has(run.cancellationReceiptId))
    )
      throw new Error(`P5 isolation run ${run.id} references unknown receipt`);
    if (run.correlationId !== undefined && !correlations.has(run.correlationId))
      throw new Error(
        `P5 isolation run ${run.id} references unknown correlation`,
      );
    if (
      run.dissentId !== undefined &&
      !source.dissentReports.some((dissent) => dissent.id === run.dissentId)
    )
      throw new Error(`P5 isolation run ${run.id} references unknown dissent`);
    if (run.residueIds.some((id) => !residues.has(id)))
      throw new Error(`P5 isolation run ${run.id} references unknown residue`);
    assertP5Sequence(run.commitSequence, run.id);
    const position = source.positions.find(({ id }) => id === run.positionId);
    const review = source.reviews.find(({ id }) => id === run.reviewId);
    if (position?.contract.canonicalDigest !== run.committedPositionDigest)
      throw new Error(`P5 isolation run ${run.id} position digest mismatch`);
    if (
      run.revealedPositionDigest !== undefined &&
      run.revealedPositionDigest !== run.committedPositionDigest
    )
      throw new Error(`P5 isolation run ${run.id} reveal digest mismatch`);
    if (review?.assignmentId !== run.assignmentId)
      throw new Error(`P5 isolation run ${run.id} assignment mismatch`);
    const prohibited = new Set([
      'authorAgentId',
      'authorModelProfileVersionId',
      'authorModelProfileId',
      'authorProvider',
      'authorConfidence',
      'candidatePopularity',
      'previousReviewerVerdicts',
      'upstreamPassMarkers',
    ]);
    if (run.reviewerVisibleFields.some((field) => prohibited.has(field)))
      throw new Error(`P5 isolation run ${run.id} leaks reviewer context`);
    if (
      run.settlement !== undefined &&
      run.settlement.consumedUsd + run.settlement.releasedUsd >
        run.reservation.amountUsd
    )
      throw new Error(`P5 isolation run ${run.id} overspends reservation`);
    if (
      source.temporalExecution &&
      JSON.stringify(source.temporalExecution).includes(
        run.committedPositionDigest,
      )
    )
      throw new Error(
        `P5 isolation run ${run.id} hides product state in Temporal history`,
      );
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

function isolationSequenceState(
  run: ObservatoryProjectionInputV1['isolationRuns'][number],
): 'committed' | 'revealed' | 'reviewed' | 'settled' | 'partial' {
  if (run.cancellationReceiptId !== undefined) return 'partial';
  if (run.commitSequence.includes('budget_settled')) return 'settled';
  if (run.commitSequence.includes('review_committed')) return 'reviewed';
  if (run.commitSequence.includes('position_revealed')) return 'revealed';
  return 'committed';
}

function isolationProjectionStatus(
  run: ObservatoryProjectionInputV1['isolationRuns'][number],
): ObservatoryProjectionV1['edges'][number]['status'] {
  return run.cancellationReceiptId === undefined ? 'active' : 'unresolved';
}

function assertP5Sequence(sequence: readonly string[], id: string): void {
  const expected = [
    'budget_reserved',
    'position_dispatched',
    'position_committed',
    'position_revealed',
    'review_assigned',
    'review_committed',
    'budget_settled',
  ];
  let previousIndex = -1;
  for (const boundary of sequence) {
    const index = expected.indexOf(boundary);
    if (index <= previousIndex)
      throw new Error(`P5 isolation run ${id} has impossible sequence`);
    if (index !== previousIndex + 1)
      throw new Error(`P5 isolation run ${id} has impossible sequence`);
    previousIndex = index;
  }
}

function projectionStatus(
  status: string,
): ObservatoryProjectionV1['edges'][number]['status'] {
  if (status === 'rejected' || status === 'failed') return 'rejected';
  if (status === 'unresolved' || status === 'planned' || status === 'assigned')
    return 'unresolved';
  if (status === 'cancelled') return 'expired';
  return 'active';
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

function assertRecordDigest(
  record: { id: string; recordDigest: string },
  kind: string,
): void {
  const withoutDigest: Record<string, unknown> = { ...record };
  delete withoutDigest.recordDigest;
  const actual = canonicalDigest(withoutDigest);
  if (record.recordDigest !== actual)
    throw new Error(`${kind} ${record.id} digest mismatch`);
}

function assertNotFutureAuthority(
  record: { id: string; authoritativeRevision: number },
  authoritativeRevision: number,
  kind: string,
): void {
  if (record.authoritativeRevision > authoritativeRevision)
    throw new Error(`${kind} ${record.id} references future authority`);
}

function assertAcyclic(
  graph: readonly { id: string; parents: readonly string[] }[],
  kind: string,
): void {
  const records = new Map(graph.map((record) => [record.id, record.parents]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error(`${kind} cycle at ${id}`);
    visiting.add(id);
    for (const parent of records.get(id) ?? []) {
      if (!records.has(parent))
        throw new Error(`${kind} ${id} references dangling parent ${parent}`);
      visit(parent);
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of records.keys()) visit(id);
}
