import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePermission } from '../rbac/permissions';
import {
  createProcessTemplate,
  deleteProcessTemplate,
  getProcessInstance,
  listProcessInstances,
  listProcessTemplates,
  startProcessInstance,
  updateProcessStep,
} from './service';

const stepTemplateSchema = z.object({
  label: z.string().min(1).max(200),
  teamId: z.string().uuid().nullish(),
  requiresApproval: z.boolean().optional(),
});

const createTemplateSchema = z.object({
  name: z.string().min(1).max(150),
  description: z.string().max(2000).nullish(),
  kind: z.enum(['GENERAL', 'CHANGE']).optional(),
  steps: z.array(stepTemplateSchema).min(1),
});

const startInstanceSchema = z.object({
  templateId: z.string().uuid(),
  subject: z.string().min(1).max(200),
  // Only meaningful (and required, checked in the service layer) when
  // templateId points at a CHANGE-kind template.
  riskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
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
      const instances = await listProcessInstances(request.user.tenantId);
      return reply.send({ instances });
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
        const instance = await startProcessInstance(
          request.user.tenantId,
          parsed.data.templateId,
          parsed.data.subject,
          parsed.data.riskLevel
            ? {
                riskLevel: parsed.data.riskLevel,
                plannedStart: parsed.data.plannedStart,
                plannedEnd: parsed.data.plannedEnd,
                rollbackPlan: parsed.data.rollbackPlan,
              }
            : undefined,
        );
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
}
