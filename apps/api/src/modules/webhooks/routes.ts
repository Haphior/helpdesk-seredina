import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { WEBHOOK_EVENTS } from '@seredina/shared';
import { requirePermission } from '../rbac/permissions';
import { createWebhook, deleteWebhook, listWebhooks } from './service';

const createWebhookSchema = z.object({
  url: z.string().url(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
});

export default async function webhookRoutes(app: FastifyInstance) {
  // Same tier as process templates / custom field definitions: tenant-wide
  // configuration, not day-to-day ticket work.
  app.get(
    '/webhooks',
    { preHandler: [app.authenticate, requirePermission('tickets:manage_all')] },
    async (request, reply) => {
      const webhooks = await listWebhooks(request.user.tenantId);
      return reply.send({ webhooks });
    },
  );

  app.post(
    '/webhooks',
    { preHandler: [app.authenticate, requirePermission('tickets:manage_all')] },
    async (request, reply) => {
      const parsed = createWebhookSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      try {
        const webhook = await createWebhook(request.user.tenantId, parsed.data);
        return reply.code(201).send(webhook);
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  app.delete(
    '/webhooks/:id',
    { preHandler: [app.authenticate, requirePermission('tickets:manage_all')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        await deleteWebhook(request.user.tenantId, id);
        return reply.code(204).send();
      } catch {
        return reply.code(404).send({ error: 'webhook not found' });
      }
    },
  );
}
