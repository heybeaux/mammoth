import { describe, expect, it } from 'vitest';
import {
  authorizeProviderDestination,
  isForbiddenProviderAddress,
  isLoopbackAddress,
} from '../src/index.js';

describe('provider destination policy', () => {
  it('recognizes loopback including IPv4-mapped IPv6', () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('::1')).toBe(true);
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('0:0:0:0:0:ffff:7f00:1')).toBe(true);
    expect(isLoopbackAddress('10.0.0.1')).toBe(false);
  });

  it.each([
    '0.0.0.0',
    '10.0.0.1',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '192.168.0.1',
    '192.88.99.1',
    '198.18.0.1',
    '224.0.0.1',
    '::',
    '::1',
    'fc00::1',
    'fe80::1',
    'ff00::1',
    '100::1',
    '2001:2::1',
    '2002:a00:1::1',
    '3fff::1',
    '5f00::1',
    '::ffff:169.254.169.254',
  ])('blocks non-public address %s in governed mode', (address) => {
    expect(isForbiddenProviderAddress(address)).toBe(true);
  });

  it.each(['2001:4860:4860::8888', '2606:4700:4700::1111'])(
    'permits ordinary global-unicast address %s in governed mode',
    (address) => {
      expect(isForbiddenProviderAddress(address)).toBe(false);
    },
  );

  it('permits only all-loopback DNS answers in local mode', async () => {
    await expect(
      authorizeProviderDestination(
        new URL('http://ollama.local:11434/api/tags'),
        { mode: 'local', approvedOrigins: [] },
        () => Promise.resolve(['::1', '127.0.0.1']),
      ),
    ).resolves.toEqual(['127.0.0.1', '::1']);
    await expect(
      authorizeProviderDestination(
        new URL('http://ollama.local:11434/api/tags'),
        { mode: 'local', approvedOrigins: [] },
        () => Promise.resolve(['127.0.0.1', '93.184.216.34']),
      ),
    ).rejects.toThrow('PROVIDER_LOCAL_MODE_REQUIRES_LOOPBACK');
  });

  it('fails closed on private, mixed, unapproved, credentialed, and unsupported destinations', async () => {
    const governed = {
      mode: 'governed' as const,
      approvedOrigins: ['https://provider.example'],
    };
    await expect(
      authorizeProviderDestination(
        new URL('https://provider.example/v1/models'),
        governed,
        () => Promise.resolve(['93.184.216.34', '10.0.0.1']),
      ),
    ).rejects.toThrow('PROVIDER_ADDRESS_NOT_ALLOWED');
    await expect(
      authorizeProviderDestination(
        new URL('https://other.example/v1/models'),
        governed,
        () => Promise.resolve(['93.184.216.34']),
      ),
    ).rejects.toThrow('PROVIDER_ORIGIN_NOT_APPROVED');
    await expect(
      authorizeProviderDestination(
        new URL('https://user:pass@provider.example/v1/models'),
        governed,
        () => Promise.resolve(['93.184.216.34']),
      ),
    ).rejects.toThrow('PROVIDER_URL_CREDENTIALS_NOT_ALLOWED');
    await expect(
      authorizeProviderDestination(
        new URL('file:///tmp/provider'),
        governed,
        () => Promise.resolve(['93.184.216.34']),
      ),
    ).rejects.toThrow('PROVIDER_SCHEME_NOT_ALLOWED');
    await expect(
      authorizeProviderDestination(
        new URL('https://provider.example/v1/models'),
        governed,
        () => Promise.resolve([]),
      ),
    ).rejects.toThrow('PROVIDER_HOST_UNRESOLVED');
    await expect(
      authorizeProviderDestination(
        new URL('https://provider.example/v1/models'),
        governed,
        () => Promise.resolve(['not-an-ip']),
      ),
    ).rejects.toThrow('PROVIDER_RESOLVER_RETURNED_INVALID_ADDRESS');
  });
});
