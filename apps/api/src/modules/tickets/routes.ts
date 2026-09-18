import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePermission } from '../rbac/permissions';
import {
  addMessage,
  createTicketFromApi,
  createTicketStatus,
  deleteTicketStatus,
  getTicket,
  ingestAlert,
  listTickets,
  listTicketStatuses,
  mergeTicket,
  updateTicket,
  updateTicketStatus,
} from './service';
import { linkAssetToTicket, unlinkAssetFromTicket } from '../assets/service';
import { listPresence, markPresence } from '../../lib/presence';

const PRIORITY = z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']);
const STATUS_CATEGORY = z.enum(['OPEN', 'PENDING', 'RESOLVED', 'CLOSED']);

const createTicketStatusSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z][a-z0-9_]*$/, 'key must be lowercase alphanumeric/underscore, starting with a letter'),
  label: z.string().min(1).max(100),
  category: STATUS_CATEGORY,
});

const updateTicketStatusSchema = z.object({
  label: z.string().min(1).max(100).optional(),
  category: STATUS_CATEGORY.optional(),
  sortOrder: z.number().int().min(0).optional(),
});

const createFromApiSchema = z.object({
  subject: z.string().min(1).max(200),
  body: z.string().min(1),
  contactEmail: z.string().email(),
  contactName: z.string().min(1),
  priority: PRIORITY.optional(),
});

const addMessageSchema = z.object({
  body: z.string().min(1),
  isPrivateNote: z.boolean().default(false),
});

const updateTicketSchema = z.object({
  statusId: z.string().uuid().optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  priority: PRIORITY.optional(),
  teamId: z.string().uuid().nullable().optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
  problemId: z.string().uuid().nullable().optional(),
});

const linkAssetSchema = z.object({ assetId: z.string().uuid() });
const mergeTicketSchema = z.object({ intoTicketId: z.string().uuid() });

const ingestAlertSchema = z.object({
  source: z.string().min(1).max(100),
  severity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']).optional(),
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  externalId: z.string().max(200).optional(),
});

