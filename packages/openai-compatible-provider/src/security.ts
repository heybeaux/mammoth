import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

export type ProviderNetworkMode = 'local' | 'governed';
export type HostResolver = (hostname: string) => Promise<readonly string[]>;

export interface DestinationPolicy {
  readonly mode: ProviderNetworkMode;
  readonly approvedOrigins: readonly string[];
}

const forbidden = new BlockList();
const publicIpv6 = new BlockList();
const allIpv4 = new BlockList();
const loopbackIpv4 = new BlockList();
publicIpv6.addSubnet('2000::', 3, 'ipv6');
allIpv4.addSubnet('0.0.0.0', 0, 'ipv4');
loopbackIpv4.addSubnet('127.0.0.0', 8, 'ipv4');
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
  ['2001::', 23],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
] as const) {
  forbidden.addSubnet(network, prefix, 'ipv6');
}

export const defaultHostResolver: HostResolver = async (hostname) => {
  if (isIP(hostname) !== 0) return [hostname];
  return (await lookup(hostname, { all: true, verbatim: true })).map(
    ({ address }) => address,
  );
};

export type ProviderAuthorizationErrorCode =
  | 'PROVIDER_SCHEME_NOT_ALLOWED'
  | 'PROVIDER_URL_CREDENTIALS_NOT_ALLOWED'
  | 'PROVIDER_ORIGIN_NOT_APPROVED'
  | 'PROVIDER_HOST_UNRESOLVED'
  | 'PROVIDER_RESOLVER_RETURNED_INVALID_ADDRESS'
  | 'PROVIDER_LOCAL_MODE_REQUIRES_LOOPBACK'
  | 'PROVIDER_ADDRESS_NOT_ALLOWED';

export class ProviderAuthorizationError extends Error {
  constructor(
    readonly code: ProviderAuthorizationErrorCode,
    readonly subject: string,
  ) {
    super(`${code}:${subject}`);
    this.name = 'ProviderAuthorizationError';
  }
}

export function isLoopbackAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return loopbackIpv4.check(address, 'ipv4');
  if (family === 6)
    return (
      address.toLowerCase() === '::1' || loopbackIpv4.check(address, 'ipv6')
    );
  return false;
}

export function isForbiddenProviderAddress(address: string): boolean {
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

export async function authorizeProviderDestination(
  url: URL,
  policy: DestinationPolicy,
  resolveHost: HostResolver,
): Promise<readonly string[]> {
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new ProviderAuthorizationError(
      'PROVIDER_SCHEME_NOT_ALLOWED',
      url.protocol,
    );
  }
  if (url.username || url.password) {
    throw new ProviderAuthorizationError(
      'PROVIDER_URL_CREDENTIALS_NOT_ALLOWED',
      url.origin,
    );
  }
  if (
    policy.mode === 'governed' &&
    !policy.approvedOrigins.includes(url.origin)
  ) {
    throw new ProviderAuthorizationError(
      'PROVIDER_ORIGIN_NOT_APPROVED',
      url.origin,
    );
  }
  let resolved: readonly string[];
  try {
    resolved = await resolveHost(url.hostname);
  } catch {
    throw new ProviderAuthorizationError(
      'PROVIDER_HOST_UNRESOLVED',
      url.hostname,
    );
  }
  const addresses = [...new Set(resolved)].sort();
  if (addresses.length === 0) {
    throw new ProviderAuthorizationError(
      'PROVIDER_HOST_UNRESOLVED',
      url.hostname,
    );
  }
  if (addresses.some((address) => isIP(address) === 0)) {
    throw new ProviderAuthorizationError(
      'PROVIDER_RESOLVER_RETURNED_INVALID_ADDRESS',
      url.hostname,
    );
  }
  if (policy.mode === 'local') {
    if (!addresses.every(isLoopbackAddress)) {
      throw new ProviderAuthorizationError(
        'PROVIDER_LOCAL_MODE_REQUIRES_LOOPBACK',
        url.hostname,
      );
    }
  } else if (addresses.some(isForbiddenProviderAddress)) {
    throw new ProviderAuthorizationError(
      'PROVIDER_ADDRESS_NOT_ALLOWED',
      url.hostname,
    );
  }
  return addresses;
}
