import type { FastifyInstance } from 'fastify';
import { requirePermission } from '../rbac/permissions';
import { exportTenantData } from './service';
import { auditRequest } from '../audit/service';

// Tenant-wide, not day-to-day -- tickets:manage_all, the same tier the AI
// Usage summary and every other tenant-wide config page already sits at.
export default async function exportRoutes(app: FastifyInstance) {
  app.get(
    '/export',
    { preHandler: [app.authenticate, requirePermission('tickets:manage_all')] },
    async (request, reply) => {
      const data = await exportTenantData(request.user.tenantId);
      // A full copy of the tenant's data leaving the system -- exactly what an auditor asks about.
      await auditRequest(request, 'tenant.data_exported', { type: 'tenant', id: request.user.tenantId });
      const filename = `seredina-export-${data.tenant.slug}-${new Date().toISOString().slice(0, 10)}.json`;
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      reply.header('Content-Type', 'application/json');
      return reply.send(data);
    },
  );
}
