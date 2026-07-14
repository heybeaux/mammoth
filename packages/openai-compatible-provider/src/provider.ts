import {
  PROVIDER_CAPABILITY_MANIFEST_VERSION,
  ModelWorkRequestSchema,
  ProviderCapabilityManifestSchema,
  ProviderErrorSchema,
  canonicalDigest,
  canonicalJson,
  providerCapabilityManifestDigest,
  type ModelWorkRequest,
  type ProviderCapabilityManifest,
  type ProviderError,
  type ProviderUsage,
} from '@mammoth/domain';
import type {
  ModelProviderPort,
  ProviderDispatchRequest,
  ProviderDispatchResult,
} from '@mammoth/provider-port';
import {
  authorizeProviderDestination,
  defaultHostResolver,
  type HostResolver,
  type ProviderNetworkMode,
} from './security.js';
import {
  NodePinnedHttpTransport,
  PinnedTransportError,
  type PinnedHttpResponse,
  type PinnedHttpTransport,
} from './transport.js';

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface OpenAICompatibleProviderOptions {
  readonly baseUrl: string;
  readonly configuredModel: string;
  readonly providerName?: string;
  readonly mode?: ProviderNetworkMode;
  readonly approvedOrigins?: readonly string[];
  readonly apiKeyEnvironmentVariable?: string;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly capabilityPath?: string;
  readonly chatCompletionsPath?: string;
  readonly timeoutMs?: number;
  readonly maximumResponseBytes?: number;
  readonly maximumRedirects?: number;
  readonly inputCurrencyMicrosPerMillionTokens?: number;
  readonly outputCurrencyMicrosPerMillionTokens?: number;
  readonly resolveHost?: HostResolver;
  readonly transport?: PinnedHttpTransport;
}

interface NormalizedOptions {
  readonly baseUrl: URL;
  readonly configuredModel: string;
  readonly providerName: string;
  readonly mode: ProviderNetworkMode;
  readonly approvedOrigins: readonly string[];
  readonly apiKeyEnvironmentVariable?: string;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly capabilityPath: string;
  readonly chatCompletionsPath: string;
  readonly timeoutMs: number;
  readonly maximumResponseBytes: number;
  readonly maximumRedirects: number;
  readonly inputCurrencyMicrosPerMillionTokens: number;
  readonly outputCurrencyMicrosPerMillionTokens: number;
}

export class OpenAICompatibleModelProvider implements ModelProviderPort {
  readonly #options: NormalizedOptions;
  readonly #resolveHost: HostResolver;
  readonly #transport: PinnedHttpTransport;
  readonly #completed = new Map<string, ProviderDispatchResult>();
  readonly #inFlight = new Map<string, Promise<ProviderDispatchResult>>();

