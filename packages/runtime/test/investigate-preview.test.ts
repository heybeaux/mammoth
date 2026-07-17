import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createInvestigationPreview,
  INVESTIGATION_ARTIFACT_NAMES,
  planInvestigation,
} from '../src/index.js';
import { describe, expect, it } from 'vitest';

const questions = [
  'Where do the strongest opportunities lie for private local world models trained on consumer hardware?',
  'Should a city replace flat transit fares with income-based pricing, and what could go wrong?',
  'What evidence would establish whether urban night lighting changes insect populations over time?',
] as const;

describe('local investigation preview', () => {
  it('is deterministic, question-derived, and performs no external effects', () => {
    const first = planInvestigation(questions[0]);
    const second = planInvestigation(`  ${questions[0]}  `);
    expect(second).toEqual(first);
    expect(first.planner).toEqual({
      plannerId: 'local-deterministic-question-planner/v1',
      questionDerived: true,
      networkUsed: false,
      externalProviderUsed: false,
    });
    expect(first.requestedAuthority).toMatchObject({
      status: 'not_granted',
      approvalRequired: true,
      externalEffectsExecuted: false,
    });
    expect(first.experiments).toMatchObject({
      mode: 'design_only',
      executionAuthorized: false,
    });
  });

  it('produces materially different teams and plans for unrelated questions', () => {
    const previews = questions.map((question) => planInvestigation(question));
    const optionalTeams = previews.map((preview) =>
      preview.proposedTeam
        .slice(2, -2)
        .map((role) => role.roleId)
        .join(','),
    );
    expect(new Set(optionalTeams).size).toBe(questions.length);
    expect(
      new Set(previews.map((preview) => preview.plan.searchQueries.join('\n')))
        .size,
    ).toBe(questions.length);
    expect(
      new Set(previews.map((preview) => preview.plan.reportSections.join('\n')))
        .size,
    ).toBe(questions.length);
  });

  it('preserves explicit constraint phrases in generic search plans', () => {
    const cases = [
      {
        question:
          'Which field data synchronization strategies help remote clinics operate offline during intermittent connectivity while resolving conflicting patient records?',
        expected: [
          'remote clinics operate offline',
          'conflicting patient records',
        ],
      },
      {
        question:
          'Where should individuals building open-source private local world-model systems on a single consumer GPU focus first?',
        expected: ['open-source private local', 'single consumer gpu'],
      },
      {
        question:
          'How should small heritage buildings cut winter heating costs without damaging archival collections under a limited maintenance budget?',
        expected: [
          'heritage buildings cut winter',
          'limited maintenance budget',
        ],
      },
    ] as const;

    for (const item of cases) {
      const planText = planInvestigation(item.question)
        .plan.searchQueries.join('\n')
        .toLocaleLowerCase('en-US');
      for (const phrase of item.expected) {
        expect(planText).toContain(phrase);
      }
    }
  });

  it('carries late question constraints into implementation and feasibility searches', () => {
    const plan = planInvestigation(
      'Where should individuals building open-source private local world-model systems on a single consumer GPU focus first?',
    ).plan.searchQueries.map((query) => query.toLocaleLowerCase('en-US'));

    expect(
      plan.some(
        (query) =>
          query.includes('repository readme implementation') &&
          query.includes('open-source') &&
          query.includes('private') &&
          query.includes('local') &&
          query.includes('single') &&
          query.includes('consumer') &&
          query.includes('gpu'),
      ),
    ).toBe(true);
    expect(
      plan.some(
        (query) =>
          query.includes('benchmark feasibility comparison') &&
          query.includes('single') &&
          query.includes('consumer') &&
          query.includes('gpu'),
      ),
    ).toBe(true);
  });

  it('projects one digest-bound preview into the required machine and reader artifacts', () => {
    const result = createInvestigationPreview(questions[1]);
    expect(Object.keys(result.artifacts)).toEqual([
      ...INVESTIGATION_ARTIFACT_NAMES,
    ]);
    for (const name of INVESTIGATION_ARTIFACT_NAMES.slice(0, -1)) {
      expect(result.artifacts[name]).toMatchObject({
        investigationId: result.preview.investigationId,
        previewDigest: result.preview.previewDigest,
      });
    }
    expect(result.artifacts['preview.md']).toContain(
      'No external research has run.',
    );
    expect(result.artifacts['preview.md']).toContain('## Approval choices');
  });

  it('keeps evaluation topic vocabulary and URLs out of generic production files', async () => {
    const runtimeRoot = fileURLToPath(new URL('../src/', import.meta.url));
    const domainRoot = fileURLToPath(
      new URL('../../domain/src/', import.meta.url),
    );
    const sources = await Promise.all([
      readFile(join(runtimeRoot, 'investigate-planner.ts'), 'utf8'),
      readFile(join(runtimeRoot, 'investigate-application.ts'), 'utf8'),
      readFile(join(runtimeRoot, 'investigate-report.ts'), 'utf8'),
      readFile(join(domainRoot, 'investigation.ts'), 'utf8'),
    ]);
    const production = sources.join('\n').toLocaleLowerCase('en-US');
    for (const forbidden of [
      'world model',
      'transit fare',
      'night lighting',
      'insect population',
      'colibri',
      'data center',
      'microplastic',
      'short-term rental',
      'http://',
      'https://',
    ]) {
      expect(production).not.toContain(forbidden);
    }
  });
});
