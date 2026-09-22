import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePermission } from '../rbac/permissions';
import {
  createProcessTemplate,
  createTicketForProcessStep,
  deleteProcessTemplate,
  getProcessInstance,
  listProcessInstances,
  listProcessTemplates,
  startProcessInstance,
  updateProcessStep,
  updateProcessTemplate,
} from './service';

const stepTemplateSchema = z.object({
  label: z.string().min(1).max(200),
  teamId: z.string().uuid().nullish(),
  requiresApproval: z.boolean().optional(),
});

const createTemplateSchema = z.object({
  name: z.string().min(1).max(150),
  description: z.string().max(2000).nullish(),
  kind: z.enum(['GENERAL', 'CHANGE', 'RELEASE']).optional(),
  steps: z.array(stepTemplateSchema).min(1),
});

const updateTemplateSchema = z.object({
  name: z.string().min(1).max(150).optional(),
  description: z.string().max(2000).nullish(),
  steps: z.array(stepTemplateSchema).min(1).optional(),
});

const startInstanceSchema = z.object({
  templateId: z.string().uuid(),
  subject: z.string().min(1).max(200),
  // Only meaningful (and required, checked in the service layer) when
  // templateId points at a CHANGE-kind template.
  riskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
  // Only meaningful (and required) for a RELEASE-kind template.
  releaseVersion: z.string().max(100).nullish(),
  changeInstanceId: z.string().uuid().nullish(),
  // Shared between CHANGE and RELEASE, ignored for GENERAL.
  plannedStart: z.coerce.date().nullish(),
  plannedEnd: z.coerce.date().nullish(),
  rollbackPlan: z.string().max(4000).nullish(),
});

const STEP_STATUS = z.enum(['PENDING', 'DONE', 'APPROVED', 'REJECTED', 'SKIPPED']);
const updateStepSchema = z.object({
  status: STEP_STATUS.optional(),
  assigneeId: z.string().uuid().nullish(),
  ticketId: z.string().uuid().nullish(),
});

const createTicketForStepSchema = z.object({
  subject: z.string().min(1).max(200),
  body: z.string().min(1),
  contactEmail: z.string().email(),
  contactName: z.string().min(1),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional(),
  assigneeId: z.string().uuid().optional(),
});

export default async function processRoutes(app: FastifyInstance) {
  // Templates are a configuration concern -- tickets:manage_all, same tier as
  // custom field definitions and macros-to-come.
  app.get(
    '/process-templates',
    { preHandler: [app.authenticate, requirePermission('tickets:manage_all')] },
    async (request, reply) => {
      const templates = await listProcessTemplates(request.user.tenantId);
      return reply.send({ templates });
    },
  );

  app.post(
    '/process-templates',
    { preHandler: [app.authenticate, requirePermission('tickets:manage_all')] },
    async (request, reply) => {
      const parsed = createTemplateSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      try {
        const template = await createProcessTemplate(request.user.tenantId, parsed.data);
        return reply.code(201).send(template);
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  app.patch(
    '/process-templates/:id',
    { preHandler: [app.authenticate, requirePermission('tickets:manage_all')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = updateTemplateSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      try {
        const template = await updateProcessTemplate(request.user.tenantId, id, parsed.data);
        return reply.send(template);
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  app.delete(
    '/process-templates/:id',
    { preHandler: [app.authenticate, requirePermission('tickets:manage_all')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        await deleteProcessTemplate(request.user.tenantId, id);
        return reply.code(204).send();
      } catch {
        return reply.code(404).send({ error: 'process template not found' });
      }
    },
  );

  // Instances are day-to-day work, not configuration -- tickets:write, same tier
  // as sending a ticket reply.
  app.get(
    '/process-instances',
    { preHandler: [app.authenticate, requirePermission('tickets:write')] },
    async (request, reply) => {
      const query = z
        .object({
          status: z.enum(['IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(),
          limit: z.coerce.number().int().min(1).max(200).optional(),
          offset: z.coerce.number().int().min(0).optional(),
        })
        .safeParse(request.query);
      if (!query.success) return reply.code(400).send({ error: query.error.flatten() });
      const { instances, total } = await listProcessInstances(request.user.tenantId, query.data);
      return reply.send({ instances, total });
    },
  );

  app.get(
    '/process-instances/:id',
    { preHandler: [app.authenticate, requirePermission('tickets:write')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        const instance = await getProcessInstance(request.user.tenantId, id);
        return reply.send(instance);
      } catch (err) {
        return reply.code(404).send({ error: (err as Error).message });
      }
    },
  );

  app.post(
    '/process-instances',
    { preHandler: [app.authenticate, requirePermission('tickets:write')] },
    async (request, reply) => {
      const parsed = startInstanceSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      try {
        const instance = await startProcessInstance(request.user.tenantId, parsed.data.templateId, parsed.data.subject, {
          riskLevel: parsed.data.riskLevel,
          releaseVersion: parsed.data.releaseVersion,
          changeInstanceId: parsed.data.changeInstanceId,
          plannedStart: parsed.data.plannedStart,
          plannedEnd: parsed.data.plannedEnd,
          rollbackPlan: parsed.data.rollbackPlan,
        });
        return reply.code(201).send(instance);
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  app.patch(
    '/process-steps/:id',
    { preHandler: [app.authenticate, requirePermission('tickets:write')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = updateStepSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      try {
        const step = await updateProcessStep(request.user.tenantId, id, parsed.data);
        return reply.send(step);
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  // Spawns a brand-new ticket and links+assigns it to this step in one action --
  // see createTicketForProcessStep's own comment for why this exists alongside
  // the plain PATCH above (which only links an *existing* ticket id).
  app.post(
    '/process-steps/:id/create-ticket',
    { preHandler: [app.authenticate, requirePermission('tickets:write')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = createTicketForStepSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      try {
        const ticket = await createTicketForProcessStep(request.user.tenantId, id, parsed.data);
        return reply.code(201).send(ticket);
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );
}