  constructor(options: OpenAICompatibleProviderOptions) {
    const baseUrl = new URL(options.baseUrl);
    const mode = options.mode ?? 'local';
    const maximumRedirects =
      options.maximumRedirects ?? (mode === 'local' ? 0 : 3);
    if (mode === 'local' && maximumRedirects !== 0) {
      throw new Error('local provider mode refuses redirects');
    }
    this.#options = {
      baseUrl,
      configuredModel: requireNonempty(
        options.configuredModel,
        'configuredModel',
      ),
      providerName: requireNonempty(
        options.providerName ?? 'ollama',
        'providerName',
      ),
      mode,
      approvedOrigins: options.approvedOrigins ?? [baseUrl.origin],
      ...(options.apiKeyEnvironmentVariable
        ? {
            apiKeyEnvironmentVariable: requireEnvironmentVariableName(
              options.apiKeyEnvironmentVariable,
            ),
          }
        : {}),
      environment: options.environment ?? process.env,
      capabilityPath: normalizePath(options.capabilityPath ?? '/api/tags'),
      chatCompletionsPath: normalizePath(
        options.chatCompletionsPath ?? '/v1/chat/completions',
      ),
      timeoutMs: requirePositiveInteger(
        options.timeoutMs ?? 30_000,
        'timeoutMs',
      ),
      maximumResponseBytes: requirePositiveInteger(
        options.maximumResponseBytes ?? 2 * 1024 * 1024,
        'maximumResponseBytes',
      ),
      maximumRedirects: requireNonnegativeInteger(
        maximumRedirects,
        'maximumRedirects',
      ),
      inputCurrencyMicrosPerMillionTokens: requireNonnegativeInteger(
        options.inputCurrencyMicrosPerMillionTokens ?? 0,
        'inputCurrencyMicrosPerMillionTokens',
      ),
      outputCurrencyMicrosPerMillionTokens: requireNonnegativeInteger(
        options.outputCurrencyMicrosPerMillionTokens ?? 0,
        'outputCurrencyMicrosPerMillionTokens',
      ),
    };
    this.#resolveHost = options.resolveHost ?? defaultHostResolver;
    this.#transport = options.transport ?? new NodePinnedHttpTransport();
  }

  async discoverCapabilities(): Promise<ProviderCapabilityManifest> {
    return this.#discoverCapabilities();
  }

  async #discoverCapabilities(
    signal?: AbortSignal,
  ): Promise<ProviderCapabilityManifest> {
    const response = await this.#request({
      method: 'GET',
      url: new URL(this.#options.capabilityPath, this.#options.baseUrl),
      headers: this.#authorizationHeaders(),
      ...(signal ? { signal } : {}),
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        `provider capability discovery failed with HTTP ${String(response.status)}`,
      );
    }
    const discovered = parseCapabilityResponse(
      response.body,
      this.#options.configuredModel,
    );
    const base: ProviderCapabilityManifest = {
      schemaVersion: PROVIDER_CAPABILITY_MANIFEST_VERSION,
      provider: this.#options.providerName,
      concreteModel: discovered.concreteModel,
      checkpoint: discovered.checkpoint,
      modalities: ['text'],
      contextWindowTokens: discovered.contextWindowTokens,
      supportsJsonOutput: true,
      supportsSeed: false,
      manifestDigest: `sha256:${'0'.repeat(64)}`,
    };
    return ProviderCapabilityManifestSchema.parse({
      ...base,
      manifestDigest: providerCapabilityManifestDigest(base),
    });
  }

  async dispatch(
    request: ProviderDispatchRequest,
  ): Promise<ProviderDispatchResult> {
    const parsed = ModelWorkRequestSchema.safeParse(request.modelWork);
    if (!parsed.success) {
      return failure('schema_incompatible', 'model-work request is invalid');
    }
    const modelWork = parsed.data;
    const existing = this.#completed.get(modelWork.effect.idempotencyKey);
    if (existing) return cloneResult(existing);
    const inFlight = this.#inFlight.get(modelWork.effect.idempotencyKey);
    if (inFlight) return cloneResult(await inFlight);

    const execution = this.#dispatchOnce(request, modelWork);
    this.#inFlight.set(modelWork.effect.idempotencyKey, execution);
    try {
      return cloneResult(await execution);
    } finally {
      if (this.#inFlight.get(modelWork.effect.idempotencyKey) === execution) {
        this.#inFlight.delete(modelWork.effect.idempotencyKey);
      }
    }
  }

  async #dispatchOnce(
    request: ProviderDispatchRequest,
    modelWork: ModelWorkRequest,
  ): Promise<ProviderDispatchResult> {
    if (request.abortSignal?.aborted) {
      return failure(
        'late_response',
        'provider dispatch was already cancelled',
      );
    }

    try {
      const manifest = await this.#discoverCapabilities(request.abortSignal);
      if (
        modelWork.attempt.provider !== manifest.provider ||
        modelWork.attempt.concreteModel !== manifest.concreteModel ||
        modelWork.attempt.checkpoint !== manifest.checkpoint ||
        modelWork.capabilityManifestDigest !== manifest.manifestDigest
      ) {
        return failure(
          'profile_drift',
          'provider identity changed after capability discovery',
        );
      }
      const body = parseCanonicalChatRequest(
        request.canonicalRequestBytes,
        manifest.concreteModel,
        modelWork.effect.canonicalRequestDigest,
      );
      const secret = this.#secret();
      if (secret && body.decoded.includes(secret)) {
        return failure(
          'secret_detected',
          'provider prompt contains configured secret',
        );
      }
      const dispatchStartedAt = Date.now();
      const response = await this.#request({
        method: 'POST',
        url: new URL(this.#options.chatCompletionsPath, this.#options.baseUrl),
        headers: {
          'content-type': 'application/json',
          'idempotency-key': modelWork.effect.idempotencyKey,
          ...this.#authorizationHeaders(),
        },
        body: request.canonicalRequestBytes,
        ...(request.abortSignal ? { signal: request.abortSignal } : {}),
      });
      if (response.status < 200 || response.status >= 300) {
        return failureForHttpStatus(response.status);
      }
      const envelope = parseChatCompletionResponse(response.body, {
        provider: manifest.provider,
        concreteModel: manifest.concreteModel,
        checkpoint: manifest.checkpoint,
        inputCurrencyMicrosPerMillionTokens:
          this.#options.inputCurrencyMicrosPerMillionTokens,
        outputCurrencyMicrosPerMillionTokens:
          this.#options.outputCurrencyMicrosPerMillionTokens,
        wallClockMs: Math.max(0, Date.now() - dispatchStartedAt),
      });
      if (
        envelope.usage.inputTokens > request.limits.inputTokens ||
        envelope.usage.outputTokens > request.limits.outputTokens ||
        envelope.usage.currencyMicros > request.limits.currencyMicros ||
        envelope.usage.wallClockMs > request.limits.wallClockMs
      ) {
        return failure(
          'budget_exhausted',
          'provider usage exceeds reservation',
        );
      }
      const result: ProviderDispatchResult = { ok: true, envelope };
      this.#completed.set(modelWork.effect.idempotencyKey, cloneResult(result));
      return cloneResult(result);
    } catch (error: unknown) {
      if (error instanceof ProviderBoundaryError)
        return { ok: false, error: error.providerError };
      if (error instanceof PinnedTransportError) {
        if (error.kind === 'response_too_large') {
          return failure(
            'oversized_output',
            'provider response exceeded limit',
          );
        }
        return error.requestAccepted
          ? failure(
              'ambiguous_delivery',
              'provider transport failed after request acceptance',
            )
          : failure(
              'transport_interrupted_before_acceptance',
              'provider transport failed before request acceptance',
            );
      }
      return failure('provider_unavailable', 'provider request failed');
    }
  }

  reconcile(input: {
    readonly idempotencyKey: string;
    readonly providerOperationId?: string;
  }): Promise<ProviderDispatchResult | undefined> {
    const result = this.#completed.get(input.idempotencyKey);
    if (!result) return Promise.resolve(undefined);
    if (
      result.ok &&
      input.providerOperationId &&
      result.envelope.providerOperationId !== input.providerOperationId
    ) {
      return Promise.resolve(undefined);
    }
    return Promise.resolve(cloneResult(result));
  }

  async #request(input: {
    readonly method: 'GET' | 'POST';
    readonly url: URL;
    readonly headers: Readonly<Record<string, string>>;
    readonly body?: Uint8Array;
    readonly signal?: AbortSignal;
  }): Promise<PinnedHttpResponse> {
    let url = input.url;
    const pinnedOrigin = input.url.origin;
    let method = input.method;
    let body = input.body;
    for (let redirects = 0; ; redirects += 1) {
      let approvedAddresses: readonly string[];
      try {
        approvedAddresses = await authorizeProviderDestination(
          url,
          {
            mode: this.#options.mode,
            approvedOrigins: this.#options.approvedOrigins,
          },
          this.#resolveHost,
        );
      } catch {
        throw new ProviderBoundaryError(
          failureError(
            'policy_denied',
            'provider destination is not authorized',
          ),
        );
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort(new ProviderTimeout());
      }, this.#options.timeoutMs);
      const abort = () => {
        controller.abort(new ProviderCancellation());
      };
      input.signal?.addEventListener('abort', abort, { once: true });
      try {
        if (input.signal?.aborted) abort();
        const response = await this.#transport.request({
          url,
          approvedAddress: approvedAddresses[0] ?? '',
          method,
          headers: input.headers,
          ...(body ? { body } : {}),
          signal: controller.signal,
          maximumResponseBytes: this.#options.maximumResponseBytes,
        });
        if (!REDIRECT_STATUSES.has(response.status)) return response;
        if (redirects >= this.#options.maximumRedirects) {
          throw new ProviderBoundaryError(
            failureError('policy_denied', 'provider redirect is not permitted'),
          );
        }
        const location = response.headers.location;
        if (!location) {
          throw new ProviderBoundaryError(
            failureError(
              'schema_incompatible',
              'provider redirect has no location',
            ),
          );
        }
        url = new URL(location, url);
        if (url.origin !== pinnedOrigin) {
          throw new ProviderBoundaryError(
            failureError(
              'policy_denied',
              'provider redirect changed the pinned origin',
            ),
          );
        }
        if (response.status === 303) {
          method = 'GET';
          body = undefined;
        }
      } catch (error: unknown) {
        if (controller.signal.reason instanceof ProviderTimeout) {
          throw new ProviderBoundaryError(
            failureError(
              'timeout_before_acceptance',
              'provider request timed out',
            ),
          );
        }
        if (controller.signal.reason instanceof ProviderCancellation) {
          throw new ProviderBoundaryError(
            failureError('late_response', 'provider request was cancelled'),
          );
        }
        throw error;
      } finally {
        clearTimeout(timeout);
        input.signal?.removeEventListener('abort', abort);
      }
    }
  }

  #secret(): string | undefined {
    const name = this.#options.apiKeyEnvironmentVariable;
    if (!name) return undefined;
    const value = this.#options.environment[name];
    if (!value) {
      throw new ProviderBoundaryError(
        failureError(
          'policy_denied',
          'configured provider credential is unavailable',
        ),
      );
    }
    return value;
  }

  #authorizationHeaders(): Readonly<Record<string, string>> {
    const secret = this.#secret();
    return secret ? { authorization: `Bearer ${secret}` } : {};
  }
}

