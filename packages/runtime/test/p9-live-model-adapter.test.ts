import { describe, expect, it } from 'vitest';
import {
  OpenAICompatibleP9LiveModelAdapter,
  buildAcceptedP9LivePlan,
} from '../src/index.js';

describe('OpenAI-compatible P9 live model adapter', () => {
  it('binds each call to its reserved output ceiling and a strict JSON schema', async () => {
    const requests: Record<string, unknown>[] = [];
    const requestUrls: string[] = [];
    const responses = [
      {
        claims: [
          {
            claimId: 'claim-1',
            candidateId: 'candidate-1',
            quote: 'Exact source quote.',
            statement: 'The source contains an exact quote.',
            subquestionIds: ['sq-upstream'],
            sectionId: 'upstream_colibri_facts',
            claimGroupId: 'group-1',
            critical: false,
            contradictionIds: [],
          },
        ],
      },
      {
        findings: [
          {
            claimId: 'claim-1',
            verdict: 'entailed',
            semanticDeltas: [],
            reasonCodes: ['quote_entails_statement'],
          },
        ],
      },
    ];
    const fetchImpl: typeof fetch = (url, init) => {
      if (typeof init?.body !== 'string') {
        throw new Error('expected a serialized JSON request body');
      }
      requestUrls.push(
        typeof url === 'string' ? url : url instanceof URL ? url.href : url.url,
      );
      requests.push(JSON.parse(init.body) as Record<string, unknown>);
      const content = responses.shift();
      return Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify(content) } }],
            usage: { prompt_tokens: 100, completion_tokens: 20 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    };
    const adapter = new OpenAICompatibleP9LiveModelAdapter({
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKeyEnvironmentVariable: 'TEST_MODEL_KEY',
      proposerProfile: {
        profileVersionId: 'proposer-v1',
        profileFamilyId: 'proposer-family',
        modelId: 'provider/proposer',
      },
      evaluatorProfile: {
        profileVersionId: 'evaluator-v1',
        profileFamilyId: 'evaluator-family',
        modelId: 'provider/evaluator',
      },
      proposerMaxOutputTokens: 1_200,
      evaluatorMaxOutputTokens: 800,
      environment: { TEST_MODEL_KEY: 'secret-not-for-output' },
      fetchImpl,
    });
    const plan = buildAcceptedP9LivePlan({
      budgetUsd: 5,
      now: '2026-07-15T18:00:00.000Z',
      proposerProfile: adapter.proposerProfile,
    }).plan;
    const snapshots = [
      {
        candidateId: 'candidate-1',
        body: 'Exact source quote.',
        sourceClass: 'repository_docs',
        sourceFamilyId: 'github.com',
      },
    ];
    const proposed = await adapter.proposeClaims({ plan, snapshots });
    await adapter.evaluateClaims({
      plan,
      snapshots,
      claims: proposed.value,
    });

    expect(requests).toHaveLength(2);
    expect(requestUrls).toEqual([
      'https://openrouter.ai/api/v1/chat/completions',
      'https://openrouter.ai/api/v1/chat/completions',
    ]);
    expect(requests.map((request) => request.max_tokens)).toEqual([1200, 800]);
    expect(requests[1]?.response_format).toMatchObject({
      json_schema: {
        schema: {
          properties: {
            findings: {
              items: {
                properties: {
                  reasonCodes: { minItems: 1 },
                },
              },
            },
          },
        },
      },
    });
    for (const request of requests) {
      expect(request.response_format).toMatchObject({
        type: 'json_schema',
        json_schema: { strict: true },
      });
      expect(JSON.stringify(request)).not.toContain('secret-not-for-output');
    }
  });
});
