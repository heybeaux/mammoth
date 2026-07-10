import {
  ClaimAssessmentSchema,
  ClaimDependencySchema,
  ClaimEvidenceEdgeSchema,
  ClaimSchema,
  EvidenceArtifactSchema,
  SourceLineageSchema,
  buildClaimGraph,
  validateSourceLineageGraph,
  type Claim,
  type ClaimAssessment,
  type ClaimDependency,
  type ClaimEvidenceEdge,
  type EvidenceArtifact,
  type SourceLineage,
} from '@mammoth/domain';
import { z } from 'zod';

export const LedgerStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    revision: z.number().int().nonnegative(),
    claims: z.array(ClaimSchema),
    assessments: z.array(ClaimAssessmentSchema),
    evidence: z.array(EvidenceArtifactSchema),
    claimEvidenceEdges: z.array(ClaimEvidenceEdgeSchema),
    claimDependencies: z.array(ClaimDependencySchema),
    sourceLineages: z.array(SourceLineageSchema),
  })
  .strict();

export interface LedgerState {
  schemaVersion: 1;
  revision: number;
  claims: Claim[];
  assessments: ClaimAssessment[];
  evidence: EvidenceArtifact[];
  claimEvidenceEdges: ClaimEvidenceEdge[];
  claimDependencies: ClaimDependency[];
  sourceLineages: SourceLineage[];
}

export function emptyLedgerState(): LedgerState {
  return {
    schemaVersion: 1,
    revision: 0,
    claims: [],
    assessments: [],
    evidence: [],
    claimEvidenceEdges: [],
    claimDependencies: [],
    sourceLineages: [],
  };
}

export interface EpistemicLedger {
  read(): Promise<Readonly<LedgerState>>;
  transact(
    mutate: (draft: LedgerState) => void,
  ): Promise<Readonly<LedgerState>>;
}

export function validateLedgerState(input: unknown): LedgerState {
  const state = LedgerStateSchema.parse(input) as LedgerState;
  uniqueIds(state.claims, 'claim');
  uniqueIds(state.evidence, 'evidence');
  uniqueIds(state.sourceLineages, 'source lineage');
  uniqueIds(state.claimDependencies, 'claim dependency');
  uniqueIds(state.claimEvidenceEdges, 'claim evidence edge');

  const claimIds = new Set(state.claims.map(({ id }) => id));
  const evidenceIds = new Set(state.evidence.map(({ id }) => id));
  const lineageIds = new Set(state.sourceLineages.map(({ id }) => id));
  for (const artifact of state.evidence) {
    if (!lineageIds.has(artifact.sourceLineageId)) {
      throw new Error(
        `evidence ${artifact.id} references unknown source lineage`,
      );
    }
  }
  for (const edge of state.claimEvidenceEdges) {
    if (!claimIds.has(edge.claimId) || !evidenceIds.has(edge.evidenceId)) {
      throw new Error(
        `claim evidence edge ${edge.id} has a dangling reference`,
      );
    }
  }
  for (const assessment of state.assessments) {
    if (!claimIds.has(assessment.claimId)) {
      throw new Error(`assessment ${assessment.id} references unknown claim`);
    }
    if (assessment.evidenceIds.some((id) => !evidenceIds.has(id))) {
      throw new Error(
        `assessment ${assessment.id} references unknown evidence`,
      );
    }
  }
  buildClaimGraph(claimIds, state.claimDependencies);
  validateSourceLineageGraph(state.sourceLineages);
  return state;
}

function uniqueIds(records: readonly { id: string }[], kind: string): void {
  const ids = new Set<string>();
  for (const record of records) {
    if (ids.has(record.id))
      throw new Error(`duplicate ${kind} id ${record.id}`);
    ids.add(record.id);
  }
}
