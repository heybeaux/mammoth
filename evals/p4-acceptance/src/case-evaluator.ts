import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  MODEL_LINEAGE_POLICY_VERSION,
  RESEARCH_CELL_CONTRACT_VERSION,
  admitResearchPosition,
  admitResearchReview,
  admitSynthesis,
  assessModelCorrelation,
  canonicalDigest,
  cellInputDigest,
  correlationAssessmentDigest,
  dissentReportDigest,
  evaluatePositionProposals,
  modelProfileVersionDigest,
  researchPositionDigest,
  researchReviewDigest,
  synthesisArtifactDigest,
  validateModelLineageGraph,
  type CriterionReference,
  type CellInput,
  type CorrelationAssessment,
  type DissentReport,
  type ModelProfileVersion,
  type ReferenceUniverse,
  type ResearchPosition,
  type ResearchReview,
  type ReviewAssignment,
  type SynthesisArtifact,
} from '@mammoth/domain';
import { buildObservatoryProjectionV1 } from '@mammoth/observatory-projection';

export interface P4ExecutableCase {
  readonly id: string;
  readonly evaluator: string;
  readonly expected: string;
  readonly input: Record<string, unknown>;
}

export async function evaluateP4Case(
  testCase: P4ExecutableCase,
  repository: string,
): Promise<string> {
  switch (testCase.evaluator) {
    case 'unsupported_agreement': {
      const count = requiredNumber(testCase.input, 'supportingPositionCount');
      const universe = referenceUniverse();
      const proposals = Array.from({ length: count }, (_, index) =>
        position({ id: `position-${String(index + 1)}` }),
      );
      const evaluated = evaluatePositionProposals(proposals, universe);
      if (evaluated.admitted.length !== count) return 'proposal_rejected';
      const admittedClaimIds = new Set(
        testCase.input.claimAdmitted === true ? ['claim-known'] : [],
      );
      const decision = admitSynthesis({
        raw: synthesisArtifact(
          evaluated.admitted.map(({ id }) => id),
          ['claim-known'],
        ),
        universe,
        admittedClaimIds,
        admittedPositionIds: new Set(evaluated.admitted.map(({ id }) => id)),
      });
      return decision.ok ? 'promoted' : 'unsupported';
    }
    case 'model_correlation':
      return evaluateCorrelation(requiredString(testCase.input, 'scenario'));
    case 'review_admission':
      return evaluateReview(requiredString(testCase.input, 'scenario'));
    case 'position_admission':
      return evaluatePosition(requiredString(testCase.input, 'scenario'));
    case 'lineage_validation':
      return evaluateLineage(requiredString(testCase.input, 'scenario'));
    case 'rejected_residue': {
      if (requiredString(testCase.input, 'scenario') !== 'missing_claim')
        throw new Error('P4_FIXTURE_REJECTED_RESIDUE_SCENARIO');
      const universe = referenceUniverse();
      const proposal = position({ claimIds: ['missing-claim'] });
      const audit = evaluatePositionProposals([proposal], universe);
      return audit.admitted.length === 0 && audit.rejected.length === 1
        ? 'retained'
        : 'lost';
    }
    case 'projection_integrity':
      return evaluateProjectionIntegrity(testCase.input, repository);
    case 'projection_determinism':
      return evaluateProjectionDeterminism(testCase.input, repository);
    default:
      throw new Error(`P4_FIXTURE_UNKNOWN_EVALUATOR:${testCase.evaluator}`);
  }
}

