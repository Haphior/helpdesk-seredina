// A v1 safety cap, not a protocol limit -- refuses to enumerate anything larger than
// a /22 (1024 addresses) so a single discovery job can't accidentally turn into an
// hours-long scan or hammer a network the operator didn't mean to sweep that broadly.
const MAX_HOSTS = 1024;

function ipToInt(ip: string): number {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    throw new Error(`invalid IPv4 address: ${ip}`);
  }
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function intToIp(int: number): string {
  return [24, 16, 8, 0].map((shift) => (int >>> shift) & 255).join('.');
}

export interface ParsedCidr {
  network: string;
  prefixLength: number;
  hostCount: number;
}

export function parseCidr(cidr: string): ParsedCidr {
  const match = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\/(\d{1,2})$/.exec(cidr.trim());
  if (!match) throw new Error(`invalid CIDR notation: ${cidr}`);
  const [, network, prefixStr] = match;
  const prefixLength = Number(prefixStr);
  if (prefixLength < 0 || prefixLength > 32) throw new Error(`invalid CIDR prefix length: ${prefixLength}`);

  ipToInt(network); // validates octet ranges, throws on garbage

  const hostCount = 2 ** (32 - prefixLength);
  if (hostCount > MAX_HOSTS) {
    throw new Error(`CIDR range too large (${hostCount} addresses) -- max ${MAX_HOSTS} per scan`);
  }

  return { network, prefixLength, hostCount };
}

/** Every address in the range, network/broadcast included -- callers just skip the ones that don't answer. */
export function enumerateCidr(cidr: string): string[] {
  const { network, prefixLength, hostCount } = parseCidr(cidr);
  const mask = prefixLength === 0 ? 0 : (~0 << (32 - prefixLength)) >>> 0;
  const base = ipToInt(network) & mask;

  const ips: string[] = [];
  for (let i = 0; i < hostCount; i++) {
    ips.push(intToIp((base + i) >>> 0));
  }
  return ips;
}
