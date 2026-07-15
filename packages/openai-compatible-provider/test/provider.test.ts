import { describe, expect, it } from 'vitest';
import type { ProviderErrorCode } from '@mammoth/domain';
import { verifyProviderPortConformance } from '@mammoth/provider-port';
import {
  OpenAICompatibleModelProvider,
  PinnedTransportError,
  type PinnedHttpTransport,
} from '../src/index.js';
import {
  FixtureTransport,
  buildModelWorkRequest,
  capabilityResponse,
  chatResponse,
  jsonResponse,
} from './helpers.js';

const loopbackResolver = () => Promise.resolve(['127.0.0.1']);

function provider(
  transport: PinnedHttpTransport,
  options: {
    readonly environment?: Readonly<Record<string, string | undefined>>;
    readonly apiKeyEnvironmentVariable?: string;
    readonly mode?: 'local' | 'governed';
    readonly approvedOrigins?: readonly string[];
    readonly resolveHost?: (hostname: string) => Promise<readonly string[]>;
    readonly maximumRedirects?: number;
    readonly timeoutMs?: number;
    readonly completedResultCapacity?: number;
    readonly completedResultTtlMs?: number;
    readonly monotonicNow?: () => number;
  } = {},
) {
  return new OpenAICompatibleModelProvider({
    baseUrl: 'http://provider.local:11434',
    configuredModel: 'fixture:latest',
    transport,
    resolveHost: options.resolveHost ?? loopbackResolver,
    ...(options.environment ? { environment: options.environment } : {}),
    ...(options.apiKeyEnvironmentVariable
      ? { apiKeyEnvironmentVariable: options.apiKeyEnvironmentVariable }
      : {}),
    ...(options.mode ? { mode: options.mode } : {}),
    ...(options.approvedOrigins
      ? { approvedOrigins: options.approvedOrigins }
      : {}),
    ...(options.maximumRedirects !== undefined
      ? { maximumRedirects: options.maximumRedirects }
      : {}),
    ...(options.timeoutMs !== undefined
      ? { timeoutMs: options.timeoutMs }
      : {}),
    ...(options.completedResultCapacity !== undefined
      ? { completedResultCapacity: options.completedResultCapacity }
      : {}),
    ...(options.completedResultTtlMs !== undefined
      ? { completedResultTtlMs: options.completedResultTtlMs }
      : {}),
    ...(options.monotonicNow ? { monotonicNow: options.monotonicNow } : {}),
  });
}

