import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';

export interface PinnedHttpRequest {
  readonly url: URL;
  readonly approvedAddress: string;
  readonly method: 'GET' | 'POST';
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: Uint8Array;
  readonly signal: AbortSignal;
  readonly maximumResponseBytes: number;
}

export interface PinnedHttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
}

export interface PinnedHttpTransport {
  request(input: PinnedHttpRequest): Promise<PinnedHttpResponse>;
}

export class PinnedTransportError extends Error {
  constructor(
    message: string,
    readonly requestAccepted: boolean,
    readonly kind: 'connection' | 'response_too_large' = 'connection',
  ) {
    super(message);
    this.name = 'PinnedTransportError';
  }
}

export class NodePinnedHttpTransport implements PinnedHttpTransport {
  request(input: PinnedHttpRequest): Promise<PinnedHttpResponse> {
    return new Promise((resolve, reject) => {
      let requestAccepted = false;
      let settled = false;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      const succeed = (response: PinnedHttpResponse) => {
        if (settled) return;
        settled = true;
        resolve(response);
      };
      const family = isIP(input.approvedAddress);
      if (family === 0) {
        fail(new PinnedTransportError('approved address is invalid', false));
        return;
      }
      const lookup: LookupFunction = (_hostname, options, callback) => {
        if (options.all) {
          callback(null, [{ address: input.approvedAddress, family }]);
          return;
        }
        callback(null, input.approvedAddress, family);
      };
      const requestImpl =
        input.url.protocol === 'https:' ? httpsRequest : httpRequest;
      const request = requestImpl(
        {
          protocol: input.url.protocol,
          hostname: input.url.hostname,
          port: input.url.port || undefined,
          method: input.method,
          path: `${input.url.pathname}${input.url.search}`,
          headers: { host: input.url.host, ...input.headers },
          lookup,
          servername: input.url.hostname,
          agent: false,
          signal: input.signal,
        },
        (response) => {
          const chunks: Uint8Array[] = [];
          let size = 0;
          response.on('data', (chunk: Buffer) => {
            size += chunk.byteLength;
            if (size > input.maximumResponseBytes) {
              const error = new PinnedTransportError(
                'provider response exceeded limit',
                true,
                'response_too_large',
              );
              fail(error);
              response.destroy(error);
              request.destroy(error);
              return;
            }
            chunks.push(chunk);
          });
          response.on('end', () => {
            const body = new Uint8Array(size);
            let offset = 0;
            for (const chunk of chunks) {
              body.set(chunk, offset);
              offset += chunk.byteLength;
            }
            succeed({
              status: response.statusCode ?? 0,
              headers: normalizeHeaders(response.headers),
              body,
            });
          });
          response.on('error', (error: Error) => {
            fail(
              error instanceof PinnedTransportError
                ? error
                : new PinnedTransportError(error.message, true),
            );
          });
        },
      );
      request.on('finish', () => {
        requestAccepted = true;
      });
      request.on('error', (error: Error) => {
        fail(
          error instanceof PinnedTransportError
            ? error
            : new PinnedTransportError(error.message, requestAccepted),
        );
      });
      if (input.body) request.write(input.body);
      request.end();
    });
  }
}

function normalizeHeaders(
  headers: Readonly<Record<string, string | string[] | undefined>>,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(headers)
      .filter(
        (entry): entry is [string, string | string[]] => entry[1] !== undefined,
      )
      .map(([key, value]) => [
        key.toLowerCase(),
        Array.isArray(value) ? value.join(', ') : value,
      ]),
  );
}
