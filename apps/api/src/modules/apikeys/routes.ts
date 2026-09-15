import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePermission } from '../rbac/permissions';
import { createApiKey, listApiKeys } from './service';

const createSchema = z.object({ name: z.string().min(1).max(100) });

export default async function apiKeyRoutes(app: FastifyInstance) {
  app.post(
    '/api-keys',
    { preHandler: [app.authenticate, requirePermission('users:manage')] },
    async (request, reply) => {
      const parsed = createSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.flatten() });
      }
      const created = await createApiKey(request.user.tenantId, parsed.data.name);
      return reply.code(201).send(created);
    },
  );

  app.get(
    '/api-keys',
    { preHandler: [app.authenticate, requirePermission('users:manage')] },
    async (request, reply) => {
      const keys = await listApiKeys(request.user.tenantId);
      return reply.send({ apiKeys: keys });
    },
  );
}