describe('OpenAI-compatible provider adapter', () => {
  it('rejects invalid modes and snapshots approved origins', async () => {
    expect(
      () =>
        new OpenAICompatibleModelProvider({
          baseUrl: 'http://provider.local:11434',
          configuredModel: 'fixture:latest',
          mode: 'invalid' as never,
        }),
    ).toThrow('provider mode must be local or governed');

    const approvedOrigins = ['http://provider.local:11434'];
    const transport = new FixtureTransport();
    transport.responses.push(capabilityResponse());
    const adapter = provider(transport, {
      mode: 'governed',
      approvedOrigins,
      resolveHost: () => Promise.resolve(['93.184.216.34']),
    });
    approvedOrigins[0] = 'http://attacker.invalid';
    await expect(adapter.discoverCapabilities()).resolves.toMatchObject({
      concreteModel: 'fixture:latest',
    });
  });

  it('discovers OpenRouter model-list capability responses', async () => {
    const transport = new FixtureTransport();
    transport.responses.push(
      jsonResponse({
        data: [
          {
            id: 'openai/gpt-4.1-mini',
            name: 'GPT-4.1 Mini',
            context_length: 1_047_576,
          },
        ],
      }),
    );
    const adapter = new OpenAICompatibleModelProvider({
      baseUrl: 'https://openrouter.ai/api/v1',
      configuredModel: 'openai/gpt-4.1-mini',
      providerName: 'openrouter',
      mode: 'governed',
      approvedOrigins: ['https://openrouter.ai'],
      capabilityPath: '/models',
      chatCompletionsPath: '/chat/completions',
      transport,
      resolveHost: () => Promise.resolve(['104.18.33.45']),
    });

    await expect(adapter.discoverCapabilities()).resolves.toMatchObject({
      provider: 'openrouter',
      concreteModel: 'openai/gpt-4.1-mini',
      contextWindowTokens: 1_047_576,
    });
  });

  it('pins discovered model identity, injects secrets only in headers, deduplicates, and reconciles', async () => {
    const transport = new FixtureTransport();
    transport.responses.push(
      capabilityResponse(),
      capabilityResponse(),
      chatResponse(),
    );
    const adapter = provider(transport, {
      environment: {
        MAMMOTH_PROVIDER_KEY: 'fixture-secret',
        HTTP_PROXY: 'http://attacker.invalid:8080',
        HTTPS_PROXY: 'http://attacker.invalid:8080',
      },
      apiKeyEnvironmentVariable: 'MAMMOTH_PROVIDER_KEY',
    });
    const manifest = await adapter.discoverCapabilities();
    const request = buildModelWorkRequest(manifest);
    const first = await adapter.dispatch({
      ...request,
      limits: request.modelWork.budget,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error('expected successful provider dispatch');
    expect(first.envelope).toMatchObject({
      provider: 'ollama',
      concreteModel: 'fixture:latest',
      checkpoint: `sha256:${'c'.repeat(64)}`,
      providerOperationId: 'operation-1',
      finishReason: 'stop',
      usage: {
        inputTokens: 12,
        outputTokens: 8,
        totalTokens: 20,
        currencyMicros: 0,
        toolCalls: 0,
      },
    });
    const post = transport.requests.find((entry) => entry.method === 'POST');
    expect(post?.approvedAddress).toBe('127.0.0.1');
    expect(post?.headers.authorization).toBe('Bearer fixture-secret');
    expect(post?.headers['idempotency-key']).toBe(
      request.modelWork.effect.idempotencyKey,
    );
    expect(post?.bodyText).not.toContain('fixture-secret');
    expect(JSON.stringify(first)).not.toContain('fixture-secret');

    const duplicate = await adapter.dispatch({
      ...request,
      limits: request.modelWork.budget,
    });
    expect(duplicate).toEqual(first);
    expect(
      transport.requests.filter((entry) => entry.method === 'POST'),
    ).toHaveLength(1);
    await expect(
      adapter.reconcile({
        idempotencyKey: request.modelWork.effect.idempotencyKey,
        providerOperationId: 'operation-1',
      }),
    ).resolves.toEqual(first);
  });

  it('satisfies the provider-neutral conformance suite', async () => {
    const transport = new FixtureTransport();
    transport.responses.push(
      capabilityResponse(),
      capabilityResponse(),
      capabilityResponse(),
      chatResponse(),
    );
    const adapter = provider(transport);
    const manifest = await adapter.discoverCapabilities();
    const request = buildModelWorkRequest(manifest);
    await expect(
      verifyProviderPortConformance({
        provider: adapter,
        request: request.modelWork,
        canonicalRequestBytes: request.canonicalRequestBytes,
      }),
    ).resolves.toBeUndefined();
  });

  it('dispatches strict JSON Schema response formats', async () => {
    const transport = new FixtureTransport();
    transport.responses.push(
      capabilityResponse(),
      capabilityResponse(),
      chatResponse(),
    );
    const adapter = provider(transport);
    const manifest = await adapter.discoverCapabilities();
    const request = buildModelWorkRequest(manifest, {
      maxTokens: 256,
      responseFormat: {
        type: 'json_schema',
        json_schema: {
          name: 'fixture_output',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['observations'],
            properties: {
              observations: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    });
    await expect(
      adapter.dispatch({ ...request, limits: request.modelWork.budget }),
    ).resolves.toMatchObject({ ok: true });
    const post = transport.requests.find((entry) => entry.method === 'POST');
    expect(JSON.parse(post?.bodyText ?? '{}')).toMatchObject({
      max_tokens: 256,
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'fixture_output', strict: true },
      },
    });
  });

  it('shares one provider call across concurrent duplicate dispatches', async () => {
    const transport = new FixtureTransport();
    transport.responses.push(capabilityResponse());
    const adapter = provider(transport);
    const manifest = await adapter.discoverCapabilities();
    const request = buildModelWorkRequest(manifest);
    transport.responses.push(capabilityResponse(), chatResponse());
    const dispatch = () =>
      adapter.dispatch({ ...request, limits: request.modelWork.budget });
    const [first, duplicate] = await Promise.all([dispatch(), dispatch()]);
    expect(duplicate).toEqual(first);
    expect(
      transport.requests.filter((entry) => entry.method === 'POST'),
    ).toHaveLength(1);
  });

  it('validates limits and canonical bytes before cache lookup or network effects', async () => {
    const transport = new FixtureTransport();
    transport.responses.push(
      capabilityResponse(),
      capabilityResponse(),
      chatResponse(),
    );
    const adapter = provider(transport);
    const manifest = await adapter.discoverCapabilities();
    const request = buildModelWorkRequest(manifest);
    const invalidLimits = await adapter.dispatch({
      ...request,
      limits: { ...request.modelWork.budget, inputTokens: Number.NaN },
    });
    expect(invalidLimits.ok).toBe(false);
    if (invalidLimits.ok) throw new Error('expected invalid limits');
    expect(invalidLimits.error.code).toBe('schema_incompatible');
    expect(transport.requests).toHaveLength(1);

    const first = await adapter.dispatch({
      ...request,
      limits: request.modelWork.budget,
    });
    expect(first.ok).toBe(true);
    const reusedKey = await adapter.dispatch({
      ...request,
      canonicalRequestBytes: new TextEncoder().encode('{}'),
      limits: request.modelWork.budget,
    });
    expect(reusedKey.ok).toBe(false);
    if (reusedKey.ok) throw new Error('expected request identity rejection');
    expect(reusedKey.error.code).toBe('schema_incompatible');
    expect(
      transport.requests.filter((entry) => entry.method === 'POST'),
    ).toHaveLength(1);
  });

  it('retains accepted budget failures once and bounds reconciliation by capacity and TTL', async () => {
    let now = 100;
    const transport = new FixtureTransport();
    transport.responses.push(
      capabilityResponse(),
      capabilityResponse(),
      chatResponse(),
      capabilityResponse(),
      chatResponse({ id: 'operation-2' }),
    );
    const adapter = provider(transport, {
      completedResultCapacity: 1,
      completedResultTtlMs: 10,
      monotonicNow: () => now,
    });
    const manifest = await adapter.discoverCapabilities();
    const firstRequest = buildModelWorkRequest(manifest);
    const first = await adapter.dispatch({
      ...firstRequest,
      limits: { ...firstRequest.modelWork.budget, inputTokens: 1 },
    });
    expect(first.ok).toBe(false);
    if (first.ok) throw new Error('expected budget exhaustion');
    expect(first.error.code).toBe('budget_exhausted');
    await expect(
      adapter.dispatch({
        ...firstRequest,
        limits: firstRequest.modelWork.budget,
      }),
    ).resolves.toEqual(first);
    expect(
      transport.requests.filter((entry) => entry.method === 'POST'),
    ).toHaveLength(1);

    const secondRequest = buildModelWorkRequest(manifest, {
      prompt: 'Return a second typed proposal.',
    });
    const second = await adapter.dispatch({
      ...secondRequest,
      limits: secondRequest.modelWork.budget,
    });
    expect(second.ok).toBe(true);
    await expect(
      adapter.reconcile({
        idempotencyKey: firstRequest.modelWork.effect.idempotencyKey,
      }),
    ).resolves.toBeUndefined();
    now = 111;
    await expect(
      adapter.reconcile({
        idempotencyKey: secondRequest.modelWork.effect.idempotencyKey,
      }),
    ).resolves.toBeUndefined();
  });

  it('propagates cancellation while capability discovery is in flight', async () => {
    let requestCount = 0;
    let notifyStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    const transport: PinnedHttpTransport = {
      request(input) {
        requestCount += 1;
        if (requestCount === 1) return Promise.resolve(capabilityResponse());
        return new Promise((_resolve, reject) => {
          notifyStarted();
          input.signal.addEventListener(
            'abort',
            () => {
              reject(new Error('fixture transport aborted'));
            },
            { once: true },
          );
        });
      },
    };
    const adapter = provider(transport);
    const manifest = await adapter.discoverCapabilities();
    const request = buildModelWorkRequest(manifest);
    const controller = new AbortController();
    const pending = adapter.dispatch({
      ...request,
      limits: request.modelWork.budget,
      abortSignal: controller.signal,
    });
    await started;
    controller.abort();
    const result = await pending;
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected cancellation');
    expect(result.error.code).toBe('late_response');
  });

  it('applies cancellation while DNS authorization is in flight', async () => {
    let resolution = 0;
    let notifyStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    const transport = new FixtureTransport();
    transport.responses.push(capabilityResponse());
    const adapter = provider(transport, {
      resolveHost: () => {
        resolution += 1;
        if (resolution === 1) return Promise.resolve(['127.0.0.1']);
        notifyStarted();
        return new Promise<readonly string[]>(() => undefined);
      },
    });
    const manifest = await adapter.discoverCapabilities();
    const request = buildModelWorkRequest(manifest);
    const controller = new AbortController();
    const pending = adapter.dispatch({
      ...request,
      limits: request.modelWork.budget,
      abortSignal: controller.signal,
    });
    await started;
    controller.abort();
    const result = await pending;
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected DNS cancellation');
    expect(result.error.code).toBe('late_response');
    expect(transport.requests).toHaveLength(1);
  });

  it('classifies post-acceptance timeout as ambiguous delivery', async () => {
    let requestCount = 0;
    const transport: PinnedHttpTransport = {
      request(input) {
        requestCount += 1;
        if (requestCount <= 2) return Promise.resolve(capabilityResponse());
        return new Promise((_resolve, reject) => {
          input.signal.addEventListener(
            'abort',
            () => {
              reject(new PinnedTransportError('timed out', true));
            },
            { once: true },
          );
        });
      },
    };
    const adapter = provider(transport, { timeoutMs: 10 });
    const manifest = await adapter.discoverCapabilities();
    const request = buildModelWorkRequest(manifest);
    const result = await adapter.dispatch({
      ...request,
      limits: request.modelWork.budget,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected ambiguous timeout');
    expect(result.error.code).toBe('ambiguous_delivery');
  });

  it('treats unresolved discovery as transient provider unavailability', async () => {
    let resolution = 0;
    const transport = new FixtureTransport();
    transport.responses.push(capabilityResponse());
    const adapter = provider(transport, {
      resolveHost: () => {
        resolution += 1;
        return Promise.resolve(resolution === 1 ? ['127.0.0.1'] : []);
      },
    });
    const manifest = await adapter.discoverCapabilities();
    const request = buildModelWorkRequest(manifest);
    const result = await adapter.dispatch({
      ...request,
      limits: request.modelWork.budget,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected provider unavailability');
    expect(result.error.code).toBe('provider_unavailable');
  });

  it('fails closed when alias or checkpoint identity drifts after discovery', async () => {
    const transport = new FixtureTransport();
    transport.responses.push(
      capabilityResponse(),
      capabilityResponse({ digest: 'd'.repeat(64) }),
    );
    const adapter = provider(transport);
    const manifest = await adapter.discoverCapabilities();
    const request = buildModelWorkRequest(manifest);
    const result = await adapter.dispatch({
      ...request,
      limits: request.modelWork.budget,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected profile drift');
    expect(result.error.code).toBe('profile_drift');
    expect(transport.requests.some((entry) => entry.method === 'POST')).toBe(
      false,
    );
  });

  it('rejects secrets in canonical prompt bytes before the provider call', async () => {
    const transport = new FixtureTransport();
    transport.responses.push(capabilityResponse(), capabilityResponse());
    const secret = 'fixture"secret\\with\nnewline';
    const adapter = provider(transport, {
      environment: { MAMMOTH_PROVIDER_KEY: secret },
      apiKeyEnvironmentVariable: 'MAMMOTH_PROVIDER_KEY',
    });
    const manifest = await adapter.discoverCapabilities();
    const request = buildModelWorkRequest(manifest, {
      prompt: `Never include ${secret} in a prompt.`,
    });
    const result = await adapter.dispatch({
      ...request,
      limits: request.modelWork.budget,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected secret rejection');
    expect(result.error.code).toBe('secret_detected');
    expect(transport.requests.some((entry) => entry.method === 'POST')).toBe(
      false,
    );
  });

  it('rejects seeded requests when the discovered manifest says seed is unsupported', async () => {
    const transport = new FixtureTransport();
    transport.responses.push(capabilityResponse(), capabilityResponse());
    const adapter = provider(transport);
    const manifest = await adapter.discoverCapabilities();
    expect(manifest.supportsSeed).toBe(false);
    const request = buildModelWorkRequest(manifest, { seed: 7 });
    const result = await adapter.dispatch({
      ...request,
      limits: request.modelWork.budget,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected unsupported seed rejection');
    expect(result.error.code).toBe('unsupported_capability');
    expect(transport.requests.some((entry) => entry.method === 'POST')).toBe(
      false,
    );
  });

  it('revalidates governed redirects and fails closed before a private target', async () => {
    const transport = new FixtureTransport();
    let resolutions = 0;
    transport.responses.push(
      jsonResponse(
        {},
        {
          status: 302,
          headers: { location: '/redirected-tags' },
        },
      ),
    );
    const adapter = provider(transport, {
      mode: 'governed',
      approvedOrigins: ['http://provider.local:11434'],
      maximumRedirects: 2,
      resolveHost: () => {
        resolutions += 1;
        return Promise.resolve(
          resolutions === 1 ? ['93.184.216.34'] : ['169.254.169.254'],
        );
      },
    });
    await expect(adapter.discoverCapabilities()).rejects.toThrow(
      'provider destination is not authorized',
    );
    expect(transport.requests).toHaveLength(1);
  });

  it('never forwards provider credentials across redirect origins', async () => {
    const transport = new FixtureTransport();
    transport.responses.push(
      jsonResponse(
        {},
        {
          status: 302,
          headers: { location: 'https://other.example/api/tags' },
        },
      ),
    );
    const adapter = provider(transport, {
      mode: 'governed',
      approvedOrigins: ['http://provider.local:11434', 'https://other.example'],
      maximumRedirects: 2,
      resolveHost: () => Promise.resolve(['93.184.216.34']),
      environment: { MAMMOTH_PROVIDER_KEY: 'never-forward-me' },
      apiKeyEnvironmentVariable: 'MAMMOTH_PROVIDER_KEY',
    });
    await expect(adapter.discoverCapabilities()).rejects.toThrow(
      'provider redirect changed the pinned origin',
    );
    expect(transport.requests).toHaveLength(1);
  });

  it('classifies HTTP, malformed usage, ambiguous transport, and reservation failures', async () => {
    const cases: {
      readonly response: ReturnType<typeof jsonResponse> | Error;
      readonly code: ProviderErrorCode;
    }[] = [
      { response: jsonResponse({}, { status: 429 }), code: 'rate_limited' },
      {
        response: jsonResponse({}, { status: 503 }),
        code: 'provider_unavailable',
      },
      {
        response: chatResponse({ totalTokens: 999 }),
        code: 'schema_incompatible',
      },
      {
        response: new PinnedTransportError('connection reset', true),
        code: 'ambiguous_delivery',
      },
      {
        response: new PinnedTransportError(
          'provider response exceeded limit',
          true,
          'response_too_large',
        ),
        code: 'oversized_output',
      },
    ];
    for (const fixture of cases) {
      const transport = new FixtureTransport();
      transport.responses.push(
        capabilityResponse(),
        capabilityResponse(),
        fixture.response,
      );
      const adapter = provider(transport);
      const manifest = await adapter.discoverCapabilities();
      const request = buildModelWorkRequest(manifest);
      const result = await adapter.dispatch({
        ...request,
        limits: request.modelWork.budget,
      });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected provider failure');
      expect(result.error.code).toBe(fixture.code);
    }

    const transport = new FixtureTransport();
    transport.responses.push(
      capabilityResponse(),
      capabilityResponse(),
      chatResponse(),
    );
    const adapter = provider(transport);
    const manifest = await adapter.discoverCapabilities();
    const request = buildModelWorkRequest(manifest);
    const result = await adapter.dispatch({
      ...request,
      limits: { ...request.modelWork.budget, inputTokens: 1 },
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected budget exhaustion');
    expect(result.error.code).toBe('budget_exhausted');
  });
});
