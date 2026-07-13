import { describe, expect, it } from 'vitest';
import {
  MODEL_LINEAGE_POLICY_VERSION,
  REVIEW_ASSIGNMENT_POLICY_VERSION,
  RESEARCH_CELL_CONTRACT_VERSION,
  SANITIZED_REVIEW_CONTEXT_VERSION,
  CorrelationAssessmentSchema,
  DissentReportSchema,
  ISOLATION_PROTOCOL_VERSION,
  ResearchPositionSchema,
  admitCorrelationAssessment,
  admitResearchPosition,
  admitResearchReview,
  admitReviewAssignment,
  admitSanitizedReviewContext,
  admitSynthesis,
  assessModelCorrelation,
  authorizePeerReveal,
  buildSanitizedReviewContext,
  cellInputDigest,
  commitPositionForReveal,
  correlationAssessmentDigest,
  dissentReportDigest,
  isolationCommitDigest,
  evaluatePositionProposals,
  modelProfileVersionDigest,
  reviewAssignmentPolicyDigest,
  reviewResidueDigest,
  researchPositionDigest,
  researchReviewDigest,
  synthesisArtifactDigest,
  validateModelLineageGraph,
  type CellInput,
  type CorrelationAssessment,
  type CriterionReference,
  type DissentReport,
  type AssignmentPolicyInput,
  type IsolationCommit,
  type ModelProfileVersion,
  type ReferenceUniverse,
  type ResearchPosition,
  type ResearchReview,
  type ReviewResidue,
  type ReviewAssignment,
  type SynthesisArtifact,
} from '../src/index.js';

const now = '2026-07-13T17:00:00.000Z';
const digestA = `sha256:${'a'.repeat(64)}`;
const digestB = `sha256:${'b'.repeat(64)}`;
const digestC = `sha256:${'c'.repeat(64)}`;

const criterionRef: CriterionReference = {
  criterionId: 'criterion-1',
  criterionVersion: 1,
  criterionDigest: digestA,
  branchId: 'main',
};

const criterionBranch: CriterionReference = {
  criterionId: 'criterion-2',
  criterionVersion: 2,
  criterionDigest: digestB,
  branchId: 'branch-holdout',
  supersedesCriterionId: 'criterion-1',
};

const input: CellInput = {
  schemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
  claimIds: ['claim-supported', 'claim-unsupported'],
  evidenceIds: ['evidence-1'],
  hypothesisIds: ['hypothesis-1'],
  artifactIds: ['artifact-1'],
};

function modelVersion(
  overrides: Partial<ModelProfileVersion> & Pick<ModelProfileVersion, 'id'>,
): ModelProfileVersion {
  const { id, ...restOverrides } = overrides;
  const base: ModelProfileVersion = {
    id,
    profileId: `profile-${overrides.id}`,
    schemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
    provider: 'provider-a',
    providerModelId: overrides.id,
    family: 'family-a',
    checkpoint: 'checkpoint-a',
    contextWindow: 128000,
    modalities: ['text'],
    locality: 'cloud' as const,
    dataPolicyId: 'data-policy-1',
    costProfileId: 'cost-profile-1',
    lineage: {
      kind: 'known' as const,
      trainingLineageIds: ['train-a'],
      fineTuneLineageIds: [],
      sharedDerivationIds: [],
      parentVersionIds: [],
    },
    immutableDigest: digestA,
    recordedAt: now,
    ...restOverrides,
  };
  return {
    ...base,
    immutableDigest: modelProfileVersionDigest(base),
  };
}

const authorModel = modelVersion({ id: 'model-author' });
const aliasModel = modelVersion({
  id: 'model-alias',
  lineage: {
    kind: 'known',
    trainingLineageIds: ['train-a'],
    fineTuneLineageIds: [],
    sharedDerivationIds: [],
    parentVersionIds: [],
    aliasOfVersionId: 'model-author',
  },
});
const correlatedModel = modelVersion({
  id: 'model-correlated',
  providerModelId: 'marketed-different',
  lineage: {
    kind: 'known',
    trainingLineageIds: ['train-x'],
    fineTuneLineageIds: [],
    sharedDerivationIds: ['rlhf-run-1'],
    parentVersionIds: [],
  },
});
const correlatedPeerModel = modelVersion({
  id: 'model-correlated-peer',
  family: 'family-b',
  checkpoint: 'checkpoint-b',
  lineage: {
    kind: 'known',
    trainingLineageIds: ['train-y'],
    fineTuneLineageIds: [],
    sharedDerivationIds: ['rlhf-run-1'],
    parentVersionIds: [],
  },
});
const unknownModel = modelVersion({
  id: 'model-unknown',
  provider: 'provider-z',
  family: 'unknown-family',
  checkpoint: 'unknown-checkpoint',
  lineage: {
    kind: 'unknown',
    trainingLineageIds: [],
    fineTuneLineageIds: [],
    sharedDerivationIds: [],
    parentVersionIds: [],
  },
});
const crossFamilyModel = modelVersion({
  id: 'model-cross-family',
  provider: 'provider-b',
  family: 'family-c',
  checkpoint: 'checkpoint-c',
  lineage: {
    kind: 'known',
    trainingLineageIds: ['train-c'],
    fineTuneLineageIds: [],
    sharedDerivationIds: [],
    parentVersionIds: [],
  },
});

