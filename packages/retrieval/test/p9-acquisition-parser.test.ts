import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AcquisitionFailure,
  BoundedParserRegistry,
  NodePinnedSourceTransport,
  ParserPolicyError,
  retrieveSource,
  type SourceTransport,
  type SourceTransportRequest,
  type TransportResponse,
} from '../src/index.js';

const encoder = new TextEncoder();
const PUBLIC = '93.184.216.34';
const NOW = new Date('2026-07-15T03:30:00.000Z');
const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) reject(error);
            else resolve();
          });
        }),
    ),
  );
});

function response(
  input: SourceTransportRequest,
  options: {
    status?: number;
    headers?: Readonly<Record<string, string>>;
    body?: string;
    connectedAddress?: string;
  } = {},
): TransportResponse {
  return {
    status: options.status ?? 200,
    headers: { 'content-type': 'text/plain', ...options.headers },
    body: encoder.encode(options.body ?? 'evidence'),
    connectedAddress: options.connectedAddress ?? input.approvedAddress,
  };
}

function fixtureTransport(
  handler: (input: SourceTransportRequest) => TransportResponse,
): SourceTransport {
  return { request: (input) => Promise.resolve(handler(input)) };
}

async function expectBlockedBeforeConnect(
  url: string,
  addresses: readonly string[],
): Promise<void> {
  let connected = false;
  try {
    await retrieveSource(
      { url },
      {
        resolveHost: () => Promise.resolve(addresses),
        transport: fixtureTransport((input) => {
          connected = true;
          return response(input);
        }),
      },
    );
    throw new Error('expected policy rejection');
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(AcquisitionFailure);
  }
  expect(connected).toBe(false);
}

