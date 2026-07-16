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
        claims: Array.from({ length: 8 }, (_, index) => {
          const claimNumber = index + 1;
          return {
            claimId: `claim-${String(claimNumber)}`,
            evidenceSpanId: 'candidate-1:span:0',
            subquestionIds: ['sq-upstream'],
            sectionId: 'upstream_colibri_facts',
            claimGroupId: 'group-1',
            critical: false,
            contradictionIds: [],
          };
        }),
      },
      {
        findings: Array.from({ length: 8 }, (_, index) => ({
          claimId: `claim-${String(index + 1)}`,
          verdict: 'entailed',
          semanticDeltas: [],
          reasonCodes: ['exact_quote_entails_statement'],
        })),
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
    for (const request of requests) {
      expect(request.response_format).toMatchObject({
        type: 'json_schema',
        json_schema: { strict: true },
      });
      expect(JSON.stringify(request)).not.toContain('secret-not-for-output');
    }
    expect(JSON.stringify(requests[0])).toContain(
      'Never invent, rewrite, or combine evidence text',
    );
    expect(JSON.stringify(requests[0])).toContain(
      'Never use a page title, navigation label, breadcrumb, or source name',
    );
    expect(JSON.stringify(requests[1])).toContain(
      'semanticDeltas must always be an empty array',
    );
    expect(JSON.stringify(requests[1])).toContain(
      'with no omissions, extras, or duplicate claimIds',
    );
    expect(JSON.stringify(requests[1]?.response_format)).not.toContain(
      '"maxItems":0',
    );
    expect(JSON.stringify(requests[1]?.response_format)).not.toContain(
      '"minItems":6',
    );
    expect(requests[0]?.response_format).toMatchObject({
      json_schema: {
        schema: {
          properties: {
            claims: {
              minItems: 8,
              items: {
                properties: {
                  evidenceSpanId: { enum: ['candidate-1:span:0'] },
                },
              },
            },
          },
        },
      },
    });
    expect(requests[1]?.response_format).toMatchObject({
      json_schema: {
        schema: {
          properties: {
            findings: {
              items: {
                properties: {
                  semanticDeltas: {
                    items: {
                      enum: [
                        'negation',
                        'quantity',
                        'unit',
                        'scope',
                        'causality',
                        'comparison',
                        'certainty',
                        'actor',
                        'timeframe',
                        'recommendation_premise',
                      ],
                    },
                  },
                  reasonCodes: { minItems: 1 },
                },
              },
            },
          },
        },
      },
    });
  });

  it('fails closed when the evaluator omits required findings', async () => {
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
      fetchImpl: (() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      findings: [
                        {
                          claimId: 'claim-1',
                          verdict: 'entailed',
                          semanticDeltas: [],
                          reasonCodes: ['exact_quote_entails_statement'],
                        },
                      ],
                    }),
                  },
                },
              ],
            }),
            { status: 200 },
          ),
        )) as typeof fetch,
    });
    const plan = buildAcceptedP9LivePlan({
      budgetUsd: 5,
      now: '2026-07-15T18:00:00.000Z',
      proposerProfile: adapter.proposerProfile,
    }).plan;

    await expect(
      adapter.evaluateClaims({ plan, claims: [], snapshots: [] }),
    ).rejects.toThrow(/at least 6/u);
  });

  it('fails closed when the provider ignores the eight-claim response contract', async () => {
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
      fetchImpl: (() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      claims: [
                        {
                          claimId: 'claim-1',
                          evidenceSpanId: 'candidate-1:span:0',
                          subquestionIds: ['sq-upstream'],
                          sectionId: 'upstream_colibri_facts',
                          claimGroupId: 'group-1',
                          critical: false,
                          contradictionIds: [],
                        },
                      ],
                    }),
                  },
                },
              ],
              usage: { prompt_tokens: 100, completion_tokens: 20 },
            }),
            { status: 200 },
          ),
        )) as typeof fetch,
    });
    const plan = buildAcceptedP9LivePlan({
      budgetUsd: 5,
      now: '2026-07-15T18:00:00.000Z',
      proposerProfile: adapter.proposerProfile,
    }).plan;

    await expect(
      adapter.proposeClaims({ plan, snapshots: [] }),
    ).rejects.toThrow(/at least 8/u);
  });

  it('rejects semantic deltas for character-identical extractive claims', async () => {
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
      fetchImpl: (() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      findings: Array.from({ length: 6 }, (_, index) =>
                        index === 0
                          ? {
                              claimId: 'claim-1',
                              verdict: 'insufficient',
                              semanticDeltas: ['quantity'],
                              reasonCodes: ['quote_does_not_entail_statement'],
                            }
                          : {
                              claimId: `claim-${String(index + 1)}`,
                              verdict: 'entailed',
                              semanticDeltas: [],
                              reasonCodes: ['exact_quote_entails_statement'],
                            },
                      ),
                    }),
                  },
                },
              ],
              usage: { prompt_tokens: 100, completion_tokens: 20 },
            }),
            { status: 200 },
          ),
        )) as typeof fetch,
    });
    const plan = buildAcceptedP9LivePlan({
      budgetUsd: 5,
      now: '2026-07-15T18:00:00.000Z',
      proposerProfile: adapter.proposerProfile,
    }).plan;

    await expect(
      adapter.evaluateClaims({
        plan,
        claims: [],
        snapshots: [],
      }),
    ).rejects.toThrow(/at most 0/u);
  });
});