const modelVersions = new Map(
  [
    authorModel,
    aliasModel,
    correlatedModel,
    correlatedPeerModel,
    unknownModel,
    crossFamilyModel,
  ].map((version) => [version.id, version]),
);

const universe: ReferenceUniverse = {
  programId: 'program-1',
  cellPlanId: 'cell-plan-1',
  workItemId: 'work-1',
  inputDigest: cellInputDigest(input),
  outputSchemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
  criterionRef,
  claimIds: new Set(['claim-supported', 'claim-unsupported']),
  evidenceIds: new Set(['evidence-1']),
  hypothesisIds: new Set(['hypothesis-1']),
  artifactIds: new Set(['artifact-1']),
  receiptRefs: new Map(),
  modelVersions,
};

const receipt = {
  receiptId: 'receipt-1',
  kind: 'model_invocation' as const,
  artifactDigest: digestB,
  receivedAt: now,
};

const receiptUniverse: ReferenceUniverse = {
  ...universe,
  receiptRefs: new Map([[receipt.receiptId, receipt]]),
};

function position(overrides: Partial<ResearchPosition> = {}): ResearchPosition {
  const base: ResearchPosition = {
    id: 'position-1',
    schemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
    programId: 'program-1',
    cellPlanId: 'cell-plan-1',
    workItemId: 'work-1',
    authorAgentId: 'agent-author',
    role: 'lateralist',
    criterionRef,
    modelProfileVersionId: authorModel.id,
    inputDigest: cellInputDigest(input),
    outputSchemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
    answer: 'Candidate answer with explicit references.',
    claimIds: ['claim-unsupported'],
    evidenceIds: ['evidence-1'],
    hypothesisIds: ['hypothesis-1'],
    artifactIds: ['artifact-1'],
    proposalRefs: [{ kind: 'claim' as const, id: 'claim-unsupported' }],
    assumptions: [],
    dissent: [],
    proposedFalsifiers: ['machine-check a direct source'],
    usage: {
      inputTokens: 10,
      outputTokens: 20,
      costUsd: 0.01,
      latencyMs: 50,
    },
    uncertaintyCodes: [],
    failureCodes: [],
    receiptRefs: [],
    canonicalDigest: digestA,
    createdAt: now,
    ...overrides,
  };
  return { ...base, canonicalDigest: researchPositionDigest(base) };
}

function assignment(
  overrides: Partial<ReviewAssignment> = {},
): ReviewAssignment {
  return {
    id: 'assignment-1',
    schemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
    programId: 'program-1',
    workItemId: 'review-work-1',
    targetPositionId: 'position-1',
    reviewerAgentId: 'agent-reviewer',
    reviewerModelProfileVersionId: crossFamilyModel.id,
    reviewerRole: 'critic',
    targetAuthorAgentId: 'agent-author',
    targetModelProfileVersionId: authorModel.id,
    targetRole: 'lateralist',
    criterionRef,
    blind: true,
    assignedAt: now,
    ...overrides,
  };
}

function review(overrides: Partial<ResearchReview> = {}): ResearchReview {
  const base: ResearchReview = {
    id: 'review-1',
    schemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
    assignmentId: 'assignment-1',
    programId: 'program-1',
    workItemId: 'review-work-1',
    targetPositionId: 'position-1',
    reviewerAgentId: 'agent-reviewer',
    reviewerModelProfileVersionId: crossFamilyModel.id,
    reviewerRole: 'critic',
    criterionRef,
    inputDigest: cellInputDigest(input),
    outputSchemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
    verdict: 'admit' as const,
    reasonCodes: ['references_checked'],
    checkedClaimIds: ['claim-unsupported'],
    checkedEvidenceIds: ['evidence-1'],
    checkedHypothesisIds: ['hypothesis-1'],
    checkedArtifactIds: ['artifact-1'],
    usage: {
      inputTokens: 5,
      outputTokens: 5,
      costUsd: 0.01,
      latencyMs: 40,
    },
    uncertaintyCodes: [],
    failureCodes: [],
    receiptRefs: [],
    canonicalDigest: digestB,
    createdAt: now,
    ...overrides,
  };
  return { ...base, canonicalDigest: researchReviewDigest(base) };
}