function evaluateCorrelation(scenario: string): string {
  if (
    ![
      'alias_checkpoint',
      'unknown_lineage',
      'shared_derivation',
      'cross_family',
    ].includes(scenario)
  )
    throw new Error(`P4_FIXTURE_CORRELATION_SCENARIO:${scenario}`);
  const subject = modelVersion({ id: 'model-subject', family: 'family-a' });
  const candidate =
    scenario === 'alias_checkpoint'
      ? modelVersion({
          id: 'model-candidate',
          family: 'family-a',
          aliasOfVersionId: subject.id,
        })
      : scenario === 'unknown_lineage'
        ? modelVersion({
            id: 'model-candidate',
            family: 'family-b',
            lineageKind: 'unknown',
          })
        : scenario === 'shared_derivation'
          ? modelVersion({
              id: 'model-candidate',
              family: 'family-b',
              sharedDerivationIds: ['derivation-shared'],
            })
          : modelVersion({ id: 'model-candidate', family: 'family-b' });
  const correlatedSubject =
    scenario === 'shared_derivation'
      ? modelVersion({
          id: subject.id,
          family: subject.family,
          sharedDerivationIds: ['derivation-shared'],
        })
      : subject;
  const registry = new Map([
    [correlatedSubject.id, correlatedSubject],
    [candidate.id, candidate],
  ]);
  const result = assessModelCorrelation({
    subject: correlatedSubject,
    candidate,
    registry,
  });
  return result.independent ? 'admitted' : 'correlated_review';
}

function evaluateReview(scenario: string): string {
  if (!['self_review', 'shared_derivation', 'cross_family'].includes(scenario))
    throw new Error(`P4_FIXTURE_REVIEW_SCENARIO:${scenario}`);
  const universe = referenceUniverse(
    scenario as 'self_review' | 'shared_derivation' | 'cross_family',
  );
  const assignment = reviewAssignment({
    reviewerAgentId:
      scenario === 'self_review' ? 'agent-author' : 'agent-review',
    targetAuthorAgentId: 'agent-author',
    selfReview: scenario === 'self_review',
  });
  const decision = admitResearchReview({
    raw: review(assignment),
    assignment,
    universe,
  });
  if (decision.ok) return decision.reasonCodes[0];
  return decision.reasonCodes.includes('self_review')
    ? 'self_review'
    : (decision.reasonCodes[0] ?? 'rejected');
}

function evaluatePosition(scenario: string): string {
  if (
    !['criterion_drift', 'explicit_branch', 'missing_references'].includes(
      scenario,
    )
  )
    throw new Error(`P4_FIXTURE_POSITION_SCENARIO:${scenario}`);
  const universe = referenceUniverse();
  const approvedBranch = universe.allowedCriterionBranches?.[0];
  let raw: ResearchPosition;
  if (scenario === 'criterion_drift')
    raw = position({
      criterionRef: criterion('drifted', 2, 'branch-drift'),
    });
  else if (scenario === 'explicit_branch') {
    if (approvedBranch === undefined)
      throw new Error('P4_FIXTURE_APPROVED_BRANCH_MISSING');
    raw = position({ criterionRef: approvedBranch });
  } else raw = position({ claimIds: ['missing-claim'] });
  const decision = admitResearchPosition(raw, universe);
  if (decision.ok) return decision.reasonCodes[0];
  return decision.reasonCodes.some((reason) => reason.startsWith('missing_'))
    ? 'missing_references'
    : (decision.reasonCodes[0] ?? 'rejected');
}

function evaluateLineage(scenario: string): string {
  if (scenario !== 'cycle_and_dangling')
    throw new Error(`P4_FIXTURE_LINEAGE_SCENARIO:${scenario}`);
  const left = modelVersion({
    id: 'model-left',
    parentVersionIds: ['model-right'],
  });
  const right = modelVersion({
    id: 'model-right',
    parentVersionIds: ['model-left'],
  });
  const cycle = validateModelLineageGraph([left, right]);
  const dangling = validateModelLineageGraph([
    modelVersion({ id: 'model-dangling', parentVersionIds: ['model-absent'] }),
  ]);
  return !cycle.ok && !dangling.ok ? 'lineage_rejected' : 'lineage_admitted';
}

async function projectionFixture(
  repository: string,
): Promise<Record<string, unknown>> {
  return JSON.parse(
    await readFile(
      resolve(
        repository,
        'evals/fixtures/p2/observatory-projection-input.json',
      ),
      'utf8',
    ),
  ) as Record<string, unknown>;
}

