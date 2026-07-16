import {
  P9SemanticDeltaSchema,
  type P9ObservedUsage,
  type ResearchPlan,
} from '@mammoth/domain';
import { z } from 'zod';
import type {
  P9LiveClaimSeed,
  P9LiveClaimSlot,
  P9LiveEvaluatorFinding,
  P9LiveModelAdapter,
  P9LiveModelOutcome,
  P9LiveModelProfile,
  P9LiveNarrativeSection,
} from './p9-live-application.js';
import type { P9ObservedSourceSnapshot } from './p9-generic-research.js';
import {
  deriveP9GovernedClaimSpans,
  P9_LIVE_MAX_SNAPSHOT_EXCERPT,
  type P9GovernedClaimSpan,
} from './p9-live-span-derivation.js';

const MAX_RESPONSE_BYTES = 2_000_000;
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

const ClaimSlotSelectionSchema = z
  .object({
    claimId: z.string().min(1),
    claimGroupId: z.string().min(1),
    critical: z.boolean(),
    contradictionIds: z.array(z.string().min(1)).default([]),
  })
  .strict();

const EvaluatorFindingSchema = z.object({
  claimId: z.string().min(1),
  verdict: z.enum(['entailed', 'contradicted', 'insufficient']),
  semanticDeltas: z.array(P9SemanticDeltaSchema).max(0).default([]),
  reasonCodes: z.array(z.string().min(1)).min(1),
});

const ClaimSeedResponseSchema = z
  .object({
    claimSlots: z.record(z.string().min(1), ClaimSlotSelectionSchema),
  })
  .strict();

const EvaluatorResponseSchema = z.object({
  findings: z.array(EvaluatorFindingSchema).min(6),
});

