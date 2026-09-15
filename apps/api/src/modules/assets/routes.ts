import type { FastifyInstance } from 'fastify';
import { requirePermission } from '../rbac/permissions';
import { getAsset, listAssets } from './service';

export default async function assetRoutes(app: FastifyInstance) {
  app.get('/assets', { preHandler: [app.authenticate, requirePermission('assets:read')] }, async (request, reply) => {
    const assets = await listAssets(request.user.tenantId);
    return reply.send({ assets });
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
}
