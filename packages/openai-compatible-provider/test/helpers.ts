import {
  MODEL_WORK_POLICY_VERSION,
  MODEL_WORK_REQUEST_SCHEMA_VERSION,
  MODEL_WORK_RESULT_SCHEMA_VERSION,
  canonicalDigest,
  canonicalJson,
  modelWorkIdentityDigest,
  modelWorkPolicyDigest,
  providerAttemptIdentityDigest,
  providerEffectIdentityDigest,
  type ModelWorkIdentity,
  type ModelWorkPolicy,
  type ModelWorkRequest,
  type ProviderAttemptIdentity,
  type ProviderCapabilityManifest,
  type ProviderEffectIdentity,
} from '@mammoth/domain';
import type {
  PinnedHttpRequest,
  PinnedHttpResponse,
  PinnedHttpTransport,
} from '../src/index.js';

export const digestA = `sha256:${'a'.repeat(64)}`;
export const digestB = `sha256:${'b'.repeat(64)}`;
export const checkpoint = `sha256:${'c'.repeat(64)}`;

export interface RecordedRequest extends PinnedHttpRequest {
  readonly bodyText: string | undefined;
}

export class FixtureTransport implements PinnedHttpTransport {
  readonly requests: RecordedRequest[] = [];
  readonly responses: (
    | PinnedHttpResponse
    | Error
    | ((request: PinnedHttpRequest) => PinnedHttpResponse)
  )[] = [];

  request(input: PinnedHttpRequest): Promise<PinnedHttpResponse> {
    this.requests.push({
      ...input,
      bodyText: input.body ? new TextDecoder().decode(input.body) : undefined,
    });
    const response = this.responses.shift();
    if (!response) return Promise.reject(new Error('missing fixture response'));
    if (response instanceof Error) return Promise.reject(response);
    return Promise.resolve(
      typeof response === 'function' ? response(input) : response,
    );
  }
}

export function jsonResponse(
  value: unknown,
  options: {
    readonly status?: number;
    readonly headers?: Record<string, string>;
  } = {},
): PinnedHttpResponse {
  return {
    status: options.status ?? 200,
    headers: options.headers ?? { 'content-type': 'application/json' },
    body: new TextEncoder().encode(JSON.stringify(value)),
  };
}

export function capabilityResponse(
  overrides: Partial<{
    readonly name: string;
    readonly model: string;
    readonly digest: string;
    readonly contextLength: number;
  }> = {},
): PinnedHttpResponse {
  return jsonResponse({
    models: [
      {
        name: overrides.name ?? 'fixture:latest',
        model: overrides.model ?? 'fixture:latest',
        digest: overrides.digest ?? 'c'.repeat(64),
        details: { context_length: overrides.contextLength ?? 8192 },
      },
    ],
  });
}

export function chatResponse(
  overrides: Partial<{
    readonly id: string;
    readonly model: string;
    readonly finishReason: string;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly totalTokens: number;
  }> = {},
): PinnedHttpResponse {
  const inputTokens = overrides.inputTokens ?? 12;
  const outputTokens = overrides.outputTokens ?? 8;
  return jsonResponse({
    id: overrides.id ?? 'operation-1',
    model: overrides.model ?? 'fixture:latest',
    choices: [
      {
        finish_reason: overrides.finishReason ?? 'stop',
        message: {
          role: 'assistant',
          content: JSON.stringify({
            observations: ['fixture'],
            claimProposals: [],
            evidenceReferences: [],
            assumptions: [],
            dissent: [],
            proposedFalsifiers: [],
          }),
        },
      },
    ],
    usage: {
      prompt_tokens: inputTokens,
      completion_tokens: outputTokens,
      total_tokens: overrides.totalTokens ?? inputTokens + outputTokens,
    },
  });
}

export function buildModelWorkRequest(
  manifest: ProviderCapabilityManifest,
  options: { readonly prompt?: string; readonly seed?: number } = {},
): {
  readonly modelWork: ModelWorkRequest;
  readonly canonicalRequestBytes: Uint8Array;
} {
  const body = {
    messages: [
      {
        content: options.prompt ?? 'Return typed research proposals.',
        role: 'user',
      },
    ],
    model: manifest.concreteModel,
    response_format: { type: 'json_object' },
    stream: false,
    temperature: 0,
    ...(options.seed === undefined ? {} : { seed: options.seed }),
  };
  const canonicalRequestBytes = new TextEncoder().encode(canonicalJson(body));
  const policyBase: ModelWorkPolicy = {
    version: MODEL_WORK_POLICY_VERSION,
    digest: digestA,
    dataClassification: 'local_only',
    retainRawOutput: true,
    maximumAttempts: 2,
    budget: {
      inputTokens: 4096,
      outputTokens: 1024,
      currencyMicros: 1000,
      wallClockMs: 30_000,
      toolCalls: 0,
    },
  };
  const policy = { ...policyBase, digest: modelWorkPolicyDigest(policyBase) };
  const identityBase: ModelWorkIdentity = {
    programId: 'program-1',
    topologyId: 'topology-1',
    topologyDigest: digestA,
    cellId: 'cell-1',
    criterionId: 'criterion-1',
    criterionVersion: 1,
    criterionDigest: digestB,
    workItemContractDigest: digestA,
    promptTemplateDigest: digestB,
    canonicalInputDigest: digestA,
    modelProfileVersionId: 'profile-version-1',
    modelProfileVersionDigest: digestB,
    policyVersion: MODEL_WORK_POLICY_VERSION,
    policyDigest: policy.digest,
    toolContractDigest: digestA,
    outputSchemaDigest: digestB,
    identityDigest: digestA,
  };
  const identity = {
    ...identityBase,
    identityDigest: modelWorkIdentityDigest(identityBase),
  };
  const attemptBase: ProviderAttemptIdentity = {
    modelWorkIdentityDigest: identity.identityDigest,
    attemptOrdinal: 1,
    provider: manifest.provider,
    concreteModel: manifest.concreteModel,
    checkpoint: manifest.checkpoint,
    attemptDigest: digestA,
  };
  const attempt = {
    ...attemptBase,
    attemptDigest: providerAttemptIdentityDigest(attemptBase),
  };
  const effectBase: ProviderEffectIdentity = {
    providerAttemptDigest: attempt.attemptDigest,
    modelWorkIdentityDigest: identity.identityDigest,
    operationKind: 'chat_completion',
    canonicalRequestDigest: canonicalDigest(body),
    idempotencyKey: digestA,
  };
  const effect = {
    ...effectBase,
    idempotencyKey: providerEffectIdentityDigest(effectBase),
  };
  return {
    canonicalRequestBytes,
    modelWork: {
      schemaVersion: MODEL_WORK_REQUEST_SCHEMA_VERSION,
      identity,
      attempt,
      effect,
      capabilityManifestDigest: manifest.manifestDigest,
      canonicalPromptDigest: digestB,
      budget: policy.budget,
      outputSchemaVersion: MODEL_WORK_RESULT_SCHEMA_VERSION,
    },
  };
}