const NarrativeResponseSchema = z.object({
  sections: z
    .array(
      z
        .object({
          sectionId: z.string().min(1),
          lead: z.string().min(100).max(600),
          claimIds: z.array(z.string().min(1)),
        })
        .strict(),
    )
    .min(7),
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
    readonly claimSlots: readonly P9LiveClaimSlot[];
  }): Promise<P9LiveModelOutcome<readonly P9LiveClaimSeed[]>> {
    const spans = deriveP9GovernedClaimSpans(request.snapshots);
    const spansById = new Map(spans.map((span) => [span.evidenceSpanId, span]));
    const slotIds = request.claimSlots.map((slot) => slot.evidenceSpanId);
    if (new Set(slotIds).size !== slotIds.length || slotIds.length < 12) {
      throw new Error(
        'P9 live proposer requires at least twelve unique prevalidated claim slots',
      );
    }
    const outcome = await this.#complete(
      this.proposerProfile.modelId,
      [
        'You are a research claim proposer. Given a research plan and source',
        'evidence spans, propose atomic factual claims by selecting governed span',
        'IDs. Never invent, rewrite, or combine evidence text; Mammoth constructs',
        'the exact quote and statement from the selected span. Never mix',
        'a sourced fact with a recommendation, implication, experiment design,',
        'or other inference. Every number, unit, scope word, comparison, causal',
        'term, certainty term, timeframe, and recommendation term in a statement',
        'must also appear in its quote. Map claims only to subquestions they',
        'directly answer, and the quote itself must include material words from',
        'each mapped subquestion. For upstream_model_docs, a concise governed',
        'model id, pipeline task, or library field is valid technical metadata.',
        'When an upstream_model_docs snapshot exposes an id field containing a',
        'model identifier named in the upstream subquestion, select that id field',
        'and map it to the upstream subquestion instead of selecting pipeline_tag.',
        'Each provided claim slot is already bound to exactly one immutable',
        'evidence span, report section, and set of relevant subquestions. Return',
        'exactly one filled entry for every claim slot key, with no omissions,',
        'extras, or duplicate claimIds. You cannot change evidence, section, or',
        'subquestion binding. Never use a page title, navigation label, breadcrumb, or',
        'source name as a claim. Choose substantive body sentences. A claim from',
        'security_advisory evidence must quote text that explicitly discusses at',
        'least two of memory safety, security, vulnerabilities, guidance, or risk.',
        'Mark a claim critical only',
        'when its quote directly supports a',
        'factual premise essential to the bounded-change decision.',
        'Return the governed JSON object whose claimSlots object is keyed by the',
        'provided immutable evidence span IDs. Each value contains only:',
        'claimId, claimGroupId, critical, contradictionIds.',
      ].join(' '),
      proposerPromptContext(request.plan, spans, request.claimSlots),
      this.input.proposerMaxOutputTokens,
      claimSeedResponseFormat(slotIds),
    );
    const selections = ClaimSeedResponseSchema.parse(
      JSON.parse(outcome.content),
    ).claimSlots;
    const returnedSlotIds = Object.keys(selections);
    if (
      returnedSlotIds.length !== slotIds.length ||
      slotIds.some((slotId) => !(slotId in selections)) ||
      returnedSlotIds.some((slotId) => !slotIds.includes(slotId))
    ) {
      throw new Error(
        'P9 live proposer claim slots must match prevalidated seed span IDs exactly',
      );
    }
    const claimIds = returnedSlotIds.map((slotId) => {
      const selection = selections[slotId];
      if (!selection) {
        throw new Error(
          `P9 live proposer omitted prevalidated claim slot: ${slotId}`,
        );
      }
      return selection.claimId;
    });
    if (new Set(claimIds).size !== claimIds.length) {
      throw new Error('P9 live proposer claimIds must be unique');
    }
    return {
      value: request.claimSlots.map((slot) => {
        const selection = selections[slot.evidenceSpanId];
        if (!selection) {
          throw new Error(
            `P9 live proposer omitted prevalidated claim slot: ${slot.evidenceSpanId}`,
          );
        }
        const span = spansById.get(slot.evidenceSpanId);
        if (!span) {
          throw new Error(
            `P9 live proposer claim slot references an unknown evidence span: ${slot.evidenceSpanId}`,
          );
        }
        return {
          claimId: selection.claimId,
          candidateId: span.candidateId,
          quote: span.quote,
          statement: span.quote,
          subquestionIds: slot.subquestionIds,
          sectionId: slot.sectionId,
          claimGroupId: selection.claimGroupId,
          critical: selection.critical,
          contradictionIds: selection.contradictionIds,
        };
      }),
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
        'contradicted, insufficient), semanticDeltas, and one or more',
        'non-empty reasonCodes. Because every proposed statement is required to',
        'be character-for-character identical to its quote, semanticDeltas must',
        'always be an empty array. If the snapshot does not support the quote or',
        'claim, express that through contradicted or insufficient; never label',
        'quantities, comparisons, causality, or other concepts already present',
        'identically in both strings as semantic deltas. Return exactly one',
        'finding for every proposed claimId, with no omissions, extras, or',
        'duplicate claimIds.',
      ].join(' '),
      `${evaluatorPromptContext(request.plan, request.snapshots)}\n\nProposed claims:\n${JSON.stringify(request.claims)}`,
      this.input.evaluatorMaxOutputTokens,
      evaluatorResponseFormat(),
    );
    return {
      value: EvaluatorResponseSchema.parse(JSON.parse(outcome.content))
        .findings,
      usage: outcome.usage,
    };
  }

  async synthesizeReport(request: {
    readonly plan: ResearchPlan;
    readonly claims: readonly P9LiveClaimSeed[];
    readonly admittedClaimIds: readonly string[];
  }): Promise<P9LiveModelOutcome<readonly P9LiveNarrativeSection[]>> {
    const admitted = request.claims.filter((claim) =>
      request.admittedClaimIds.includes(claim.claimId),
    );
    const requiredSectionIds = [
      ...request.plan.reportOutline.sections.map(
        (section) => section.sectionId,
      ),
      'references_provenance',
    ];
    const outcome = await this.#complete(
      this.proposerProfile.modelId,
      [
        'You are the final research editor. Produce one concise, readable lead paragraph for every required section.',
        'Answer the research question directly. The first_bounded_change lead must contrast the admitted current state with exactly one proposed implementation delta, literally include the phrase "current state" or the word "baseline", use add, introduce, replace, remove, modify, or implement, name a concrete flag, harness, benchmark, test, function, kernel, configuration, mode, or check, and explain why it comes first. Do not use vague phrases such as verification path or optimization path. Never recommend behavior that the admitted current-state evidence says is already implemented.',
        'The experiment_design lead must be executable and must literally include every one of these surface forms: the word "warm-up" (hyphenated), a numeric repetition count written in digits, the word "paired", the word "baseline" or "unchanged" for the fixed control, a named statistical method (write "bootstrap confidence interval", "t-test", or "Wilcoxon"), a numeric minimum effect threshold introduced with "at least" or "threshold", the exact two-word phrase "output parity" (with a space, never hyphenated), the word "pass" for the accept rule, and the word "fail" for the reject rule.',
        'Use only the admitted claims supplied. Do not copy raw JSON, markup, source metadata, or long quotations.',
        'Do not introduce unsupported numbers or factual claims. Keep each lead between 100 and 600 characters.',
        'The first_bounded_change section must cite at least one admitted claim assigned to that section through claimIds. Other sections should cite claims only when assigned evidence is available. Never move or reuse a claim across sections merely to add a citation. claimIds controls which exact admitted evidence sentences appear after the lead; use only IDs assigned to that section.',
        'Return only the governed JSON object with a sections array containing sectionId, lead, and claimIds.',
      ].join(' '),
      JSON.stringify({
        question: request.plan.question,
        requiredSectionIds,
        admittedClaims: admitted,
      }),
      this.input.proposerMaxOutputTokens,
      narrativeResponseFormat(
        requiredSectionIds,
        admitted.map((claim) => claim.claimId),
      ),
    );
    const sections = NarrativeResponseSchema.parse(
      JSON.parse(outcome.content),
    ).sections;
    if (
      new Set(sections.map((section) => section.sectionId)).size !==
        requiredSectionIds.length ||
      requiredSectionIds.some(
        (id) => !sections.some((section) => section.sectionId === id),
      )
    ) {
      throw new Error(
        'P9 live synthesizer must return every required report section exactly once',
      );
    }
    const normalizedSections = sections.map((section) => ({
      ...section,
      claimIds: admitted
        .filter((claim) => claim.sectionId === section.sectionId)
        .map((claim) => claim.claimId),
    }));
    return { value: normalizedSections, usage: outcome.usage };
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

