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
publicIpv6.addSubnet('2000::', 3, 'ipv6');
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

export function isLoopbackAddress(address: string): boolean {
  const mapped = mappedIpv4(address);
  if (mapped) return isLoopbackAddress(mapped);
  if (isIP(address) === 4) return address.startsWith('127.');
  return isIP(address) === 6 && address.toLowerCase() === '::1';
}

export function isForbiddenProviderAddress(address: string): boolean {
  const mapped = mappedIpv4(address);
  if (mapped) return isForbiddenProviderAddress(mapped);
  const family = isIP(address);
  if (family === 4) return forbidden.check(address, 'ipv4');
  if (family === 6)
    return (
      !publicIpv6.check(address, 'ipv6') || forbidden.check(address, 'ipv6')
    );
  return true;
}

export async function authorizeProviderDestination(
  url: URL,
  policy: DestinationPolicy,
  resolveHost: HostResolver,
): Promise<readonly string[]> {
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`PROVIDER_SCHEME_NOT_ALLOWED:${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new Error('PROVIDER_URL_CREDENTIALS_NOT_ALLOWED');
  }
  if (
    policy.mode === 'governed' &&
    !policy.approvedOrigins.includes(url.origin)
  ) {
    throw new Error(`PROVIDER_ORIGIN_NOT_APPROVED:${url.origin}`);
  }
  const addresses = [...new Set(await resolveHost(url.hostname))].sort();
  if (addresses.length === 0) {
    throw new Error(`PROVIDER_HOST_UNRESOLVED:${url.hostname}`);
  }
  if (addresses.some((address) => isIP(address) === 0)) {
    throw new Error(
      `PROVIDER_RESOLVER_RETURNED_INVALID_ADDRESS:${url.hostname}`,
    );
  }
  if (policy.mode === 'local') {
    if (!addresses.every(isLoopbackAddress)) {
      throw new Error(`PROVIDER_LOCAL_MODE_REQUIRES_LOOPBACK:${url.hostname}`);
    }
  } else if (addresses.some(isForbiddenProviderAddress)) {
    throw new Error(`PROVIDER_ADDRESS_NOT_ALLOWED:${url.hostname}`);
  }
  return addresses;
}

function mappedIpv4(address: string): string | undefined {
  const normalized = address.toLowerCase();
  if (!normalized.startsWith('::ffff:')) return undefined;
  const suffix = normalized.slice('::ffff:'.length);
  if (isIP(suffix) === 4) return suffix;
  const words = suffix.split(':');
  if (words.length !== 2) return undefined;
  const high = Number.parseInt(words[0] ?? '', 16);
  const low = Number.parseInt(words[1] ?? '', 16);
  if (
    !Number.isInteger(high) ||
    !Number.isInteger(low) ||
    high < 0 ||
    high > 0xffff ||
    low < 0 ||
    low > 0xffff
  )
    return undefined;
  return `${String(high >>> 8)}.${String(high & 0xff)}.${String(low >>> 8)}.${String(low & 0xff)}`;
}