async function evaluateProjectionIntegrity(
  input: Record<string, unknown>,
  repository: string,
): Promise<string> {
  const checks = requiredStringArray(input, 'checks');
  if (
    checks.length !== 2 ||
    !checks.includes('future_authority') ||
    !checks.includes('digest_mismatch')
  )
    throw new Error('P4_FIXTURE_PROJECTION_CHECKS');
  const source = await projectionFixture(repository);
  const receipt = {
    id: 'receipt-adversarial',
    workItemId: 'work-item-adversarial',
    status: 'succeeded',
    artifactDigest: digest('artifact-adversarial'),
    authoritativeRevision: Number(source.authoritativeRevision) + 1,
  };
  const future = { ...receipt, recordDigest: canonicalDigest(receipt) };
  const mismatch = {
    ...receipt,
    authoritativeRevision: Number(source.authoritativeRevision),
    recordDigest: digest('intentionally-wrong'),
  };
  const rejected = [future, mismatch].every((candidate) => {
    try {
      buildObservatoryProjectionV1({ ...source, receipts: [candidate] });
      return false;
    } catch {
      return true;
    }
  });
  return rejected ? 'projection_rejected' : 'projection_admitted';
}

async function evaluateProjectionDeterminism(
  input: Record<string, unknown>,
  repository: string,
): Promise<string> {
  const reorder = requiredStringArray(input, 'reorder');
  const expected = [
    'claims',
    'evidence',
    'assessments',
    'auditEvents',
    'cells',
    'positions',
    'reviews',
    'modelLineages',
    'correlations',
    'dissentReports',
    'rejectedResidue',
    'receipts',
  ];
  if (
    reorder.length !== expected.length ||
    expected.some((field) => !reorder.includes(field))
  )
    throw new Error('P4_FIXTURE_PROJECTION_REORDER');
  const preRestart = reconstructedP4Projection(
    await projectionFixture(repository),
  );
  const postRestart = structuredClone(preRestart);
  for (const field of reorder) {
    postRestart[field] = [...requiredRecordArray(postRestart, field)].reverse();
  }
  const before = buildObservatoryProjectionV1(preRestart);
  const after = buildObservatoryProjectionV1(postRestart);
  return before.integrity.canonicalDigest === after.integrity.canonicalDigest &&
    JSON.stringify(before) === JSON.stringify(after)
    ? 'deterministic'
    : 'nondeterministic';
}

