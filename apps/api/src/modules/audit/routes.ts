import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePermission } from '../rbac/permissions';
import { listAuditLogs } from './service';

const querySchema = z.object({
  action: z.string().max(100).optional(),
  actorUserId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export default async function auditRoutes(app: FastifyInstance) {
  app.get(
    '/audit-logs',
    { preHandler: [app.authenticate, requirePermission('audit:read')] },
    async (request, reply) => {
      const parsed = querySchema.safeParse(request.query);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      return reply.send(await listAuditLogs(request.user.tenantId, parsed.data));
    },
  );
}
