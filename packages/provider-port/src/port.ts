import type {
  ModelWorkBudget,
  ModelWorkRequest,
  ProviderCapabilityManifest,
  ProviderError,
  ProviderUsage,
} from '@mammoth/domain';

export interface ProviderDispatchRequest {
  readonly modelWork: ModelWorkRequest;
  readonly canonicalRequestBytes: Uint8Array;
  readonly limits: ModelWorkBudget;
  readonly abortSignal?: AbortSignal;
}

export interface ProviderEnvelope {
  readonly provider: string;
  readonly concreteModel: string;
  readonly checkpoint: string;
  readonly providerOperationId?: string;
  readonly finishReason: 'stop' | 'length' | 'content_filter';
  readonly usage: ProviderUsage;
  readonly rawResponseBytes: Uint8Array;
}

export type ProviderDispatchResult =
  | { readonly ok: true; readonly envelope: ProviderEnvelope }
  | { readonly ok: false; readonly error: ProviderError };

/** Provider-neutral effect boundary. Concrete implementations may not expose SDK types. */
export interface ModelProviderPort {
  discoverCapabilities(): Promise<ProviderCapabilityManifest>;
  dispatch(request: ProviderDispatchRequest): Promise<ProviderDispatchResult>;
  reconcile(input: {
    readonly idempotencyKey: string;
    readonly providerOperationId?: string;
  }): Promise<ProviderDispatchResult | undefined>;
}
