import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { MAX_ATTACHMENT_SIZE_BYTES } from '@seredina/shared';
import { requirePermission } from '../rbac/permissions';
import { auditRequest } from '../audit/service';
import {
  attachToMyMessage,
  createMyTicket,
  getMyAttachment,
  getMyTicket,
  getPortalSettings,
  listMyTickets,
  listPortalCatalog,
  PortalError,
  readPortalSession,
  redeemPortalLink,
  replyToMyTicket,
  requestFromCatalog,
  requestPortalLink,
  resolvePortalTenant,
  setPortalEnabled,
} from './service';

// Customer portal -- docs/adr/0063-customer-portal.md. Public routes live
// under /public/:tenantSlug/portal/, like the KB portal and the widget. The
// session is a portal-only bearer token, never a console JWT.

function fail(reply: FastifyReply, err: unknown) {
  if (err instanceof PortalError) return reply.code(err.status).send({ error: err.message });
  throw err;
}

async function session(request: FastifyRequest) {
  const { tenantSlug } = request.params as { tenantSlug: string };
  const tenantId = await resolvePortalTenant(tenantSlug);
  return readPortalSession(tenantId, request.headers.authorization);
}

export default async function portalRoutes(app: FastifyInstance) {
  // Admin toggle.
  app.get('/portal-settings', { preHandler: [app.authenticate, requirePermission('tickets:manage_all')] }, async (request, reply) => {
    return reply.send(await getPortalSettings(request.user.tenantId));
  });

  app.put('/portal-settings', { preHandler: [app.authenticate, requirePermission('tickets:manage_all')] }, async (request, reply) => {
    const parsed = z.object({ enabled: z.boolean() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const settings = await setPortalEnabled(request.user.tenantId, parsed.data.enabled);
    await auditRequest(request, 'portal.settings_updated', { type: 'portal_settings' }, { enabled: parsed.data.enabled });
    return reply.send(settings);
  });

  // Sign-in.
  app.post(
    '/public/:tenantSlug/portal/request-link',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { tenantSlug } = request.params as { tenantSlug: string };
      const parsed = z.object({ email: z.string().email().max(320) }).safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Enter a valid email address.' });
      try {
        await requestPortalLink(tenantSlug, parsed.data.email);
        // Same answer whether or not the address has tickets.
        return reply.code(202).send({ ok: true });
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  app.post(
    '/public/:tenantSlug/portal/redeem',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { tenantSlug } = request.params as { tenantSlug: string };
      const parsed = z.object({ token: z.string().min(1).max(2000) }).safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'missing token' });
      try {
        return reply.send(await redeemPortalLink(tenantSlug, parsed.data.token));
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  // Tickets.
  app.get('/public/:tenantSlug/portal/tickets', async (request, reply) => {
    try {
      return reply.send({ tickets: await listMyTickets(await session(request)) });
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post('/public/:tenantSlug/portal/tickets', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = z.object({ subject: z.string().trim().min(1).max(300), body: z.string().trim().min(1).max(20_000) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      return reply.code(201).send(await createMyTicket(await session(request), parsed.data));
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.get('/public/:tenantSlug/portal/tickets/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!z.string().uuid().safeParse(id).success) return reply.code(404).send({ error: 'not found' });
    try {
      return reply.send(await getMyTicket(await session(request), id));
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post(
    '/public/:tenantSlug/portal/tickets/:id/messages',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = z.object({ body: z.string().trim().min(1).max(20_000) }).safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      if (!z.string().uuid().safeParse(id).success) return reply.code(404).send({ error: 'not found' });
      try {
        return reply.code(201).send(await replyToMyTicket(await session(request), id, parsed.data.body));
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  app.post(
    '/public/:tenantSlug/portal/messages/:messageId/attachments',
    { bodyLimit: MAX_ATTACHMENT_SIZE_BYTES + 1024 * 1024, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { messageId } = request.params as { messageId: string };
      if (!z.string().uuid().safeParse(messageId).success) return reply.code(404).send({ error: 'not found' });
      try {
        const s = await session(request);
        const file = await request.file();
        if (!file) return reply.code(400).send({ error: 'no file provided' });
        const data = await file.toBuffer();
        if (file.file.truncated) {
          return reply.code(400).send({ error: `attachment exceeds the ${MAX_ATTACHMENT_SIZE_BYTES / (1024 * 1024)}MB limit` });
        }
        return reply.code(201).send(await attachToMyMessage(s, messageId, { filename: file.filename, mimeType: file.mimetype, data }));
      } catch (err) {
        if (err instanceof PortalError) return fail(reply, err);
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  app.get('/public/:tenantSlug/portal/attachments/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!z.string().uuid().safeParse(id).success) return reply.code(404).send({ error: 'not found' });
    try {
      const attachment = await getMyAttachment(await session(request), id);
      reply.header('Content-Type', attachment.mimeType);
      reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(attachment.filename)}"`);
      return reply.send(attachment.data);
    } catch (err) {
      return fail(reply, err);
    }
  });

  // Service catalog.
  app.get('/public/:tenantSlug/portal/catalog', async (request, reply) => {
    try {
      const s = await session(request);
      return reply.send({ items: await listPortalCatalog(s.tenantId) });
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post(
    '/public/:tenantSlug/portal/catalog/:id/request',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = z.object({ subject: z.string().trim().max(300).optional() }).safeParse(request.body ?? {});
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      if (!z.string().uuid().safeParse(id).success) return reply.code(404).send({ error: 'not found' });
      try {
        return reply.code(201).send(await requestFromCatalog(await session(request), id, parsed.data.subject || undefined));
      } catch (err) {
        return fail(reply, err);
      }
    },
  );
}