function synthesis(
  overrides: Partial<SynthesisArtifact> = {},
): SynthesisArtifact {
  const base: SynthesisArtifact = {
    id: 'synthesis-1',
    schemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
    programId: 'program-1',
    cellPlanId: 'cell-plan-1',
    criterionRef,
    admittedClaimIds: ['claim-supported'],
    factualSentenceClaimIds: ['claim-supported'],
    positionIds: ['position-1'],
    dissentReportIds: [],
    unresolvedClaimIds: ['claim-unsupported'],
    receiptRefs: [],
    canonicalDigest: digestC,
    createdAt: now,
    ...overrides,
  };
  return { ...base, canonicalDigest: synthesisArtifactDigest(base) };
}

function dissentReport(overrides: Partial<DissentReport> = {}): DissentReport {
  const base: DissentReport = {
    id: 'dissent-1',
    schemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
    programId: 'program-1',
    cellPlanId: 'cell-plan-1',
    criterionRef,
    positionIds: ['position-1'],
    claimIds: ['claim-unsupported'],
    evidenceIds: ['evidence-1'],
    unresolvedReasonCodes: ['minority-position-retained'],
    canonicalDigest: digestA,
    createdAt: now,
    ...overrides,
  };
  return { ...base, canonicalDigest: dissentReportDigest(base) };
}

function correlationAssessment(
  overrides: Partial<CorrelationAssessment> = {},
): CorrelationAssessment {
  const base: CorrelationAssessment = {
    id: 'correlation-1',
    schemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
    policyVersion: MODEL_LINEAGE_POLICY_VERSION,
    subjectModelProfileVersionId: authorModel.id,
    candidateModelProfileVersionId: crossFamilyModel.id,
    independent: true,
    correlationScore: 0,
    reasonCodes: ['different_known_family'],
    assessedAt: now,
    canonicalDigest: digestA,
    ...overrides,
  };
  return {
    ...base,
    canonicalDigest: correlationAssessmentDigest(base),
  };
}

function isolationCommit(
  overrides: Partial<IsolationCommit> = {},
): IsolationCommit {
  const pos = position({ receiptRefs: [receipt] });
  const base: IsolationCommit = {
    id: 'commit-1',
    protocolVersion: ISOLATION_PROTOCOL_VERSION,
    programId: pos.programId,
    cellPlanId: pos.cellPlanId,
    workItemId: pos.workItemId,
    positionId: pos.id,
    authorAgentId: pos.authorAgentId,
    role: pos.role,
    criterionRef: pos.criterionRef,
    modelProfileVersionId: pos.modelProfileVersionId,
    inputDigest: pos.inputDigest,
    outputDigest: researchPositionDigest(pos),
    outputSchemaVersion: pos.outputSchemaVersion,
    receiptRefs: [receipt],
    auditSequence: 10,
    committedAt: now,
    canonicalDigest: digestA,
    ...overrides,
  };
  return { ...base, canonicalDigest: isolationCommitDigest(base) };
}

function assignmentPolicyInput(
  overrides: Partial<AssignmentPolicyInput> = {},
): AssignmentPolicyInput {
  const base: AssignmentPolicyInput = {
    policyVersion: REVIEW_ASSIGNMENT_POLICY_VERSION,
    assignment: assignment(),
    positionCommitDigest: isolationCommit().canonicalDigest,
    sanitizedContextDigest: buildSanitizedReviewContext({
      position: position({ receiptRefs: [receipt] }),
      commit: isolationCommit(),
    }).contextDigest,
    assignmentDigest: digestA,
    ...overrides,
  };
  return { ...base, assignmentDigest: reviewAssignmentPolicyDigest(base) };
}

function reviewResidue(overrides: Partial<ReviewResidue> = {}): ReviewResidue {
  const base: ReviewResidue = {
    id: 'residue-1',
    policyVersion: REVIEW_ASSIGNMENT_POLICY_VERSION,
    kind: 'minority_position',
    attributableWorkId: 'review-work-1',
    positionIds: ['position-1'],
    reviewIds: [],
    reasonCodes: ['minority-retained'],
    retainedAt: now,
    canonicalDigest: digestA,
    ...overrides,
  };
  return { ...base, canonicalDigest: reviewResidueDigest(base) };
}

