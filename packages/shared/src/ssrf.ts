// Blocks the realistic outbound-webhook SSRF threat: a tenant pointing a webhook
// URL at their own internal network or a cloud metadata endpoint (169.254.169.254
// is the AWS/GCP/Azure metadata IP -- the single most common real-world SSRF
// target). NOT exhaustive and NOT DNS-rebinding-proof: a hostname could resolve to
// a public IP at check time and a private one at actual connection time. Good
// enough as a first real barrier, not a formal guarantee -- see
// docs/adr/0009-outbound-webhooks.md for the honest scope of what this does and
// doesn't cover.

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

// [network, prefixLength][] -- loopback, RFC1918 private ranges, link-local/cloud
// metadata (169.254/16), and the "this network" block (0.0.0.0/8).
const PRIVATE_V4_RANGES: [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
];

function isPrivateV4(ip: string): boolean {
  const target = ipv4ToInt(ip);
  if (target === null) return false;
  return PRIVATE_V4_RANGES.some(([network, prefixLength]) => {
    const networkInt = ipv4ToInt(network);
    if (networkInt === null) return false;
    const mask = prefixLength === 0 ? 0 : (~0 << (32 - prefixLength)) >>> 0;
    return (target & mask) === (networkInt & mask);
  });
}

/** Loopback (::1), unique-local (fc00::/7), and link-local (fe80::/10) -- string-
 * prefix checks, not full CIDR math, since IPv6 addresses have multiple equivalent
 * textual forms; catches the common normalized forms Node's dns.lookup returns. */
function isPrivateV6(ip: string): boolean {
  const lower = ip.toLowerCase();
  return lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80');
}

export function isPrivateOrReservedIp(ip: string, family: 4 | 6): boolean {
  return family === 4 ? isPrivateV4(ip) : isPrivateV6(ip);
}