function reconstructedP4Projection(
  source: Record<string, unknown>,
): Record<string, unknown> {
  const criterionRecord = requiredRecord(source, 'criterion');
  const program = requiredRecord(source, 'program');
  const authoritativeRevision = requiredNumber(source, 'authoritativeRevision');
  const criterionRef: CriterionReference = {
    criterionId: requiredString(criterionRecord, 'id'),
    criterionVersion: requiredNumber(criterionRecord, 'version'),
    criterionDigest: requiredString(criterionRecord, 'canonicalDigest'),
    branchId: 'main',
  };
  const cellInput: CellInput = {
    schemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
    claimIds: ['claim-unresolved'],
    evidenceIds: ['evidence-support'],
    hypothesisIds: [],
    artifactIds: [],
  };
  const inputDigest = cellInputDigest(cellInput);
  const cellContract = {
    id: 'cell-plan-p4-restart',
    schemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
    programId: requiredString(program, 'id'),
    workItemId: 'work-item-p4-position',
    templateId: 'template-p4-divergence',
    templateVersion: 1,
    criterionRef,
    branchId: criterionRef.branchId,
    input: cellInput,
    inputDigest,
    outputContract: {
      kind: 'positions' as const,
      minimumCount: 1,
      schemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
    },
    plannedAt: '2026-07-13T18:00:00.000Z',
  };
  const lineageRoot = modelVersion({
    id: 'model-p4-root',
    family: 'family-p4-root',
  });
  const lineageChild = modelVersion({
    id: 'model-p4-child',
    family: 'family-p4-child',
    parentVersionIds: [lineageRoot.id],
  });
  const lineageAlias = modelVersion({
    id: 'model-p4-alias',
    family: 'family-p4-alias',
    aliasOfVersionId: lineageChild.id,
  });
  const positionContract = projectionPosition(
    requiredString(program, 'id'),
    criterionRef,
    inputDigest,
    lineageChild.id,
  );
  const reviewContract = projectionReview(
    requiredString(program, 'id'),
    criterionRef,
    lineageAlias.id,
  );
  const correlationBase: CorrelationAssessment = {
    id: 'correlation-p4-child-alias',
    schemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
    policyVersion: MODEL_LINEAGE_POLICY_VERSION,
    subjectModelProfileVersionId: lineageChild.id,
    candidateModelProfileVersionId: lineageAlias.id,
    independent: false,
    correlationScore: 0.9,
    reasonCodes: ['alias_model_version'],
    assessedAt: '2026-07-13T18:00:00.000Z',
    canonicalDigest: digest('correlation-placeholder'),
  };
  const correlationContract = {
    ...correlationBase,
    canonicalDigest: correlationAssessmentDigest(correlationBase),
  };
  const dissentBase: DissentReport = {
    id: 'dissent-p4-restart',
    schemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
    programId: requiredString(program, 'id'),
    cellPlanId: cellContract.id,
    criterionRef,
    positionIds: [positionContract.id],
    claimIds: ['claim-unresolved'],
    evidenceIds: ['evidence-support'],
    unresolvedReasonCodes: ['minority-report-retained'],
    canonicalDigest: digest('dissent-placeholder'),
    createdAt: '2026-07-13T18:00:00.000Z',
  };
  const dissentContract = {
    ...dissentBase,
    canonicalDigest: dissentReportDigest(dissentBase),
  };
  const lineage = (
    contract: ModelProfileVersion,
    parentModelLineageIds: readonly string[],
  ) =>
    withRecordDigest({
      contract,
      id: contract.id,
      provider: contract.provider,
      family: contract.family,
      checkpoint: contract.checkpoint,
      modelProfileVersion: 'v1',
      parentModelLineageIds: [...parentModelLineageIds],
      sharedDerivationIds: [...contract.lineage.sharedDerivationIds],
      unknownLineage: false,
      authoritativeRevision,
    });
  return {
    ...source,
    cells: [
      withRecordDigest({
        contract: cellContract,
        id: 'cell-p4-restart',
        programId: requiredString(program, 'id'),
        cellPlanId: cellContract.id,
        cellPlanVersion: 'v1',
        branchId: criterionRef.branchId,
        role: 'divergence',
        status: 'succeeded',
        criterionId: criterionRef.criterionId,
        criterionVersion: criterionRef.criterionVersion,
        criterionDigest: criterionRef.criterionDigest,
        workItemIds: ['work-item-p4-position'],
        receiptIds: ['receipt-p4-cell'],
        authoritativeRevision,
      }),
    ],
    positions: [
      withRecordDigest({
        contract: positionContract,
        id: positionContract.id,
        cellId: 'cell-p4-restart',
        claimIds: [...positionContract.claimIds],
        evidenceIds: [...positionContract.evidenceIds],
        modelProfileVersionId: positionContract.modelProfileVersionId,
        criterionId: criterionRef.criterionId,
        criterionVersion: criterionRef.criterionVersion,
        criterionDigest: criterionRef.criterionDigest,
        status: 'rejected',
        rejectedResidueId: 'residue-p4-position',
        authoritativeRevision,
      }),
    ],
    reviews: [
      withRecordDigest({
        contract: reviewContract,
        id: reviewContract.id,
        cellId: 'cell-p4-restart',
        positionId: positionContract.id,
        reviewerModelProfileVersionId:
          reviewContract.reviewerModelProfileVersionId,
        assignmentId: reviewContract.assignmentId,
        verdict: reviewContract.verdict,
        status: 'completed',
        receiptIds: ['receipt-p4-review'],
        authoritativeRevision,
      }),
    ],
    modelLineages: [
      lineage(lineageRoot, []),
      lineage(lineageChild, [lineageRoot.id]),
      lineage(lineageAlias, [lineageChild.id]),
    ],
    correlations: [
      withRecordDigest({
        contract: correlationContract,
        id: correlationContract.id,
        modelLineageIds: [lineageChild.id, lineageAlias.id],
        policyVersion: correlationContract.policyVersion,
        score: correlationContract.correlationScore,
        status: 'correlated',
        reasonCodes: [...correlationContract.reasonCodes],
        authoritativeRevision,
      }),
    ],
    dissentReports: [
      withRecordDigest({
        contract: dissentContract,
        id: dissentContract.id,
        positionIds: [...dissentContract.positionIds],
        claimIds: [...dissentContract.claimIds],
        evidenceIds: [...dissentContract.evidenceIds],
        status: 'preserved',
        reasonCodes: [...dissentContract.unresolvedReasonCodes],
        authoritativeRevision,
      }),
    ],
    rejectedResidue: [
      withRecordDigest({
        id: 'residue-p4-position',
        sourceId: positionContract.id,
        sourceKind: 'position',
        reasonCodes: ['unsupported-claim'],
        retainedArtifactDigest: positionContract.canonicalDigest,
        authoritativeRevision,
      }),
    ],
    receipts: [
      withRecordDigest({
        id: 'receipt-p4-cell',
        workItemId: 'work-item-p4-position',
        status: 'succeeded',
        artifactDigest: positionContract.canonicalDigest,
        authoritativeRevision,
      }),
      withRecordDigest({
        id: 'receipt-p4-review',
        workItemId: 'work-item-p4-review',
        status: 'succeeded',
        artifactDigest: reviewContract.canonicalDigest,
        authoritativeRevision,
      }),
    ],
  };
}

