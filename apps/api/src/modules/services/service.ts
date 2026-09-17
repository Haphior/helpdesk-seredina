import { prisma, withTenantTx } from '@seredina/db';

const ASSET_SUMMARY_SELECT = { id: true, name: true, ipAddress: true, assetType: true } as const;

export async function listServices(tenantId: string) {
  return withTenantTx(prisma, tenantId, (tx) =>
    tx.service.findMany({
      include: { assets: { include: { asset: { select: ASSET_SUMMARY_SELECT } } } },
      orderBy: { name: 'asc' },
    }),
  );
}

export interface CreateServiceInput {
  name: string;
  description?: string | null;
}

export async function createService(tenantId: string, input: CreateServiceInput) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const existing = await tx.service.findUnique({ where: { tenantId_name: { tenantId, name: input.name } } });
    if (existing) throw new Error('a service with this name already exists');
    return tx.service.create({
      data: { tenantId, name: input.name, description: input.description ?? null },
      include: { assets: { include: { asset: { select: ASSET_SUMMARY_SELECT } } } },
    });
  });
}

export async function deleteService(tenantId: string, id: string) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const existing = await tx.service.findUnique({ where: { id } });
    if (!existing) throw new Error('service not found');
    await tx.service.delete({ where: { id } });
  });
}

export async function linkAssetToService(tenantId: string, serviceId: string, assetId: string) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const [service, asset] = await Promise.all([
      tx.service.findUnique({ where: { id: serviceId } }),
      tx.asset.findUnique({ where: { id: assetId } }),
    ]);
    if (!service) throw new Error('service not found');
    if (!asset) throw new Error('asset not found');

    await tx.serviceAsset.upsert({
      where: { serviceId_assetId: { serviceId, assetId } },
      create: { tenantId, serviceId, assetId },
      update: {},
    });
    return tx.service.findUniqueOrThrow({
      where: { id: serviceId },
      include: { assets: { include: { asset: { select: ASSET_SUMMARY_SELECT } } } },
    });
  });
}

export async function unlinkAssetFromService(tenantId: string, serviceId: string, assetId: string) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const service = await tx.service.findUnique({ where: { id: serviceId } });
    if (!service) throw new Error('service not found');
    await tx.serviceAsset.deleteMany({ where: { serviceId, assetId } });
  });
}

export type PublicServiceStatusLevel = 'operational' | 'degraded' | 'outage';

export interface PublicServiceStatus {
  id: string;
  name: string;
  status: PublicServiceStatusLevel;
  openIncidents: number;
}

/**
 * "A public status page, auto-driven by Service Configuration Management + the
 * alert channel" (docs/ROADMAP.md) -- zero manual maintenance because it's a
 * pure read over data that already exists for other reasons: which Assets an
 * agent has linked to an open channel='alert' Ticket (the same TicketAsset link
 * used everywhere else in the CMDB), joined through ServiceAsset to find which
 * Services those Assets underpin. No new table.
 *
 * Deliberately scoped to channel='alert' only, not "any open ticket linked to
 * this asset" -- a routine "replace this keyboard" ticket tagged with an asset
 * shouldn't flip a public status page to degraded. See docs/adr/0025-public-status-page.md
 * for the privacy/scoping decision on what an anonymous visitor sees here:
 * a service name and a status color, never a ticket subject or description.
 */
export async function getPublicStatusPage(
  tenantId: string,
): Promise<{ overall: PublicServiceStatusLevel; services: PublicServiceStatus[] }> {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const [services, openAlertTickets] = await Promise.all([
      tx.service.findMany({
        select: { id: true, name: true, assets: { select: { assetId: true } } },
        orderBy: { name: 'asc' },
      }),
      tx.ticket.findMany({
        where: { channel: 'alert', status: { category: { in: ['OPEN', 'PENDING'] } } },
        select: { priority: true, assets: { select: { assetId: true } } },
      }),
    ]);

    let overall: PublicServiceStatusLevel = 'operational';
    const result: PublicServiceStatus[] = services.map((service) => {
      const serviceAssetIds = new Set(service.assets.map((a) => a.assetId));
      const affecting = openAlertTickets.filter((t) => t.assets.some((a) => serviceAssetIds.has(a.assetId)));
      const major = affecting.some((t) => t.priority === 'URGENT' || t.priority === 'HIGH');
      const status: PublicServiceStatusLevel = affecting.length === 0 ? 'operational' : major ? 'outage' : 'degraded';
      if (status === 'outage') overall = 'outage';
      else if (status === 'degraded' && overall !== 'outage') overall = 'degraded';
      return { id: service.id, name: service.name, status, openIncidents: affecting.length };
    });

    return { overall, services: result };
  });
}
