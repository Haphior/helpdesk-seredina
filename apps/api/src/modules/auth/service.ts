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
      select: { id: true, email: true, name: true, role: { select: { key: true } } },
    });
    if (!user) throw new Error('user not found');
    return user;
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