function referenceUniverse(
  modelScenario:
    | 'self_review'
    | 'shared_derivation'
    | 'cross_family' = 'cross_family',
): ReferenceUniverse {
  const primary = criterion('criterion-primary', 1, 'branch-main');
  const branch = criterion('criterion-branch', 1, 'branch-approved');
  const shared =
    modelScenario === 'shared_derivation' ? ['derivation-shared'] : [];
  const author = modelVersion({
    id: 'model-author',
    family: 'family-a',
    sharedDerivationIds: shared,
  });
  const reviewer = modelVersion({
    id: 'model-reviewer',
    family: 'family-b',
    sharedDerivationIds: shared,
  });
  return {
    programId: 'program-p4',
    cellPlanId: 'cell-plan-p4',
    workItemId: 'work-item-p4',
    inputDigest: digest('input-p4'),
    outputSchemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
    criterionRef: primary,
    allowedCriterionBranches: [branch],
    claimIds: new Set(['claim-known']),
    evidenceIds: new Set(['evidence-known']),
    hypothesisIds: new Set(['hypothesis-known']),
    artifactIds: new Set(['artifact-known']),
    receiptRefs: new Map(),
    modelVersions: new Map([
      [author.id, author],
      [reviewer.id, reviewer],
    ]),
  };
}

function criterion(
  id: string,
  version: number,
  branchId: string,
): CriterionReference {
  return {
    criterionId: id,
    criterionVersion: version,
    criterionDigest: digest(`${id}:${String(version)}:${branchId}`),
    branchId,
  };
}

function modelVersion(input: {
  id: string;
  family?: string;
  lineageKind?: 'known' | 'unknown';
  aliasOfVersionId?: string;
  parentVersionIds?: string[];
  sharedDerivationIds?: string[];
}): ModelProfileVersion {
  const lineageKind = input.lineageKind ?? 'known';
  const base: ModelProfileVersion = {
    id: input.id,
    profileId: `profile-${input.id}`,
    schemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
    provider: 'test-provider',
    providerModelId: `provider-${input.id}`,
    family: input.family ?? 'family-a',
    checkpoint: `checkpoint-${input.family ?? 'family-a'}`,
    contextWindow: 8192,
    modalities: ['text'],
    locality: 'local' as const,
    dataPolicyId: 'data-policy-p4',
    costProfileId: 'cost-profile-p4',
    lineage: {
      kind: lineageKind,
      trainingLineageIds: [],
      fineTuneLineageIds: [],
      sharedDerivationIds:
        lineageKind === 'known' ? (input.sharedDerivationIds ?? []) : [],
      parentVersionIds:
        lineageKind === 'known' ? (input.parentVersionIds ?? []) : [],
      ...(lineageKind === 'known' && input.aliasOfVersionId
        ? { aliasOfVersionId: input.aliasOfVersionId }
        : {}),
    },
    immutableDigest: digest(`placeholder:${input.id}`),
    recordedAt: '2026-07-13T18:00:00.000Z',
  };
  return { ...base, immutableDigest: modelProfileVersionDigest(base) };
}

