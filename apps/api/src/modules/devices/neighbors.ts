import type { Prisma } from '@seredina/db';

/**
 * Passive discovery (docs/adr/0055-agent-based-discovery.md): an enrolled
 * agent reports its own ARP/neighbor table -- the devices its machine has
 * recently talked to on the local network -- and those become CMDB records.
 * Nothing is scanned; the server never opens a connection anywhere.
 *
 * Identity is the MAC address, not the IP: that's what fixes the DHCP churn
 * problem docs/adr/0002-agentless-discovery.md disclosed (a lease change used
 * to mean a brand-new Asset row).
 *
 * The reporting device's credential is the only thing vouching for this data,
 * so it is treated as low-trust: it may create AGENT_NEIGHBOR records and
 * refresh records that discovery itself owns (AGENT_NEIGHBOR, AGENTLESS_SCAN),
 * but it never edits an operator's MANUAL record (beyond bumping lastSeenAt) or
 * an enrolled agent's own AGENT record at all.
 */

export interface NeighborReport {
  ip: string;
  mac: string;
}

/** Sources whose fields neighbor reports may overwrite -- see the file comment. */
const DISCOVERY_OWNED = new Set(['AGENT_NEIGHBOR', 'AGENTLESS_SCAN']);

export function normalizeMac(mac: string): string | null {
  const hex = mac.toLowerCase().replace(/[^0-9a-f]/g, '');
  if (hex.length !== 12) return null;
  if (hex === '000000000000' || hex === 'ffffffffffff') return null;
  // Group bit set = multicast/broadcast, never a real host.
  if (parseInt(hex.slice(0, 2), 16) & 1) return null;
  return hex.match(/../g)!.join(':');
}

/** Normalizes, drops junk, and keeps the first entry per IP and per MAC. */
export function sanitizeNeighbors(reports: NeighborReport[]): NeighborReport[] {
  const seenIps = new Set<string>();
  const seenMacs = new Set<string>();
  const result: NeighborReport[] = [];
  for (const report of reports) {
    const mac = normalizeMac(report.mac);
    if (!mac || seenIps.has(report.ip) || seenMacs.has(mac)) continue;
    seenIps.add(report.ip);
    seenMacs.add(mac);
    result.push({ ip: report.ip, mac });
  }
  return result;
}

export interface NeighborIngestResult {
  created: number;
  updated: number;
}

/**
 * Must run inside a withTenantTx. Loads every candidate Asset in one query and
 * decides in memory, so a routine check-in (nothing new on the network) costs
 * two queries, not one per neighbor.
 */
export async function ingestNeighbors(
  tx: Prisma.TransactionClient,
  tenantId: string,
  reports: NeighborReport[],
): Promise<NeighborIngestResult> {
  const neighbors = sanitizeNeighbors(reports);
  if (neighbors.length === 0) return { created: 0, updated: 0 };

  const candidates = await tx.asset.findMany({
    where: {
      OR: [{ macAddress: { in: neighbors.map((n) => n.mac) } }, { ipAddress: { in: neighbors.map((n) => n.ip) } }],
    },
    select: { id: true, ipAddress: true, macAddress: true, discoverySource: true },
  });
  const byMac = new Map(candidates.filter((a) => a.macAddress).map((a) => [a.macAddress!, a]));
  const byIp = new Map(candidates.filter((a) => a.ipAddress).map((a) => [a.ipAddress!, a]));

  const now = new Date();
  const touched: string[] = [];
  let created = 0;
  let updated = 0;

  // Frees `ip` from a stale discovery-owned record so it can move to the
  // record that now really holds it. Returns false if an operator's (or an
  // agent's) record holds it -- then the IP is left alone.
  async function releaseIp(ip: string, keepId?: string): Promise<boolean> {
    const holder = byIp.get(ip);
    if (!holder || holder.id === keepId) return true;
    if (!DISCOVERY_OWNED.has(holder.discoverySource)) return false;
    await tx.asset.update({ where: { id: holder.id }, data: { ipAddress: null } });
    byIp.delete(ip);
    holder.ipAddress = null;
    return true;
  }

  for (const { ip, mac } of neighbors) {
    const known = byMac.get(mac);
    if (known) {
      if (DISCOVERY_OWNED.has(known.discoverySource) && known.ipAddress !== ip && (await releaseIp(ip, known.id))) {
        // Same device, new lease -- move the IP instead of creating a new row.
        await tx.asset.update({ where: { id: known.id }, data: { ipAddress: ip, lastSeenAt: now } });
        if (known.ipAddress) byIp.delete(known.ipAddress);
        known.ipAddress = ip;
        byIp.set(ip, known);
        updated++;
      } else if (known.discoverySource !== 'AGENT') {
        // An agent's own lastSeenAt means "last check-in" (ADR 0047) -- a
        // neighbor seeing that machine must not make a dead agent look alive.
        touched.push(known.id);
      }
      continue;
    }

    const atIp = byIp.get(ip);
    if (atIp && DISCOVERY_OWNED.has(atIp.discoverySource) && !atIp.macAddress) {
      // e.g. an earlier agentless scan found this IP but couldn't learn its MAC.
      await tx.asset.update({ where: { id: atIp.id }, data: { macAddress: mac, lastSeenAt: now } });
      atIp.macAddress = mac;
      byMac.set(mac, atIp);
      updated++;
      continue;
    }

    // Unknown MAC. If the IP is held by a stale discovery record for a
    // different MAC, that lease moved on -- release it; if an operator's
    // record holds it, create the new record without an IP rather than touch theirs.
    const ipFree = await releaseIp(ip);
    const asset = await tx.asset.create({
      data: {
        tenantId,
        name: ip,
        ipAddress: ipFree ? ip : null,
        macAddress: mac,
        discoverySource: 'AGENT_NEIGHBOR',
        lastSeenAt: now,
      },
      select: { id: true, ipAddress: true, macAddress: true, discoverySource: true },
    });
    byMac.set(mac, asset);
    if (asset.ipAddress) byIp.set(asset.ipAddress, asset);
    created++;
  }

  if (touched.length > 0) {
    await tx.asset.updateMany({ where: { id: { in: touched } }, data: { lastSeenAt: now } });
  }
  return { created, updated };
}
