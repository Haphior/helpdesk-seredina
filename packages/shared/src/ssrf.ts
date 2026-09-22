// Blocks the realistic outbound SSRF threat: a tenant pointing a URL we fetch
// server-side (an outbound webhook, a bring-your-own AI base URL) at our own
// internal network or a cloud metadata endpoint (169.254.169.254 is the
// AWS/GCP/Azure metadata IP -- the single most common real-world SSRF target).
//
// Covers every address the hostname resolves to (not just the first), IPv6
// forms that embed an IPv4 address (::ffff:127.0.0.1, NAT64, 6to4), and
// redirects (ssrfSafeFetch never follows one -- a public server answering
// `307 Location: http://169.254.169.254/` would otherwise walk straight past
// the check). Still NOT DNS-rebinding-proof: fetch() re-resolves the hostname
// itself, so a resolver that answers public-then-private between our lookup
// and the connection wins. See docs/adr/0009-outbound-webhooks.md.
import { lookup } from 'node:dns/promises';
import { isIPv4, isIPv6 } from 'node:net';

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)) return null;
  const [a, b, c, d] = parts.map(Number);
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

// [network, prefixLength][] -- everything that isn't ordinary public unicast.
const BLOCKED_V4_RANGES: [string, number][] = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // RFC1918
  ['100.64.0.0', 10], // carrier-grade NAT (also some cloud-internal ranges)
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local / cloud metadata
  ['172.16.0.0', 12], // RFC1918
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // TEST-NET-1
  ['192.168.0.0', 16], // RFC1918
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, incl. 255.255.255.255 broadcast
];

function isBlockedV4Int(target: number): boolean {
  return BLOCKED_V4_RANGES.some(([network, prefixLength]) => {
    const mask = (~0 << (32 - prefixLength)) >>> 0;
    return (target & mask) === ((ipv4ToInt(network) as number) & mask);
  });
}

/** Expands any valid IPv6 text form (incl. `::` and an embedded dotted quad) to its 8 16-bit groups. */
function ipv6ToGroups(ip: string): number[] | null {
  let text = ip.split('%')[0]; // drop a zone id (fe80::1%eth0)
  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = ipv4ToInt(tail);
    if (v4 === null) return null;
    text = `${text.slice(0, lastColon + 1)}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }

  const halves = text.split('::');
  if (halves.length > 2) return null;
  const parse = (part: string) => (part === '' ? [] : part.split(':').map((g) => parseInt(g, 16)));
  const head = parse(halves[0]);
  const rest = halves.length === 2 ? parse(halves[1]) : [];
  const zeros = halves.length === 2 ? 8 - head.length - rest.length : 0;
  const groups = [...head, ...new Array(Math.max(zeros, 0)).fill(0), ...rest];
  if (groups.length !== 8 || groups.some((g) => Number.isNaN(g) || g < 0 || g > 0xffff)) return null;
  return groups;
}

function isBlockedV6(ip: string): boolean {
  const g = ipv6ToGroups(ip);
  if (!g) return true; // unparseable -- fail closed
  const embeddedV4 = (hi: number, lo: number) => ((hi << 16) | lo) >>> 0;

  const first5Zero = g.slice(0, 5).every((x) => x === 0);
  // ::ffff:a.b.c.d (IPv4-mapped) -- the classic way to smuggle 127.0.0.1 past a v6-only check.
  if (first5Zero && g[5] === 0xffff) return isBlockedV4Int(embeddedV4(g[6], g[7]));
  // ::a.b.c.d (deprecated IPv4-compatible), which also covers :: and ::1.
  if (first5Zero && g[5] === 0) return true;
  // 64:ff9b::/96 NAT64 -- reaches whatever IPv4 address it embeds.
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
    return isBlockedV4Int(embeddedV4(g[6], g[7]));
  }
  // 2002::/16 6to4 -- embeds an IPv4 address in groups 1-2.
  if (g[0] === 0x2002) return isBlockedV4Int(embeddedV4(g[1], g[2]));

  return (
    (g[0] & 0xfe00) === 0xfc00 || // fc00::/7 unique-local
    (g[0] & 0xffc0) === 0xfe80 || // fe80::/10 link-local
    (g[0] & 0xffc0) === 0xfec0 || // fec0::/10 deprecated site-local
    (g[0] & 0xff00) === 0xff00 || // ff00::/8 multicast
    (g[0] === 0x2001 && g[1] === 0x0db8) // 2001:db8::/32 documentation
  );
}

export function isPrivateOrReservedIp(ip: string, family: 4 | 6): boolean {
  if (family === 4) {
    const target = ipv4ToInt(ip);
    return target === null ? true : isBlockedV4Int(target);
  }
  return isBlockedV6(ip);
}

/**
 * Throws unless every address `url`'s host resolves to is public. An IP
 * literal host is checked directly, without a DNS lookup.
 */
export async function assertPublicUrl(url: string | URL): Promise<void> {
  const parsed = typeof url === 'string' ? new URL(url) : url;
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`refusing to fetch a non-http(s) URL: ${parsed.protocol}`);
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '');

  const addresses = isIPv4(host)
    ? [{ address: host, family: 4 }]
    : isIPv6(host)
      ? [{ address: host, family: 6 }]
      : await lookup(host, { all: true });

  if (addresses.length === 0) throw new Error(`could not resolve ${host}`);
  for (const { address, family } of addresses) {
    if (isPrivateOrReservedIp(address, family as 4 | 6)) {
      throw new Error(`refusing to connect to a private/reserved address: ${address}`);
    }
  }
}

/**
 * fetch() for URLs a tenant controls: checks the destination with
 * assertPublicUrl first, and never follows a redirect (a 3xx comes back as-is,
 * so callers checking `response.ok` treat it as a failure).
 */
export const ssrfSafeFetch: typeof fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : input;
  await assertPublicUrl(url);
  return fetch(input, { ...init, redirect: 'manual' });
};
