import { isIP } from 'node:net';

const PRIVATE_V4 = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^0\./,
];

export function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4)
    return PRIVATE_V4.some((range) => range.test(address));
  if (isIP(address) === 6) {
    const normalized = address.toLowerCase();
    return (
      normalized === '::' ||
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      /^fe[89ab]/.test(normalized) ||
      normalized.startsWith('::ffff:127.') ||
      normalized.startsWith('::ffff:10.') ||
      normalized.startsWith('::ffff:192.168.')
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