export default async function ticketRoutes(app: FastifyInstance) {
  // The API channel -- see plugins/apiKeyAuth.ts. Deliberately a different auth
  // mechanism than every other route here (ApiKey, not a user JWT): the caller is a
  // contact-facing integration, not a logged-in agent.
  app.post('/v1/tickets', { preHandler: app.authenticateApiKey }, async (request, reply) => {
    const parsed = createFromApiSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const ticket = await createTicketFromApi(request.apiKeyTenantId!, parsed.data);
    return reply.code(201).send(ticket);
  });

  // The NOC/SOC integration point -- see modules/tickets/service.ts's ingestAlert
  // for why this reuses Ticket instead of a separate model, and
  // docs/adr/0003-alert-ingestion.md for the full reasoning. Same ApiKey auth as
  // /v1/tickets: a customer's monitoring tool and their generic integration share
  // one credential type, not two.
  app.post('/v1/alerts', { preHandler: app.authenticateApiKey }, async (request, reply) => {
    const parsed = ingestAlertSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const ticket = await ingestAlert(request.apiKeyTenantId!, parsed.data);
    return reply.code(201).send(ticket);
  });

  app.get(
    '/ticket-statuses',
    { preHandler: [app.authenticate, requirePermission('tickets:read')] },
    async (request, reply) => {
      const statuses = await listTicketStatuses(request.user.tenantId);
      return reply.send({ statuses });
    },
  );

  // Defining/reordering/deleting a status is tenant-wide configuration --
  // tickets:manage_all, same tier as every other Configuration resource.
  app.post(
    '/ticket-statuses',
    { preHandler: [app.authenticate, requirePermission('tickets:manage_all')] },
    async (request, reply) => {
      const parsed = createTicketStatusSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      try {
        const status = await createTicketStatus(request.user.tenantId, parsed.data);
        return reply.code(201).send(status);
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  app.patch(
    '/ticket-statuses/:id',
    { preHandler: [app.authenticate, requirePermission('tickets:manage_all')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = updateTicketStatusSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      try {
        const status = await updateTicketStatus(request.user.tenantId, id, parsed.data);
        return reply.send(status);
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  app.delete(
    '/ticket-statuses/:id',
    { preHandler: [app.authenticate, requirePermission('tickets:manage_all')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        await deleteTicketStatus(request.user.tenantId, id);
        return reply.code(204).send();
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  app.get('/tickets', { preHandler: [app.authenticate, requirePermission('tickets:read')] }, async (request, reply) => {
    const query = z
      .object({
        statusCategory: STATUS_CATEGORY.optional(),
        assigneeId: z.union([z.string().uuid(), z.literal('unassigned')]).optional(),
        priority: PRIORITY.optional(),
        q: z.string().max(200).optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
        offset: z.coerce.number().int().min(0).optional(),
      })
      .safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({ error: query.error.flatten() });
    }
    const { tickets, total } = await listTickets(request.user.tenantId, query.data);
    return reply.send({ tickets, total });
  });

  // An agent logging a ticket by hand -- a walk-in, a phone call -- rather than
  // through the Service Catalog. Same underlying createTicketFromApi() every
  // other channel already goes through (see docs/adr/0016-service-catalog.md
  // for the precedent of reusing it under a different channel value), just
  // authenticated as a logged-in agent (tickets:write) instead of an ApiKey.
  app.post('/tickets', { preHandler: [app.authenticate, requirePermission('tickets:write')] }, async (request, reply) => {
    const parsed = createFromApiSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const ticket = await createTicketFromApi(request.user.tenantId, { ...parsed.data, channel: 'agent' });
    return reply.code(201).send(ticket);
  });

  app.get(
    '/tickets/:id',
    { preHandler: [app.authenticate, requirePermission('tickets:read')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        const ticket = await getTicket(request.user.tenantId, id);
        return reply.send(ticket);
      } catch {
        return reply.code(404).send({ error: 'ticket not found' });
      }
    },
  );

  app.post(
    '/tickets/:id/messages',
    { preHandler: [app.authenticate, requirePermission('tickets:write')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = addMessageSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.flatten() });
      }
      try {
        const message = await addMessage(request.user.tenantId, id, {
          authorUserId: request.user.sub,
          ...parsed.data,
        });
        return reply.code(201).send(message);
      } catch {
        return reply.code(404).send({ error: 'ticket not found' });
      }
    },
  );

  app.patch(
    '/tickets/:id',
    { preHandler: [app.authenticate, requirePermission('tickets:write')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = updateTicketSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.flatten() });
      }
      try {
        const ticket = await updateTicket(request.user.tenantId, id, parsed.data);
        return reply.send(ticket);
      } catch {
        return reply.code(404).send({ error: 'ticket not found' });
      }
    },
  );

  // Lightweight CMDB linkage -- "this ticket is about that asset." See
  // modules/assets/service.ts and schema.prisma's TicketAsset.
  app.post(
    '/tickets/:id/assets',
    { preHandler: [app.authenticate, requirePermission('tickets:write')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = linkAssetSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.flatten() });
      }
      try {
        await linkAssetToTicket(request.user.tenantId, id, parsed.data.assetId);
        const ticket = await getTicket(request.user.tenantId, id);
        return reply.code(201).send(ticket);
      } catch (err) {
        return reply.code(404).send({ error: (err as Error).message });
      }
    },
  );

  app.delete(
    '/tickets/:id/assets/:assetId',
    { preHandler: [app.authenticate, requirePermission('tickets:write')] },
    async (request, reply) => {
      const { id, assetId } = request.params as { id: string; assetId: string };
      try {
        await unlinkAssetFromTicket(request.user.tenantId, id, assetId);
        const ticket = await getTicket(request.user.tenantId, id);
        return reply.send(ticket);
      } catch (err) {
        return reply.code(404).send({ error: (err as Error).message });
      }
    },
  );

  // See docs/adr/0019-collision-merge-bulk-actions.md.
  app.post(
    '/tickets/:id/merge',
    { preHandler: [app.authenticate, requirePermission('tickets:write')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = mergeTicketSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      try {
        await mergeTicket(request.user.tenantId, id, parsed.data.intoTicketId);
        const ticket = await getTicket(request.user.tenantId, id);
        return reply.send(ticket);
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  // Collision detection: a short-poll heartbeat, not a WebSocket -- see
  // docs/adr/0019-collision-merge-bulk-actions.md for why that's the right call
  // here. POST records "I'm still looking at this ticket"; GET answers "who else
  // is." Both tickets:write, the same tier as every other ticket-detail action.
  app.post(
    '/tickets/:id/presence',
    { preHandler: [app.authenticate, requirePermission('tickets:write')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      await markPresence(request.user.tenantId, id, request.user.sub);
      return reply.code(204).send();
    },
  );

  app.get(
    '/tickets/:id/presence',
    { preHandler: [app.authenticate, requirePermission('tickets:write')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const userIds = await listPresence(request.user.tenantId, id, request.user.sub);
      return reply.send({ userIds });
    },
  );
}
