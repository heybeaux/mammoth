import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import type {
  SourceTransport,
  SourceTransportRequest,
  TransportResponse,
} from './types.js';

export class SourceTransportError extends Error {
  constructor(
    message: string,
    readonly requestAccepted: boolean,
    readonly kind: 'connection' | 'response_too_large' = 'connection',
  ) {
    super(message);
    this.name = 'SourceTransportError';
  }
}

/**
 * Direct Node transport with an injected lookup result. It ignores ambient proxy
 * variables, preserves Host/TLS SNI, and reports the actual connected address.
 */
export class NodePinnedSourceTransport implements SourceTransport {
  request(input: SourceTransportRequest): Promise<TransportResponse> {
    return new Promise((resolve, reject) => {
      let requestAccepted = false;
      let settled = false;
      const family = isIP(input.approvedAddress);
      if (family === 0) {
        reject(new SourceTransportError('approved address is invalid', false));
        return;
      }
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      const lookup: LookupFunction = (_hostname, options, callback) => {
        if (options.all) {
          callback(null, [{ address: input.approvedAddress, family }]);
          return;
        }
        callback(null, input.approvedAddress, family);
      };
      const requestImpl =
        input.url.protocol === 'https:' ? httpsRequest : httpRequest;
      const suppliedHeaders = Object.fromEntries(
        Object.entries(input.headers).filter(
          ([name]) => name.toLowerCase() !== 'host',
        ),
      );
      const request = requestImpl(
        {
          protocol: input.url.protocol,
          hostname: input.url.hostname,
          port: input.url.port || undefined,
          method: 'GET',
          path: `${input.url.pathname}${input.url.search}`,
          headers: { ...suppliedHeaders, host: input.url.host },
          lookup,
          servername: input.url.hostname.replace(/^\[|\]$/gu, ''),
          agent: false,
          signal: input.signal,
        },
        (response) => {
          const chunks: Uint8Array[] = [];
          let size = 0;
          const connectedAddress = response.socket.remoteAddress ?? '';
          response.on('data', (chunk: Buffer) => {
            size += chunk.byteLength;
            if (size > input.maximumResponseBytes) {
              const error = new SourceTransportError(
                'source response exceeded byte limit',
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
            if (settled) return;
            const body = new Uint8Array(size);
            let offset = 0;
            for (const chunk of chunks) {
              body.set(chunk, offset);
              offset += chunk.byteLength;
            }
            settled = true;
            resolve({
              status: response.statusCode ?? 0,
              headers: normalizeHeaders(response.headers),
              body,
              connectedAddress,
            });
          });
          response.on('error', (error: Error) => {
            fail(
              error instanceof SourceTransportError
                ? error
                : new SourceTransportError(error.message, true),
            );
          });
        },
      );
      request.on('finish', () => {
        requestAccepted = true;
      });
      request.on('error', (error: Error) => {
        fail(
          error instanceof SourceTransportError
            ? error
            : new SourceTransportError(error.message, requestAccepted),
        );
      });
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
