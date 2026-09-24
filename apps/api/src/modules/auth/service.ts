import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { DEFAULT_ROLES, PERMISSIONS, type Permission } from '@seredina/shared';
import { prisma, withTenantTx } from '@seredina/db';
import { countTenants, resolveTenantIdBySlug } from '../tenants/service';
import { seedDefaultTicketStatuses } from '../tickets/service';
import { seedDefaultTeam } from '../teams/service';
import { recordAudit } from '../audit/service';

/** Where a sign-in attempt came from, for the audit log. */
export interface RequestOrigin {
  ipAddress: string | null;
  userAgent: string | null;
}

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
  /**
   * Set when the password was right but a second step is still owed
   * (docs/adr/0061-mfa-totp.md): 'verify' = enter a code from the app,
   * 'setup' = the tenant requires MFA and this user hasn't enrolled yet. No
   * session token may be issued while this is set.
   */
  mfa?: 'verify' | 'setup';
}

export async function registerTenant(input: RegisterTenantInput): Promise<AuthResult> {
  const mode = process.env.SEREDINA_MODE === 'self_hosted' ? 'self_hosted' : 'cloud';

  // Self-hosted is architecturally single-tenant (see docs/PRODUCT.md) -- this
  // was previously unenforced: /register behaved identically in both modes,
  // so a self-hosted operator could accidentally create a second, orphaned
  // tenant with no UI ever pointing at it. The first registration (bootstrapping
  // the one tenant) still works; count_tenants() is the same "no tenant context
  // to check from yet" SECURITY DEFINER escape hatch as resolveTenantIdBySlug,
  // used here for the same reason -- see prisma/rls/policies.sql.
  if (mode === 'self_hosted' && (await countTenants()) > 0) {
    throw new Error('this self-hosted instance already has a tenant -- self-hosted mode supports exactly one');
  }

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
      data: { id: tenantId, slug: input.tenantSlug, name: input.tenantName, mode },
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
export const MAX_FAILED_LOGIN_ATTEMPTS = 5;
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

// Compared against when there's no real hash to check (unknown email, locked or
// inactive account), so every login attempt pays the same bcrypt cost. Without
// it, "no such user" answers in ~1ms while a wrong password takes ~200ms, and
// the identical 'invalid credentials' message stops mattering -- response time
// alone enumerates which emails have accounts.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('seredina-login-timing-equalizer', 12);

type LoginFailure = 'unknown_user' | 'account_inactive' | 'account_locked' | 'wrong_password' | 'sso_required';

/**
 * The password was right, but this workspace signs in through its identity
 * provider (docs/adr/0062-sso-oidc.md). Only thrown after the password
 * checked out, so it reveals nothing to someone guessing.
 */
export class SsoRequiredError extends Error {}

export async function login(input: LoginInput, origin: RequestOrigin = { ipAddress: null, userAgent: null }): Promise<AuthResult> {
  const tenantId = await resolveTenantIdBySlug(input.tenantSlug);
  if (!tenantId) {
    throw new Error('invalid credentials');
  }

  // Filled in inside the transaction, written to the audit log after it commits.
  let failure: LoginFailure | null = null;
  let failedUserId: string | null = null;
  let justLockedOut = false;

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

    if (!user || !user.isActive || (user.lockedUntil && user.lockedUntil > new Date())) {
      await bcrypt.compare(input.password, DUMMY_PASSWORD_HASH);
      failure = !user ? 'unknown_user' : !user.isActive ? 'account_inactive' : 'account_locked';
      failedUserId = user?.id ?? null;
      return null;
    }

    const valid = await bcrypt.compare(input.password, user.passwordHash);
    if (!valid) {
      const failedLoginAttempts = user.failedLoginAttempts + 1;
      const lockedOut = failedLoginAttempts >= MAX_FAILED_LOGIN_ATTEMPTS;
      failure = 'wrong_password';
      failedUserId = user.id;
      justLockedOut = lockedOut;
      await tx.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: lockedOut ? 0 : failedLoginAttempts,
          lockedUntil: lockedOut ? new Date(Date.now() + LOCKOUT_DURATION_MS) : null,
        },
      });
      return null;
    }

    // SSO enforced: password sign-in is kept only for admins, as the way back in
    // if the identity provider is down or misconfigured.
    const sso = await tx.tenantSsoSettings.findUnique({ where: { tenantId }, select: { enabled: true, enforced: true } });
    if (sso?.enabled && sso.enforced && user.role?.key !== 'admin') {
      failure = 'sso_required';
      failedUserId = user.id;
      return null;
    }

    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { mfaRequired: true } });
    const mfa: AuthResult['mfa'] = user.mfaEnabledAt ? 'verify' : tenant.mfaRequired ? 'setup' : undefined;

    // With a second step still owed, the failed-attempt counter is left alone:
    // resetting it on the password alone would let someone who has the password
    // retry codes forever by signing in again between guesses. It resets once
    // the code is right (see mfa.ts).
    if (!mfa && user.failedLoginAttempts > 0) {
      await tx.user.update({ where: { id: user.id }, data: { failedLoginAttempts: 0, lockedUntil: null } });
    }

    const permissions = (user.role?.permissions.map((rp) => rp.permission.key) ?? []) as Permission[];

    return { tenantId, userId: user.id, permissions, mfa };
  });

  const actor = { actorLabel: input.email, ...origin };
  if (!result) {
    await recordAudit(tenantId, {
      action: 'auth.login_failed',
      actorType: failedUserId ? 'user' : 'anonymous',
      actorUserId: failedUserId,
      metadata: { reason: failure },
      ...actor,
    });
    if (justLockedOut) {
      await recordAudit(tenantId, {
        action: 'auth.account_locked',
        actorType: 'system',
        target: { type: 'user', id: failedUserId, label: input.email },
        metadata: { failedAttempts: MAX_FAILED_LOGIN_ATTEMPTS, lockMinutes: LOCKOUT_DURATION_MS / 60_000 },
        ...origin,
      });
    }
    if (failure === 'sso_required') throw new SsoRequiredError('This workspace signs in with single sign-on.');
    throw new Error('invalid credentials');
  }

  // With MFA pending, success is recorded once the code checks out (mfa.ts).
  if (!result.mfa) {
    await recordAudit(tenantId, { action: 'auth.login_succeeded', actorType: 'user', actorUserId: result.userId, ...actor });
  }
  return result;
}