class ProviderBoundaryError extends Error {
  constructor(readonly providerError: ProviderError) {
    super(providerError.message);
    this.name = 'ProviderBoundaryError';
  }
}

class ProviderTimeout extends Error {}
class ProviderCancellation extends Error {}

function parseCapabilityResponse(
  bytes: Uint8Array,
  configuredModel: string,
): {
  readonly concreteModel: string;
  readonly checkpoint: string;
  readonly contextWindowTokens: number;
} {
  const record = parseJsonRecord(bytes, 'provider capability response');
  const models = requireArray(record.models, 'provider models');
  const candidates = models.map((entry) =>
    requireRecord(entry, 'provider model'),
  );
  const selected = candidates.find(
    (candidate) =>
      candidate.name === configuredModel || candidate.model === configuredModel,
  );
  if (!selected) {
    throw new ProviderBoundaryError(
      failureError(
        'unsupported_capability',
        'configured model was not discovered',
      ),
    );
  }
  const concreteModel = requireNonempty(
    typeof selected.model === 'string' ? selected.model : selected.name,
    'discovered concrete model',
  );
  const checkpoint = normalizeCheckpoint(
    requireNonempty(selected.digest, 'discovered model digest'),
  );
  const details =
    selected.details && typeof selected.details === 'object'
      ? (selected.details as Record<string, unknown>)
      : {};
  const contextWindowTokens =
    typeof details.context_length === 'number' &&
    Number.isInteger(details.context_length) &&
    details.context_length > 0
      ? details.context_length
      : 4096;
  return { concreteModel, checkpoint, contextWindowTokens };
}

