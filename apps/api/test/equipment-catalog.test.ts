import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma, withTenantTx } from '@seredina/db';
import { createAsset } from '../src/modules/assets/service';
import {
  createAssetModel,
  createManufacturer,
  deleteManufacturer,
  listAssetModels,
} from '../src/modules/assetcatalog/service';

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('equipment catalog', () => {
  let tenantId: string;

  beforeAll(async () => {
    tenantId = randomUUID();
    await withTenantTx(prisma, tenantId, (tx) =>
      tx.tenant.create({ data: { id: tenantId, slug: `cat-${tenantId.slice(0, 8)}`, name: 'Catalog Test' } }),
    );
  });

  it('creates a manufacturer and a model under it', async () => {
    const dell = await createManufacturer(tenantId, 'Dell');
    const model = await createAssetModel(tenantId, { manufacturerId: dell.id, name: 'OptiPlex 7090', assetType: 'WORKSTATION' });

    expect(model.name).toBe('OptiPlex 7090');
    expect(model.manufacturer.name).toBe('Dell');
  });

  it('rejects a duplicate manufacturer name with a clean error', async () => {
    await expect(createManufacturer(tenantId, 'Dell')).rejects.toThrow('a manufacturer with this name already exists');
  });

  it('linking an asset to a model, then deleting the model, SET NULLs the link (asset survives)', async () => {
    const hp = await createManufacturer(tenantId, 'HP');
    const model = await createAssetModel(tenantId, { manufacturerId: hp.id, name: 'EliteBook 840', assetType: 'WORKSTATION' });

    const asset = await createAsset(tenantId, { name: 'Front desk laptop', assetType: 'WORKSTATION', modelId: model.id });
    let fetched = await withTenantTx(prisma, tenantId, (tx) => tx.asset.findUniqueOrThrow({ where: { id: asset.id } }));
    expect(fetched.modelId).toBe(model.id);

    // Deleting the manufacturer cascades to its model, which SET NULLs the asset's
    // link -- the asset itself must never disappear because a catalog entry did.
    await deleteManufacturer(tenantId, hp.id);

    fetched = await withTenantTx(prisma, tenantId, (tx) => tx.asset.findUniqueOrThrow({ where: { id: asset.id } }));
    expect(fetched.modelId).toBeNull();
    expect(fetched.name).toBe('Front desk laptop');

    const remainingModels = await listAssetModels(tenantId);
    expect(remainingModels.find((m) => m.id === model.id)).toBeUndefined();
  });
});
