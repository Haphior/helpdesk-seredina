import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma, withTenantTx } from '@seredina/db';
import { checkKbPortalAccess, getKbPortalSettings, updateKbPortalSettings } from '../src/modules/kb/service';

/**
 * KB public portal access control -- see docs/adr/0051-kb-portal-access-control.md.
 * The `requirePermission('tickets:manage_all')` gate on GET/PATCH /kb-settings
 * reuses the same, already-proven mechanism as AI Settings/UI Settings, so it's
 * not re-tested here -- these tests cover what's actually new: the
 * no-row-means-portal-enabled-with-no-code default, and checkKbPortalAccess's
 * three-way disabled/code_required/code_invalid result.
 */
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('KB portal settings', () => {
  let tenantId: string;

  beforeEach(async () => {
    tenantId = randomUUID();
    await withTenantTx(prisma, tenantId, (tx) =>
      tx.tenant.create({ data: { id: tenantId, slug: `kbsettings-${tenantId.slice(0, 8)}`, name: 'KB Settings Tenant' } }),
    );
  });

  it('a fresh tenant with no settings row defaults to portal enabled, no access code', async () => {
    expect(await getKbPortalSettings(tenantId)).toEqual({ portalEnabled: true, hasAccessCode: false });
    expect(await checkKbPortalAccess(tenantId)).toEqual({ ok: true });
  });

  it('disabling the portal persists and blocks access regardless of any code', async () => {
    await updateKbPortalSettings(tenantId, { portalEnabled: false });
    expect(await getKbPortalSettings(tenantId)).toEqual({ portalEnabled: false, hasAccessCode: false });
    expect(await checkKbPortalAccess(tenantId)).toEqual({ ok: false, reason: 'disabled' });
    expect(await checkKbPortalAccess(tenantId, 'whatever')).toEqual({ ok: false, reason: 'disabled' });
  });

  it('setting an access code never returns it, only that one is set', async () => {
    const settings = await updateKbPortalSettings(tenantId, { accessCode: 'letmein' });
    expect(settings).toEqual({ portalEnabled: true, hasAccessCode: true });
  });

  it('an access code gates checkKbPortalAccess: missing, wrong, and correct', async () => {
    await updateKbPortalSettings(tenantId, { accessCode: 'letmein' });
    expect(await checkKbPortalAccess(tenantId)).toEqual({ ok: false, reason: 'code_required' });
    expect(await checkKbPortalAccess(tenantId, 'nope')).toEqual({ ok: false, reason: 'code_invalid' });
    expect(await checkKbPortalAccess(tenantId, 'letmein')).toEqual({ ok: true });
  });

  it('clearing the access code with accessCode: null is a real update, not a no-op', async () => {
    await updateKbPortalSettings(tenantId, { accessCode: 'letmein' });
    await updateKbPortalSettings(tenantId, { accessCode: null });
    expect(await getKbPortalSettings(tenantId)).toEqual({ portalEnabled: true, hasAccessCode: false });
    expect(await checkKbPortalAccess(tenantId)).toEqual({ ok: true });
  });

  it('omitting accessCode on an update leaves an existing code untouched', async () => {
    await updateKbPortalSettings(tenantId, { accessCode: 'letmein' });
    await updateKbPortalSettings(tenantId, { portalEnabled: true });
    expect(await checkKbPortalAccess(tenantId, 'letmein')).toEqual({ ok: true });
  });

  it('settings for one tenant are invisible to another -- RLS scoping applies like any other tenant-owned row', async () => {
    await updateKbPortalSettings(tenantId, { portalEnabled: false, accessCode: 'letmein' });

    const otherTenantId = randomUUID();
    await withTenantTx(prisma, otherTenantId, (tx) =>
      tx.tenant.create({ data: { id: otherTenantId, slug: `kbsettings-other-${otherTenantId.slice(0, 8)}`, name: 'Other Tenant' } }),
    );

    expect(await getKbPortalSettings(otherTenantId)).toEqual({ portalEnabled: true, hasAccessCode: false });
    expect(await checkKbPortalAccess(otherTenantId)).toEqual({ ok: true });
  });
});
