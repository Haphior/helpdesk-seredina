import type { FastifyInstance } from 'fastify';
import { requirePermission } from '../rbac/permissions';
import { getAiAdapter } from './adapter';
import { getAiUsageSummary, getTicketAiUsage, suggestReply, summarizeTicket } from './service';

export default async function aiRoutes(app: FastifyInstance) {
  // Gated on tickets:write, same as sending a reply -- suggesting one is a lighter
  // version of the same action, never something a read-only agent should trigger.
  app.post(
    '/tickets/:id/ai/suggest-reply',
    { preHandler: [app.authenticate, requirePermission('tickets:write')] },
    async (request, reply) => {
      const adapter = getAiAdapter();
      if (!adapter) {
        return reply.code(503).send({ error: 'AI features are not configured (missing ANTHROPIC_API_KEY)' });
      }
      const { id } = request.params as { id: string };
      try {
        const result = await suggestReply(request.user.tenantId, id, adapter);
        return reply.send(result);
      } catch (err) {
        return reply.code(404).send({ error: (err as Error).message });
      }
    },
  );

  app.post(
    '/tickets/:id/ai/summarize',
    { preHandler: [app.authenticate, requirePermission('tickets:write')] },
    async (request, reply) => {
      const adapter = getAiAdapter();
      if (!adapter) {
        return reply.code(503).send({ error: 'AI features are not configured (missing ANTHROPIC_API_KEY)' });
      }
      const { id } = request.params as { id: string };
      try {
        const result = await summarizeTicket(request.user.tenantId, id, adapter);
        return reply.send(result);
      } catch (err) {
        return reply.code(404).send({ error: (err as Error).message });
      }
    },
  );

  // AI cost transparency (docs/adr/0023-ai-cost-transparency.md) -- per-ticket
  // usage is tickets:read (visible to anyone who can see the ticket), the
  // tenant-wide summary is tickets:manage_all (financial visibility, not a
  // day-to-day ticket action).
  app.get(
    '/tickets/:id/ai-usage',
    { preHandler: [app.authenticate, requirePermission('tickets:read')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const usage = await getTicketAiUsage(request.user.tenantId, id);
      return reply.send(usage);
    },
  );

  app.get(
    '/ai-usage/summary',
    { preHandler: [app.authenticate, requirePermission('tickets:manage_all')] },
    async (request, reply) => {
      const summary = await getAiUsageSummary(request.user.tenantId);
      return reply.send(summary);
    },
  );
}