function parseCanonicalChatRequest(
  bytes: Uint8Array,
  concreteModel: string,
  expectedDigest: string,
): { readonly decoded: string } {
  let decoded: string;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new ProviderBoundaryError(
      failureError(
        'schema_incompatible',
        'provider request is not valid UTF-8',
      ),
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(decoded) as unknown;
  } catch {
    throw new ProviderBoundaryError(
      failureError('malformed_output', 'provider request is not valid JSON'),
    );
  }
  if (decoded !== canonicalJson(value)) {
    throw new ProviderBoundaryError(
      failureError(
        'schema_incompatible',
        'provider request bytes are not canonical',
      ),
    );
  }
  if (canonicalDigest(value) !== expectedDigest) {
    throw new ProviderBoundaryError(
      failureError(
        'schema_incompatible',
        'provider request digest does not match',
      ),
    );
  }
  const record = requireExactRecord(
    value,
    ['model', 'messages', 'stream', 'response_format', 'temperature', 'seed'],
    ['model', 'messages', 'stream'],
    'provider chat request',
  );
  if (record.model !== concreteModel) {
    throw new ProviderBoundaryError(
      failureError(
        'profile_drift',
        'chat request model does not match discovery',
      ),
    );
  }
  if (record.stream !== false) {
    throw new ProviderBoundaryError(
      failureError(
        'unsupported_capability',
        'streaming provider output is disabled',
      ),
    );
  }
  if (record.seed !== undefined) {
    throw new ProviderBoundaryError(
      failureError('unsupported_capability', 'provider seed is not supported'),
    );
  }
  if (
    record.temperature !== undefined &&
    (typeof record.temperature !== 'number' ||
      !Number.isFinite(record.temperature) ||
      record.temperature < 0 ||
      record.temperature > 2)
  ) {
    throw new ProviderBoundaryError(
      failureError('schema_incompatible', 'provider temperature is invalid'),
    );
  }
  if (record.response_format !== undefined) {
    const format = requireExactRecord(
      record.response_format,
      ['type'],
      ['type'],
      'provider response format',
    );
    if (format.type !== 'json_object') {
      throw new ProviderBoundaryError(
        failureError(
          'unsupported_capability',
          'provider response format is unsupported',
        ),
      );
    }
  }
  const messages = requireArray(record.messages, 'provider messages');
  if (messages.length === 0) {
    throw new ProviderBoundaryError(
      failureError('schema_incompatible', 'provider messages are empty'),
    );
  }
  for (const message of messages) {
    const parsed = requireExactRecord(
      message,
      ['role', 'content'],
      ['role', 'content'],
      'provider message',
    );
    if (!['system', 'user', 'assistant'].includes(String(parsed.role))) {
      throw new ProviderBoundaryError(
        failureError(
          'unsupported_capability',
          'provider message role is not allowed',
        ),
      );
    }
    requireNonempty(parsed.content, 'provider message content');
  }
  return { decoded };
}

