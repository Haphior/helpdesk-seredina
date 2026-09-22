import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma, withTenantTx } from '@seredina/db';
import { getDashboardPrefs, getOnboardingChecklist, upsertDashboardPref, WIDGET_TYPES } from '../src/modules/dashboard/service';

// The original 7 widgets default to visible so an existing dashboard never
// silently changes shape; the ones added by the dashboard-builder pass
// default to hidden -- they belong in the "Add widget" catalog, not
// unasked-for on every dashboard. Keep this list in sync with
// dashboard/service.ts's own DEFAULT_VISIBLE map.
const DEFAULT_HIDDEN_WIDGETS = ['channel_breakdown', 'my_open_tickets', 'unassigned_open_tickets', 'quick_links'];
import { createMacro } from '../src/modules/macros/service';
import { upsertSlaPolicy } from '../src/modules/sla/service';
import { createTicketStatus, seedDefaultTicketStatuses } from '../src/modules/tickets/service';

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

  it('with no rows at all, returns every widget at its default visibility/order/size', async () => {
    const prefs = await getDashboardPrefs(tenantId, userId);
    expect(prefs).toHaveLength(WIDGET_TYPES.length);
    // the original 7 default visible; the dashboard-builder additions default hidden
    for (const p of prefs) {
      expect(p.visible).toBe(!DEFAULT_HIDDEN_WIDGETS.includes(p.widgetType));
      expect(p.size).toBe('normal');
    }
    // default order matches the WIDGET_TYPES catalog order
    expect(prefs.map((p) => p.widgetType)).toEqual([...WIDGET_TYPES]);
  });

  it('adding a default-hidden widget makes it visible and keeps the rest untouched', async () => {
    await upsertDashboardPref(tenantId, userId, { widgetType: 'my_open_tickets', visible: true });
    const prefs = await getDashboardPrefs(tenantId, userId);
    expect(prefs.find((p) => p.widgetType === 'my_open_tickets')?.visible).toBe(true);
    expect(prefs.find((p) => p.widgetType === 'unassigned_open_tickets')?.visible).toBe(false);
  });

  it('resizing a widget persists and defaults everything else to normal', async () => {
    await upsertDashboardPref(tenantId, userId, { widgetType: 'ticket_volume', size: 'wide' });
    const prefs = await getDashboardPrefs(tenantId, userId);
    expect(prefs.find((p) => p.widgetType === 'ticket_volume')?.size).toBe('wide');
    expect(prefs.find((p) => p.widgetType === 'priority_breakdown')?.size).toBe('normal');
  });

  it('rejects an unknown widget size', async () => {
    await expect(upsertDashboardPref(tenantId, userId, { widgetType: 'ticket_volume', size: 'huge' })).rejects.toThrow(
      'unknown widget size',
    );
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

describe.skipIf(!hasDb)('onboarding checklist', () => {
  let tenantId: string;

  beforeAll(async () => {
    tenantId = randomUUID();
    await withTenantTx(prisma, tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, slug: `onboard-${tenantId.slice(0, 8)}`, name: 'Onboarding Test' } });
      await seedDefaultTicketStatuses(tx, tenantId);
      await tx.user.create({ data: { tenantId, email: 'solo-admin@example.com', name: 'Solo Admin', passwordHash: 'x' } });
    });
  });

  it('a fresh tenant with only the seeded defaults and one user has every item undone', async () => {
    const { items, allDone } = await getOnboardingChecklist(tenantId);
    expect(items.every((i) => !i.done)).toBe(true);
    expect(allDone).toBe(false);
  });

  it('each item flips to done independently as the tenant actually does the thing', async () => {
    await createTicketStatus(tenantId, { key: 'waiting_on_vendor', label: 'Waiting on Vendor', category: 'PENDING' });
    let { items } = await getOnboardingChecklist(tenantId);
    expect(items.find((i) => i.key === 'customize_status')?.done).toBe(true);
    expect(items.find((i) => i.key === 'set_sla_policy')?.done).toBe(false);

    await upsertSlaPolicy(tenantId, { priority: 'URGENT', firstResponseMinutes: 15, resolutionMinutes: 60, businessHoursOnly: false });
    ({ items } = await getOnboardingChecklist(tenantId));
    expect(items.find((i) => i.key === 'set_sla_policy')?.done).toBe(true);
    expect(items.find((i) => i.key === 'create_macro')?.done).toBe(false);

    await createMacro(tenantId, { name: 'Close it', actions: { setPriority: 'LOW' } });
    ({ items } = await getOnboardingChecklist(tenantId));
    expect(items.find((i) => i.key === 'create_macro')?.done).toBe(true);
    expect(items.find((i) => i.key === 'invite_teammate')?.done).toBe(false);

    await withTenantTx(prisma, tenantId, (tx) =>
      tx.user.create({ data: { tenantId, email: 'second-user@example.com', name: 'Second User', passwordHash: 'x' } }),
    );
    const final = await getOnboardingChecklist(tenantId);
    expect(final.items.every((i) => i.done)).toBe(true);
    expect(final.allDone).toBe(true);
  });
});
