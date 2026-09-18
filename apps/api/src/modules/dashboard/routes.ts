import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePermission } from '../rbac/permissions';
import { getDashboardPrefs, getOnboardingChecklist, upsertDashboardPref, WIDGET_TYPES } from './service';

const upsertSchema = z.object({
  widgetType: z.enum(WIDGET_TYPES),
  visible: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

/** Per-user preferences over which team-wide widgets show and in what order -- gated tickets:read like the reporting data itself, not tickets:manage_all, since this is personal UI state, not tenant configuration. */
export default async function dashboardRoutes(app: FastifyInstance) {
  app.get('/dashboard-widgets', { preHandler: [app.authenticate, requirePermission('tickets:read')] }, async (request, reply) => {
    return reply.send({ widgets: await getDashboardPrefs(request.user.tenantId, request.user.sub) });
  });

  app.get(
    '/onboarding-checklist',
    { preHandler: [app.authenticate, requirePermission('tickets:read')] },
    async (request, reply) => {
      return reply.send(await getOnboardingChecklist(request.user.tenantId));
    },
  );

  app.put('/dashboard-widgets', { preHandler: [app.authenticate, requirePermission('tickets:read')] }, async (request, reply) => {
    const parsed = upsertSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      await upsertDashboardPref(request.user.tenantId, request.user.sub, parsed.data);
      return reply.send({ widgets: await getDashboardPrefs(request.user.tenantId, request.user.sub) });
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });
}
