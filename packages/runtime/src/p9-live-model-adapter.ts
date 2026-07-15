import {
  P9SemanticDeltaSchema,
  type P9ObservedUsage,
  type ResearchPlan,
} from '@mammoth/domain';
import { z } from 'zod';
import type {
  P9LiveClaimSeed,
  P9LiveEvaluatorFinding,
  P9LiveModelAdapter,
  P9LiveModelOutcome,
  P9LiveModelProfile,
} from './p9-live-application.js';
import type { P9ObservedSourceSnapshot } from './p9-generic-research.js';

const MAX_RESPONSE_BYTES = 2_000_000;
const MAX_SNAPSHOT_EXCERPT = 6_000;
const REQUEST_TIMEOUT_MS = 90_000;

export interface OpenAICompatibleP9LiveModelAdapterInput {
  readonly baseUrl: string;
  readonly apiKeyEnvironmentVariable: string;
  readonly proposerProfile: P9LiveModelProfile;
  readonly evaluatorProfile: P9LiveModelProfile;
  readonly proposerMaxOutputTokens: number;
  readonly evaluatorMaxOutputTokens: number;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => Date;
}

const ClaimSeedSchema = z.object({
  claimId: z.string().min(1),
  candidateId: z.string().min(1),
  quote: z.string().min(1),
  statement: z.string().min(1),
  subquestionIds: z.array(z.string().min(1)).min(1),
  sectionId: z.string().min(1),
  claimGroupId: z.string().min(1),
  critical: z.boolean(),
  contradictionIds: z.array(z.string().min(1)).default([]),
});

const EvaluatorFindingSchema = z.object({
  claimId: z.string().min(1),
  verdict: z.enum(['entailed', 'contradicted', 'insufficient']),
  semanticDeltas: z.array(P9SemanticDeltaSchema).default([]),
  reasonCodes: z.array(z.string().min(1)).min(1),
});

const ClaimSeedResponseSchema = z.object({
  claims: z.array(ClaimSeedSchema),
});

const EvaluatorResponseSchema = z.object({
  findings: z.array(EvaluatorFindingSchema),
});

const ChatCompletionResponseSchema = z
  .object({
    choices: z
      .array(
        z
          .object({
            message: z.object({ content: z.string() }).passthrough(),
          })
          .passthrough(),
      )
      .min(1),
    usage: z
      .object({
        prompt_tokens: z.number().int().nonnegative().default(0),
        completion_tokens: z.number().int().nonnegative().default(0),
      })
      .passthrough()
      .nullish(),
  })
  .passthrough();

/**
 * Live model adapter for OpenAI-compatible chat-completions providers. The
 * credential is resolved by environment-variable name at call time and is
 * never persisted or echoed; usage comes from the provider-reported usage
 * block, or null when the provider reports none so the executor settles the
 * effect conservatively at its reserved ceiling.
 */
export class OpenAICompatibleP9LiveModelAdapter implements P9LiveModelAdapter {
  readonly proposerProfile: P9LiveModelProfile;
  readonly evaluatorProfile: P9LiveModelProfile;
  readonly #completionsUrl: URL;

