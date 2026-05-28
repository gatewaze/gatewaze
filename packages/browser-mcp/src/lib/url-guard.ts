import { lookup } from 'node:dns/promises';
import net from 'node:net';

/**
 * SSRF guard for the browser MCP. The browser can navigate anywhere the
 * worker can reach, so every navigation target is validated first:
 *   - scheme must be http/https
 *   - host must not resolve to loopback, private, link-local, or
 *     cloud-metadata addresses
 *
 * DNS is resolved before allowing navigation so a public hostname that
 * points at an internal address (DNS-rebinding) is also rejected.
 */

export class BlockedUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlockedUrlError';
  }
}

function isPrivateV4(ip: string): boolean {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true; // fail closed
  const [a, b] = p;
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 169 && b === 254) return true; // link-local + 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a >= 224) return true; // multicast / reserved
  return false;
}

function isPrivateV6(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v === '::1' || v === '::') return true; // loopback / unspecified
  if (v.startsWith('fc') || v.startsWith('fd')) return true; // unique-local fc00::/7
  if (v.startsWith('fe80')) return true; // link-local
  // IPv4-mapped (::ffff:a.b.c.d) — validate the embedded v4
  const mapped = v.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateV4(mapped[1]);
  return false;
}

function isBlockedAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateV4(ip);
  if (net.isIPv6(ip)) return isPrivateV6(ip);
  return true; // not a recognisable IP — fail closed
}

/**
 * Validate a navigation URL. Throws BlockedUrlError if the target is
 * disallowed. Returns the normalised URL string when allowed.
 */
export async function assertNavigable(rawUrl: string): Promise<string> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BlockedUrlError(`Not a valid URL: ${rawUrl}`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BlockedUrlError(`Disallowed scheme '${url.protocol}'. Only http/https are permitted.`);
  }

  const host = url.hostname;

  // Block obvious local hostnames before resolving.
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) {
    throw new BlockedUrlError(`Disallowed host '${host}'.`);
  }

  // If the host is a literal IP, check it directly.
  if (net.isIP(host)) {
    if (isBlockedAddress(host)) {
      throw new BlockedUrlError(`Disallowed address '${host}' (loopback/private/link-local).`);
    }
    return url.toString();
  }

  // Otherwise resolve DNS and reject if ANY resolved address is private.
  let records: { address: string }[];
  try {
    records = await lookup(host, { all: true });
  } catch {
    throw new BlockedUrlError(`Could not resolve host '${host}'.`);
  }
  if (records.length === 0) {
    throw new BlockedUrlError(`Host '${host}' resolved to no addresses.`);
  }
  for (const { address } of records) {
    if (isBlockedAddress(address)) {
      throw new BlockedUrlError(
        `Host '${host}' resolves to a disallowed address (${address}).`,
      );
    }
  }

  return url.toString();
}
