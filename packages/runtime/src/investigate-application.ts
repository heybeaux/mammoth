import {
  InvestigationPreviewSchema,
  type InvestigationPreview,
} from '@mammoth/domain';
import { planInvestigation } from './investigate-planner.js';
import { renderInvestigationPreview } from './investigate-report.js';

export const INVESTIGATION_ARTIFACT_NAMES = [
  'problem-contract.json',
  'team-plan.json',
  'research-plan-proposal.json',
  'approval-request.json',
  'preview.md',
] as const;

export interface InvestigationPreviewArtifacts {
  readonly 'problem-contract.json': Readonly<
    Pick<
      InvestigationPreview,
      | 'schemaVersion'
      | 'contractFamily'
      | 'investigationId'
      | 'question'
      | 'interpretation'
      | 'ambiguities'
      | 'assumptions'
      | 'previewDigest'
    >
  >;
  readonly 'team-plan.json': Readonly<
    Pick<
      InvestigationPreview,
      | 'schemaVersion'
      | 'contractFamily'
      | 'investigationId'
      | 'proposedTeam'
      | 'previewDigest'
    >
  >;
  readonly 'research-plan-proposal.json': Readonly<
    Pick<
      InvestigationPreview,
      | 'schemaVersion'
      | 'contractFamily'
      | 'investigationId'
      | 'plan'
      | 'experiments'
      | 'planner'
      | 'previewDigest'
    >
  >;
  readonly 'approval-request.json': Readonly<
    Pick<
      InvestigationPreview,
      | 'schemaVersion'
      | 'contractFamily'
      | 'investigationId'
      | 'requestedAuthority'
      | 'approvalChoices'
      | 'previewDigest'
    >
  >;
  readonly 'preview.md': string;
}

export interface InvestigationPreviewResult {
  readonly preview: InvestigationPreview;
  readonly artifacts: InvestigationPreviewArtifacts;
}

export function createInvestigationPreview(
  question: string,
): InvestigationPreviewResult {
  const preview = InvestigationPreviewSchema.parse(planInvestigation(question));
  const common = {
    schemaVersion: preview.schemaVersion,
    contractFamily: preview.contractFamily,
    investigationId: preview.investigationId,
    previewDigest: preview.previewDigest,
  };
  return {
    preview,
    artifacts: {
      'problem-contract.json': {
        ...common,
        question: preview.question,
        interpretation: preview.interpretation,
        ambiguities: preview.ambiguities,
        assumptions: preview.assumptions,
      },
      'team-plan.json': {
        ...common,
        proposedTeam: preview.proposedTeam,
      },
      'research-plan-proposal.json': {
        ...common,
        plan: preview.plan,
        experiments: preview.experiments,
        planner: preview.planner,
      },
      'approval-request.json': {
        ...common,
        requestedAuthority: preview.requestedAuthority,
        approvalChoices: preview.approvalChoices,
      },
      'preview.md': renderInvestigationPreview(preview),
    },
  };
}
