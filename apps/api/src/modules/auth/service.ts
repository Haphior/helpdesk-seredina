import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { DEFAULT_ROLES, type Permission } from '@seredina/shared';
import { prisma, withTenantTx } from '@seredina/db';
import { resolveTenantIdBySlug } from '../tenants/service';
import { seedDefaultTicketStatuses } from '../tickets/service';
import { seedDefaultTeam } from '../teams/service';

export interface RegisterTenantInput {
  tenantSlug: string;
  tenantName: string;
  adminEmail: string;
  adminName: string;
  password: string;
}

export interface AuthResult {
  tenantId: string;
  userId: string;
  permissions: Permission[];
}

export async function registerTenant(input: RegisterTenantInput): Promise<AuthResult> {
  const existing = await resolveTenantIdBySlug(input.tenantSlug);
  if (existing) {
    throw new Error('tenant slug already taken');
  }

  // Minted up front, then bound as this brand-new tenant's own withTenantTx context --
  // creating a tenant is not a bootstrap exemption, it's the same tenant-transaction
  // pattern as everything else, just for an id that doesn't exist in the table yet.
  const tenantId = randomUUID();
  const passwordHash = await bcrypt.hash(input.password, 12);

  return withTenantTx(prisma, tenantId, async (tx) => {
    await tx.tenant.create({
      data: { id: tenantId, slug: input.tenantSlug, name: input.tenantName, mode: 'cloud' },
    });

    const allPermissions = await tx.permission.findMany();
    const permissionIdByKey = new Map(allPermissions.map((p) => [p.key, p.id]));

    let adminRoleId: string | null = null;
    for (const [roleKey, permissionKeys] of Object.entries(DEFAULT_ROLES)) {
      const role = await tx.role.create({ data: { tenantId, key: roleKey, name: roleKey } });
      if (roleKey === 'admin') adminRoleId = role.id;

      for (const permissionKey of permissionKeys) {
        const permissionId = permissionIdByKey.get(permissionKey);
        if (!permissionId) continue; // catalog not seeded yet -- role just ends up with fewer perms
        await tx.rolePermission.create({ data: { tenantId, roleId: role.id, permissionId } });
      }
    }

    const adminUser = await tx.user.create({
      data: { tenantId, email: input.adminEmail, name: input.adminName, passwordHash, roleId: adminRoleId },
    });

    await seedDefaultTicketStatuses(tx, tenantId);
    await seedDefaultTeam(tx, tenantId);

    return { tenantId, userId: adminUser.id, permissions: DEFAULT_ROLES.admin };
  });
}

export interface LoginInput {
  tenantSlug: string;
  email: string;
  password: string;
}

// Account lockout after repeated failed logins. The error thrown on a locked
// account is identical to a wrong password ('invalid credentials') -- same
// anti-enumeration reasoning as everywhere else in this function: a client
// shouldn't be able to distinguish "wrong password," "no such user," or "locked
// out" from the response alone.
const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

export async function login(input: LoginInput): Promise<AuthResult> {
  const tenantId = await resolveTenantIdBySlug(input.tenantSlug);
  if (!tenantId) {
    throw new Error('invalid credentials');
  }

  // Returns null on any failure rather than throwing inside the transaction --
  // throwing here would roll back the whole interactive transaction, INCLUDING the
  // failed-attempt-counter update a few lines below it, silently defeating the
  // lockout this function exists to enforce. Only throw after withTenantTx has
  // returned (and therefore committed).
  const result = await withTenantTx(prisma, tenantId, async (tx) => {
    const user = await tx.user.findUnique({
      where: { tenantId_email: { tenantId, email: input.email } },
      include: { role: { include: { permissions: { include: { permission: true } } } } },
    });

    if (!user) return null;

    if (!user.isActive) return null;

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      return null;
    }

    const valid = await bcrypt.compare(input.password, user.passwordHash);
    if (!valid) {
      const failedLoginAttempts = user.failedLoginAttempts + 1;
      const lockedOut = failedLoginAttempts >= MAX_FAILED_LOGIN_ATTEMPTS;
      await tx.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: lockedOut ? 0 : failedLoginAttempts,
          lockedUntil: lockedOut ? new Date(Date.now() + LOCKOUT_DURATION_MS) : null,
        },
      });
      return null;
    }

    if (user.failedLoginAttempts > 0) {
      await tx.user.update({ where: { id: user.id }, data: { failedLoginAttempts: 0, lockedUntil: null } });
    }

    const permissions = (user.role?.permissions.map((rp) => rp.permission.key) ?? []) as Permission[];

    return { tenantId, userId: user.id, permissions };
  });

  if (!result) throw new Error('invalid credentials');
  return result;
}

export async function getMe(tenantId: string, userId: string) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: { select: { key: true } },
        tenant: { select: { name: true, slug: true } },
      },
    });
    if (!user) throw new Error('user not found');
    const { tenant, ...rest } = user;
    return { ...rest, tenantName: tenant.name, tenantSlug: tenant.slug };
  });
}

