import { prisma, withTenantTx } from '@seredina/db';
import { parseCidr } from '@seredina/shared';
import { discoveryQueue } from '../../lib/queue';

/**
 * Server-side network scans only make sense when the worker sits on the
 * customer's own network -- i.e. self-hosted. In cloud mode the worker is on
 * OUR network, so a tenant "scanning 10.0.0.0/22" would be probing our own
 * infrastructure. Cloud tenants discover devices through enrolled agents
 * instead (docs/adr/0052-agent-based-discovery.md).
 */
export function isServerSideScanAllowed(): boolean {
  return process.env.SEREDINA_MODE === 'self_hosted';
}

export class ServerSideScanDisabledError extends Error {
  constructor() {
    super('network scans from the server are only available in self-hosted mode -- enroll an agent on a device in that network instead');
  }
}

export async function createDiscoveryJob(tenantId: string, cidrRange: string) {
  if (!isServerSideScanAllowed()) throw new ServerSideScanDisabledError();
  parseCidr(cidrRange); // throws on invalid notation or a range over the safety cap

  const job = await withTenantTx(prisma, tenantId, (tx) =>
    tx.discoveryJob.create({ data: { tenantId, cidrRange, status: 'PENDING' } }),
  );

  await discoveryQueue.add('scan', { tenantId, discoveryJobId: job.id, cidrRange });

  return job;
}

export async function listDiscoveryJobs(tenantId: string) {
  return withTenantTx(prisma, tenantId, (tx) => tx.discoveryJob.findMany({ orderBy: { createdAt: 'desc' } }));
}

export async function getDiscoveryJob(tenantId: string, id: string) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const job = await tx.discoveryJob.findUnique({ where: { id } });
    if (!job) throw new Error('discovery job not found');
    return job;
  });
}
