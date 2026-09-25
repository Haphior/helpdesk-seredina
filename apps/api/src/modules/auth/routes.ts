import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePermission } from '../rbac/permissions';
import { PERMISSIONS, type Permission } from '@seredina/shared';
import {
  completeTour,
  createRole,
  createUser,
  deleteRole,
  getActiveUserPermissions,
  getMe,
  listRoles,
  listUsers,
  login,
  registerTenant,
  resetUserPassword,
  SsoRequiredError,
  unlockUser,
  updateRole,
  updateUser,
} from './service';
import { auditRequest, recordAudit, requestOrigin } from '../audit/service';
import {
  changeOwnPassword,
  completePasswordSetup,
  describeSetupToken,
  hasConnectedEmailChannel,
  PasswordError,
  requestPasswordReset,
  sendInvitation,
} from './password';
import {
  beginMfaSetup,
  beginMfaSetupForLogin,
  completeMfaLogin,
  completeMfaSetupForLogin,
  confirmMfaSetup,
  disableMfa,
  getMfaStatus,
  issueMfaChallenge,
  MfaError,
  regenerateRecoveryCodes,
  resetUserMfa,
  setMfaRequired,
} from './mfa';

const registerSchema = z.object({
  tenantSlug: z
    .string()
    .min(2)
    .max(63)
    .regex(/^[a-z0-9-]+$/, 'tenantSlug must be lowercase alphanumeric with hyphens'),
  tenantName: z.string().min(1),
  adminEmail: z.string().email(),
  adminName: z.string().min(1),
  password: z.string().min(8).max(128),
});

const loginSchema = z.object({
  tenantSlug: z.string(),
  email: z.string().email(),
  password: z.string(),
});

// Either a password the admin shares, or `invite: true` to email the person a
// link to choose their own (docs/adr/0067-account-self-service.md).
const createUserSchema = z
  .object({
    email: z.string().email(),
    name: z.string().min(1),
    password: z.string().min(8).max(128).optional(),
    invite: z.boolean().optional(),
    roleKey: z.string().min(1),
  })
  .refine((v) => (v.invite ? v.password === undefined : v.password !== undefined), {
    message: 'give an initial password, or send an invitation instead',
    path: ['password'],
  });

const newPassword = z.string().min(8).max(128);

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

const resetPasswordSchema = z.object({ password: z.string().min(8).max(128) });