/**
 * Called by the JWT plugin's authenticate() on every request: the user's
 * CURRENT permissions, or null if they no longer exist or were deactivated.
 * The permissions baked into the token at login are never trusted for
 * authorization -- they'd keep a demoted or deactivated user's old access
 * alive until the token expired.
 */
export async function getActiveUserPermissions(tenantId: string, userId: string): Promise<Permission[] | null> {
  const user = await withTenantTx(prisma, tenantId, (tx) =>
    tx.user.findUnique({
      where: { id: userId },
      select: { isActive: true, role: { select: { permissions: { select: { permission: { select: { key: true } } } } } } },
    }),
  );
  if (!user || !user.isActive) return null;
  return (user.role?.permissions.map((rp) => rp.permission.key) ?? []) as Permission[];
}

/**
 * users:manage is not a license to hand out more access than the caller has --
 * otherwise a custom role with users:manage but not roles:manage (e.g. an HR
 * role) could assign 'admin' to itself or mint a new admin account. Throws if
 * the role carries any permission the caller lacks.
 */
export function assertCanAssignRole(rolePermissionKeys: string[], callerPermissions: readonly Permission[]) {
  const missing = rolePermissionKeys.filter((key) => !callerPermissions.includes(key as Permission));
  if (missing.length > 0) {
    throw new Error(`cannot assign a role with permissions you don't have: ${missing.join(', ')}`);
  }
}

const ROLE_WITH_PERMISSION_KEYS = { permissions: { select: { permission: { select: { key: true } } } } } as const;

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
        tourCompletedAt: true,
      },
    });
    if (!user) throw new Error('user not found');
    const { tenant, ...rest } = user;
    return { ...rest, tenantName: tenant.name, tenantSlug: tenant.slug };
  });
}

/** Idempotent -- called once when the user finishes or explicitly skips the guided tour. */
export async function completeTour(tenantId: string, userId: string) {
  return withTenantTx(prisma, tenantId, (tx) =>
    tx.user.update({ where: { id: userId }, data: { tourCompletedAt: new Date() }, select: { tourCompletedAt: true } }),
  );
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
        mfaEnabledAt: true,
      },
      orderBy: { name: 'asc' },
    }),
  );
  const now = new Date();
  return users.map(({ lockedUntil, mfaEnabledAt, ...u }) => ({
    ...u,
    isLocked: !!lockedUntil && lockedUntil > now,
    mfaEnabled: Boolean(mfaEnabledAt),
  }));
}

/**
 * Custom roles (Phase 4, docs/adr/0036-phase-4-self-hosted-signup-byok-custom-roles.md):
 * the 3 seeded roles (admin/team_lead/agent) were never structurally special
 * -- Role/Permission/RolePermission were already generic, and login() already
 * derives a user's actual permissions from these real DB rows, never from
 * the DEFAULT_ROLES map (that map is ONLY consulted once, at tenant
 * registration, to seed the starting 3). So a tenant admin creating a 4th
 * role and assigning users to it already works end-to-end the moment the
 * row exists -- this is genuinely just the missing CRUD, not a deeper gap.
 */
export async function listRoles(tenantId: string) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const roles = await tx.role.findMany({
      include: { permissions: { include: { permission: { select: { key: true } } } } },
      orderBy: { key: 'asc' },
    });
    return roles.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      permissions: r.permissions.map((rp) => rp.permission.key) as Permission[],
    }));
  });
}

