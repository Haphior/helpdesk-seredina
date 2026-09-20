import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePermission } from '../rbac/permissions';
import { getPublicTenantBranding, getTenantBranding, setTenantBranding } from './service';

const brandingSchema = z.object({
  logoUrl: z.string().url().nullable().optional(),
  accentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'accentColor must be a hex color, e.g. #4f46e5')
    .nullable()
    .optional(),
});

export default async function brandingRoutes(app: FastifyInstance) {
  app.get('/tenant-branding', { preHandler: app.authenticate }, async (request, reply) => {
    const branding = await getTenantBranding(request.user.tenantId);
    return reply.send(branding);
  });

  app.patch(
    '/tenant-branding',
    { preHandler: [app.authenticate, requirePermission('tickets:manage_all')] },
    async (request, reply) => {
      const parsed = brandingSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      try {
        const branding = await setTenantBranding(request.user.tenantId, parsed.data);
        return reply.send(branding);
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  // The self-service portal's own header (PublicKb/PublicKbArticle/PublicStatus):
  // no auth, tenant resolved by slug from the URL, 404 for an unknown slug -- same
  // shape as modules/kb's /public/:tenantSlug routes.
  app.get('/public/:tenantSlug/branding', async (request, reply) => {
    const { tenantSlug } = request.params as { tenantSlug: string };
    const branding = await getPublicTenantBranding(tenantSlug);
    if (!branding) return reply.code(404).send({ error: 'not found' });
    return reply.send(branding);
  });
}
