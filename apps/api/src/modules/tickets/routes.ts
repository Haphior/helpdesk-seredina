import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePermission } from '../rbac/permissions';
import {
  addMessage,
  createTicketFromApi,
  getTicket,
  ingestAlert,
  listTickets,
  listTicketStatuses,
  updateTicket,
} from './service';
import { linkAssetToTicket, unlinkAssetFromTicket } from '../assets/service';

const PRIORITY = z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']);
const STATUS_CATEGORY = z.enum(['OPEN', 'PENDING', 'RESOLVED', 'CLOSED']);

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
});

const linkAssetSchema = z.object({ assetId: z.string().uuid() });

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

  app.get('/tickets', { preHandler: [app.authenticate, requirePermission('tickets:read')] }, async (request, reply) => {
    const query = z.object({ statusCategory: STATUS_CATEGORY.optional() }).safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({ error: query.error.flatten() });
    }
    const tickets = await listTickets(request.user.tenantId, query.data);
    return reply.send({ tickets });
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
}