  constructor(private readonly input: OpenAICompatibleP9LiveModelAdapterInput) {
    const base = new URL(input.baseUrl);
    if (base.protocol !== 'https:') {
      throw new Error('P9 live model adapter requires an https base URL');
    }
    if (!input.apiKeyEnvironmentVariable.trim()) {
      throw new Error(
        'P9 live model adapter requires an API key environment variable name',
      );
    }
    for (const [role, value] of [
      ['proposer', input.proposerMaxOutputTokens],
      ['evaluator', input.evaluatorMaxOutputTokens],
    ] as const) {
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error(
          `P9 live ${role} max output tokens must be a positive integer`,
        );
      }
    }
    if (
      input.proposerProfile.profileFamilyId ===
      input.evaluatorProfile.profileFamilyId
    ) {
      throw new Error(
        'P9 live proposer and evaluator profile families must differ',
      );
    }
    this.#completionsUrl = new URL(
      `${base.pathname.replace(/\/+$/u, '')}/chat/completions`,
      base,
    );
    this.proposerProfile = input.proposerProfile;
    this.evaluatorProfile = input.evaluatorProfile;
  }

  async proposeClaims(request: {
    readonly plan: ResearchPlan;
    readonly snapshots: readonly P9ObservedSourceSnapshot[];
  }): Promise<P9LiveModelOutcome<readonly P9LiveClaimSeed[]>> {
    const outcome = await this.#complete(
      this.proposerProfile.modelId,
      [
        'You are a research claim proposer. Given a research plan and source',
        'snapshots, propose factual claims. Each claim must include an exact',
        'verbatim quote copied character-for-character from one snapshot body.',
        'The statement must be exactly identical to the quote; do not paraphrase',
        'or add recommendations, causality, comparisons, quantities, or scope.',
        'Return the governed JSON object whose claims array contains objects',
        'with keys: claimId,',
        'candidateId, quote, statement, subquestionIds, sectionId,',
        'claimGroupId, critical, contradictionIds.',
      ].join(' '),
      promptContext(request.plan, request.snapshots),
      this.input.proposerMaxOutputTokens,
      claimSeedResponseFormat(),
    );
    return {
      value: ClaimSeedResponseSchema.parse(JSON.parse(outcome.content)).claims,
      usage: outcome.usage,
    };
  }

  async evaluateClaims(request: {
    readonly plan: ResearchPlan;
    readonly claims: readonly P9LiveClaimSeed[];
    readonly snapshots: readonly P9ObservedSourceSnapshot[];
  }): Promise<P9LiveModelOutcome<readonly P9LiveEvaluatorFinding[]>> {
    const outcome = await this.#complete(
      this.evaluatorProfile.modelId,
      [
        'You are an independent entailment evaluator. For each proposed claim,',
        'decide whether the quoted snapshot text entails the statement.',
        'Quote identity alone does not prove support. Respond with ONLY a JSON',
        'object whose findings array contains objects with keys: claimId,',
        'verdict (one of entailed,',
        'contradicted, insufficient), semanticDeltas (only governed enum',
        `values: ${P9SemanticDeltaSchema.options.join(', ')}), and one or more`,
        'non-empty reasonCodes.',
      ].join(' '),
      `${promptContext(request.plan, request.snapshots)}\n\nProposed claims:\n${JSON.stringify(request.claims)}`,
      this.input.evaluatorMaxOutputTokens,
      evaluatorResponseFormat(),
    );
    return {
      value: EvaluatorResponseSchema.parse(JSON.parse(outcome.content))
        .findings,
      usage: outcome.usage,
    };
  }

  async #complete(
    modelId: string,
    system: string,
    user: string,
    maxTokens: number,
    responseFormat: object,
  ): Promise<{ content: string; usage: P9ObservedUsage | null }> {
    const environment = this.input.environment ?? process.env;
    const apiKey = environment[this.input.apiKeyEnvironmentVariable];
    if (!apiKey?.trim()) {
      throw new Error(
        `P9 live model credential environment variable ${this.input.apiKeyEnvironmentVariable} is empty`,
      );
    }
    const now = this.input.now ?? (() => new Date());
    const fetchImpl = this.input.fetchImpl ?? fetch;
    const startedAt = now().getTime();
    const response = await fetchImpl(this.#completionsUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelId,
        temperature: 0,
        max_tokens: maxTokens,
        response_format: responseFormat,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(
        `P9 live model call failed with HTTP ${String(response.status)}`,
      );
    }
    const rawBody = await response.text();
    if (Buffer.byteLength(rawBody, 'utf8') > MAX_RESPONSE_BYTES) {
      throw new Error('P9 live model response exceeded the size cap');
    }
    const parsed = ChatCompletionResponseSchema.parse(JSON.parse(rawBody));
    const usage = parsed.usage
      ? {
          requests: 1,
          inputTokens: parsed.usage.prompt_tokens,
          outputTokens: parsed.usage.completion_tokens,
          bytes: Buffer.byteLength(rawBody, 'utf8'),
          durationMs: Math.max(0, now().getTime() - startedAt),
        }
      : null;
    const choice = parsed.choices[0];
    if (!choice) {
      throw new Error('P9 live model response did not include a choice');
    }
    return { content: choice.message.content, usage };
  }
}

function promptContext(
  plan: ResearchPlan,
  snapshots: readonly P9ObservedSourceSnapshot[],
): string {
  const planSummary = {
    question: plan.question,
    subquestions: plan.subquestions,
    reportOutline: plan.reportOutline,
    contradictionRequirements: plan.contradictionRequirements,
  };
  const boundedSnapshots = snapshots.map((snapshot) => ({
    candidateId: snapshot.candidateId,
    sourceClass: snapshot.sourceClass,
    sourceFamilyId: snapshot.sourceFamilyId,
    body: snapshot.body.slice(0, MAX_SNAPSHOT_EXCERPT),
  }));
  return `Research plan:\n${JSON.stringify(planSummary)}\n\nSource snapshots:\n${JSON.stringify(boundedSnapshots)}`;
}

function claimSeedResponseFormat(): object {
  return structuredResponseFormat('p9_live_claim_seeds', 'claims', {
    type: 'object',
    additionalProperties: false,
    properties: {
      claimId: { type: 'string', minLength: 1 },
      candidateId: { type: 'string', minLength: 1 },
      quote: { type: 'string', minLength: 1 },
      statement: { type: 'string', minLength: 1 },
      subquestionIds: {
        type: 'array',
        minItems: 1,
        items: { type: 'string', minLength: 1 },
      },
      sectionId: { type: 'string', minLength: 1 },
      claimGroupId: { type: 'string', minLength: 1 },
      critical: { type: 'boolean' },
      contradictionIds: {
        type: 'array',
        items: { type: 'string', minLength: 1 },
      },
    },
    required: [
      'claimId',
      'candidateId',
      'quote',
      'statement',
      'subquestionIds',
      'sectionId',
      'claimGroupId',
      'critical',
      'contradictionIds',
    ],
  });
}

function evaluatorResponseFormat(): object {
  return structuredResponseFormat('p9_live_entailment_findings', 'findings', {
    type: 'object',
    additionalProperties: false,
    properties: {
      claimId: { type: 'string', minLength: 1 },
      verdict: {
        type: 'string',
        enum: ['entailed', 'contradicted', 'insufficient'],
      },
      semanticDeltas: {
        type: 'array',
        items: { type: 'string', enum: [...P9SemanticDeltaSchema.options] },
      },
      reasonCodes: {
        type: 'array',
        minItems: 1,
        items: { type: 'string', minLength: 1 },
      },
    },
    required: ['claimId', 'verdict', 'semanticDeltas', 'reasonCodes'],
  });
}

function structuredResponseFormat(
  name: string,
  collectionKey: string,
  itemSchema: object,
): object {
  return {
    type: 'json_schema',
    json_schema: {
      name,
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          [collectionKey]: { type: 'array', items: itemSchema },
        },
        required: [collectionKey],
      },
    },
  };
}