const mfaTokenSchema = z.object({ mfaToken: z.string().min(1).max(2000) });
const mfaCodeSchema = z.object({ code: z.string().min(1).max(32) });
const mfaLoginSchema = mfaTokenSchema.merge(mfaCodeSchema);

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
        await recordAudit(result.tenantId, {
          action: 'tenant.registered',
          actorType: 'user',
          actorUserId: result.userId,
          actorLabel: parsed.data.adminEmail,
          target: { type: 'tenant', id: result.tenantId, label: parsed.data.tenantSlug },
          ...requestOrigin(request),
        });
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
        const result = await login(parsed.data, requestOrigin(request));
        // Password right, second step owed: no session yet, just a 5-minute
        // token for the next request (docs/adr/0061-mfa-totp.md).
        if (result.mfa === 'verify') return reply.send({ mfaRequired: true, mfaToken: issueMfaChallenge(result) });
        if (result.mfa === 'setup') return reply.send({ mfaSetupRequired: true, mfaToken: issueMfaChallenge(result) });
        const token = app.jwt.sign({
          sub: result.userId,
          tenantId: result.tenantId,
          permissions: result.permissions,
        });
        return reply.send({ token });
      } catch (err) {
        if (err instanceof SsoRequiredError) return reply.code(403).send({ error: err.message, ssoRequired: true });
        return reply.code(401).send({ error: 'invalid credentials' });
      }
    },
  );

  const signSession = (result: { userId: string; tenantId: string; permissions: Permission[] }) =>
    app.jwt.sign({ sub: result.userId, tenantId: result.tenantId, permissions: result.permissions });

  const mfaFailure = (reply: import('fastify').FastifyReply, err: unknown) => {
    if (err instanceof MfaError) return reply.code(401).send({ error: err.message });
    throw err;
  };

  // Second step of sign-in: same per-IP limit as the password step. Wrong codes
  // also count toward the per-account lockout.
  app.post('/auth/login/mfa', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = mfaLoginSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      const result = await completeMfaLogin(parsed.data.mfaToken, parsed.data.code, requestOrigin(request));
      return reply.send({ token: signSession(result) });
    } catch (err) {
      return mfaFailure(reply, err);
    }
  });

  // Enrollment during sign-in, when the workspace requires MFA.
  app.post('/auth/login/mfa-setup', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = mfaTokenSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      return reply.send(await beginMfaSetupForLogin(parsed.data.mfaToken));
    } catch (err) {
      return mfaFailure(reply, err);
    }
  });

  app.post('/auth/login/mfa-setup/confirm', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = mfaLoginSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      const { auth, recoveryCodes } = await completeMfaSetupForLogin(parsed.data.mfaToken, parsed.data.code, requestOrigin(request));
      return reply.send({ token: signSession(auth), recoveryCodes });
    } catch (err) {
      return mfaFailure(reply, err);
    }
  });

  // Self-service MFA for the signed-in user.
  app.get('/auth/mfa', { preHandler: app.authenticate }, async (request, reply) => {
    return reply.send(await getMfaStatus(request.user.tenantId, request.user.sub));
  });

  app.post('/auth/mfa/setup', { preHandler: app.authenticate }, async (request, reply) => {
    return reply.send(await beginMfaSetup(request.user.tenantId, request.user.sub));
  });

  app.post('/auth/mfa/enable', { preHandler: app.authenticate, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = mfaCodeSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      const recoveryCodes = await confirmMfaSetup(request.user.tenantId, request.user.sub, parsed.data.code);
      await auditRequest(request, 'auth.mfa_enabled', { type: 'user', id: request.user.sub });
      return reply.send({ recoveryCodes });
    } catch (err) {
      if (err instanceof MfaError) return reply.code(400).send({ error: err.message });
      throw err;
    }
  });

  app.post('/auth/mfa/disable', { preHandler: app.authenticate, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = z.object({ password: z.string().min(1).max(128) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      await disableMfa(request.user.tenantId, request.user.sub, parsed.data.password);
      await auditRequest(request, 'auth.mfa_disabled', { type: 'user', id: request.user.sub });
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof MfaError) return reply.code(400).send({ error: err.message });
      throw err;
    }
  });

  app.post(
    '/auth/mfa/recovery-codes',
    { preHandler: app.authenticate, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const parsed = mfaCodeSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      try {
        const recoveryCodes = await regenerateRecoveryCodes(request.user.tenantId, request.user.sub, parsed.data.code);
        await auditRequest(request, 'auth.mfa_recovery_codes_regenerated', { type: 'user', id: request.user.sub });
        return reply.send({ recoveryCodes });
      } catch (err) {
        if (err instanceof MfaError) return reply.code(400).send({ error: err.message });
        throw err;
      }
    },
  );

  // Workspace policy: everyone must use MFA.
  app.patch('/auth/mfa-policy', { preHandler: [app.authenticate, requirePermission('users:manage')] }, async (request, reply) => {
    const parsed = z.object({ required: z.boolean() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      await setMfaRequired(request.user.tenantId, request.user.sub, parsed.data.required);
      await auditRequest(request, 'tenant.mfa_policy_changed', { type: 'tenant', id: request.user.tenantId }, { required: parsed.data.required });
      return reply.send({ required: parsed.data.required });
    } catch (err) {
      if (err instanceof MfaError) return reply.code(400).send({ error: err.message });
      throw err;
    }
  });

  app.post(
    '/users/:id/mfa/reset',
    { preHandler: [app.authenticate, requirePermission('users:manage')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        const { email } = await resetUserMfa(request.user.tenantId, id);
        await auditRequest(request, 'user.mfa_reset', { type: 'user', id, label: email });
        return reply.code(204).send();
      } catch (err) {
        return reply.code(404).send({ error: (err as Error).message });
      }
    },
  );

  app.get('/auth/me', { preHandler: app.authenticate }, async (request, reply) => {
    const { sub, tenantId } = request.user;
    const me = await getMe(tenantId, sub);
    return reply.send(me);
  });

  // No permission gate beyond being logged in -- every user marks their own
  // tour done/skipped, never someone else's.
  app.post('/auth/complete-tour', { preHandler: app.authenticate }, async (request, reply) => {
    const { sub, tenantId } = request.user;
    const result = await completeTour(tenantId, sub);
    return reply.send(result);
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
      const { invite, ...input } = parsed.data;
      // Checked before the account exists, so a failed invitation never leaves
      // behind an account nobody can sign in to.
      if (invite && !(await hasConnectedEmailChannel(request.user.tenantId))) {
        return reply.code(409).send({ error: 'Connect an email channel first: invitations are sent from it.' });
      }
      let user;
      try {
        user = await createUser(request.user.tenantId, input, request.user.permissions);
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
      await auditRequest(request, invite ? 'user.invited' : 'user.created', { type: 'user', id: user.id, label: user.email }, { role: input.roleKey });
      if (invite) {
        const inviter = await getMe(request.user.tenantId, request.user.sub).catch(() => null);
        try {
          await sendInvitation(request.user.tenantId, user.id, inviter?.name ?? null);
        } catch (err) {
          request.log.error({ err }, 'failed to queue an invitation');
          return reply.code(201).send({ ...user, invitationSent: false });
        }
      }
      return reply.code(201).send({ ...user, invitationSent: Boolean(invite) });
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
        const user = await updateUser(request.user.tenantId, id, parsed.data, {
          id: request.user.sub,
          permissions: request.user.permissions,
        });
        const target = { type: 'user', id: user.id, label: user.email };
        if (parsed.data.roleKey) await auditRequest(request, 'user.role_changed', target, { role: parsed.data.roleKey });
        if (parsed.data.isActive === false) await auditRequest(request, 'user.deactivated', target);
        if (parsed.data.isActive === true) await auditRequest(request, 'user.reactivated', target);
        if (parsed.data.name) await auditRequest(request, 'user.renamed', target, { name: parsed.data.name });
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
        await auditRequest(request, 'user.unlocked', { type: 'user', id });
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
        await auditRequest(request, 'user.password_reset', { type: 'user', id });
        return reply.code(204).send();
      } catch (err) {
        return reply.code(404).send({ error: (err as Error).message });
      }
    },
  );

  app.post(
    '/users/:id/invite',
    { preHandler: [app.authenticate, requirePermission('users:manage')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!z.string().uuid().safeParse(id).success) return reply.code(404).send({ error: 'user not found' });
      try {
        const inviter = await getMe(request.user.tenantId, request.user.sub).catch(() => null);
        await sendInvitation(request.user.tenantId, id, inviter?.name ?? null);
        await auditRequest(request, 'user.invite_sent', { type: 'user', id });
        return reply.code(202).send({ ok: true });
      } catch (err) {
        if (err instanceof PasswordError) return reply.code(err.status).send({ error: err.message });
        throw err;
      }
    },
  );

  // --- Account self-service (docs/adr/0067-account-self-service.md) ---------

  // Your own password. Ends your other sessions; this one gets a fresh token.
  app.post(
    '/auth/password',
    { preHandler: app.authenticate, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const parsed = z.object({ currentPassword: z.string().min(1).max(200), newPassword }).safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      const { tenantId, sub } = request.user;
      try {
        await changeOwnPassword(tenantId, sub, parsed.data.currentPassword, parsed.data.newPassword);
      } catch (err) {
        if (err instanceof PasswordError) return reply.code(err.status).send({ error: err.message });
        throw err;
      }
      await auditRequest(request, 'auth.password_changed', { type: 'user', id: sub });
      const permissions = await getActiveUserPermissions(tenantId, sub);
      return reply.send({ token: app.jwt.sign({ sub, tenantId, permissions: permissions ?? [] }) });
    },
  );

  // Same answer whether or not the address has an account.
  app.post(
    '/auth/password/forgot',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const parsed = z.object({ tenantSlug: z.string().min(1).max(63), email: z.string().email().max(320) }).safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Enter your organization and a valid email address.' });
      await requestPasswordReset(parsed.data.tenantSlug, parsed.data.email);
      return reply.code(202).send({ ok: true });
    },
  );

  // What a reset or invitation link is for, before anything changes.
  app.post(
    '/auth/password/token',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const parsed = z.object({ token: z.string().min(1).max(2000) }).safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'missing token' });
      try {
        return reply.send(await describeSetupToken(parsed.data.token));
      } catch (err) {
        if (err instanceof PasswordError) return reply.code(err.status).send({ error: err.message });
        throw err;
      }
    },
  );

  app.post(
    '/auth/password/set',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const parsed = z.object({ token: z.string().min(1).max(2000), password: newPassword }).safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      try {
        const done = await completePasswordSetup(parsed.data.token, parsed.data.password);
        await recordAudit(done.tenantId, {
          action: done.kind === 'invite' ? 'user.invite_accepted' : 'auth.password_reset_by_email',
          actorType: 'user',
          actorUserId: done.userId,
          actorLabel: done.email,
          target: { type: 'user', id: done.userId, label: done.email },
          ...requestOrigin(request),
        });
        return reply.send({ tenantSlug: done.tenantSlug, email: done.email });
      } catch (err) {
        if (err instanceof PasswordError) return reply.code(err.status).send({ error: err.message });
        throw err;
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
      await auditRequest(request, 'role.created', { type: 'role', id: role.id, label: role.key }, { permissions: role.permissions });
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
      await auditRequest(request, 'role.updated', { type: 'role', id: role.id, label: role.key }, {
        ...(parsed.data.name ? { name: parsed.data.name } : {}),
        ...(parsed.data.permissions ? { permissions: role.permissions } : {}),
      });
      return reply.send(role);
    } catch (err) {
      return reply.code(404).send({ error: (err as Error).message });
    }
  });

  app.delete('/roles/:id', { preHandler: [app.authenticate, requirePermission('roles:manage')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      await deleteRole(request.user.tenantId, id);
      await auditRequest(request, 'role.deleted', { type: 'role', id });
      return reply.code(204).send();
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });
}
