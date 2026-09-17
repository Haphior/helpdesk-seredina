import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePermission } from '../rbac/permissions';
import { createService, deleteService, linkAssetToService, listServices, unlinkAssetFromService } from './service';

const createServiceSchema = z.object({
  name: z.string().min(1).max(150),
  description: z.string().max(2000).nullish(),
});

const linkAssetSchema = z.object({ assetId: z.string().uuid() });

// Same permission tiers as the rest of the CMDB (modules/assets): assets:read
// to browse, assets:manage to define services or change what underpins them --
// this is CMDB configuration, not day-to-day ticket work.
export default async function serviceRoutes(app: FastifyInstance) {
  app.get('/services', { preHandler: [app.authenticate, requirePermission('assets:read')] }, async (request, reply) => {
    const services = await listServices(request.user.tenantId);
    return reply.send({ services });
  });

  app.post('/services', { preHandler: [app.authenticate, requirePermission('assets:manage')] }, async (request, reply) => {
    const parsed = createServiceSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      const service = await createService(request.user.tenantId, parsed.data);
      return reply.code(201).send(service);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.delete('/services/:id', { preHandler: [app.authenticate, requirePermission('assets:manage')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      await deleteService(request.user.tenantId, id);
      return reply.code(204).send();
    } catch {
      return reply.code(404).send({ error: 'service not found' });
    }
  });

  app.post(
    '/services/:id/assets',
    { preHandler: [app.authenticate, requirePermission('assets:manage')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = linkAssetSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      try {
        const service = await linkAssetToService(request.user.tenantId, id, parsed.data.assetId);
        return reply.code(201).send(service);
      } catch (err) {
        return reply.code(404).send({ error: (err as Error).message });
      }
    },
  );

  app.delete(
    '/services/:id/assets/:assetId',
    { preHandler: [app.authenticate, requirePermission('assets:manage')] },
    async (request, reply) => {
      const { id, assetId } = request.params as { id: string; assetId: string };
      try {
        await unlinkAssetFromService(request.user.tenantId, id, assetId);
        return reply.code(204).send();
      } catch (err) {
        return reply.code(404).send({ error: (err as Error).message });
      }
    },
  );
}