function position(
  input: {
    id?: string;
    criterionRef?: CriterionReference;
    claimIds?: string[];
  } = {},
): ResearchPosition {
  const claimIds = input.claimIds ?? ['claim-known'];
  const base: ResearchPosition = {
    id: input.id ?? 'position-p4',
    schemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
    programId: 'program-p4',
    cellPlanId: 'cell-plan-p4',
    workItemId: 'work-item-p4',
    authorAgentId: 'agent-author',
    role: 'divergence',
    criterionRef:
      input.criterionRef ?? criterion('criterion-primary', 1, 'branch-main'),
    modelProfileVersionId: 'model-author',
    inputDigest: digest('input-p4'),
    outputSchemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
    answer: 'Executable P4 adversarial position.',
    claimIds,
    evidenceIds: ['evidence-known'],
    hypothesisIds: ['hypothesis-known'],
    artifactIds: ['artifact-known'],
    proposalRefs: claimIds.map((id) => ({ kind: 'claim' as const, id })),
    assumptions: [],
    dissent: [],
    proposedFalsifiers: [],
    usage: { inputTokens: 1, outputTokens: 1, costUsd: 0, latencyMs: 1 },
    uncertaintyCodes: [],
    failureCodes: [],
    receiptRefs: [],
    canonicalDigest: digest('position-placeholder'),
    createdAt: '2026-07-13T18:00:00.000Z',
  };
  return { ...base, canonicalDigest: researchPositionDigest(base) };
}

function synthesisArtifact(
  positionIds: readonly string[],
  claimIds: readonly string[],
): SynthesisArtifact {
  const base: SynthesisArtifact = {
    id: 'synthesis-p4',
    schemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
    programId: 'program-p4',
    cellPlanId: 'cell-plan-p4',
    criterionRef: criterion('criterion-primary', 1, 'branch-main'),
    admittedClaimIds: [...claimIds],
    factualSentenceClaimIds: [...claimIds],
    positionIds: [...positionIds],
    dissentReportIds: [],
    unresolvedClaimIds: [],
    receiptRefs: [],
    canonicalDigest: digest('synthesis-placeholder'),
    createdAt: '2026-07-13T18:00:00.000Z',
  };
  return { ...base, canonicalDigest: synthesisArtifactDigest(base) };
}

function projectionPosition(
  programId: string,
  criterionRef: CriterionReference,
  inputDigest: string,
  modelProfileVersionId: string,
): ResearchPosition {
  const base: ResearchPosition = {
    id: 'position-p4-restart',
    schemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
    programId,
    cellPlanId: 'cell-plan-p4-restart',
    workItemId: 'work-item-p4-position',
    authorAgentId: 'agent-p4-child',
    role: 'divergence',
    criterionRef,
    modelProfileVersionId,
    inputDigest,
    outputSchemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
    answer: 'Restart-stable P4 candidate.',
    claimIds: ['claim-unresolved'],
    evidenceIds: ['evidence-support'],
    hypothesisIds: [],
    artifactIds: [],
    proposalRefs: [{ kind: 'claim', id: 'claim-unresolved' }],
    assumptions: [],
    dissent: [],
    proposedFalsifiers: [],
    usage: { inputTokens: 1, outputTokens: 1, costUsd: 0, latencyMs: 1 },
    uncertaintyCodes: [],
    failureCodes: [],
    receiptRefs: [],
    canonicalDigest: digest('position-projection-placeholder'),
    createdAt: '2026-07-13T18:00:00.000Z',
  };
  return { ...base, canonicalDigest: researchPositionDigest(base) };
}

function projectionReview(
  programId: string,
  criterionRef: CriterionReference,
  reviewerModelProfileVersionId: string,
): ResearchReview {
  const base: ResearchReview = {
    id: 'review-p4-restart',
    schemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
    assignmentId: 'assignment-p4-restart',
    programId,
    workItemId: 'work-item-p4-review',
    targetPositionId: 'position-p4-restart',
    reviewerAgentId: 'agent-p4-alias',
    reviewerModelProfileVersionId,
    reviewerRole: 'falsification',
    criterionRef,
    inputDigest: digest('review-input-p4-restart'),
    outputSchemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
    verdict: 'reject',
    reasonCodes: ['correlated-review'],
    checkedClaimIds: ['claim-unresolved'],
    checkedEvidenceIds: ['evidence-support'],
    checkedHypothesisIds: [],
    checkedArtifactIds: [],
    usage: { inputTokens: 1, outputTokens: 1, costUsd: 0, latencyMs: 1 },
    uncertaintyCodes: [],
    failureCodes: [],
    receiptRefs: [],
    canonicalDigest: digest('review-projection-placeholder'),
    createdAt: '2026-07-13T18:00:00.000Z',
  };
  return { ...base, canonicalDigest: researchReviewDigest(base) };
}

