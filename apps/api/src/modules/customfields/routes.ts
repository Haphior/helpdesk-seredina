import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePermission } from '../rbac/permissions';
import {
  createCustomFieldDefinition,
  deleteCustomFieldDefinition,
  listCustomFieldDefinitions,
  updateCustomFieldDefinition,
} from './service';

const createCustomFieldSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z][a-z0-9_]*$/, 'key must be lowercase alphanumeric/underscore, starting with a letter'),
  label: z.string().min(1).max(100),
  fieldType: z.enum(['TEXT', 'NUMBER', 'BOOLEAN', 'DATE', 'SELECT']),
  options: z.array(z.string().min(1)).optional(),
  required: z.boolean().optional(),
});

const updateCustomFieldSchema = z.object({
  label: z.string().min(1).max(100).optional(),
  required: z.boolean().optional(),
  options: z.array(z.string().min(1)).optional(),
  sortOrder: z.number().int().min(0).optional(),
});

export default async function customFieldRoutes(app: FastifyInstance) {
  // Gated on tickets:read, not tickets:manage_all -- every agent working a ticket
  // needs to see and fill in custom field values (TicketDetail.tsx renders them for
  // whoever has the ticket open); only DEFINING what fields exist (create/delete
  // below) is the tenant-wide configuration concern restricted to admin/team_lead.
  app.get(
    '/custom-fields',
    { preHandler: [app.authenticate, requirePermission('tickets:read')] },
    async (request, reply) => {
      const customFields = await listCustomFieldDefinitions(request.user.tenantId);
      return reply.send({ customFields });
    },
  );

  app.post(
    '/custom-fields',
    { preHandler: [app.authenticate, requirePermission('tickets:manage_all')] },
    async (request, reply) => {
      const parsed = createCustomFieldSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.flatten() });
      }
      try {
        const field = await createCustomFieldDefinition(request.user.tenantId, parsed.data);
        return reply.code(201).send(field);
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  app.patch(
    '/custom-fields/:id',
    { preHandler: [app.authenticate, requirePermission('tickets:manage_all')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = updateCustomFieldSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      try {
        const field = await updateCustomFieldDefinition(request.user.tenantId, id, parsed.data);
        return reply.send(field);
      } catch (err) {
        return reply.code(404).send({ error: (err as Error).message });
      }
    },
  );

  app.delete(
    '/custom-fields/:id',
    { preHandler: [app.authenticate, requirePermission('tickets:manage_all')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        await deleteCustomFieldDefinition(request.user.tenantId, id);
        return reply.code(204).send();
      } catch {
        return reply.code(404).send({ error: 'custom field not found' });
      }
    },
  );
}
