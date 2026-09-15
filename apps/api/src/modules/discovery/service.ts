import { prisma, withTenantTx } from '@seredina/db';
import { parseCidr } from '@seredina/shared';
import { discoveryQueue } from '../../lib/queue';

export async function createDiscoveryJob(tenantId: string, cidrRange: string) {
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
