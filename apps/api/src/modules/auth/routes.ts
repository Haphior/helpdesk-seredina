import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePermission } from '../rbac/permissions';
import { PERMISSIONS } from '@seredina/shared';
import {
  createRole,
  createUser,
  deleteRole,
  getMe,
  listRoles,
  listUsers,
  login,
  registerTenant,
  resetUserPassword,
  unlockUser,
  updateRole,
  updateUser,
} from './service';

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

const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8),
  roleKey: z.string().min(1),
});

const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  roleKey: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
});

const createRoleSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9_]+$/, 'key must be lowercase alphanumeric with underscores'),
  name: z.string().min(1).max(100),
  permissions: z.array(z.enum(PERMISSIONS)),
});

const updateRoleSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  permissions: z.array(z.enum(PERMISSIONS)).optional(),
});

const resetPasswordSchema = z.object({ password: z.string().min(8) });

export default async function authRoutes(app: FastifyInstance) {
  // Tighter than the global default (see index.ts) -- these are the two routes an
  // automated credential-stuffing/mass-registration attempt would actually hit.
  // Account lockout (service.ts's login()) is a second, independent layer: this
  // limit is per-IP and resets every window, lockout is per-account and doesn't.
  app.post(
    '/auth/register',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request, reply) => {
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
    },
  );

  app.post(
    '/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
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
    },
  );

  app.get('/auth/me', { preHandler: app.authenticate }, async (request, reply) => {
    const { sub, tenantId } = request.user;
    const me = await getMe(tenantId, sub);
    return reply.send(me);
  });

  // Gated on tickets:read, not users:manage -- any agent needs this to populate an
  // assignee picker, not just admins.
  app.get(
    '/users',
    { preHandler: [app.authenticate, requirePermission('tickets:read')] },
    async (request, reply) => {
      const users = await listUsers(request.user.tenantId);
      return reply.send({ users });
    },
  );

  app.post(
    '/users',
    { preHandler: [app.authenticate, requirePermission('users:manage')] },
    async (request, reply) => {
      const parsed = createUserSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.flatten() });
      }
      try {
        const user = await createUser(request.user.tenantId, parsed.data);
        return reply.code(201).send(user);
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  app.patch(
    '/users/:id',
    { preHandler: [app.authenticate, requirePermission('users:manage')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = updateUserSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.flatten() });
      }
      try {
        const user = await updateUser(request.user.tenantId, id, parsed.data, request.user.sub);
        return reply.send(user);
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  app.post(
    '/users/:id/unlock',
    { preHandler: [app.authenticate, requirePermission('users:manage')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        await unlockUser(request.user.tenantId, id);
        return reply.code(204).send();
      } catch (err) {
        return reply.code(404).send({ error: (err as Error).message });
      }
    },
  );

  app.post(
    '/users/:id/reset-password',
    { preHandler: [app.authenticate, requirePermission('users:manage')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = resetPasswordSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.flatten() });
      }
      try {
        await resetUserPassword(request.user.tenantId, id, parsed.data.password);
        return reply.code(204).send();
      } catch (err) {
        return reply.code(404).send({ error: (err as Error).message });
      }
    },
  );

  // Gated on users:manage, not tickets:read -- unlike /users (identities, needed
  // broadly for pickers), the role catalog is an admin/config concern.
  app.get(
    '/roles',
    { preHandler: [app.authenticate, requirePermission('users:manage')] },
    async (request, reply) => {
      const roles = await listRoles(request.user.tenantId);
      return reply.send({ roles });
    },
  );

  // Custom roles (Phase 4, docs/adr/0036-phase-4-self-hosted-signup-byok-custom-roles.md)
  // -- the first real check of roles:manage anywhere in this codebase; it was
  // defined and assigned to admin/team_lead from day one but never actually
  // gated anything until now.
  app.post('/roles', { preHandler: [app.authenticate, requirePermission('roles:manage')] }, async (request, reply) => {
    const parsed = createRoleSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      const role = await createRole(request.user.tenantId, parsed.data);
      return reply.code(201).send(role);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.patch('/roles/:id', { preHandler: [app.authenticate, requirePermission('roles:manage')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateRoleSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      const role = await updateRole(request.user.tenantId, id, parsed.data);
      return reply.send(role);
    } catch (err) {
      return reply.code(404).send({ error: (err as Error).message });
    }
  });

  app.delete('/roles/:id', { preHandler: [app.authenticate, requirePermission('roles:manage')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      await deleteRole(request.user.tenantId, id);
      return reply.code(204).send();
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });
}
