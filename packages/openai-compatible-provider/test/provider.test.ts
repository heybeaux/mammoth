import { describe, expect, it } from 'vitest';
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
  });
}

describe('OpenAI-compatible provider adapter', () => {
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
    const adapter = provider(transport, {
      environment: { MAMMOTH_PROVIDER_KEY: 'Return typed research proposals.' },
      apiKeyEnvironmentVariable: 'MAMMOTH_PROVIDER_KEY',
    });
    const manifest = await adapter.discoverCapabilities();
    const request = buildModelWorkRequest(manifest);
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
      readonly code: string;
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
