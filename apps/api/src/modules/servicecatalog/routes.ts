import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePermission } from '../rbac/permissions';
import {
  createServiceCatalogItem,
  createTicketFromCatalogItem,
  deleteServiceCatalogItem,
  listServiceCatalogItems,
  updateServiceCatalogItem,
} from './service';

const createItemSchema = z.object({
  name: z.string().min(1).max(150),
  description: z.string().max(2000).nullish(),
  icon: z.string().max(10).nullish(),
  customFieldKeys: z.array(z.string()).optional(),
});

const updateItemSchema = z.object({
  name: z.string().min(1).max(150).optional(),
  description: z.string().max(2000).nullish(),
  icon: z.string().max(10).nullish(),
  customFieldKeys: z.array(z.string()).optional(),
  sortOrder: z.number().int().min(0).optional(),
});

const requestSchema = z.object({
  contactEmail: z.string().email(),
  contactName: z.string().min(1).max(200),
  subject: z.string().max(200).optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
});

export default async function serviceCatalogRoutes(app: FastifyInstance) {
  // Browsable by any agent (tickets:read, same tier as custom field definitions) --
  // requesting an item is a day-to-day action, not configuration. Only
  // defining/deleting items below is the tenant-wide configuration concern
  // restricted to tickets:manage_all.
  app.get(
    '/service-catalog-items',
    { preHandler: [app.authenticate, requirePermission('tickets:read')] },
    async (request, reply) => {
      const items = await listServiceCatalogItems(request.user.tenantId);
      return reply.send({ items });
    },
  );

  app.post(
    '/service-catalog-items',
    { preHandler: [app.authenticate, requirePermission('tickets:manage_all')] },
    async (request, reply) => {
      const parsed = createItemSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      try {
        const item = await createServiceCatalogItem(request.user.tenantId, parsed.data);
        return reply.code(201).send(item);
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  app.patch(
    '/service-catalog-items/:id',
    { preHandler: [app.authenticate, requirePermission('tickets:manage_all')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = updateItemSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      try {
        const item = await updateServiceCatalogItem(request.user.tenantId, id, parsed.data);
        return reply.send(item);
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  app.delete(
    '/service-catalog-items/:id',
    { preHandler: [app.authenticate, requirePermission('tickets:manage_all')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        await deleteServiceCatalogItem(request.user.tenantId, id);
        return reply.code(204).send();
      } catch {
        return reply.code(404).send({ error: 'service catalog item not found' });
      }
    },
  );

  // Day-to-day action (creates a ticket) -- tickets:write, same tier as sending
  // a ticket reply.
  app.post(
    '/service-catalog-items/:id/request',
    { preHandler: [app.authenticate, requirePermission('tickets:write')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = requestSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      try {
        const ticket = await createTicketFromCatalogItem(request.user.tenantId, id, parsed.data);
        return reply.code(201).send(ticket);
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );
}
