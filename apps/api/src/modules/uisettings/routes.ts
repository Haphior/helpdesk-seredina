import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePermission } from '../rbac/permissions';
import { UI_THEMES, getTenantUiTheme, setTenantUiTheme } from './service';

const updateUiSettingsSchema = z.object({
  theme: z.enum(UI_THEMES.map((t) => t.key) as [string, ...string[]]),
});

export default async function uiSettingsRoutes(app: FastifyInstance) {
  // Deliberately no permission check beyond being logged in -- every
  // authenticated user's own page render needs this (Layout.tsx fetches it
  // to set the theme attribute), not just admins. Changing it (PATCH) is the
  // tenant-wide action, gated below.
  app.get('/ui-settings', { preHandler: app.authenticate }, async (request, reply) => {
    const settings = await getTenantUiTheme(request.user.tenantId);
    return reply.send(settings);
  });

  app.get('/ui-settings/themes', { preHandler: app.authenticate }, async (_request, reply) => {
    return reply.send({ themes: UI_THEMES });
  });

  app.patch(
    '/ui-settings',
    { preHandler: [app.authenticate, requirePermission('tickets:manage_all')] },
    async (request, reply) => {
      const parsed = updateUiSettingsSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      try {
        const settings = await setTenantUiTheme(request.user.tenantId, parsed.data.theme);
        return reply.send(settings);
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );
}
