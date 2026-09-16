import { prisma, withTenantTx, type AssetType } from '@seredina/db';

export async function listManufacturers(tenantId: string) {
  return withTenantTx(prisma, tenantId, (tx) => tx.manufacturer.findMany({ orderBy: { name: 'asc' } }));
}

export async function createManufacturer(tenantId: string, name: string) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const existing = await tx.manufacturer.findUnique({ where: { tenantId_name: { tenantId, name } } });
    if (existing) throw new Error('a manufacturer with this name already exists');
    return tx.manufacturer.create({ data: { tenantId, name } });
  });
}

export async function deleteManufacturer(tenantId: string, id: string) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const existing = await tx.manufacturer.findUnique({ where: { id } });
    if (!existing) throw new Error('manufacturer not found');
    // Deleting a manufacturer cascades to its models (schema: onDelete: Cascade),
    // which in turn orphans Asset.modelId to null (FK, not cascaded -- an asset
    // never disappears because its catalog entry did). Fine for a rare admin
    // action; not worth a confirmation-count roundtrip in this v1.
    await tx.manufacturer.delete({ where: { id } });
  });
}

export async function listAssetModels(tenantId: string) {
  return withTenantTx(prisma, tenantId, (tx) =>
    tx.assetModel.findMany({ include: { manufacturer: true }, orderBy: [{ manufacturer: { name: 'asc' } }, { name: 'asc' }] }),
  );
}

export interface CreateAssetModelInput {
  manufacturerId: string;
  name: string;
  assetType: AssetType;
}

export async function createAssetModel(tenantId: string, input: CreateAssetModelInput) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const manufacturer = await tx.manufacturer.findUnique({ where: { id: input.manufacturerId } });
    if (!manufacturer) throw new Error('manufacturer not found');

    const existing = await tx.assetModel.findUnique({
      where: { tenantId_manufacturerId_name: { tenantId, manufacturerId: input.manufacturerId, name: input.name } },
    });
    if (existing) throw new Error('a model with this name already exists for this manufacturer');

    return tx.assetModel.create({
      data: { tenantId, manufacturerId: input.manufacturerId, name: input.name, assetType: input.assetType },
      include: { manufacturer: true },
    });
  });
}

export async function deleteAssetModel(tenantId: string, id: string) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const existing = await tx.assetModel.findUnique({ where: { id } });
    if (!existing) throw new Error('asset model not found');
    await tx.assetModel.delete({ where: { id } });
  });
}
