import { prisma, withTenantTx } from '@seredina/db';
import { enumerateCidr } from '@seredina/shared';
import { mapWithConcurrency } from '../lib/concurrency';
import { scanHost, type HostScanResult } from './scanHost';

// Bounds how many hosts are probed at once (see lib/concurrency.ts) -- enough to keep
// a /22 (1024 addresses) sweep from taking minutes, not so much it opens a thousand
// sockets/SNMP sessions simultaneously.
const SCAN_CONCURRENCY = 32;

export async function runDiscoveryJob(tenantId: string, discoveryJobId: string, cidrRange: string): Promise<void> {
  await withTenantTx(prisma, tenantId, (tx) =>
    tx.discoveryJob.update({ where: { id: discoveryJobId }, data: { status: 'RUNNING', startedAt: new Date() } }),
  );

  try {
    const ips = enumerateCidr(cidrRange);
    const results = await mapWithConcurrency(ips, SCAN_CONCURRENCY, scanHost);
    const found = results.filter((r): r is HostScanResult => r !== null);

    // Sequential on purpose: each upsert is its own short withTenantTx (a pooled
    // connection for its duration, see packages/db's ADR) -- running these
    // concurrently would hold many connections open at once for no real benefit,
    // since the network scan above is already what dominates wall-clock time.
    for (const host of found) {
      await withTenantTx(prisma, tenantId, (tx) =>
        tx.asset.upsert({
          where: { tenantId_ipAddress: { tenantId, ipAddress: host.ipAddress } },
          create: {
            tenantId,
            name: host.name,
            ipAddress: host.ipAddress,
            hostname: host.hostname,
            assetType: host.assetType,
            discoverySource: 'AGENTLESS_SCAN',
            snmpSysDescr: host.snmpSysDescr,
            lastSeenAt: new Date(),
          },
          update: {
            hostname: host.hostname,
            assetType: host.assetType,
            snmpSysDescr: host.snmpSysDescr,
            lastSeenAt: new Date(),
          },
        }),
      );
    }

    await withTenantTx(prisma, tenantId, (tx) =>
      tx.discoveryJob.update({
        where: { id: discoveryJobId },
        data: { status: 'COMPLETED', discoveredCount: found.length, completedAt: new Date() },
      }),
    );
  } catch (err) {
    await withTenantTx(prisma, tenantId, (tx) =>
      tx.discoveryJob.update({
        where: {
          id: discoveryJobId,
        },
        data: {
          status: 'FAILED',
          errorMessage: err instanceof Error ? err.message : 'unknown error',
          completedAt: new Date(),
        },
      }),
    );
    throw err;
  }
}
