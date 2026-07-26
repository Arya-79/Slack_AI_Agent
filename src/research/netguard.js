/**
 * Guard for outbound requests to hostnames derived from untrusted input.
 *
 * The company-research step fetches `https://www.<domain>` where `<domain>`
 * comes from a joining member's email address. Without a guard that is a
 * server-side request forgery (SSRF) primitive: a crafted address could point
 * the server at `localhost`, cloud metadata endpoints (169.254.169.254), or
 * other hosts on the internal network.
 *
 * We therefore (1) sanity-check the hostname shape, and (2) resolve it and
 * refuse to connect if any resolved address is loopback, link-local, private,
 * or otherwise reserved.
 */

import dns from 'node:dns/promises';
import net from 'node:net';

const HOSTNAME_RE = /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?:\.(?!-)[a-z0-9-]{1,63})+$/i;

/** True for addresses that must never be reachable from user-supplied input. */
export function isPrivateOrReservedIp(ip) {
  const type = net.isIP(ip);
  if (type === 4) {
    const p = ip.split('.').map(Number);
    if (p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
    const [a, b] = p;
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // loopback
    if (a === 0) return true; // "this" network
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 169 && b === 254) return true; // link-local incl. cloud metadata
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    if (a >= 224) return true; // multicast + reserved
    return false;
  }
  if (type === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true; // loopback / unspecified
    if (lower.startsWith('fe80')) return true; // link-local
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique-local
    if (lower.startsWith('::ffff:')) {
      // IPv4-mapped IPv6 — evaluate the embedded v4 address.
      return isPrivateOrReservedIp(lower.replace('::ffff:', ''));
    }
    return false;
  }
  // Not an IP literal at all.
  return true;
}

/** Cheap structural check before we spend a DNS lookup. */
export function isPlausiblePublicHostname(hostname) {
  if (!hostname || typeof hostname !== 'string') return false;
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return false;
  if (net.isIP(h)) return false; // reject raw IPs — must be a real domain
  return HOSTNAME_RE.test(h);
}

/**
 * Resolve `hostname` and throw unless every address is a public one.
 * Returns the list of safe addresses on success.
 */
export async function assertSafePublicHost(hostname, { resolver = dns } = {}) {
  if (!isPlausiblePublicHostname(hostname)) {
    throw new Error(`refusing to fetch non-public hostname: ${hostname}`);
  }
  const records = await resolver.lookup(hostname, { all: true });
  if (!records.length) throw new Error(`no DNS records for ${hostname}`);
  for (const { address } of records) {
    if (isPrivateOrReservedIp(address)) {
      throw new Error(`hostname ${hostname} resolves to a private address (${address})`);
    }
  }
  return records.map((r) => r.address);
}
