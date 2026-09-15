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

export async function login(input: LoginInput): Promise<AuthResult> {
  const tenantId = await resolveTenantIdBySlug(input.tenantSlug);
  if (!tenantId) {
    throw new Error('invalid credentials');
  }

  return withTenantTx(prisma, tenantId, async (tx) => {
    const user = await tx.user.findUnique({
      where: { tenantId_email: { tenantId, email: input.email } },
      include: { role: { include: { permissions: { include: { permission: true } } } } },
    });

    if (!user) throw new Error('invalid credentials');

    const valid = await bcrypt.compare(input.password, user.passwordHash);
    if (!valid) throw new Error('invalid credentials');

    const permissions = (user.role?.permissions.map((rp) => rp.permission.key) ?? []) as Permission[];

    return { tenantId, userId: user.id, permissions };
  });
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
        tenant: { select: { name: true } },
      },
    });
    if (!user) throw new Error('user not found');
    const { tenant, ...rest } = user;
    return { ...rest, tenantName: tenant.name };
  });
}

/** Agents/admins in the tenant -- used by the web app's assignee picker. */
export async function listUsers(tenantId: string) {
  return withTenantTx(prisma, tenantId, async (tx) =>
    tx.user.findMany({
      select: { id: true, name: true, email: true, role: { select: { key: true } } },
      orderBy: { name: 'asc' },
    }),
  );
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
}

export async function updateUser(tenantId: string, userId: string, input: UpdateUserInput) {
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
      data: { name: input.name, roleId },
      select: { id: true, name: true, email: true, role: { select: { key: true } } },
    });
  });
}
