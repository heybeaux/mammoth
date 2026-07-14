import {
  PROVIDER_CAPABILITY_MANIFEST_VERSION,
  ProviderCapabilityManifestSchema,
  canonicalDigest,
  canonicalJson,
  providerCapabilityManifestDigest,
  type ProviderCapabilityManifest,
  type ProviderUsage,
  type TypedModelOutput,
} from '@mammoth/domain';
import type {
  ModelProviderPort,
  ProviderDispatchRequest,
  ProviderDispatchResult,
} from './port.js';

export interface DeterministicProviderOptions {
  readonly typedOutput: TypedModelOutput;
  readonly concreteModel?: string;
  readonly checkpoint?: string;
  readonly operationPrefix?: string;
}

export class DeterministicModelProvider implements ModelProviderPort {
  readonly #manifest: ProviderCapabilityManifest;
  readonly #rawResponseBytes: Uint8Array;
  readonly #operationPrefix: string;
  readonly #completed = new Map<string, ProviderDispatchResult>();

  constructor(options: DeterministicProviderOptions) {
    const concreteModel = options.concreteModel ?? 'mammoth-fixture-v1';
    const checkpoint = options.checkpoint ?? 'fixture-checkpoint-v1';
    const manifestBase: ProviderCapabilityManifest = {
      schemaVersion: PROVIDER_CAPABILITY_MANIFEST_VERSION,
      provider: 'deterministic',
      concreteModel,
      checkpoint,
      modalities: ['text'],
      contextWindowTokens: 65_536,
      supportsJsonOutput: true,
      supportsSeed: true,
      manifestDigest: `sha256:${'0'.repeat(64)}`,
    };
    this.#manifest = ProviderCapabilityManifestSchema.parse({
      ...manifestBase,
      manifestDigest: providerCapabilityManifestDigest(manifestBase),
    });
    this.#rawResponseBytes = new TextEncoder().encode(
      JSON.stringify(options.typedOutput),
    );
    this.#operationPrefix = options.operationPrefix ?? 'deterministic';
  }

  discoverCapabilities(): Promise<ProviderCapabilityManifest> {
    return Promise.resolve({
      ...this.#manifest,
      modalities: [...this.#manifest.modalities],
    });
  }

  dispatch(request: ProviderDispatchRequest): Promise<ProviderDispatchResult> {
    const parsed = request.modelWork;
    if (request.abortSignal?.aborted) {
      return Promise.resolve({
        ok: false,
        error: {
          schemaVersion: '1.0.0',
          code: 'late_response',
          message: 'dispatch was cancelled before provider acceptance',
        },
      });
    }
    if (
      parsed.attempt.provider !== this.#manifest.provider ||
      parsed.attempt.concreteModel !== this.#manifest.concreteModel ||
      parsed.attempt.checkpoint !== this.#manifest.checkpoint ||
      parsed.capabilityManifestDigest !== this.#manifest.manifestDigest
    ) {
      return Promise.resolve({
        ok: false,
        error: {
          schemaVersion: '1.0.0',
          code: 'profile_drift',
          message:
            'requested provider identity does not match capability discovery',
        },
      });
    }
    if (
      !canonicalRequestMatchesDigest(
        request,
        parsed.effect.canonicalRequestDigest,
      )
    ) {
      return Promise.resolve({
        ok: false,
        error: {
          schemaVersion: '1.0.0',
          code: 'schema_incompatible',
          message: 'canonical provider request bytes do not match their digest',
        },
      });
    }
    const existing = this.#completed.get(parsed.effect.idempotencyKey);
    if (existing) return Promise.resolve(cloneDispatchResult(existing));

    const inputTokens = Math.max(
      1,
      Math.ceil(request.canonicalRequestBytes.byteLength / 4),
    );
    const outputTokens = Math.max(
      1,
      Math.ceil(this.#rawResponseBytes.byteLength / 4),
    );
    const usage: ProviderUsage = {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      currencyMicros: 0,
      wallClockMs: 0,
      toolCalls: 0,
    };
    if (
      usage.inputTokens > request.limits.inputTokens ||
      usage.outputTokens > request.limits.outputTokens
    ) {
      return Promise.resolve({
        ok: false,
        error: {
          schemaVersion: '1.0.0',
          code: 'budget_exhausted',
          message:
            'deterministic provider usage exceeds the reserved token budget',
        },
      });
    }
    const result: ProviderDispatchResult = {
      ok: true,
      envelope: {
        provider: this.#manifest.provider,
        concreteModel: this.#manifest.concreteModel,
        checkpoint: this.#manifest.checkpoint,
        providerOperationId: `${this.#operationPrefix}:${parsed.effect.idempotencyKey}`,
        finishReason: 'stop',
        usage,
        rawResponseBytes: this.#rawResponseBytes.slice(),
      },
    };
    this.#completed.set(parsed.effect.idempotencyKey, result);
    return Promise.resolve(cloneDispatchResult(result));
  }

  reconcile(input: {
    readonly idempotencyKey: string;
    readonly providerOperationId?: string;
  }): Promise<ProviderDispatchResult | undefined> {
    const result = this.#completed.get(input.idempotencyKey);
    if (!result?.ok || !input.providerOperationId)
      return Promise.resolve(result ? cloneDispatchResult(result) : undefined);
    return Promise.resolve(
      result.envelope.providerOperationId === input.providerOperationId
        ? cloneDispatchResult(result)
        : undefined,
    );
  }
}

function canonicalRequestMatchesDigest(
  request: ProviderDispatchRequest,
  expectedDigest: string,
): boolean {
  if (request.canonicalRequestBytes.byteLength === 0) return false;
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(
      request.canonicalRequestBytes,
    );
    const parsed = JSON.parse(decoded) as unknown;
    return (
      decoded === canonicalJson(parsed) &&
      canonicalDigest(parsed) === expectedDigest
    );
  } catch {
    return false;
  }
}

function cloneDispatchResult(
  result: ProviderDispatchResult,
): ProviderDispatchResult {
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
