import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requirePermission } from '../rbac/permissions';
import { auditRequest } from '../audit/service';
import {
  anonymizeContact,
  ContactError,
  exportContactData,
  getContact,
  getRetentionSettings,
  listContacts,
  MAX_RETENTION_DAYS,
  MIN_RETENTION_DAYS,
  setRetentionSettings,
  updateContact,
} from './service';

// Contacts and their data rights -- docs/adr/0066-contact-data-rights.md.
// Anyone who can read tickets can look contacts up; correcting, exporting,
// erasing and the retention policy need contacts:manage. Audit entries carry
// the contact's id only, never their name or email: the audit log can't be
// edited, so a name written there would outlive an erasure.

function fail(reply: FastifyReply, err: unknown) {
  if (err instanceof ContactError) return reply.code(err.status).send({ error: err.message });
  throw err;
}

const idParam = z.object({ id: z.string().uuid() });

export default async function contactRoutes(app: FastifyInstance) {
  app.get('/contacts', { preHandler: [app.authenticate, requirePermission('tickets:read')] }, async (request, reply) => {
    const parsed = z.object({ search: z.string().max(200).optional(), cursor: z.string().uuid().optional() }).safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return reply.send(await listContacts(request.user.tenantId, parsed.data));
  });

  app.get('/contacts/:id', { preHandler: [app.authenticate, requirePermission('tickets:read')] }, async (request, reply) => {
    const params = idParam.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: 'contact not found' });
    try {
      return reply.send(await getContact(request.user.tenantId, params.data.id));
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.patch('/contacts/:id', { preHandler: [app.authenticate, requirePermission('contacts:manage')] }, async (request, reply) => {
    const params = idParam.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: 'contact not found' });
    const parsed = z
      .object({ name: z.string().trim().min(1).max(200).optional(), email: z.string().trim().email().max(320).optional() })
      .refine((v) => v.name !== undefined || v.email !== undefined, { message: 'nothing to change' })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      const contact = await updateContact(request.user.tenantId, params.data.id, parsed.data);
      await auditRequest(request, 'contact.updated', { type: 'contact', id: contact.id }, { fields: Object.keys(parsed.data) });
      return reply.send(contact);
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.get('/contacts/:id/export', { preHandler: [app.authenticate, requirePermission('contacts:manage')] }, async (request, reply) => {
    const params = idParam.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: 'contact not found' });
    const query = z.object({ internalNotes: z.enum(['true', 'false']).optional() }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: query.error.flatten() });
    const includeInternalNotes = query.data.internalNotes === 'true';
    try {
      const data = await exportContactData(request.user.tenantId, params.data.id, { includeInternalNotes });
      await auditRequest(request, 'contact.exported', { type: 'contact', id: params.data.id }, { includeInternalNotes });
      reply.header('Content-Disposition', `attachment; filename="contact-${params.data.id}.json"`);
      return reply.send(data);
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post(
    '/contacts/:id/anonymize',
    { preHandler: [app.authenticate, requirePermission('contacts:manage')] },
    async (request, reply) => {
      const params = idParam.safeParse(request.params);
      if (!params.success) return reply.code(404).send({ error: 'contact not found' });
      const parsed = z.object({ confirmEmail: z.string().min(1).max(320) }).safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      try {
        const result = await anonymizeContact(request.user.tenantId, params.data.id, parsed.data.confirmEmail);
        await auditRequest(request, 'contact.anonymized', { type: 'contact', id: params.data.id }, {
          tickets: result.tickets,
          messages: result.messages,
          attachments: result.attachments,
        });
        return reply.send(result);
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  app.get('/contact-retention', { preHandler: [app.authenticate, requirePermission('contacts:manage')] }, async (request, reply) => {
    return reply.send(await getRetentionSettings(request.user.tenantId));
  });

  app.put('/contact-retention', { preHandler: [app.authenticate, requirePermission('contacts:manage')] }, async (request, reply) => {
    const parsed = z
      .object({ days: z.number().int().min(MIN_RETENTION_DAYS).max(MAX_RETENTION_DAYS).nullable() })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const settings = await setRetentionSettings(request.user.tenantId, parsed.data.days);
    await auditRequest(request, 'contact.retention_updated', { type: 'contact_retention' }, { days: parsed.data.days });
    return reply.send(settings);
  });
}
