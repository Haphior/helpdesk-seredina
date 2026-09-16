import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePermission } from '../rbac/permissions';
import {
  createAssetModel,
  createManufacturer,
  deleteAssetModel,
  deleteManufacturer,
  listAssetModels,
  listManufacturers,
} from './service';

const ASSET_TYPE = z.enum(['SERVER', 'WORKSTATION', 'NETWORK_DEVICE', 'PRINTER', 'MOBILE_DEVICE', 'OTHER']);

const createManufacturerSchema = z.object({ name: z.string().min(1).max(100) });

const createAssetModelSchema = z.object({
  manufacturerId: z.string().uuid(),
  name: z.string().min(1).max(100),
  assetType: ASSET_TYPE,
});

// Reading the catalog is assets:read (anyone entering/viewing asset data needs the
// picker); creating/deleting entries is assets:manage -- same split as custom
// fields' tickets:read/tickets:manage_all, applied to the assets permission pair
// that already exists instead of a new one.
export default async function assetCatalogRoutes(app: FastifyInstance) {
  app.get(
    '/manufacturers',
    { preHandler: [app.authenticate, requirePermission('assets:read')] },
    async (request, reply) => {
      const manufacturers = await listManufacturers(request.user.tenantId);
      return reply.send({ manufacturers });
    },
  );

  app.post(
    '/manufacturers',
    { preHandler: [app.authenticate, requirePermission('assets:manage')] },
    async (request, reply) => {
      const parsed = createManufacturerSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      try {
        const manufacturer = await createManufacturer(request.user.tenantId, parsed.data.name);
        return reply.code(201).send(manufacturer);
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  app.delete(
    '/manufacturers/:id',
    { preHandler: [app.authenticate, requirePermission('assets:manage')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        await deleteManufacturer(request.user.tenantId, id);
        return reply.code(204).send();
      } catch {
        return reply.code(404).send({ error: 'manufacturer not found' });
      }
    },
  );

  app.get(
    '/asset-models',
    { preHandler: [app.authenticate, requirePermission('assets:read')] },
    async (request, reply) => {
      const assetModels = await listAssetModels(request.user.tenantId);
      return reply.send({ assetModels });
    },
  );

  app.post(
    '/asset-models',
    { preHandler: [app.authenticate, requirePermission('assets:manage')] },
    async (request, reply) => {
      const parsed = createAssetModelSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      try {
        const assetModel = await createAssetModel(request.user.tenantId, parsed.data);
        return reply.code(201).send(assetModel);
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  app.delete(
    '/asset-models/:id',
    { preHandler: [app.authenticate, requirePermission('assets:manage')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        await deleteAssetModel(request.user.tenantId, id);
        return reply.code(204).send();
      } catch {
        return reply.code(404).send({ error: 'asset model not found' });
      }
    },
  );
}
