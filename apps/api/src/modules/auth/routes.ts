import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePermission } from '../rbac/permissions';
import { getMe, login, registerTenant } from './service';

const registerSchema = z.object({
  tenantSlug: z
    .string()
    .min(2)
    .max(63)
    .regex(/^[a-z0-9-]+$/, 'tenantSlug must be lowercase alphanumeric with hyphens'),
  tenantName: z.string().min(1),
  adminEmail: z.string().email(),
  adminName: z.string().min(1),
  password: z.string().min(8),
});

const loginSchema = z.object({
  tenantSlug: z.string(),
  email: z.string().email(),
  password: z.string(),
});

export default async function authRoutes(app: FastifyInstance) {
  app.post('/auth/register', async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    try {
      const result = await registerTenant(parsed.data);
      const token = app.jwt.sign({
        sub: result.userId,
        tenantId: result.tenantId,
        permissions: result.permissions,
      });
      return reply.code(201).send({ token });
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.post('/auth/login', async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    try {
      const result = await login(parsed.data);
      const token = app.jwt.sign({
        sub: result.userId,
        tenantId: result.tenantId,
        permissions: result.permissions,
      });
      return reply.send({ token });
    } catch {
      return reply.code(401).send({ error: 'invalid credentials' });
    }
  });

  app.get('/auth/me', { preHandler: app.authenticate }, async (request, reply) => {
    const { sub, tenantId } = request.user;
    const me = await getMe(tenantId, sub);
    return reply.send(me);
  });

  // Demonstrates the RBAC preHandler chain (auth then permission) -- the first real
  // resource-protected route lands with the ticketing module in Phase 1.
  app.get(
    '/auth/admin-ping',
    { preHandler: [app.authenticate, requirePermission('users:manage')] },
    async (_request, reply) => reply.send({ ok: true }),
  );
}
