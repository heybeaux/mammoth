import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { NodePinnedHttpTransport, PinnedTransportError } from '../src/index.js';

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

describe('node pinned HTTP transport', () => {
  it('connects to the approved IP while preserving the requested Host header', async () => {
    let observedHost = '';
    let observedBody = '';
    const server = createServer((request, response) => {
      observedHost = request.headers.host ?? '';
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => {
        observedBody += chunk;
      });
      request.on('end', () => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('{"ok":true}');
      });
    });
    servers.push(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = (server.address() as AddressInfo).port;
    const transport = new NodePinnedHttpTransport();
    const response = await transport.request({
      url: new URL(
        `http://provider.invalid:${String(port)}/v1/chat/completions`,
      ),
      approvedAddress: '127.0.0.1',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Host: 'attacker.invalid',
      },
      body: new TextEncoder().encode('{"test":true}'),
      signal: new AbortController().signal,
      maximumResponseBytes: 1024,
    });
    expect(response.status).toBe(200);
    expect(new TextDecoder().decode(response.body)).toBe('{"ok":true}');
    expect(observedHost).toBe(`provider.invalid:${String(port)}`);
    expect(observedBody).toBe('{"test":true}');
  });

  it('fails after acceptance when the actual response exceeds its byte limit', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('123456');
    });
    servers.push(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = (server.address() as AddressInfo).port;
    const transport = new NodePinnedHttpTransport();
    try {
      await transport.request({
        url: new URL(`http://provider.invalid:${String(port)}/large`),
        approvedAddress: '127.0.0.1',
        method: 'GET',
        headers: {},
        signal: new AbortController().signal,
        maximumResponseBytes: 4,
      });
      throw new Error('expected response-size rejection');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(PinnedTransportError);
      expect((error as PinnedTransportError).requestAccepted).toBe(true);
    }
  });
});
