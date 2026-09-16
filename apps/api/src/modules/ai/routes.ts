import type { FastifyInstance } from 'fastify';
import { requirePermission } from '../rbac/permissions';
import { getAiAdapter } from './adapter';
import { suggestReply, summarizeTicket } from './service';

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
}