describe('P4 research-cell contract schemas', () => {
  it('rejects unknown schema versions and noncanonical digests', () => {
    expect(
      ResearchPositionSchema.safeParse({
        ...position(),
        schemaVersion: '9.9.9',
      }).success,
    ).toBe(false);
    expect(
      ResearchPositionSchema.safeParse({
        ...position(),
        canonicalDigest: digestB,
      }).success,
    ).toBe(false);
  });

  it('rejects missing references while preserving rejected proposal residue', () => {
    const missing = position({
      id: 'missing-position',
      claimIds: ['claim-missing'],
      evidenceIds: ['evidence-missing'],
      hypothesisIds: ['hypothesis-missing'],
      artifactIds: ['artifact-missing'],
      proposalRefs: [
        { kind: 'claim', id: 'claim-missing' },
        { kind: 'evidence', id: 'evidence-missing' },
        { kind: 'hypothesis', id: 'hypothesis-missing' },
        { kind: 'artifact', id: 'artifact-missing' },
      ],
    });
    const result = evaluatePositionProposals([position(), missing], universe);

    expect(result.admitted).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.proposal).toMatchObject({
      id: 'missing-position',
    });
    expect(result.rejected[0]?.reasonCodes).toEqual([
      'missing_artifact_ref',
      'missing_claim_ref',
      'missing_evidence_ref',
      'missing_hypothesis_ref',
    ]);
  });

  it('binds typed proposal references to their matching universe and parallel ID arrays', () => {
    expect(
      admitResearchPosition(
        position({
          proposalRefs: [
            { kind: 'claim', id: 'claim-unsupported' },
            { kind: 'evidence', id: 'evidence-1' },
            { kind: 'hypothesis', id: 'hypothesis-1' },
            { kind: 'artifact', id: 'artifact-1' },
          ],
        }),
        universe,
      ),
    ).toMatchObject({ ok: true });

    expect(
      admitResearchPosition(
        position({
          evidenceIds: [],
          proposalRefs: [{ kind: 'evidence', id: 'evidence-1' }],
        }),
        universe,
      ),
    ).toMatchObject({ ok: false, reasonCodes: ['schema_invalid'] });

    expect(
      admitResearchPosition(
        position({
          evidenceIds: ['claim-unsupported'],
          proposalRefs: [{ kind: 'evidence', id: 'claim-unsupported' }],
        }),
        universe,
      ),
    ).toMatchObject({
      ok: false,
      reasonCodes: ['missing_evidence_ref'],
    });
  });

  it('enforces canonical dissent and correlation assessment digests', () => {
    expect(DissentReportSchema.safeParse(dissentReport()).success).toBe(true);
    expect(
      DissentReportSchema.safeParse({
        ...dissentReport(),
        claimIds: ['claim-supported'],
      }).success,
    ).toBe(false);
    expect(
      CorrelationAssessmentSchema.safeParse(correlationAssessment()).success,
    ).toBe(true);
    expect(
      CorrelationAssessmentSchema.safeParse({
        ...correlationAssessment(),
        correlationScore: 0.5,
      }).success,
    ).toBe(false);
  });
});

describe('model lineage and correlation policy', () => {
  it('rejects dangling, cyclic, and noncanonical model lineage', () => {
    expect(
      validateModelLineageGraph([
        modelVersion({
          id: 'child',
          lineage: {
            kind: 'known',
            trainingLineageIds: [],
            fineTuneLineageIds: [],
            sharedDerivationIds: [],
            parentVersionIds: ['missing'],
          },
        }),
      ]),
    ).toMatchObject({ ok: false, code: 'dangling_model_lineage' });

    const cyclicA = modelVersion({
      id: 'cyclic-a',
      lineage: {
        kind: 'known',
        trainingLineageIds: [],
        fineTuneLineageIds: [],
        sharedDerivationIds: [],
        parentVersionIds: ['cyclic-b'],
      },
    });
    const cyclicB = modelVersion({
      id: 'cyclic-b',
      lineage: {
        kind: 'known',
        trainingLineageIds: [],
        fineTuneLineageIds: [],
        sharedDerivationIds: [],
        parentVersionIds: ['cyclic-a'],
      },
    });
    expect(validateModelLineageGraph([cyclicA, cyclicB])).toMatchObject({
      ok: false,
      code: 'cyclic_model_lineage',
    });

    expect(
      validateModelLineageGraph([{ ...authorModel, immutableDigest: digestB }]),
    ).toMatchObject({ ok: false, code: 'noncanonical_model_digest' });

    expect(
      validateModelLineageGraph([
        authorModel,
        modelVersion({ id: authorModel.id, family: 'family-conflict' }),
      ]),
    ).toMatchObject({ ok: false, code: 'duplicate_model_lineage' });
  });

  it('does not count aliases, shared derivation, or unknown lineage as independent', () => {
    const aliasCorrelation = assessModelCorrelation({
      subject: authorModel,
      candidate: aliasModel,
      registry: modelVersions,
      requireKnownLineageForIndependence: true,
    });
    expect(aliasCorrelation.independent).toBe(false);
    expect(aliasCorrelation.reasonCodes).toContain('alias_model_version');

    const sharedDerivationCorrelation = assessModelCorrelation({
      subject: correlatedModel,
      candidate: correlatedPeerModel,
      registry: modelVersions,
      requireKnownLineageForIndependence: true,
    });
    expect(sharedDerivationCorrelation.independent).toBe(false);
    expect(sharedDerivationCorrelation.reasonCodes).toContain(
      'shared_derivation',
    );

    const unknownCorrelation = assessModelCorrelation({
      subject: authorModel,
      candidate: unknownModel,
      registry: modelVersions,
      requireKnownLineageForIndependence: true,
    });
    expect(unknownCorrelation.independent).toBe(false);
    expect(unknownCorrelation.reasonCodes).toContain('unknown_lineage');

    expect(
      assessModelCorrelation({
        subject: authorModel,
        candidate: unknownModel,
        registry: modelVersions,
      }).independent,
    ).toBe(false);
  });
});

