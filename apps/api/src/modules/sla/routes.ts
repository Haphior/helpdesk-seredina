import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePermission } from '../rbac/permissions';
import { deleteSlaPolicy, getBusinessHours, listSlaPolicies, upsertBusinessHours, upsertSlaPolicy } from './service';

const PRIORITY = z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']);

const upsertSlaPolicySchema = z.object({
  priority: PRIORITY,
  firstResponseMinutes: z.number().int().positive(),
  resolutionMinutes: z.number().int().positive(),
  businessHoursOnly: z.boolean(),
});

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected 24h "HH:mm"');
const dayWindowSchema = z.object({ start: HHMM, end: HHMM });
const scheduleSchema = z.object({
  sun: z.array(dayWindowSchema).optional(),
  mon: z.array(dayWindowSchema).optional(),
  tue: z.array(dayWindowSchema).optional(),
  wed: z.array(dayWindowSchema).optional(),
  thu: z.array(dayWindowSchema).optional(),
  fri: z.array(dayWindowSchema).optional(),
  sat: z.array(dayWindowSchema).optional(),
});

const upsertBusinessHoursSchema = z.object({
  timezone: z.string().min(1),
  schedule: scheduleSchema,
});

export default async function slaRoutes(app: FastifyInstance) {
  // Same read/write split as custom fields, process templates, macros: any agent
  // can see the configured targets (e.g. to understand why a ticket looks
  // overdue); only admin/team_lead defines them.
  app.get('/sla-policies', { preHandler: [app.authenticate, requirePermission('tickets:read')] }, async (request, reply) => {
    return reply.send({ slaPolicies: await listSlaPolicies(request.user.tenantId) });
  });

  app.put('/sla-policies', { preHandler: [app.authenticate, requirePermission('tickets:manage_all')] }, async (request, reply) => {
    const parsed = upsertSlaPolicySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      return reply.send(await upsertSlaPolicy(request.user.tenantId, parsed.data));
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.delete('/sla-policies/:id', { preHandler: [app.authenticate, requirePermission('tickets:manage_all')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      await deleteSlaPolicy(request.user.tenantId, id);
      return reply.code(204).send();
    } catch {
      return reply.code(404).send({ error: 'SLA policy not found' });
    }
  });

  app.get('/business-hours', { preHandler: [app.authenticate, requirePermission('tickets:read')] }, async (request, reply) => {
    return reply.send({ businessHours: await getBusinessHours(request.user.tenantId) });
  });

  app.put('/business-hours', { preHandler: [app.authenticate, requirePermission('tickets:manage_all')] }, async (request, reply) => {
    const parsed = upsertBusinessHoursSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return reply.send(await upsertBusinessHours(request.user.tenantId, parsed.data));
  });
}
