import { describe, expect, it } from 'vitest';
import {
  MODEL_LINEAGE_POLICY_VERSION,
  RESEARCH_CELL_CONTRACT_VERSION,
  ResearchPositionSchema,
  admitResearchPosition,
  admitResearchReview,
  admitSynthesis,
  assessModelCorrelation,
  cellInputDigest,
  evaluatePositionProposals,
  modelProfileVersionDigest,
  researchPositionDigest,
  researchReviewDigest,
  synthesisArtifactDigest,
  unsupportedAgreementCannotPromote,
  validateModelLineageGraph,
  type CellInput,
  type CriterionReference,
  type ModelProfileVersion,
  type ReferenceUniverse,
  type ResearchPosition,
  type ResearchReview,
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
  criterionRef,
  claimIds: new Set(['claim-supported', 'claim-unsupported']),
  evidenceIds: new Set(['evidence-1']),
  hypothesisIds: new Set(['hypothesis-1']),
  artifactIds: new Set(['artifact-1']),
  modelVersions,
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
  });
});

describe('admission and review policy', () => {
  it('keeps one or one hundred unsupported agreeing positions from promoting truth', () => {
    expect(
      unsupportedAgreementCannotPromote({
        claimId: 'claim-unsupported',
        supportingPositionIds: ['position-1'],
        admittedClaimIds: new Set(['claim-supported']),
      }),
    ).toBe(true);
    expect(
      unsupportedAgreementCannotPromote({
        claimId: 'claim-unsupported',
        supportingPositionIds: Array.from(
          { length: 100 },
          (_, index) => `position-${String(index)}`,
        ),
        admittedClaimIds: new Set(['claim-supported']),
      }),
    ).toBe(true);
  });

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
      requireIndependentReviewer: true,
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
      requireIndependentReviewer: true,
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
      requireIndependentReviewer: true,
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
      requireIndependentReviewer: true,
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
        requireIndependentReviewer: true,
      }),
    ).toMatchObject({ ok: true });
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
      ok: false,
      reasonCodes: ['unapproved_criterion_branch'],
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
  });
});