/**
 * Agents/admins in the tenant -- used by the web app's assignee picker AND the
 * Users admin page, so it deliberately includes deactivated/locked users too
 * (an admin reactivating someone needs to see them). `isLocked` is derived
 * here rather than exposing lockedUntil's raw timestamp -- "is this account
 * currently locked" is the only thing the UI needs to decide whether to show
 * an unlock button.
 */
export async function listUsers(tenantId: string) {
  const users = await withTenantTx(prisma, tenantId, async (tx) =>
    tx.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: { select: { key: true } },
        isActive: true,
        lockedUntil: true,
      },
      orderBy: { name: 'asc' },
    }),
  );
  const now = new Date();
  return users.map(({ lockedUntil, ...u }) => ({ ...u, isLocked: !!lockedUntil && lockedUntil > now }));
}

/** The tenant's roles (fixed to admin/team_lead/agent for now -- see ROADMAP's "custom roles" backlog item). */
export async function listRoles(tenantId: string) {
  return withTenantTx(prisma, tenantId, async (tx) =>
    tx.role.findMany({ select: { id: true, key: true, name: true }, orderBy: { key: 'asc' } }),
  );
}

export interface CreateUserInput {
  email: string;
  name: string;
  password: string;
  roleKey: string;
}

/**
 * registerTenant creates exactly one user (the first admin) -- this is how a tenant
 * gets any OTHER user. No invite/email flow yet (apps/worker has no email sending
 * built), so an admin sets the initial password directly and shares it out of band;
 * see ROADMAP for that as a deferred follow-up once the email channel exists.
 */
export async function createUser(tenantId: string, input: CreateUserInput) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const role = await tx.role.findUnique({ where: { tenantId_key: { tenantId, key: input.roleKey } } });
    if (!role) throw new Error('role not found');

    const passwordHash = await bcrypt.hash(input.password, 12);
    return tx.user.create({
      data: { tenantId, email: input.email, name: input.name, passwordHash, roleId: role.id },
      select: { id: true, name: true, email: true, role: { select: { key: true } } },
    });
  });
}

export interface UpdateUserInput {
  name?: string;
  roleKey?: string;
  isActive?: boolean;
}

/**
 * `callerId`, when passed, blocks a self-deactivation -- a lone admin
 * deactivating their own account with nobody else able to log in and
 * reactivate them would be a real footgun. Optional because not every caller
 * of updateUser is a self-service admin action (there is none today, but a
 * future system-initiated update -- e.g. a bulk offboarding job -- shouldn't
 * be forced to invent a caller id it doesn't have).
 */
export async function updateUser(tenantId: string, userId: string, input: UpdateUserInput, callerId?: string) {
  if (input.isActive === false && userId === callerId) {
    throw new Error('you cannot deactivate your own account');
  }
  return withTenantTx(prisma, tenantId, async (tx) => {
    const existing = await tx.user.findUnique({ where: { id: userId } });
    if (!existing) throw new Error('user not found');

    let roleId: string | undefined;
    if (input.roleKey) {
      const role = await tx.role.findUnique({ where: { tenantId_key: { tenantId, key: input.roleKey } } });
      if (!role) throw new Error('role not found');
      roleId = role.id;
    }

    return tx.user.update({
      where: { id: userId },
      data: { name: input.name, roleId, isActive: input.isActive },
      select: { id: true, name: true, email: true, role: { select: { key: true } }, isActive: true },
    });
  });
}

/** Clears a lockout early -- an admin's escape hatch for the 15-minute wait in login(). */
export async function unlockUser(tenantId: string, userId: string) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const existing = await tx.user.findUnique({ where: { id: userId } });
    if (!existing) throw new Error('user not found');
    await tx.user.update({ where: { id: userId }, data: { failedLoginAttempts: 0, lockedUntil: null } });
  });
}

/**
 * Same mechanism as createUser's initial password -- an admin sets it directly
 * and shares it out of band, since there's no email/invite flow yet (see
 * createUser's comment). Not exposed as a field on the generic updateUser PATCH:
 * a password change is sensitive enough to be its own explicit action, same
 * reasoning as webhook secret rotation (modules/webhooks/service.ts).
 */
export async function resetUserPassword(tenantId: string, userId: string, newPassword: string) {
  const passwordHash = await bcrypt.hash(newPassword, 12);
  return withTenantTx(prisma, tenantId, async (tx) => {
    const existing = await tx.user.findUnique({ where: { id: userId } });
    if (!existing) throw new Error('user not found');
    // A reset password shouldn't inherit a stale lockout from before the reset.
    await tx.user.update({ where: { id: userId }, data: { passwordHash, failedLoginAttempts: 0, lockedUntil: null } });
  });
}
