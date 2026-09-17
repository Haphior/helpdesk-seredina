import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePermission } from '../rbac/permissions';
import { createSavedView, deleteSavedView, listSavedViews } from './service';

const filtersSchema = z.object({
  statusCategory: z.enum(['OPEN', 'PENDING', 'RESOLVED', 'CLOSED']).optional(),
  assigneeId: z.union([z.string().uuid(), z.literal('unassigned')]).optional(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional(),
});

const createSavedViewSchema = z.object({
  name: z.string().min(1).max(80),
  filters: filtersSchema,
});

// A personal convenience, not tenant configuration -- tickets:read, the same
// tier dashboard-widget preferences use, not tickets:manage_all.
export default async function savedViewRoutes(app: FastifyInstance) {
  app.get('/saved-views', { preHandler: [app.authenticate, requirePermission('tickets:read')] }, async (request, reply) => {
    const views = await listSavedViews(request.user.tenantId, request.user.sub);
    return reply.send({ views });
  });

  app.post('/saved-views', { preHandler: [app.authenticate, requirePermission('tickets:read')] }, async (request, reply) => {
    const parsed = createSavedViewSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      const view = await createSavedView(request.user.tenantId, request.user.sub, parsed.data);
      return reply.code(201).send(view);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.delete(
    '/saved-views/:id',
    { preHandler: [app.authenticate, requirePermission('tickets:read')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        await deleteSavedView(request.user.tenantId, request.user.sub, id);
        return reply.code(204).send();
      } catch {
        return reply.code(404).send({ error: 'saved view not found' });
      }
    },
  );
}
