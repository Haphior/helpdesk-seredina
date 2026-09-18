import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma, withTenantTx } from '@seredina/db';
import { createRole, createUser, deleteRole, listRoles, login, updateRole } from '../src/modules/auth/service';
import { seedDefaultTicketStatuses } from '../src/modules/tickets/service';

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('Custom roles (Phase 4)', () => {
  let tenantId: string;
  let tenantSlug: string;

  beforeEach(async () => {
    tenantId = randomUUID();
    tenantSlug = `custom-roles-${tenantId.slice(0, 8)}`;
    await withTenantTx(prisma, tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, slug: tenantSlug, name: 'Custom Roles Tenant' } });
      await tx.role.create({ data: { tenantId, key: 'admin', name: 'Admin' } });
      await seedDefaultTicketStatuses(tx, tenantId);
    });
  });

  it('creates a role with an arbitrary permission set and lists it back', async () => {
    const role = await createRole(tenantId, { key: 'billing_viewer', name: 'Billing Viewer', permissions: ['tickets:read'] });
    expect(role.permissions).toEqual(['tickets:read']);

    const roles = await listRoles(tenantId);
    const found = roles.find((r) => r.key === 'billing_viewer');
    expect(found?.name).toBe('Billing Viewer');
    expect(found?.permissions).toEqual(['tickets:read']);
  });

  it('rejects an unknown permission key', async () => {
    // @ts-expect-error -- deliberately invalid, service-layer validation is what's under test
    await expect(createRole(tenantId, { key: 'bad', name: 'Bad', permissions: ['not:a:real:permission'] })).rejects.toThrow(
      'unknown permission',
    );
  });

  it('rejects a duplicate role key', async () => {
    await createRole(tenantId, { key: 'dup', name: 'First', permissions: ['tickets:read'] });
    await expect(createRole(tenantId, { key: 'dup', name: 'Second', permissions: ['tickets:read'] })).rejects.toThrow(
      'already exists',
    );
  });

  it('updateRole replaces the permission set entirely and can rename', async () => {
    const role = await createRole(tenantId, { key: 'reviewer', name: 'Reviewer', permissions: ['tickets:read'] });
    const updated = await updateRole(tenantId, role.id, { name: 'Senior Reviewer', permissions: ['tickets:read', 'tickets:write'] });
    expect(updated.name).toBe('Senior Reviewer');
    expect(updated.permissions.sort()).toEqual(['tickets:read', 'tickets:write']);
  });

  it('blocks deleting the admin role', async () => {
    const roles = await listRoles(tenantId);
    const admin = roles.find((r) => r.key === 'admin')!;
    await expect(deleteRole(tenantId, admin.id)).rejects.toThrow('cannot delete the admin role');
  });

  it('blocks deleting a role with users assigned, succeeds once reassigned', async () => {
    const role = await createRole(tenantId, { key: 'temp_role', name: 'Temp Role', permissions: ['tickets:read'] });
    const user = await createUser(tenantId, { email: 'temp@example.com', name: 'Temp User', password: 'password123', roleKey: 'temp_role' });

    await expect(deleteRole(tenantId, role.id)).rejects.toThrow('user(s) still assigned');

    await withTenantTx(prisma, tenantId, (tx) => tx.user.update({ where: { id: user.id }, data: { roleId: null } }));
    await deleteRole(tenantId, role.id); // no throw

    const roles = await listRoles(tenantId);
    expect(roles.some((r) => r.key === 'temp_role')).toBe(false);
  });

  it('a custom role with a narrow permission set actually restricts login-derived permissions for real', async () => {
    await createRole(tenantId, { key: 'read_only', name: 'Read Only', permissions: ['tickets:read'] });
    await createUser(tenantId, { email: 'readonly@example.com', name: 'Read Only User', password: 'password123', roleKey: 'read_only' });

    const result = await login({ tenantSlug, email: 'readonly@example.com', password: 'password123' });
    expect(result.permissions).toEqual(['tickets:read']);
  });
});
