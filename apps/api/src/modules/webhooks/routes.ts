import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { WEBHOOK_EVENTS, WEBHOOK_KINDS } from '@seredina/shared';
import { requirePermission } from '../rbac/permissions';
import { createWebhook, deleteWebhook, listWebhooks, rotateWebhookSecret, updateWebhook } from './service';

const createWebhookSchema = z.object({
  url: z.string().url(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
  kind: z.enum(WEBHOOK_KINDS).optional(),
});

const updateWebhookSchema = z.object({
  url: z.string().url().optional(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).optional(),
  isActive: z.boolean().optional(),
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

  app.patch(
    '/webhooks/:id',
    { preHandler: [app.authenticate, requirePermission('tickets:manage_all')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = updateWebhookSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      try {
        const webhook = await updateWebhook(request.user.tenantId, id, parsed.data);
        return reply.send(webhook);
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  app.post(
    '/webhooks/:id/rotate-secret',
    { preHandler: [app.authenticate, requirePermission('tickets:manage_all')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        const webhook = await rotateWebhookSecret(request.user.tenantId, id);
        return reply.send(webhook);
      } catch (err) {
        return reply.code(404).send({ error: (err as Error).message });
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
