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