function validatePermissionKeys(permissions: string[]): void {
  const invalid = permissions.filter((p) => !(PERMISSIONS as readonly string[]).includes(p));
  if (invalid.length > 0) {
    throw new Error(`unknown permission(s): ${invalid.join(', ')}`);
  }
}

export interface CreateRoleInput {
  key: string;
  name: string;
  permissions: Permission[];
}

export async function createRole(tenantId: string, input: CreateRoleInput) {
  validatePermissionKeys(input.permissions);

  return withTenantTx(prisma, tenantId, async (tx) => {
    const existing = await tx.role.findUnique({ where: { tenantId_key: { tenantId, key: input.key } } });
    if (existing) throw new Error('a role with this key already exists');

    const permissionRows = await tx.permission.findMany({ where: { key: { in: input.permissions } } });
    const role = await tx.role.create({ data: { tenantId, key: input.key, name: input.name } });
    for (const p of permissionRows) {
      await tx.rolePermission.create({ data: { tenantId, roleId: role.id, permissionId: p.id } });
    }
    return { id: role.id, key: role.key, name: role.name, permissions: permissionRows.map((p) => p.key) as Permission[] };
  });
}

export interface UpdateRoleInput {
  name?: string;
  permissions?: Permission[];
}

/** `key` is immutable once created -- same convention as CustomFieldDefinition's key. */
export async function updateRole(tenantId: string, id: string, input: UpdateRoleInput) {
  if (input.permissions) validatePermissionKeys(input.permissions);

  return withTenantTx(prisma, tenantId, async (tx) => {
    const existing = await tx.role.findUnique({ where: { id } });
    if (!existing) throw new Error('role not found');

    if (input.name) {
      await tx.role.update({ where: { id }, data: { name: input.name } });
    }

    if (input.permissions) {
      // Full delete+recreate, same pattern as ProcessTemplate's step list --
      // simpler than reconciling an add/remove diff, and RolePermission rows
      // carry no other state that a rebuild would lose.
      await tx.rolePermission.deleteMany({ where: { roleId: id } });
      const permissionRows = await tx.permission.findMany({ where: { key: { in: input.permissions } } });
      for (const p of permissionRows) {
        await tx.rolePermission.create({ data: { tenantId, roleId: id, permissionId: p.id } });
      }
    }

    const updated = await tx.role.findUnique({
      where: { id },
      include: { permissions: { include: { permission: { select: { key: true } } } } },
    });
    return {
      id: updated!.id,
      key: updated!.key,
      name: updated!.name,
      permissions: updated!.permissions.map((rp) => rp.permission.key) as Permission[],
    };
  });
}

/** Blocks deleting 'admin' -- every tenant needs at least one role that can manage users/roles, and this is the one registration always seeds. */
export async function deleteRole(tenantId: string, id: string) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const existing = await tx.role.findUnique({ where: { id } });
    if (!existing) throw new Error('role not found');
    if (existing.key === 'admin') throw new Error('cannot delete the admin role');

    const usersWithRole = await tx.user.count({ where: { roleId: id } });
    if (usersWithRole > 0) {
      throw new Error(`cannot delete a role with ${usersWithRole} user(s) still assigned to it -- reassign them first`);
    }

    await tx.role.delete({ where: { id } });
  });
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
export async function createUser(tenantId: string, input: CreateUserInput, callerPermissions: readonly Permission[]) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const role = await tx.role.findUnique({
      where: { tenantId_key: { tenantId, key: input.roleKey } },
      include: ROLE_WITH_PERMISSION_KEYS,
    });
    if (!role) throw new Error('role not found');
    assertCanAssignRole(role.permissions.map((rp) => rp.permission.key), callerPermissions);

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
 * `caller`, when passed, blocks a self-deactivation -- a lone admin
 * deactivating their own account with nobody else able to log in and
 * reactivate them would be a real footgun -- and a role change to a role with
 * more permissions than the caller holds (see assertCanAssignRole). Optional
 * because not every caller of updateUser is a self-service admin action
 * (there is none today, but a future system-initiated update -- e.g. a bulk
 * offboarding job -- shouldn't be forced to invent a caller it doesn't have).
 */
export async function updateUser(
  tenantId: string,
  userId: string,
  input: UpdateUserInput,
  caller?: { id: string; permissions: readonly Permission[] },
) {
  const callerId = caller?.id;
  if (input.isActive === false && userId === callerId) {
    throw new Error('you cannot deactivate your own account');
  }
  return withTenantTx(prisma, tenantId, async (tx) => {
    const existing = await tx.user.findUnique({ where: { id: userId } });
    if (!existing) throw new Error('user not found');

    let roleId: string | undefined;
    if (input.roleKey) {
      const role = await tx.role.findUnique({
        where: { tenantId_key: { tenantId, key: input.roleKey } },
        include: ROLE_WITH_PERMISSION_KEYS,
      });
      if (!role) throw new Error('role not found');
      if (caller) assertCanAssignRole(role.permissions.map((rp) => rp.permission.key), caller.permissions);
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