function withRecordDigest<T extends Record<string, unknown>>(
  record: T,
): T & { recordDigest: string } {
  return { ...record, recordDigest: canonicalDigest(record) };
}

function reviewAssignment(input: {
  reviewerAgentId: string;
  targetAuthorAgentId: string;
  selfReview: boolean;
}): ReviewAssignment {
  return {
    id: 'assignment-p4',
    schemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
    programId: 'program-p4',
    workItemId: 'work-item-p4',
    targetPositionId: 'position-p4',
    reviewerAgentId: input.reviewerAgentId,
    reviewerModelProfileVersionId: input.selfReview
      ? 'model-author'
      : 'model-reviewer',
    reviewerRole: input.selfReview ? 'divergence' : 'falsification',
    targetAuthorAgentId: input.targetAuthorAgentId,
    targetModelProfileVersionId: 'model-author',
    targetRole: 'divergence',
    criterionRef: criterion('criterion-primary', 1, 'branch-main'),
    blind: true,
    assignedAt: '2026-07-13T18:00:00.000Z',
  };
}

function review(assignment: ReviewAssignment): ResearchReview {
  const base: ResearchReview = {
    id: 'review-p4',
    schemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
    assignmentId: assignment.id,
    programId: assignment.programId,
    workItemId: assignment.workItemId,
    targetPositionId: assignment.targetPositionId,
    reviewerAgentId: assignment.reviewerAgentId,
    reviewerModelProfileVersionId: assignment.reviewerModelProfileVersionId,
    reviewerRole: assignment.reviewerRole,
    criterionRef: assignment.criterionRef,
    inputDigest: digest('input-p4'),
    outputSchemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
    verdict: 'reject' as const,
    reasonCodes: ['adversarial-review'],
    checkedClaimIds: ['claim-known'],
    checkedEvidenceIds: ['evidence-known'],
    checkedHypothesisIds: ['hypothesis-known'],
    checkedArtifactIds: ['artifact-known'],
    usage: { inputTokens: 1, outputTokens: 1, costUsd: 0, latencyMs: 1 },
    uncertaintyCodes: [],
    failureCodes: [],
    receiptRefs: [],
    canonicalDigest: digest('review-placeholder'),
    createdAt: '2026-07-13T18:00:00.000Z',
  };
  return { ...base, canonicalDigest: researchReviewDigest(base) };
}

function digest(value: string): string {
  return canonicalDigest({ value });
}

function requiredString(input: Record<string, unknown>, field: string): string {
  const value = input[field];
  if (typeof value !== 'string') throw new Error(`P4_FIXTURE_INPUT:${field}`);
  return value;
}

function requiredRecord(
  input: Record<string, unknown>,
  field: string,
): Record<string, unknown> {
  const value = input[field];
  if (!isRecord(value)) throw new Error(`P4_FIXTURE_INPUT:${field}`);
  return value;
}

function requiredRecordArray(
  input: Record<string, unknown>,
  field: string,
): Record<string, unknown>[] {
  const value = input[field];
  if (!Array.isArray(value) || value.some((entry) => !isRecord(entry)))
    throw new Error(`P4_FIXTURE_INPUT:${field}`);
  return value as Record<string, unknown>[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredNumber(input: Record<string, unknown>, field: string): number {
  const value = input[field];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0)
    throw new Error(`P4_FIXTURE_INPUT:${field}`);
  return value;
}

function requiredStringArray(
  input: Record<string, unknown>,
  field: string,
): string[] {
  const value = input[field];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string'))
    throw new Error(`P4_FIXTURE_INPUT:${field}`);
  return value.map((entry) => String(entry));
}
