import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePermission } from '../rbac/permissions';
import { createProblem, getProblem, listProblems, updateProblem } from './service';

const PROBLEM_STATUS = z.enum(['UNDER_INVESTIGATION', 'KNOWN_ERROR', 'RESOLVED', 'CLOSED']);

const createProblemSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(4000).nullish(),
  ownerId: z.string().uuid().nullish(),
});

const updateProblemSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(4000).nullish(),
  status: PROBLEM_STATUS.optional(),
  rootCause: z.string().max(4000).nullish(),
  workaround: z.string().max(4000).nullish(),
  changeInstanceId: z.string().uuid().nullish(),
  ownerId: z.string().uuid().nullish(),
});

const listProblemsQuerySchema = z.object({
  status: PROBLEM_STATUS.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

// Same tier as process instances -- day-to-day investigative work, not
// configuration, so tickets:write rather than tickets:manage_all.
export default async function problemRoutes(app: FastifyInstance) {
  app.get('/problems', { preHandler: [app.authenticate, requirePermission('tickets:write')] }, async (request, reply) => {
    const query = listProblemsQuerySchema.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: query.error.flatten() });
    const { problems, total } = await listProblems(request.user.tenantId, query.data);
    return reply.send({ problems, total });
  });

  app.post('/problems', { preHandler: [app.authenticate, requirePermission('tickets:write')] }, async (request, reply) => {
    const parsed = createProblemSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const problem = await createProblem(request.user.tenantId, parsed.data);
    return reply.code(201).send(problem);
  });

  app.get('/problems/:id', { preHandler: [app.authenticate, requirePermission('tickets:write')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const problem = await getProblem(request.user.tenantId, id);
      return reply.send(problem);
    } catch (err) {
      return reply.code(404).send({ error: (err as Error).message });
    }
  });

  app.patch('/problems/:id', { preHandler: [app.authenticate, requirePermission('tickets:write')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateProblemSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      const problem = await updateProblem(request.user.tenantId, id, parsed.data);
      return reply.send(problem);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });
}
