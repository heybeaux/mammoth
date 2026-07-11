import { isIP } from 'node:net';

const PRIVATE_V4 = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^0\./,
];

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

export function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4)
    return PRIVATE_V4.some((range) => range.test(address));
  if (isIP(address) === 6) {
    const normalized = address.toLowerCase();
    const mapped = mappedIpv4(normalized);
    return (
      normalized === '::' ||
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      /^fe[89ab]/.test(normalized) ||
      (mapped !== undefined && isPrivateAddress(mapped))
    );
  }
  return true;
}

export async function assertSafeUrl(
  url: URL,
  schemes: readonly string[],
  allowPrivateNetwork: boolean,
  resolveHost: (hostname: string) => Promise<readonly string[]>,
): Promise<void> {
  if (!schemes.includes(url.protocol)) {
    throw new Error(`SCHEME_NOT_ALLOWED:${url.protocol}`);
  }
  if (url.username || url.password)
    throw new Error('URL_CREDENTIALS_NOT_ALLOWED');
  const addresses = await resolveHost(url.hostname);
  if (addresses.length === 0)
    throw new Error(`HOST_UNRESOLVED:${url.hostname}`);
  if (!allowPrivateNetwork && addresses.some(isPrivateAddress)) {
    throw new Error(`PRIVATE_ADDRESS_NOT_ALLOWED:${url.hostname}`);
  }
}
