import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePermission } from '../rbac/permissions';
import { createAsset, deleteAsset, getAsset, listAssets, updateAsset } from './service';

const ASSET_TYPE = z.enum(['SERVER', 'WORKSTATION', 'NETWORK_DEVICE', 'PRINTER', 'MOBILE_DEVICE', 'OTHER']);
const ASSET_STATUS = z.enum(['ACTIVE', 'INACTIVE', 'RETIRED']);

// .nullish() (null or undefined) on the optional string fields -- undefined means
// "don't touch this field" on PATCH, null means "clear it" (e.g. remove a
// mis-entered serial number). Plain .optional() can't express the second case.
const assetFieldsSchema = {
  ipAddress: z.string().ip().nullish(),
  macAddress: z.string().nullish(),
  hostname: z.string().nullish(),
  serialNumber: z.string().nullish(),
  manufacturer: z.string().nullish(),
  model: z.string().nullish(),
  operatingSystem: z.string().nullish(),
  modelId: z.string().uuid().nullish(),
};

const createAssetSchema = z.object({
  name: z.string().min(1).max(200),
  assetType: ASSET_TYPE,
  status: ASSET_STATUS.optional(),
  ...assetFieldsSchema,
});

const updateAssetSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  assetType: ASSET_TYPE.optional(),
  status: ASSET_STATUS.optional(),
  ...assetFieldsSchema,
});

const listAssetsQuerySchema = z.object({
  assetType: ASSET_TYPE.optional(),
  status: ASSET_STATUS.optional(),
  q: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export default async function assetRoutes(app: FastifyInstance) {
  app.get('/assets', { preHandler: [app.authenticate, requirePermission('assets:read')] }, async (request, reply) => {
    const query = listAssetsQuerySchema.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: query.error.flatten() });
    const { assets, total } = await listAssets(request.user.tenantId, query.data);
    return reply.send({ assets, total });
  });

  app.get(
    '/assets/:id',
    { preHandler: [app.authenticate, requirePermission('assets:read')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        const asset = await getAsset(request.user.tenantId, id);
        return reply.send(asset);
      } catch {
        return reply.code(404).send({ error: 'asset not found' });
      }
    },
  );

  app.post(
    '/assets',
    { preHandler: [app.authenticate, requirePermission('assets:manage')] },
    async (request, reply) => {
      const parsed = createAssetSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.flatten() });
      }
      const asset = await createAsset(request.user.tenantId, parsed.data);
      return reply.code(201).send(asset);
    },
  );

  app.patch(
    '/assets/:id',
    { preHandler: [app.authenticate, requirePermission('assets:manage')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = updateAssetSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.flatten() });
      }
      try {
        const asset = await updateAsset(request.user.tenantId, id, parsed.data);
        return reply.send(asset);
      } catch {
        return reply.code(404).send({ error: 'asset not found' });
      }
    },
  );

  app.delete(
    '/assets/:id',
    { preHandler: [app.authenticate, requirePermission('assets:manage')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        await deleteAsset(request.user.tenantId, id);
        return reply.code(204).send();
      } catch {
        return reply.code(404).send({ error: 'asset not found' });
      }
    },
  );
}
