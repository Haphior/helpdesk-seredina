import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePermission } from '../rbac/permissions';
import { applyMacro, createMacro, deleteMacro, listMacros, updateMacro } from './service';

const PRIORITY = z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']);

const macroActionsSchema = z.object({
  setStatusId: z.string().uuid().optional(),
  setPriority: PRIORITY.optional(),
  setTeamId: z.string().uuid().nullish(),
  setAssigneeId: z.string().uuid().nullish(),
  addReply: z.object({ body: z.string().min(1), isPrivateNote: z.boolean() }).optional(),
});

const createMacroSchema = z.object({
  name: z.string().min(1).max(100),
  actions: macroActionsSchema,
});

const updateMacroSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  actions: macroActionsSchema.optional(),
});

export default async function macroRoutes(app: FastifyInstance) {
  // Same split as custom fields / process templates: listing is tickets:write
  // (any agent applying a macro to a ticket needs to see what's available, same
  // reasoning as custom fields' GET); defining/deleting a macro is
  // tickets:manage_all, tenant-wide configuration.
  app.get(
    '/macros',
    { preHandler: [app.authenticate, requirePermission('tickets:write')] },
    async (request, reply) => {
      const macros = await listMacros(request.user.tenantId);
      return reply.send({ macros });
    },
  );

  app.post(
    '/macros',
    { preHandler: [app.authenticate, requirePermission('tickets:manage_all')] },
    async (request, reply) => {
      const parsed = createMacroSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      try {
        const macro = await createMacro(request.user.tenantId, parsed.data);
        return reply.code(201).send(macro);
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  app.patch(
    '/macros/:id',
    { preHandler: [app.authenticate, requirePermission('tickets:manage_all')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = updateMacroSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      try {
        const macro = await updateMacro(request.user.tenantId, id, parsed.data);
        return reply.send(macro);
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  app.delete(
    '/macros/:id',
    { preHandler: [app.authenticate, requirePermission('tickets:manage_all')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        await deleteMacro(request.user.tenantId, id);
        return reply.code(204).send();
      } catch {
        return reply.code(404).send({ error: 'macro not found' });
      }
    },
  );

  app.post(
    '/tickets/:id/apply-macro',
    { preHandler: [app.authenticate, requirePermission('tickets:write')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = z.object({ macroId: z.string().uuid() }).safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      try {
        await applyMacro(request.user.tenantId, id, parsed.data.macroId, request.user.sub);
        return reply.code(204).send();
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );
}
