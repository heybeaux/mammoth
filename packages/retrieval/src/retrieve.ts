import { lookup } from 'node:dns/promises';
import type {
  HostResolver,
  RetrievedSource,
  RetrievalPolicy,
  SourceRequest,
  SourceTransport,
} from './types.js';
import { assertSafeUrl } from './security.js';

export const DEFAULT_RETRIEVAL_POLICY: RetrievalPolicy = {
  allowedSchemes: ['https:'],
  allowedMediaTypes: ['text/plain', 'text/html', 'application/json'],
  maxBytes: 5 * 1024 * 1024,
  maxRedirects: 5,
  timeoutMs: 15_000,
  allowPrivateNetwork: false,
};

const defaultResolver: HostResolver = async (hostname) =>
  (await lookup(hostname, { all: true })).map(({ address }) => address);

const defaultTransport: SourceTransport = async (url, init) =>
  fetch(url, { ...init, redirect: 'manual' });

function mediaType(headers: Headers): string {
  const [type = 'application/octet-stream'] = (
    headers.get('content-type') ?? 'application/octet-stream'
  ).split(';', 1);
  return type.trim().toLowerCase();
}

async function readBounded(
  body: ReadableStream<Uint8Array> | null,
  maximum: number,
): Promise<Uint8Array> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    let complete = false;
    while (!complete) {
      const { done, value } = await reader.read();
      if (done) {
        complete = true;
        continue;
      }
      size += value.byteLength;
      if (size > maximum)
        throw new Error(`RESPONSE_TOO_LARGE:${String(maximum)}`);
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export async function retrieveSource(
  request: SourceRequest,
  options: {
    policy?: Partial<RetrievalPolicy>;
    transport?: SourceTransport;
    resolveHost?: HostResolver;
    now?: () => Date;
  } = {},
): Promise<RetrievedSource> {
  const policy = { ...DEFAULT_RETRIEVAL_POLICY, ...options.policy };
  const transport = options.transport ?? defaultTransport;
  const resolveHost = options.resolveHost ?? defaultResolver;
  const redirectChain: string[] = [];
  let url = new URL(request.url);
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, policy.timeoutMs);
  try {
    for (let redirects = 0; ; redirects += 1) {
      await assertSafeUrl(
        url,
        policy.allowedSchemes,
        policy.allowPrivateNetwork,
        resolveHost,
      );
      const response = await transport(url, {
        headers: request.headers ?? {},
        signal: controller.signal,
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (redirects >= policy.maxRedirects)
          throw new Error('TOO_MANY_REDIRECTS');
        const location = response.headers.get('location');
        if (!location) throw new Error('REDIRECT_WITHOUT_LOCATION');
        redirectChain.push(url.href);
        url = new URL(location, url);
        continue;
      }
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`SOURCE_HTTP_ERROR:${String(response.status)}`);
      }
      const type = mediaType(response.headers);
      if (!policy.allowedMediaTypes.includes(type)) {
        throw new Error(`MEDIA_TYPE_NOT_ALLOWED:${type}`);
      }
      const declaredLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > policy.maxBytes) {
        throw new Error(`RESPONSE_TOO_LARGE:${String(policy.maxBytes)}`);
      }
      const bytes = await readBounded(response.body, policy.maxBytes);
      return {
        requestedUrl: request.url,
        finalUrl: url.href,
        redirectChain,
        retrievedAt: (options.now ?? (() => new Date()))().toISOString(),
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        mediaType: type,
        bytes,
      };
    }
  } finally {
    clearTimeout(timeout);
  }
}
