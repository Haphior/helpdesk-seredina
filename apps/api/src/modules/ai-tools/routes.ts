import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePermission } from '../rbac/permissions';
import { TOOL_CATALOG } from './catalog';
import { getAutonomyPolicy, updateAutonomyPolicy } from './policy';
import { approveAiAgentRun, listAiAgentRuns, rejectAiAgentRun } from './agentRuns';
import { auditRequest } from '../audit/service';

const updatePolicySchema = z.object({
  autoExecuteTools: z.array(z.string()).optional(),
  maxActionsPerDay: z.number().int().min(0).max(1000).optional(),
});

const listRunsQuerySchema = z.object({
  status: z.enum(['PENDING_APPROVAL', 'EXECUTED', 'REJECTED', 'FAILED']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

/**
 * Same tickets:manage_all tier as webhooks/macros/escalation-tier config
 * (this is tenant-wide AI-behavior configuration and oversight, not a
 * day-to-day ticket action) -- see docs/adr/0033-ai-tool-catalog-and-autonomy.md.
 */
export default async function aiToolsRoutes(app: FastifyInstance) {
  // The catalog itself, for the settings UI to render checkboxes without
  // hardcoding tool names/descriptions on the frontend.
  app.get('/ai-tools/catalog', { preHandler: [app.authenticate, requirePermission('tickets:manage_all')] }, async (_request, reply) => {
    return reply.send({
      tools: TOOL_CATALOG.map((t) => ({ name: t.name, description: t.description, mutating: t.mutating })),
    });
  });

  app.get('/autonomy-policy', { preHandler: [app.authenticate, requirePermission('tickets:manage_all')] }, async (request, reply) => {
    const policy = await getAutonomyPolicy(request.user.tenantId);
    return reply.send(policy);
  });

  app.patch('/autonomy-policy', { preHandler: [app.authenticate, requirePermission('tickets:manage_all')] }, async (request, reply) => {
    const parsed = updatePolicySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      const policy = await updateAutonomyPolicy(request.user.tenantId, parsed.data);
      await auditRequest(request, 'autonomy_policy.updated', { type: 'autonomy_policy' }, parsed.data);
      return reply.send(policy);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.get('/ai-agent-runs', { preHandler: [app.authenticate, requirePermission('tickets:manage_all')] }, async (request, reply) => {
    const { status, limit, offset } = listRunsQuerySchema.parse(request.query);
    const { runs, total } = await listAiAgentRuns(request.user.tenantId, { status, limit, offset });
    return reply.send({ runs, total });
  });

  app.post(
    '/ai-agent-runs/:id/approve',
    { preHandler: [app.authenticate, requirePermission('tickets:manage_all')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        const run = await approveAiAgentRun(request.user.tenantId, id, request.user.sub);
        return reply.send(run);
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  app.post(
    '/ai-agent-runs/:id/reject',
    { preHandler: [app.authenticate, requirePermission('tickets:manage_all')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        const run = await rejectAiAgentRun(request.user.tenantId, id, request.user.sub);
        return reply.send(run);
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );
}
