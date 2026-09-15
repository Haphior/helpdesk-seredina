import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePermission } from '../rbac/permissions';
import { createDiscoveryJob, getDiscoveryJob, listDiscoveryJobs } from './service';

const createSchema = z.object({ cidrRange: z.string().min(1) });

export default async function discoveryRoutes(app: FastifyInstance) {
  // Triggering a network sweep is a meaningfully sensitive action (it touches
  // whatever network the worker runs on) -- gated on assets:manage, not just
  // assets:read.
  app.post(
    '/discovery-jobs',
    { preHandler: [app.authenticate, requirePermission('assets:manage')] },
    async (request, reply) => {
      const parsed = createSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.flatten() });
      }
      try {
        const job = await createDiscoveryJob(request.user.tenantId, parsed.data.cidrRange);
        return reply.code(201).send(job);
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  app.get(
    '/discovery-jobs',
    { preHandler: [app.authenticate, requirePermission('assets:read')] },
    async (request, reply) => {
      const jobs = await listDiscoveryJobs(request.user.tenantId);
      return reply.send({ discoveryJobs: jobs });
    },
  );

  app.get(
    '/discovery-jobs/:id',
    { preHandler: [app.authenticate, requirePermission('assets:read')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        const job = await getDiscoveryJob(request.user.tenantId, id);
        return reply.send(job);
      } catch {
        return reply.code(404).send({ error: 'discovery job not found' });
      }
    },
  );
}
