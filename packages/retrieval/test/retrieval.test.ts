import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FileContentStore,
  contentDigest,
  isPrivateAddress,
  parseSource,
  retrieveSource,
  snapshotSource,
  type SourceTransport,
} from '../src/index.js';

const encoder = new TextEncoder();
const publicResolver = () => Promise.resolve(['93.184.216.34']);

function response(
  body: string,
  options: { status?: number; headers?: Record<string, string> } = {},
): Awaited<ReturnType<SourceTransport>> {
  const bytes = encoder.encode(body);
  return {
    status: options.status ?? 200,
    headers: new Headers({ 'content-type': 'text/plain', ...options.headers }),
    body: new ReadableStream({
      start: (controller) => {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
  };
}

describe('source retrieval', () => {
  it('denies private IPv4 destinations encoded as IPv6-mapped addresses', () => {
    expect(isPrivateAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateAddress('::ffff:172.16.0.1')).toBe(true);
    expect(isPrivateAddress('::ffff:7f00:1')).toBe(true);
    expect(isPrivateAddress('::ffff:ac10:1')).toBe(true);
    expect(isPrivateAddress('::ffff:5db8:d822')).toBe(false);
  });

  it('records redirects and final response metadata', async () => {
    const transport: SourceTransport = (url) =>
      Promise.resolve(
        url.pathname === '/old'
          ? response('', { status: 302, headers: { location: '/new' } })
          : response('ground truth', { headers: { 'x-source': 'fixture' } }),
      );
    const result = await retrieveSource(
      { url: 'https://example.com/old' },
      {
        transport,
        resolveHost: publicResolver,
        now: () => new Date('2026-07-10T00:00:00Z'),
      },
    );
    expect(result).toMatchObject({
      finalUrl: 'https://example.com/new',
      redirectChain: ['https://example.com/old'],
      mediaType: 'text/plain',
      retrievedAt: '2026-07-10T00:00:00.000Z',
    });
    expect(new TextDecoder().decode(result.bytes)).toBe('ground truth');
  });

  it('denies private destinations before transport runs', async () => {
    let called = false;
    await expect(
      retrieveSource(
        { url: 'https://internal.example/secret' },
        {
          resolveHost: () => Promise.resolve(['127.0.0.1']),
          transport: () => {
            called = true;
            return Promise.resolve(response('no'));
          },
        },
      ),
    ).rejects.toThrow('PRIVATE_ADDRESS_NOT_ALLOWED');
    expect(called).toBe(false);
  });

  it('enforces actual streamed size when content-length is absent', async () => {
    await expect(
      retrieveSource(
        { url: 'https://example.com/large' },
        {
          resolveHost: publicResolver,
          transport: () => Promise.resolve(response('12345')),
          policy: { maxBytes: 4 },
        },
      ),
    ).rejects.toThrow('RESPONSE_TOO_LARGE:4');
  });

  it('rejects non-success responses instead of snapshotting error pages', async () => {
    await expect(
      retrieveSource(
        { url: 'https://example.com/missing' },
        {
          resolveHost: publicResolver,
          transport: () =>
            Promise.resolve(response('not found', { status: 404 })),
        },
      ),
    ).rejects.toThrow('SOURCE_HTTP_ERROR:404');
  });

  it('revalidates each redirect destination against SSRF policy', async () => {
    await expect(
      retrieveSource(
        { url: 'https://example.com/start' },
        {
          resolveHost: (host) =>
            Promise.resolve(
              host === 'example.com' ? ['93.184.216.34'] : ['10.0.0.2'],
            ),
          transport: () =>
            Promise.resolve(
              response('', {
                status: 302,
                headers: { location: 'https://private.example/end' },
              }),
            ),
        },
      ),
    ).rejects.toThrow('PRIVATE_ADDRESS_NOT_ALLOWED:private.example');
  });
});

describe('parsing and immutable snapshots', () => {
  it('extracts deterministic readable HTML and excludes executable content', () => {
    const parsed = parseSource(
      encoder.encode(
        '<h1>Title &amp; facts</h1><script>ignore()</script><p>Answer: 42</p>',
      ),
      'text/html',
    );
    expect(parsed.text).toBe('Title & facts\nAnswer: 42');
    expect(parsed).toMatchObject({
      parserId: 'mammoth-deterministic-text',
      parserVersion: '1.0.0',
    });
  });

  it('deduplicates identical bytes and detects corruption on read', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mammoth-cas-'));
    const store = new FileContentStore(root);
    const first = await store.put(encoder.encode('immutable'));
    const second = await store.put(encoder.encode('immutable'));
    expect(second).toEqual(first);
    expect(new TextDecoder().decode(await store.get(first.digest))).toBe(
      'immutable',
    );
    if (!first.path) throw new Error('expected local artifact path');
    await chmod(first.path, 0o640);
    await writeFile(first.path, 'tampered');
    await expect(store.get(first.digest)).rejects.toThrow(
      'CAS_INTEGRITY_FAILURE',
    );
  });

  it('creates raw and parsed content-addressed artifacts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mammoth-snapshot-'));
    const snapshot = await snapshotSource(
      { url: 'https://example.com/fact' },
      new FileContentStore(root),
      {
        resolveHost: publicResolver,
        transport: () =>
          Promise.resolve(
            response('<p>A fact</p>', {
              headers: { 'content-type': 'text/html; charset=utf-8' },
            }),
          ),
      },
    );
    expect(snapshot.contentDigest).toBe(
      contentDigest(encoder.encode('<p>A fact</p>')),
    );
    expect(snapshot.parsedArtifact.text).toBe('A fact');
    if (!snapshot.contentObject.path || !snapshot.parsedObject.path) {
      throw new Error('expected local artifact paths');
    }
    expect(await readFile(snapshot.contentObject.path, 'utf8')).toBe(
      '<p>A fact</p>',
    );
    expect(await readFile(snapshot.parsedObject.path, 'utf8')).toBe('A fact');
  });
});
