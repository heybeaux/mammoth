import { NetworkHopReceiptSchema } from '@mammoth/domain';
import type {
  HostResolver,
  NetworkHopReceipt,
  RetrievedSource,
  RetrievalPolicy,
  SourceRequest,
  SourceTransport,
} from './types.js';
import {
  AcquisitionPolicyError,
  authorizeAcquisitionHop,
  canonicalizeAcquisitionUrl,
  defaultHostResolver,
} from './security.js';
import {
  NodePinnedSourceTransport,
  SourceTransportError,
} from './transport.js';

export const DEFAULT_RETRIEVAL_POLICY: RetrievalPolicy = {
  allowedSchemes: ['https:'],
  allowedMediaTypes: ['text/plain', 'text/html', 'application/json'],
  allowedPorts: [443],
  maxBytes: 5 * 1024 * 1024,
  maxRedirects: 5,
  timeoutMs: 15_000,
};

export class AcquisitionFailure extends Error {
  constructor(
    readonly code: string,
    readonly networkReceipts: readonly NetworkHopReceipt[],
    cause?: unknown,
  ) {
    super(code, cause === undefined ? undefined : { cause });
    this.name = 'AcquisitionFailure';
  }
}

function mediaType(headers: Readonly<Record<string, string>>): string {
  const [type = 'application/octet-stream'] = (
    headers['content-type'] ?? 'application/octet-stream'
  ).split(';', 1);
  return type.trim().toLowerCase();
}

function sameAddresses(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length && left.every((value, i) => value === right[i])
  );
}

export async function retrieveSource(
  request: SourceRequest,
  options: {
    policy?: Partial<RetrievalPolicy>;
    transport?: SourceTransport;
    resolveHost?: HostResolver;
    now?: () => Date;
    signal?: AbortSignal;
    policyId?: string;
  } = {},
): Promise<RetrievedSource> {
  const policy = { ...DEFAULT_RETRIEVAL_POLICY, ...options.policy };
  const transport = options.transport ?? new NodePinnedSourceTransport();
  const resolveHost = options.resolveHost ?? defaultHostResolver;
  const now = options.now ?? (() => new Date());
  const policyId = options.policyId ?? 'p9-public-network/v1';
  const redirectChain: string[] = [];
  const networkReceipts: NetworkHopReceipt[] = [];
  const priorAnswers = new Map<string, readonly string[]>();
  let url = canonicalizeAcquisitionUrl(request.url);
  const initialOrigin = url.origin;
  const controller = new AbortController();
  const abort = () => {
    controller.abort(options.signal?.reason);
  };
  options.signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => {
    controller.abort(new Error('ACQUISITION_TIMEOUT'));
  }, policy.timeoutMs);
  try {
    if (options.signal?.aborted) abort();
    for (let redirects = 0; ; redirects += 1) {
      const authorized = await authorizeAcquisitionHop(
        url,
        policy,
        resolveHost,
      );
      url = authorized.url;
      const hostname = url.hostname.toLowerCase();
      const previous = priorAnswers.get(hostname);
      if (previous && !sameAddresses(previous, authorized.addresses)) {
        throw new AcquisitionPolicyError('DNS_ANSWER_CHANGED', hostname);
      }
      priorAnswers.set(hostname, authorized.addresses);
      const approvedAddress = authorized.addresses[0];
      if (!approvedAddress) {
        throw new AcquisitionPolicyError('HOST_UNRESOLVED', hostname);
      }
      const response = await transport.request({
        url,
        approvedAddress,
        headers: request.headers ?? {},
        signal: controller.signal,
        maximumResponseBytes: policy.maxBytes,
      });
      if (
        response.connectedAddress.toLowerCase() !==
        approvedAddress.toLowerCase()
      ) {
        throw new AcquisitionPolicyError(
          'CONNECTED_ADDRESS_NOT_APPROVED',
          response.connectedAddress || 'unknown',
        );
      }
      const redirectLocation = [301, 302, 303, 307, 308].includes(
        response.status,
      )
        ? (response.headers.location ?? null)
        : null;
      networkReceipts.push(
        NetworkHopReceiptSchema.parse({
          schemaVersion: '1.0.0',
          contractFamily: 'p9.v1',
          policyId,
          hop: networkReceipts.length,
          canonicalUrl: url.href,
          origin: url.origin,
          approvedAddresses: authorized.addresses,
          connectedAddress: response.connectedAddress,
          resolvedAt: now().toISOString(),
          responseStatus: response.status,
          redirectLocation,
        }),
      );
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (redirects >= policy.maxRedirects) {
          throw new Error('TOO_MANY_REDIRECTS');
        }
        if (!redirectLocation) throw new Error('REDIRECT_WITHOUT_LOCATION');
        redirectChain.push(url.href);
        const next = canonicalizeAcquisitionUrl(new URL(redirectLocation, url));
        if (next.origin !== initialOrigin) {
          throw new AcquisitionPolicyError(
            'REDIRECT_ORIGIN_NOT_ALLOWED',
            next.origin,
          );
        }
        url = next;
        continue;
      }
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`SOURCE_HTTP_ERROR:${String(response.status)}`);
      }
      const type = mediaType(response.headers);
      if (!policy.allowedMediaTypes.includes(type)) {
        throw new Error(`MEDIA_TYPE_NOT_ALLOWED:${type}`);
      }
      const declaredLength = Number(response.headers['content-length']);
      if (Number.isFinite(declaredLength) && declaredLength > policy.maxBytes) {
        throw new Error(`RESPONSE_TOO_LARGE:${String(policy.maxBytes)}`);
      }
      if (response.body.byteLength > policy.maxBytes) {
        throw new Error(`RESPONSE_TOO_LARGE:${String(policy.maxBytes)}`);
      }
      return {
        requestedUrl: request.url,
        finalUrl: url.href,
        redirectChain,
        retrievedAt: now().toISOString(),
        status: response.status,
        headers: response.headers,
        mediaType: type,
        bytes: response.body,
        networkReceipts,
      };
    }
  } catch (error: unknown) {
    if (error instanceof AcquisitionFailure) throw error;
    if (controller.signal.aborted) {
      throw new AcquisitionFailure(
        options.signal?.aborted
          ? 'ACQUISITION_CANCELLED'
          : 'ACQUISITION_TIMEOUT',
        networkReceipts,
        error,
      );
    }
    const code =
      error instanceof AcquisitionPolicyError
        ? error.code
        : error instanceof SourceTransportError &&
            error.kind === 'response_too_large'
          ? `RESPONSE_TOO_LARGE:${String(policy.maxBytes)}`
          : error instanceof Error
            ? error.message
            : 'ACQUISITION_UNKNOWN_FAILURE';
    throw new AcquisitionFailure(code, networkReceipts, error);
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abort);
  }
}
