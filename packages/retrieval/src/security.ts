import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import type { HostResolver, RetrievalPolicy } from './types.js';

const forbidden = new BlockList();
const publicIpv6 = new BlockList();
const allIpv4 = new BlockList();

publicIpv6.addSubnet('2000::', 3, 'ipv6');
allIpv4.addSubnet('0.0.0.0', 0, 'ipv4');

for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  forbidden.addSubnet(network, prefix, 'ipv4');
}

for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  forbidden.addSubnet(network, prefix, 'ipv6');
}

export type AcquisitionPolicyErrorCode =
  | 'SCHEME_NOT_ALLOWED'
  | 'URL_CREDENTIALS_NOT_ALLOWED'
  | 'PORT_NOT_ALLOWED'
  | 'HOST_UNRESOLVED'
  | 'RESOLVER_RETURNED_INVALID_ADDRESS'
  | 'ADDRESS_NOT_ALLOWED'
  | 'MIXED_ADDRESS_SET_NOT_ALLOWED'
  | 'DNS_ANSWER_CHANGED'
  | 'CONNECTED_ADDRESS_NOT_APPROVED'
  | 'REDIRECT_ORIGIN_NOT_ALLOWED';

export class AcquisitionPolicyError extends Error {
  constructor(
    readonly code: AcquisitionPolicyErrorCode,
    readonly subject: string,
  ) {
    super(`${code}:${subject}`);
    this.name = 'AcquisitionPolicyError';
  }
}

export const defaultHostResolver: HostResolver = async (hostname) => {
  if (isIP(hostname) !== 0) return [hostname];
  return (await lookup(hostname, { all: true, verbatim: true })).map(
    ({ address }) => address,
  );
};

export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return forbidden.check(address, 'ipv4');
  if (family === 6) {
    if (allIpv4.check(address, 'ipv6')) {
      return forbidden.check(address, 'ipv6');
    }
    return (
      !publicIpv6.check(address, 'ipv6') || forbidden.check(address, 'ipv6')
    );
  }
  return true;
}

export function canonicalizeAcquisitionUrl(input: string | URL): URL {
  const url = new URL(typeof input === 'string' ? input : input.href);
  if (url.username || url.password) {
    throw new AcquisitionPolicyError('URL_CREDENTIALS_NOT_ALLOWED', url.origin);
  }
  const hostname = url.hostname.replace(/\.+$/u, '');
  if (!hostname) {
    throw new AcquisitionPolicyError('HOST_UNRESOLVED', url.hostname);
  }
  url.hostname = hostname;
  url.hash = '';
  return url;
}

function effectivePort(url: URL): number {
  if (url.port) return Number(url.port);
  return url.protocol === 'https:' ? 443 : 80;
}

function resolutionHostname(url: URL): string {
  return url.hostname.replace(/^\[|\]$/gu, '');
}

/** Validates a hop and returns the complete, sorted address set to pin. */
export async function authorizeAcquisitionHop(
  input: string | URL,
  policy: RetrievalPolicy,
  resolveHost: HostResolver,
): Promise<{ readonly url: URL; readonly addresses: readonly string[] }> {
  const url = canonicalizeAcquisitionUrl(input);
  if (!policy.allowedSchemes.includes(url.protocol)) {
    throw new AcquisitionPolicyError('SCHEME_NOT_ALLOWED', url.protocol);
  }
  const port = effectivePort(url);
  if (!policy.allowedPorts.includes(port)) {
    throw new AcquisitionPolicyError('PORT_NOT_ALLOWED', String(port));
  }

  const hostname = resolutionHostname(url);
  let resolved: readonly string[];
  try {
    resolved = await resolveHost(hostname);
  } catch {
    throw new AcquisitionPolicyError('HOST_UNRESOLVED', hostname);
  }
  const addresses = [
    ...new Set(resolved.map((address) => address.toLowerCase())),
  ].sort();
  if (addresses.length === 0) {
    throw new AcquisitionPolicyError('HOST_UNRESOLVED', hostname);
  }
  if (addresses.some((address) => isIP(address) === 0)) {
    throw new AcquisitionPolicyError(
      'RESOLVER_RETURNED_INVALID_ADDRESS',
      hostname,
    );
  }
  const forbiddenCount = addresses.filter(isPrivateAddress).length;
  if (forbiddenCount > 0 && forbiddenCount < addresses.length) {
    throw new AcquisitionPolicyError('MIXED_ADDRESS_SET_NOT_ALLOWED', hostname);
  }
  if (forbiddenCount > 0) {
    throw new AcquisitionPolicyError('ADDRESS_NOT_ALLOWED', hostname);
  }
  return { url, addresses };
}

/** Compatibility wrapper retained for callers that only need a preflight check. */
export async function assertSafeUrl(
  url: URL,
  schemes: readonly string[],
  _allowPrivateNetwork: boolean,
  resolveHost: HostResolver,
): Promise<void> {
  await authorizeAcquisitionHop(
    url,
    {
      allowedSchemes: schemes,
      allowedMediaTypes: ['text/plain'],
      allowedPorts: [80, 443],
      maxBytes: 1,
      maxRedirects: 0,
      timeoutMs: 1,
    },
    resolveHost,
  );
}

export function assertPermittedUrl(url: URL, schemes: readonly string[]): void {
  canonicalizeAcquisitionUrl(url);
  if (!schemes.includes(url.protocol)) {
    throw new AcquisitionPolicyError('SCHEME_NOT_ALLOWED', url.protocol);
  }
}