function parseChatCompletionResponse(
  bytes: Uint8Array,
  identity: {
    readonly provider: string;
    readonly concreteModel: string;
    readonly checkpoint: string;
    readonly inputCurrencyMicrosPerMillionTokens: number;
    readonly outputCurrencyMicrosPerMillionTokens: number;
    readonly wallClockMs: number;
  },
) {
  const record = parseJsonRecord(bytes, 'provider chat response');
  const returnedModel = requireNonempty(
    record.model,
    'provider response model',
  );
  if (returnedModel !== identity.concreteModel) {
    throw new ProviderBoundaryError(
      failureError(
        'profile_drift',
        'provider response model does not match discovery',
      ),
    );
  }
  const choices = requireArray(record.choices, 'provider choices');
  if (choices.length !== 1) {
    throw new ProviderBoundaryError(
      failureError(
        'schema_incompatible',
        'provider response must contain one choice',
      ),
    );
  }
  const choice = requireRecord(choices[0], 'provider choice');
  const finishReason = choice.finish_reason;
  if (!['stop', 'length', 'content_filter'].includes(String(finishReason))) {
    throw new ProviderBoundaryError(
      failureError(
        'schema_incompatible',
        'provider finish reason is unsupported',
      ),
    );
  }
  const message = requireRecord(choice.message, 'provider response message');
  requireNonempty(message.content, 'provider response content');
  const usageRecord = requireRecord(record.usage, 'provider usage');
  const inputTokens = requireNonnegativeInteger(
    usageRecord.prompt_tokens,
    'provider input tokens',
  );
  const outputTokens = requireNonnegativeInteger(
    usageRecord.completion_tokens,
    'provider output tokens',
  );
  const totalTokens = requireNonnegativeInteger(
    usageRecord.total_tokens,
    'provider total tokens',
  );
  if (totalTokens !== inputTokens + outputTokens) {
    throw new ProviderBoundaryError(
      failureError(
        'schema_incompatible',
        'provider usage totals are inconsistent',
      ),
    );
  }
  const usage: ProviderUsage = {
    inputTokens,
    outputTokens,
    totalTokens,
    currencyMicros:
      Math.ceil(
        (inputTokens * identity.inputCurrencyMicrosPerMillionTokens) /
          1_000_000,
      ) +
      Math.ceil(
        (outputTokens * identity.outputCurrencyMicrosPerMillionTokens) /
          1_000_000,
      ),
    wallClockMs: identity.wallClockMs,
    toolCalls: 0,
  };
  return {
    provider: identity.provider,
    concreteModel: identity.concreteModel,
    checkpoint: identity.checkpoint,
    providerOperationId: requireNonempty(record.id, 'provider operation ID'),
    finishReason: String(finishReason) as 'stop' | 'length' | 'content_filter',
    usage,
    rawResponseBytes: bytes.slice(),
  };
}

