import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePermission } from '../rbac/permissions';
import {
  acknowledgeEscalation,
  addShift,
  createEscalationTier,
  createOnCallSchedule,
  deleteEscalationTier,
  deleteOnCallSchedule,
  deleteShift,
  listEscalationTiers,
  listOnCallSchedules,
  renameOnCallSchedule,
  updateEscalationTier,
} from './service';

const createScheduleSchema = z.object({ name: z.string().min(1).max(150) });
const addShiftSchema = z.object({ userId: z.string().uuid(), startsAt: z.coerce.date(), endsAt: z.coerce.date() });
const createTierSchema = z.object({
  userId: z.string().uuid().nullish(),
  onCallScheduleId: z.string().uuid().nullish(),
  escalateAfterMinutes: z.number().int().positive(),
});
const updateTierSchema = z.object({
  escalateAfterMinutes: z.number().int().positive().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

// All configuration (schedules/shifts/tiers) is tickets:manage_all, the same
// tier as SLA policies and business hours -- this is CMDB-adjacent tenant
// config, not day-to-day ticket work.
export default async function onCallRoutes(app: FastifyInstance) {
  app.get(
    '/on-call-schedules',
    { preHandler: [app.authenticate, requirePermission('tickets:manage_all')] },
    async (request, reply) => {
      const schedules = await listOnCallSchedules(request.user.tenantId);
      return reply.send({ schedules });
    },
  );

  app.post(
    '/on-call-schedules',
    { preHandler: [app.authenticate, requirePermission('tickets:manage_all')] },
    async (request, reply) => {
      const parsed = createScheduleSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      try {
        const schedule = await createOnCallSchedule(request.user.tenantId, parsed.data.name);
        return reply.code(201).send(schedule);
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  app.patch(
    '/on-call-schedules/:id',
    { preHandler: [app.authenticate, requirePermission('tickets:manage_all')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = createScheduleSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      try {
        const schedule = await renameOnCallSchedule(request.user.tenantId, id, parsed.data.name);
        return reply.send(schedule);
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  app.delete(
    '/on-call-schedules/:id',
    { preHandler: [app.authenticate, requirePermission('tickets:manage_all')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        await deleteOnCallSchedule(request.user.tenantId, id);
        return reply.code(204).send();
      } catch {
        return reply.code(404).send({ error: 'on-call schedule not found' });
      }
    },
  );

  app.post(
    '/on-call-schedules/:id/shifts',
    { preHandler: [app.authenticate, requirePermission('tickets:manage_all')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = addShiftSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      try {
        const shift = await addShift(request.user.tenantId, id, parsed.data);
        return reply.code(201).send(shift);
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  app.delete(
    '/on-call-shifts/:id',
    { preHandler: [app.authenticate, requirePermission('tickets:manage_all')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        await deleteShift(request.user.tenantId, id);
        return reply.code(204).send();
      } catch {
        return reply.code(404).send({ error: 'shift not found' });
      }
    },
  );

  app.get(
    '/escalation-tiers',
    { preHandler: [app.authenticate, requirePermission('tickets:manage_all')] },
    async (request, reply) => {
      const tiers = await listEscalationTiers(request.user.tenantId);
      return reply.send({ tiers });
    },
  );

  app.post(
    '/escalation-tiers',
    { preHandler: [app.authenticate, requirePermission('tickets:manage_all')] },
    async (request, reply) => {
      const parsed = createTierSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      try {
        const tier = await createEscalationTier(request.user.tenantId, parsed.data);
        return reply.code(201).send(tier);
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  app.patch(
    '/escalation-tiers/:id',
    { preHandler: [app.authenticate, requirePermission('tickets:manage_all')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = updateTierSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      try {
        const tier = await updateEscalationTier(request.user.tenantId, id, parsed.data);
        return reply.send(tier);
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  app.delete(
    '/escalation-tiers/:id',
    { preHandler: [app.authenticate, requirePermission('tickets:manage_all')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        await deleteEscalationTier(request.user.tenantId, id);
        return reply.code(204).send();
      } catch {
        return reply.code(404).send({ error: 'escalation tier not found' });
      }
    },
  );

  // Acknowledging is a day-to-day action from a ticket, not configuration --
  // tickets:write, the same tier as every other ticket-detail action.
  app.post(
    '/tickets/:id/escalation/acknowledge',
    { preHandler: [app.authenticate, requirePermission('tickets:write')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        const run = await acknowledgeEscalation(request.user.tenantId, id, request.user.sub);
        return reply.send(run);
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );
}
