import type { FastifyInstance } from 'fastify';
import { requirePermission } from '../rbac/permissions';
import { listTeams } from './service';

export default async function teamRoutes(app: FastifyInstance) {
  app.get('/teams', { preHandler: [app.authenticate, requirePermission('tickets:read')] }, async (request, reply) => {
    const teams = await listTeams(request.user.tenantId);
    return reply.send({ teams });
  });
}