function failureForHttpStatus(status: number): ProviderDispatchResult {
  if (status === 429)
    return failure('rate_limited', 'provider rate limited request');
  if (status >= 500)
    return failure('provider_unavailable', 'provider is unavailable');
  if (status === 408)
    return failure('timeout_before_acceptance', 'provider request timed out');
  return failure('content_rejected', 'provider rejected request');
}

function failure(
  code: ProviderError['code'],
  message: string,
): ProviderDispatchResult {
  return { ok: false, error: failureError(code, message) };
}

function failureError(
  code: ProviderError['code'],
  message: string,
): ProviderError {
  return ProviderErrorSchema.parse({ schemaVersion: '1.0.0', code, message });
}

function cloneResult(result: ProviderDispatchResult): ProviderDispatchResult {
  if (!result.ok) return { ok: false, error: { ...result.error } };
  return {
    ok: true,
    envelope: {
      ...result.envelope,
      usage: { ...result.envelope.usage },
      rawResponseBytes: result.envelope.rawResponseBytes.slice(),
    },
  };
}

function parseJsonRecord(
  bytes: Uint8Array,
  name: string,
): Record<string, unknown> {
  try {
    return requireRecord(
      JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      ) as unknown,
      name,
    );
  } catch (error: unknown) {
    if (error instanceof ProviderBoundaryError) throw error;
    throw new ProviderBoundaryError(
      failureError('malformed_output', `${name} is not valid JSON`),
    );
  }
}

function requireRecord(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProviderBoundaryError(
      failureError('schema_incompatible', `${name} must be an object`),
    );
  }
  return value as Record<string, unknown>;
}

function requireExactRecord(
  value: unknown,
  allowedKeys: readonly string[],
  requiredKeys: readonly string[],
  name: string,
): Record<string, unknown> {
  const record = requireRecord(value, name);
  const allowed = new Set(allowedKeys);
  if (
    Object.keys(record).some((key) => !allowed.has(key)) ||
    requiredKeys.some((key) => !(key in record))
  ) {
    throw new ProviderBoundaryError(
      failureError('schema_incompatible', `${name} has invalid fields`),
    );
  }
  return record;
}

function requireArray(value: unknown, name: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new ProviderBoundaryError(
      failureError('schema_incompatible', `${name} must be an array`),
    );
  }
  return value;
}

function requireNonempty(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ProviderBoundaryError(
      failureError('schema_incompatible', `${name} must be a non-empty string`),
    );
  }
  return value;
}

function requirePositiveInteger(value: unknown, name: string): number {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return Number(value);
}

function requireNonnegativeInteger(value: unknown, name: string): number {
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new ProviderBoundaryError(
      failureError(
        'schema_incompatible',
        `${name} must be a nonnegative integer`,
      ),
    );
  }
  return Number(value);
}

function normalizePath(value: string): string {
  if (!value.startsWith('/') || value.startsWith('//')) {
    throw new Error('provider path must be absolute and origin-relative');
  }
  return value;
}

function normalizeCheckpoint(value: string): string {
  if (/^[0-9a-f]{64}$/.test(value)) return `sha256:${value}`;
  if (/^sha256:[0-9a-f]{64}$/.test(value)) return value;
  throw new ProviderBoundaryError(
    failureError('profile_drift', 'discovered checkpoint is not immutable'),
  );
}

function requireEnvironmentVariableName(value: string): string {
  if (!/^[A-Z_][A-Z0-9_]*$/.test(value)) {
    throw new Error(
      'provider credential reference must be an environment variable name',
    );
  }
  return value;
}
