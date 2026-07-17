import { canonicalDigest, InvestigationPreviewSchema } from '../src/index.js';
import { describe, expect, it } from 'vitest';

describe('investigation preview contract', () => {
  it('rejects a preview whose content no longer matches its digest', () => {
    const body = {
      schemaVersion: '1.0.0' as const,
      contractFamily: 'investigation.preview.v1' as const,
      investigationId: 'investigation:test',
      question: 'How should a complex unfamiliar problem be investigated?',
      interpretation: {
        objective: 'Produce a useful answer.',
        decisionCriterion: 'Prefer well-supported conclusions.',
        constraints: ['No external effects before approval.'],
        unknowns: ['Which evidence matters?'],
        falsifiers: ['A credible counterexample.'],
      },
      proposedTeam: Array.from({ length: 5 }, (_, index) => ({
        roleId: `role-${String(index)}`,
        title: `Role ${String(index)}`,
        mission: 'Investigate independently.',
        independence: 'Cannot evaluate its own work.',
      })),
      ambiguities: ['The decision horizon is unknown.'],
      assumptions: ['Research-only completion is acceptable.'],
      plan: {
        subquestions: ['What is observed?'],
        searchQueries: ['question evidence'],
        evidenceRequirements: ['Capture source lineage.'],
        falsificationChecks: ['Seek counterexamples.'],
        contradictionChecks: ['Preserve disagreement.'],
        reportSections: ['Direct answer'],
        stopCriteria: ['Answer or mark blocked.'],
      },
      requestedAuthority: {
        status: 'not_granted' as const,
        approvalRequired: true as const,
        localProviders: ['local planner'],
        requestedCloudCapabilities: ['research'],
        requestedTools: ['search'],
        requestedNetworkAccess: ['read-only public access'],
        maxTimeMinutes: 30,
        maxSpendUsd: 1,
        externalEffectsExecuted: false as const,
      },
      experiments: {
        mode: 'design_only' as const,
        executionAuthorized: false as const,
        statement: 'Experiment execution is not authorized.',
      },
      approvalChoices: [
        { choice: 'approve' as const, effect: 'Mint scoped authority.' },
        { choice: 'revise' as const, effect: 'Revise without effects.' },
        { choice: 'cancel' as const, effect: 'End without effects.' },
      ],
      planner: {
        plannerId: 'local-deterministic-question-planner/v1' as const,
        questionDerived: true as const,
        networkUsed: false as const,
        externalProviderUsed: false as const,
      },
    };
    const preview = {
      ...body,
      previewDigest: canonicalDigest(body),
    };
    expect(InvestigationPreviewSchema.parse(preview)).toEqual(preview);
    expect(() =>
      InvestigationPreviewSchema.parse({
        ...preview,
        question: `${preview.question} Changed.`,
      }),
    ).toThrow(/digest/u);
  });
});
