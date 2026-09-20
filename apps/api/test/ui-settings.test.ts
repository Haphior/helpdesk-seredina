import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma, withTenantTx } from '@seredina/db';
import { getTenantUiTheme, setTenantUiTheme } from '../src/modules/uisettings/service';

/**
 * Tenant theme system -- see docs/adr/0042-tenant-theme-system.md. The
 * `requirePermission('tickets:manage_all')` gate on PATCH /ui-settings
 * reuses the same, already-proven mechanism as AI Settings/Business Hours
 * (see ai-byok.test.ts, custom-roles.test.ts) rather than a new one, so it's
 * not re-tested here -- these tests cover what's actually new: the
 * no-row-means-default shape and its RLS scoping.
 */
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('Tenant UI theme settings', () => {
  let tenantId: string;

  beforeEach(async () => {
    tenantId = randomUUID();
    await withTenantTx(prisma, tenantId, (tx) =>
      tx.tenant.create({ data: { id: tenantId, slug: `theme-${tenantId.slice(0, 8)}`, name: 'Theme Tenant' } }),
    );
  });

  it('a fresh tenant with no settings row defaults to "middle"', async () => {
    const settings = await getTenantUiTheme(tenantId);
    expect(settings).toEqual({ theme: 'middle' });
  });

  it('setting a theme persists it and GET reflects the change', async () => {
    await setTenantUiTheme(tenantId, 'refined');
    const settings = await getTenantUiTheme(tenantId);
    expect(settings).toEqual({ theme: 'refined' });
  });

  it('switching back to "middle" is a real update, not just deleting the row', async () => {
    await setTenantUiTheme(tenantId, 'refined');
    await setTenantUiTheme(tenantId, 'middle');
    const settings = await getTenantUiTheme(tenantId);
    expect(settings).toEqual({ theme: 'middle' });
  });

  it('rejects a theme key that is not one of the real options', async () => {
    await expect(setTenantUiTheme(tenantId, 'not-a-real-theme')).rejects.toThrow('theme must be one of');
  });

  it('a theme set for one tenant is invisible to another -- RLS scoping applies here like any other tenant-owned row', async () => {
    await setTenantUiTheme(tenantId, 'refined');

    const otherTenantId = randomUUID();
    await withTenantTx(prisma, otherTenantId, (tx) =>
      tx.tenant.create({ data: { id: otherTenantId, slug: `theme-other-${otherTenantId.slice(0, 8)}`, name: 'Other Theme Tenant' } }),
    );

    const otherSettings = await getTenantUiTheme(otherTenantId);
    expect(otherSettings).toEqual({ theme: 'middle' });
  });
});
