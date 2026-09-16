import type { FastifyInstance } from 'fastify';
import { requirePermission } from '../rbac/permissions';
import {
  getAgentWorkload,
  getChannelBreakdown,
  getPriorityBreakdown,
  getRecentActivity,
  getSlaCompliance,
  getTicketVolume,
} from './service';

/** Read-only aggregate views -- any agent can see team-wide stats, same as the rest of this codebase's read/write split (tickets:read here, never tickets:manage_all). */
export default async function reportingRoutes(app: FastifyInstance) {
  app.get('/reporting/ticket-volume', { preHandler: [app.authenticate, requirePermission('tickets:read')] }, async (request, reply) => {
    const days = Number((request.query as { days?: string }).days ?? 14);
    return reply.send({ volume: await getTicketVolume(request.user.tenantId, days) });
  });

  app.get('/reporting/priority-breakdown', { preHandler: [app.authenticate, requirePermission('tickets:read')] }, async (request, reply) => {
    return reply.send({ breakdown: await getPriorityBreakdown(request.user.tenantId) });
  });

  app.get('/reporting/sla-compliance', { preHandler: [app.authenticate, requirePermission('tickets:read')] }, async (request, reply) => {
    return reply.send(await getSlaCompliance(request.user.tenantId));
  });

  app.get('/reporting/agent-workload', { preHandler: [app.authenticate, requirePermission('tickets:read')] }, async (request, reply) => {
    return reply.send(await getAgentWorkload(request.user.tenantId));
  });

  app.get('/reporting/channel-breakdown', { preHandler: [app.authenticate, requirePermission('tickets:read')] }, async (request, reply) => {
    return reply.send({ breakdown: await getChannelBreakdown(request.user.tenantId) });
  });

  app.get('/reporting/recent-activity', { preHandler: [app.authenticate, requirePermission('tickets:read')] }, async (request, reply) => {
    return reply.send({ tickets: await getRecentActivity(request.user.tenantId) });
  });
}
