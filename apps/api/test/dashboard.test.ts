import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma, withTenantTx } from '@seredina/db';
import { getDashboardPrefs, upsertDashboardPref, WIDGET_TYPES } from '../src/modules/dashboard/service';

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('dashboard widget prefs', () => {
  let tenantId: string;
  let userId: string;

  beforeAll(async () => {
    tenantId = randomUUID();
    await withTenantTx(prisma, tenantId, (tx) =>
      tx.tenant.create({ data: { id: tenantId, slug: `dash-${tenantId.slice(0, 8)}`, name: 'Dashboard Test' } }),
    );
    userId = await withTenantTx(prisma, tenantId, async (tx) => {
      const u = await tx.user.create({ data: { tenantId, email: 'dash-user@example.com', name: 'Dash User', passwordHash: 'x' } });
      return u.id;
    });
  });

  it('with no rows at all, returns every widget type visible, at its default order', async () => {
    const prefs = await getDashboardPrefs(tenantId, userId);
    expect(prefs).toHaveLength(WIDGET_TYPES.length);
    expect(prefs.every((p) => p.visible)).toBe(true);
    // default order matches the WIDGET_TYPES catalog order
    expect(prefs.map((p) => p.widgetType)).toEqual([...WIDGET_TYPES]);
  });

  it('hiding one widget only affects that widget, not the others', async () => {
    await upsertDashboardPref(tenantId, userId, { widgetType: 'agent_workload', visible: false });
    const prefs = await getDashboardPrefs(tenantId, userId);
    expect(prefs.find((p) => p.widgetType === 'agent_workload')?.visible).toBe(false);
    expect(prefs.find((p) => p.widgetType === 'ticket_volume')?.visible).toBe(true);
  });

  it('reordering a widget changes the returned sort order', async () => {
    await upsertDashboardPref(tenantId, userId, { widgetType: 'recent_activity', sortOrder: -1 });
    const prefs = await getDashboardPrefs(tenantId, userId);
    expect(prefs[0].widgetType).toBe('recent_activity');
  });

  it('rejects an unknown widget type', async () => {
    await expect(upsertDashboardPref(tenantId, userId, { widgetType: 'not_a_real_widget' })).rejects.toThrow('unknown widget type');
  });
});