describe('P9 hosted-safe acquisition', () => {
  it('rejects URL credentials before DNS resolution or connect', async () => {
    let resolved = false;
    let connected = false;
    await expect(
      retrieveSource(
        { url: 'https://operator:secret@example.com/evidence' },
        {
          resolveHost: () => {
            resolved = true;
            return Promise.resolve([PUBLIC]);
          },
          transport: fixtureTransport((input) => {
            connected = true;
            return response(input);
          }),
        },
      ),
    ).rejects.toMatchObject({ code: 'URL_CREDENTIALS_NOT_ALLOWED' });
    expect(resolved).toBe(false);
    expect(connected).toBe(false);
  });

  it('canonicalizes trailing-dot and Unicode hosts before resolution', async () => {
    const resolvedHosts: string[] = [];
    const transport = fixtureTransport((input) => response(input));
    const trailingDot = await retrieveSource(
      { url: 'https://example.com./evidence#fragment' },
      {
        resolveHost: (hostname) => {
          resolvedHosts.push(hostname);
          return Promise.resolve([PUBLIC]);
        },
        transport,
        now: () => NOW,
      },
    );
    const unicode = await retrieveSource(
      { url: 'https://münich.example/evidence' },
      {
        resolveHost: (hostname) => {
          resolvedHosts.push(hostname);
          return Promise.resolve([PUBLIC]);
        },
        transport,
        now: () => NOW,
      },
    );

    expect(resolvedHosts).toEqual(['example.com', 'xn--mnich-kva.example']);
    expect(trailingDot.finalUrl).toBe('https://example.com/evidence');
    expect(trailingDot.networkReceipts[0]?.canonicalUrl).toBe(
      'https://example.com/evidence',
    );
    expect(unicode.finalUrl).toBe('https://xn--mnich-kva.example/evidence');
  });

  it('rejects non-policy ports before connect', async () => {
    await expectBlockedBeforeConnect('https://example.com:8443/evidence', [
      PUBLIC,
    ]);
  });

  it.each([
    'https://127.0.0.1/secret',
    'https://2130706433/secret',
    'https://0x7f000001/secret',
    'https://0177.0.0.1/secret',
  ])('blocks obfuscated loopback before connect: %s', async (url) => {
    await expectBlockedBeforeConnect(url, ['127.0.0.1']);
  });

  it.each(['::ffff:127.0.0.1', '::ffff:7f00:1'])(
    'blocks IPv6-mapped private address %s before connect',
    async (address) => {
      await expectBlockedBeforeConnect('https://mapped.example/secret', [
        address,
      ]);
    },
  );

  it('rejects mixed public/private DNS answers before connect', async () => {
    await expectBlockedBeforeConnect('https://mixed.example/', [
      PUBLIC,
      '10.0.0.4',
    ]);
  });

  it('pins each hop and rejects changed DNS answers with the prior chain retained', async () => {
    let resolutions = 0;
    const transport = fixtureTransport((input) =>
      input.url.pathname === '/start'
        ? response(input, {
            status: 302,
            headers: { location: '/finish' },
            body: '',
          })
        : response(input),
    );
    try {
      await retrieveSource(
        { url: 'https://example.com/start' },
        {
          resolveHost: () =>
            Promise.resolve([resolutions++ === 0 ? PUBLIC : '8.8.8.8']),
          transport,
          now: () => NOW,
        },
      );
      throw new Error('expected rebinding rejection');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(AcquisitionFailure);
      const failure = error as AcquisitionFailure;
      expect(failure.code).toBe('DNS_ANSWER_CHANGED');
      expect(failure.networkReceipts).toHaveLength(1);
      expect(failure.networkReceipts[0]?.redirectLocation).toBe('/finish');
    }
  });

  it('rejects public-to-private origin drift with the prior chain retained', async () => {
    const transport = fixtureTransport((input) =>
      response(input, {
        status: 302,
        headers: { location: 'https://private.example/secret' },
        body: '',
      }),
    );
    try {
      await retrieveSource(
        { url: 'https://public.example/start' },
        {
          resolveHost: (hostname) =>
            Promise.resolve(
              hostname === 'public.example' ? [PUBLIC] : ['10.0.0.2'],
            ),
          transport,
          now: () => NOW,
        },
      );
      throw new Error('expected private redirect rejection');
    } catch (error: unknown) {
      const failure = error as AcquisitionFailure;
      expect(failure.code).toBe('REDIRECT_ORIGIN_NOT_ALLOWED');
      expect(failure.networkReceipts).toHaveLength(1);
    }
  });

  it('rejects a transport that connects anywhere except the pinned address', async () => {
    await expect(
      retrieveSource(
        { url: 'https://example.com/' },
        {
          resolveHost: () => Promise.resolve([PUBLIC]),
          transport: fixtureTransport((input) =>
            response(input, { connectedAddress: '8.8.8.8' }),
          ),
        },
      ),
    ).rejects.toMatchObject({ code: 'CONNECTED_ADDRESS_NOT_APPROVED' });
  });

  it('uses direct pinned transport and ignores ambient proxy variables', async () => {
    let observedHost = '';
    const server = createServer((request, outgoing) => {
      observedHost = request.headers.host ?? '';
      outgoing.writeHead(200, { 'content-type': 'text/plain' });
      outgoing.end('direct');
    });
    servers.push(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = (server.address() as AddressInfo).port;
    const before = process.env.HTTPS_PROXY;
    process.env.HTTPS_PROXY = 'http://127.0.0.1:1';
    try {
      const result = await new NodePinnedSourceTransport().request({
        url: new URL(`http://source.invalid:${String(port)}/evidence`),
        approvedAddress: '127.0.0.1',
        headers: { Host: 'attacker.invalid' },
        signal: new AbortController().signal,
        maximumResponseBytes: 100,
      });
      expect(new TextDecoder().decode(result.body)).toBe('direct');
      expect(result.connectedAddress).toBe('127.0.0.1');
      expect(observedHost).toBe(`source.invalid:${String(port)}`);
    } finally {
      if (before === undefined) delete process.env.HTTPS_PROXY;
      else process.env.HTTPS_PROXY = before;
    }
  });
});

describe('P9 bounded parser registry', () => {
  const registry = new BoundedParserRegistry();

  it('explicitly rejects PDF bytes instead of decoding them as UTF-8', () => {
    try {
      registry.parse(
        encoder.encode('%PDF-1.7\nmalformed or encrypted'),
        'application/pdf',
        {
          now: () => NOW,
          sourceUrl: 'https://example.com/paper.pdf',
        },
      );
      throw new Error('expected PDF rejection');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ParserPolicyError);
      const failure = error as ParserPolicyError;
      expect(failure.code).toBe('PARSER_UNSUPPORTED_PDF');
      expect(failure.decision).toMatchObject({
        status: 'unsupported',
        sniffedMediaType: 'application/pdf',
        reasonCode: 'pdf_explicitly_unsupported',
      });
      expect(failure.receipt).toBeNull();
    }
  });

  it('rejects binary or archive bytes mislabeled as text', () => {
    for (const bytes of [
      Uint8Array.from([0, 1, 2, 3]),
      Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 1, 2]),
      encoder.encode('%PDF-1.7\nobject'),
    ]) {
      expect(() =>
        registry.parse(bytes, 'text/plain', { now: () => NOW }),
      ).toThrow('PARSER_MEDIA_TYPE_CONFLICT');
    }
  });

  it('parses HTML-leading Markdown declared as plain text without treating it as HTML', () => {
    const markdown = [
      '<p align="center">',
      '  <img src="assets/colibri.svg" alt="Colibri">',
      '</p>',
      '',
      '**Tiny engine, immense model.**',
      'Colibri caches mmap-backed experts on Apple silicon.',
    ].join('\n');

    const parsed = registry.parse(encoder.encode(markdown), 'text/plain', {
      now: () => NOW,
      sourceUrl: 'https://raw.example.com/project/README.md',
    });

    expect(parsed.text).toBe(markdown);
    expect(parsed.mediaSupportDecision).toMatchObject({
      declaredMediaType: 'text/plain',
      sniffedMediaType: 'text/html',
      fileExtension: '.md',
      status: 'supported',
      reasonCode: 'registered_parser_selected',
    });
    expect(parsed.parserReceipt).toMatchObject({
      status: 'parsed',
      mediaType: 'text/plain',
    });
  });

  it('rejects the same plain-text and HTML mismatch for a non-Markdown URL', () => {
    expect(() =>
      registry.parse(
        encoder.encode('<p>generic mislabeled HTML</p>'),
        'text/plain',
        {
          now: () => NOW,
          sourceUrl: 'https://example.com/document.txt',
        },
      ),
    ).toThrow('PARSER_MEDIA_TYPE_CONFLICT');
  });

  it('preserves a typed parser failure receipt for malformed JSON', () => {
    try {
      registry.parse(encoder.encode('{not-json'), 'application/json', {
        now: () => NOW,
      });
      throw new Error('expected malformed JSON rejection');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ParserPolicyError);
      const failure = error as ParserPolicyError;
      expect(failure.code).toBe('PARSER_MALFORMED_INPUT');
      expect(failure.decision.status).toBe('supported');
      expect(failure.receipt).toMatchObject({
        status: 'failed',
        failureCode: 'parser_malformed_input',
      });
    }
  });

  it('emits digest-bound parser identity and finite resource limits', () => {
    const parsed = registry.parse(
      encoder.encode('{"answer":42}'),
      'application/json',
      {
        now: () => NOW,
      },
    );
    expect(parsed.text).toBe('{\n  "answer": 42\n}');
    expect(parsed.mediaSupportDecision).toMatchObject({ status: 'supported' });
    expect(parsed.parserReceipt).toMatchObject({
      status: 'parsed',
      mediaType: 'application/json',
      limits: {
        maximumInputBytes: 5 * 1024 * 1024,
        maximumOutputCharacters: 5_000_000,
        timeoutMs: 5_000,
        maximumMemoryBytes: 64 * 1024 * 1024,
        maximumProcesses: 1,
      },
    });
  });
});