describe('admission and review policy', () => {
  it.each([1, 100])(
    'keeps an unsupported claim unsupported with %i agreeing positions',
    (count) => {
      const proposals = Array.from({ length: count }, (_, index) =>
        position({ id: `position-${String(index + 1)}` }),
      );
      const evaluated = evaluatePositionProposals(proposals, universe);
      expect(evaluated.admitted).toHaveLength(count);
      expect(
        admitSynthesis({
          raw: synthesis({
            admittedClaimIds: ['claim-unsupported'],
            factualSentenceClaimIds: ['claim-unsupported'],
            positionIds: evaluated.admitted.map(({ id }) => id),
          }),
          universe,
          admittedClaimIds: new Set(['claim-supported']),
          admittedPositionIds: new Set(evaluated.admitted.map(({ id }) => id)),
        }),
      ).toMatchObject({
        ok: false,
        reasonCodes: ['synthesis_non_admitted_claim'],
      });
    },
  );

  it('rejects self-review and correlated review while accepting cross-family review', () => {
    const selfReview = admitResearchReview({
      raw: review({
        reviewerAgentId: 'agent-author',
        reviewerModelProfileVersionId: authorModel.id,
      }),
      assignment: assignment({
        reviewerAgentId: 'agent-author',
        reviewerModelProfileVersionId: authorModel.id,
      }),
      universe,
    });
    expect(selfReview.ok).toBe(false);
    if (!selfReview.ok) expect(selfReview.reasonCodes).toContain('self_review');

    const correlatedReview = admitResearchReview({
      raw: review({
        reviewerModelProfileVersionId: aliasModel.id,
      }),
      assignment: assignment({
        reviewerModelProfileVersionId: aliasModel.id,
      }),
      universe,
    });
    expect(correlatedReview.ok).toBe(false);
    if (!correlatedReview.ok) {
      expect(correlatedReview.reasonCodes).toContain('correlated_review');
    }

    const sharedDerivationReview = admitResearchReview({
      raw: review({
        reviewerModelProfileVersionId: correlatedPeerModel.id,
      }),
      assignment: assignment({
        reviewerModelProfileVersionId: correlatedPeerModel.id,
        targetModelProfileVersionId: correlatedModel.id,
      }),
      universe,
    });
    expect(sharedDerivationReview.ok).toBe(false);
    if (!sharedDerivationReview.ok) {
      expect(sharedDerivationReview.reasonCodes).toContain('correlated_review');
    }

    const unknownLineageReview = admitResearchReview({
      raw: review({
        reviewerModelProfileVersionId: unknownModel.id,
      }),
      assignment: assignment({
        reviewerModelProfileVersionId: unknownModel.id,
      }),
      universe,
    });
    expect(unknownLineageReview.ok).toBe(false);
    if (!unknownLineageReview.ok) {
      expect(unknownLineageReview.reasonCodes).toContain('correlated_review');
    }

    expect(
      admitResearchReview({
        raw: review(),
        assignment: assignment(),
        universe,
      }),
    ).toMatchObject({ ok: true });
  });

  it('fails closed when review correlation receives a dangling lineage graph', () => {
    const dangling = modelVersion({
      id: 'model-dangling-reviewer',
      family: 'family-dangling',
      checkpoint: 'checkpoint-dangling',
      lineage: {
        kind: 'known',
        trainingLineageIds: [],
        fineTuneLineageIds: [],
        sharedDerivationIds: [],
        parentVersionIds: ['model-missing-parent'],
      },
    });
    const danglingUniverse: ReferenceUniverse = {
      ...universe,
      modelVersions: new Map([...modelVersions, [dangling.id, dangling]]),
    };
    const decision = admitResearchReview({
      raw: review({ reviewerModelProfileVersionId: dangling.id }),
      assignment: assignment({ reviewerModelProfileVersionId: dangling.id }),
      universe: danglingUniverse,
    });
    expect(decision).toMatchObject({
      ok: false,
      reasonCodes: ['correlated_review'],
    });
  });

  it('binds position identity, input, output, and receipts to authority', () => {
    const receipt = {
      receiptId: 'receipt-1',
      kind: 'model_invocation' as const,
      artifactDigest: digestB,
      receivedAt: now,
    };
    const receiptUniverse: ReferenceUniverse = {
      ...universe,
      receiptRefs: new Map([[receipt.receiptId, receipt]]),
    };
    expect(
      admitResearchPosition(
        position({ receiptRefs: [receipt] }),
        receiptUniverse,
      ),
    ).toMatchObject({ ok: true });

    const driftCases: readonly [Partial<ResearchPosition>, string][] = [
      [{ cellPlanId: 'cell-plan-other' }, 'cell_plan_drift'],
      [{ workItemId: 'work-other' }, 'work_item_drift'],
      [{ inputDigest: digestB }, 'input_digest_drift'],
      [{ outputSchemaVersion: '2.0.0' }, 'output_schema_drift'],
      [
        { receiptRefs: [{ ...receipt, receiptId: 'receipt-missing' }] },
        'missing_receipt_ref',
      ],
      [
        { receiptRefs: [{ ...receipt, artifactDigest: digestC }] },
        'receipt_ref_drift',
      ],
    ];
    for (const [change, reason] of driftCases) {
      expect(
        admitResearchPosition(position(change), receiptUniverse),
      ).toMatchObject({ ok: false, reasonCodes: [reason] });
    }
  });

  it('binds every immutable review field to the resolved assignment', () => {
    const mismatches: Partial<ResearchReview>[] = [
      { assignmentId: 'assignment-other' },
      { programId: 'program-other' },
      { workItemId: 'work-other' },
      { reviewerAgentId: 'agent-other' },
      { reviewerModelProfileVersionId: correlatedPeerModel.id },
      { reviewerRole: 'other-role' },
      { targetPositionId: 'position-other' },
      { criterionRef: criterionBranch },
    ];
    for (const mismatch of mismatches) {
      const result = admitResearchReview({
        raw: review(mismatch),
        assignment: assignment(),
        universe,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reasonCodes).toContain('schema_invalid');
    }
  });

  it('binds review input and output-schema references to authority', () => {
    expect(
      admitResearchReview({
        raw: review({ inputDigest: digestC }),
        assignment: assignment(),
        universe,
      }),
    ).toMatchObject({ ok: false, reasonCodes: ['input_digest_drift'] });

    expect(
      admitResearchReview({
        raw: review({ outputSchemaVersion: '2.0.0' }),
        assignment: assignment(),
        universe,
      }),
    ).toMatchObject({ ok: false, reasonCodes: ['output_schema_drift'] });
  });

  it('distinguishes silent criterion drift from an explicit criterion branch', () => {
    expect(
      admitResearchPosition(
        position({
          criterionRef: {
            ...criterionRef,
            criterionDigest: digestB,
          },
        }),
        universe,
      ),
    ).toMatchObject({
      ok: false,
      reasonCodes: ['criterion_drift'],
    });

    const branched = position({
      criterionRef: criterionBranch,
    });
    expect(
      admitResearchPosition(branched, {
        ...universe,
        allowedCriterionBranches: [criterionBranch],
      }),
    ).toMatchObject({
      ok: true,
      reasonCodes: ['admitted_on_branch'],
    });

    expect(
      admitResearchPosition(branched, {
        ...universe,
        criterionRef: criterionBranch,
      }),
    ).toMatchObject({ ok: true });
  });

  it('requires synthesis to cite only admitted claim IDs and known positions', () => {
    expect(
      admitSynthesis({
        raw: synthesis({
          admittedClaimIds: ['claim-unsupported'],
          factualSentenceClaimIds: ['claim-unsupported'],
        }),
        universe,
        admittedClaimIds: new Set(['claim-supported']),
        admittedPositionIds: new Set(['position-1']),
      }),
    ).toMatchObject({
      ok: false,
      reasonCodes: ['synthesis_non_admitted_claim'],
    });

    expect(
      admitSynthesis({
        raw: synthesis(),
        universe,
        admittedClaimIds: new Set(['claim-supported']),
        admittedPositionIds: new Set(['position-1']),
      }),
    ).toMatchObject({ ok: true });
  });

  it('records correlation assessment policy version as immutable contract data', () => {
    expect(MODEL_LINEAGE_POLICY_VERSION).toBe('1.0.0');
    expect(
      admitCorrelationAssessment({
        raw: correlationAssessment(),
        modelVersions,
      }),
    ).toMatchObject({ ok: true });

    const forged = correlationAssessment({
      independent: false,
      correlationScore: 0.5,
      reasonCodes: ['shared_derivation'],
    });
    expect(
      admitCorrelationAssessment({ raw: forged, modelVersions }),
    ).toMatchObject({
      ok: false,
      reasonCodes: ['correlation_policy_drift'],
    });
  });
});

describe('P5 isolation and blind-review contracts', () => {
  it('commits positions durably before peer reveal and rejects early or missing reveal', () => {
    const pos = position({ receiptRefs: [receipt] });
    const commit = isolationCommit();
    expect(
      commitPositionForReveal({
        position: pos,
        commit,
        universe: receiptUniverse,
      }),
    ).toMatchObject({ ok: true });

    const peer = isolationCommit({
      id: 'commit-peer',
      positionId: 'position-peer',
      auditSequence: 12,
    });
    expect(
      authorizePeerReveal({
        request: {
          protocolVersion: ISOLATION_PROTOCOL_VERSION,
          requesterPositionId: pos.id,
          peerPositionId: 'position-peer',
          requesterCommitDigest: commit.canonicalDigest,
          peerCommitDigest: peer.canonicalDigest,
          requestedAtAuditSequence: 11,
        },
        commits: new Map([
          [pos.id, commit],
          ['position-peer', peer],
        ]),
      }),
    ).toMatchObject({ ok: false, reasonCodes: ['early_reveal'] });

    expect(
      authorizePeerReveal({
        request: {
          protocolVersion: ISOLATION_PROTOCOL_VERSION,
          requesterPositionId: pos.id,
          peerPositionId: 'missing-peer',
          requesterCommitDigest: commit.canonicalDigest,
          peerCommitDigest: peer.canonicalDigest,
          requestedAtAuditSequence: 20,
        },
        commits: new Map([[pos.id, commit]]),
      }),
    ).toMatchObject({
      ok: false,
      reasonCodes: ['missing_durable_commit'],
    });

    expect(
      authorizePeerReveal({
        request: {
          protocolVersion: ISOLATION_PROTOCOL_VERSION,
          requesterPositionId: pos.id,
          peerPositionId: 'position-peer',
          requesterCommitDigest: digestC,
          peerCommitDigest: peer.canonicalDigest,
          requestedAtAuditSequence: 20,
        },
        commits: new Map([
          [pos.id, commit],
          ['position-peer', peer],
        ]),
      }),
    ).toMatchObject({ ok: false, reasonCodes: ['commit_digest_drift'] });
  });

  it('rejects reveal commits with digest drift, mutable refs, missing receipts, and unknown versions', () => {
    const pos = position({ receiptRefs: [receipt] });
    expect(
      commitPositionForReveal({
        position: pos,
        commit: { ...isolationCommit(), protocolVersion: '9.9.9' },
        universe: receiptUniverse,
      }),
    ).toMatchObject({ ok: false, reasonCodes: ['schema_invalid'] });

    expect(
      commitPositionForReveal({
        position: pos,
        commit: isolationCommit({ outputDigest: digestC }),
        universe: receiptUniverse,
      }),
    ).toMatchObject({ ok: false, reasonCodes: ['commit_digest_drift'] });

    expect(
      commitPositionForReveal({
        position: pos,
        commit: isolationCommit({
          criterionRef: {
            ...criterionRef,
            supersedesCriterionId: 'criterion-old',
          },
        }),
        universe: receiptUniverse,
      }),
    ).toMatchObject({
      ok: false,
      reasonCodes: ['mutable_criterion_ref'],
    });

    expect(
      commitPositionForReveal({
        position: pos,
        commit: isolationCommit({ modelProfileVersionId: 'model-mutable-ref' }),
        universe: receiptUniverse,
      }),
    ).toMatchObject({
      ok: false,
      reasonCodes: ['mutable_model_profile_ref', 'unknown_model_lineage'],
    });

    expect(
      commitPositionForReveal({
        position: pos,
        commit: isolationCommit({ receiptRefs: [] }),
        universe: receiptUniverse,
      }),
    ).toMatchObject({ ok: false, reasonCodes: ['schema_invalid'] });
  });

  it('builds allowlisted sanitized review context and rejects prohibited leakage', () => {
    const pos = position({ receiptRefs: [receipt] });
    const commit = isolationCommit();
    const context = buildSanitizedReviewContext({ position: pos, commit });

    expect(context.schemaVersion).toBe(SANITIZED_REVIEW_CONTEXT_VERSION);
    expect(Object.keys(context).sort()).not.toContain('authorAgentId');
    expect(
      admitSanitizedReviewContext({ raw: context, position: pos, commit }),
    ).toMatchObject({ ok: true });

    const leakCases: unknown[] = [
      { ...context, authorAgentId: 'agent-author' },
      { ...context, authorModel: 'hidden-model' },
      { ...context, authorProvider: 'hidden-provider' },
      { ...context, confidence: 0.99 },
      { ...context, popularity: 12 },
      { ...context, priorVerdicts: ['admit'] },
      { ...context, upstreamPassMarker: true },
      { ...context, nested: { authorIdentity: 'agent-author' } },
      { ...context, futureProhibitedField: 'unknown future leak' },
      { ...context, canonicalDigest: context.positionCommitDigest },
    ];
    for (const raw of leakCases) {
      expect(
        admitSanitizedReviewContext({ raw, position: pos, commit }),
      ).toMatchObject({
        ok: false,
        reasonCodes: ['review_context_leakage', 'schema_invalid'],
      });
    }

    expect(
      admitSanitizedReviewContext({
        raw: { ...context, contextDigest: context.positionCommitDigest },
        position: pos,
        commit,
      }),
    ).toMatchObject({
      ok: false,
      reasonCodes: ['review_context_digest_drift'],
    });
  });

  it('applies deterministic author-aware assignment and lineage policy before blind review', () => {
    expect(
      admitReviewAssignment({
        raw: assignmentPolicyInput(),
        universe,
      }),
    ).toMatchObject({ ok: true });

    const sameProfile = assignmentPolicyInput({
      assignment: assignment({
        reviewerModelProfileVersionId: authorModel.id,
        reviewerRole: 'critic',
      }),
    });
    expect(admitReviewAssignment({ raw: sameProfile, universe })).toMatchObject(
      {
        ok: false,
        reasonCodes: ['correlated_review', 'self_review'],
      },
    );

    const alias = assignmentPolicyInput({
      assignment: assignment({ reviewerModelProfileVersionId: aliasModel.id }),
    });
    expect(admitReviewAssignment({ raw: alias, universe })).toMatchObject({
      ok: false,
      reasonCodes: ['correlated_review'],
    });

    const sameRole = assignmentPolicyInput({
      assignment: assignment({ reviewerRole: 'lateralist' }),
    });
    expect(admitReviewAssignment({ raw: sameRole, universe })).toMatchObject({
      ok: false,
      reasonCodes: ['self_review'],
    });

    const unknown = assignmentPolicyInput({
      assignment: assignment({
        reviewerModelProfileVersionId: unknownModel.id,
      }),
    });
    expect(admitReviewAssignment({ raw: unknown, universe })).toMatchObject({
      ok: false,
      reasonCodes: ['correlated_review', 'unknown_lineage_policy'],
    });

    const unblind = assignmentPolicyInput({
      assignment: assignment({ blind: false }),
    });
    expect(admitReviewAssignment({ raw: unblind, universe })).toMatchObject({
      ok: false,
      reasonCodes: ['assignment_not_blind'],
    });
  });

  it('preserves dissent and every invalid or unfinished review residue through synthesis', () => {
    const residueKinds: ReviewResidue['kind'][] = [
      'minority_position',
      'unresolved_conflict',
      'abstention',
      'invalid_review',
      'rejected_assignment',
      'timed_out_review',
      'never_started_review',
    ];
    const residues = residueKinds.map((kind, index) =>
      reviewResidue({
        id: `residue-${index + 1}`,
        kind,
        reasonCodes: [`${kind}-retained`],
      }),
    );
    for (const residue of residues) {
      expect(reviewResidueDigest(residue)).toBe(residue.canonicalDigest);
    }

    const requiredResidueIds = new Set(residues.map(({ id }) => id));
    expect(
      admitSynthesis({
        raw: synthesis({ dissentReportIds: [] }),
        universe,
        admittedClaimIds: new Set(['claim-supported']),
        admittedPositionIds: new Set(['position-1']),
        requiredResidueIds,
      }),
    ).toMatchObject({ ok: false, reasonCodes: ['residue_erased'] });

    expect(
      admitSynthesis({
        raw: synthesis({ dissentReportIds: [...requiredResidueIds] }),
        universe,
        admittedClaimIds: new Set(['claim-supported']),
        admittedPositionIds: new Set(['position-1']),
        requiredResidueIds,
      }),
    ).toMatchObject({ ok: true });
  });
});