function proposerPromptContext(
  plan: ResearchPlan,
  spans: readonly P9GovernedClaimSpan[],
  claimSlots: readonly P9LiveClaimSlot[],
): string {
  const planSummary = {
    question: plan.question,
    subquestions: plan.subquestions,
    reportOutline: plan.reportOutline,
    contradictionRequirements: plan.contradictionRequirements,
  };
  const spansById = new Map(spans.map((span) => [span.evidenceSpanId, span]));
  const governedSlots = claimSlots.map((slot) => ({
    ...slot,
    sourceClass: spansById.get(slot.evidenceSpanId)?.sourceClass,
    sourceFamilyId: spansById.get(slot.evidenceSpanId)?.sourceFamilyId,
  }));
  return `Research plan:\n${JSON.stringify(planSummary)}\n\nPrevalidated claim slots:\n${JSON.stringify(governedSlots)}`;
}

function evaluatorPromptContext(
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
    body: snapshot.body.slice(0, P9_LIVE_MAX_SNAPSHOT_EXCERPT),
  }));
  return `Research plan:\n${JSON.stringify(planSummary)}\n\nSource snapshots:\n${JSON.stringify(boundedSnapshots)}`;
}

function claimSeedResponseFormat(evidenceSpanIds: readonly string[]): object {
  const slotSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      claimId: { type: 'string', minLength: 1 },
      claimGroupId: { type: 'string', minLength: 1 },
      critical: { type: 'boolean' },
      contradictionIds: {
        type: 'array',
        items: { type: 'string', minLength: 1 },
      },
    },
    required: ['claimId', 'claimGroupId', 'critical', 'contradictionIds'],
  };
  return {
    type: 'json_schema',
    json_schema: {
      name: 'p9_live_claim_seeds',
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          claimSlots: {
            type: 'object',
            additionalProperties: false,
            properties: Object.fromEntries(
              evidenceSpanIds.map((evidenceSpanId) => [
                evidenceSpanId,
                slotSchema,
              ]),
            ),
            required: [...evidenceSpanIds],
          },
        },
        required: ['claimSlots'],
      },
    },
  };
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
        items: { type: 'string', minLength: 1 },
      },
    },
    required: ['claimId', 'verdict', 'semanticDeltas', 'reasonCodes'],
  });
}

function narrativeResponseFormat(
  sectionIds: readonly string[],
  claimIds: readonly string[],
): object {
  return structuredResponseFormat('p9_live_report_narrative', 'sections', {
    type: 'object',
    additionalProperties: false,
    properties: {
      sectionId: { type: 'string', enum: [...sectionIds] },
      lead: { type: 'string', minLength: 100, maxLength: 600 },
      claimIds: {
        type: 'array',
        items: { type: 'string', enum: [...claimIds] },
      },
    },
    required: ['sectionId', 'lead', 'claimIds'],
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
          [collectionKey]: {
            type: 'array',
            items: itemSchema,
          },
        },
        required: [collectionKey],
      },
    },
  };
}
