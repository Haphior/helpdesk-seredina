import { prisma, withTenantTx } from '@seredina/db';

/**
 * The fixed catalog of widget types -- validated here (zod at the route
 * layer references this array), not a DB enum, same posture as everywhere
 * else a fixed string set is checked in this codebase.
 */
export const WIDGET_TYPES = [
  'onboarding_checklist',
  'ticket_volume',
  'priority_breakdown',
  'sla_compliance',
  'csat_score',
  'agent_workload',
  'recent_activity',
] as const;
export type WidgetType = (typeof WIDGET_TYPES)[number];

// onboarding_checklist first -- "the first widget you see is literally the
// tour's checklist" (docs/ROADMAP.md). Dismissible for free: it's a widget
// like any other, so the existing hide toggle already covers "I'm done with
// this," no separate dismiss mechanism needed.
const DEFAULT_ORDER: Record<WidgetType, number> = {
  onboarding_checklist: 0,
  ticket_volume: 1,
  priority_breakdown: 2,
  sla_compliance: 3,
  csat_score: 4,
  agent_workload: 5,
  recent_activity: 6,
};

export interface DashboardPref {
  widgetType: WidgetType;
  visible: boolean;
  sortOrder: number;
}

/**
 * A widget type with no row for this user shows at its default
 * position/visibility -- the same "no row = default" shape SlaPolicy
 * already uses. Only a user who actually hides or reorders something ever
 * gets a row written.
 */
export async function getDashboardPrefs(tenantId: string, userId: string): Promise<DashboardPref[]> {
  const rows = await withTenantTx(prisma, tenantId, (tx) => tx.dashboardWidget.findMany({ where: { userId } }));
  const byType = new Map(rows.map((r) => [r.widgetType, r]));

  return WIDGET_TYPES.map((widgetType) => {
    const row = byType.get(widgetType);
    return {
      widgetType,
      visible: row?.visible ?? true,
      sortOrder: row?.sortOrder ?? DEFAULT_ORDER[widgetType],
    };
  }).sort((a, b) => a.sortOrder - b.sortOrder);
}

const SEEDED_STATUS_KEYS = new Set(['open', 'pending', 'resolved', 'closed']);

export interface OnboardingChecklistItem {
  key: string;
  label: string;
  done: boolean;
  href: string;
}

/**
 * The tour ROADMAP.md asked for, expressed as real tenant-data checks
 * rather than a one-time "did you click through" flag -- an established
 * tenant that already has an SLA policy, a macro, a customized status, and
 * more than one user has genuinely finished onboarding, whether or not
 * anyone ever saw this exact widget. The four line up with the roadmap's
 * own suggested examples (custom status, macro, SLA policy) plus the one
 * near-universal SaaS-onboarding step it didn't mention: inviting a teammate.
 */
export async function getOnboardingChecklist(tenantId: string): Promise<{ items: OnboardingChecklistItem[]; allDone: boolean }> {
  const [statuses, slaPolicyCount, macroCount, userCount] = await withTenantTx(prisma, tenantId, (tx) =>
    Promise.all([
      tx.ticketStatus.findMany({ select: { key: true } }),
      tx.slaPolicy.count(),
      tx.macro.count(),
      tx.user.count(),
    ]),
  );

  const items: OnboardingChecklistItem[] = [
    {
      key: 'customize_status',
      label: 'Customize your ticket statuses',
      done: statuses.some((s) => !SEEDED_STATUS_KEYS.has(s.key)),
      href: '/ticket-statuses',
    },
    { key: 'set_sla_policy', label: 'Set an SLA policy', done: slaPolicyCount > 0, href: '/sla-policies' },
    { key: 'create_macro', label: 'Create a macro', done: macroCount > 0, href: '/macros' },
    { key: 'invite_teammate', label: 'Invite a teammate', done: userCount > 1, href: '/users' },
  ];

  return { items, allDone: items.every((i) => i.done) };
}

export interface UpsertDashboardPrefInput {
  widgetType: string;
  visible?: boolean;
  sortOrder?: number;
}

export async function upsertDashboardPref(tenantId: string, userId: string, input: UpsertDashboardPrefInput) {
  if (!WIDGET_TYPES.includes(input.widgetType as WidgetType)) {
    throw new Error('unknown widget type');
  }

  return withTenantTx(prisma, tenantId, (tx) =>
    tx.dashboardWidget.upsert({
      where: { userId_widgetType: { userId, widgetType: input.widgetType } },
      create: {
        tenantId,
        userId,
        widgetType: input.widgetType,
        visible: input.visible ?? true,
        sortOrder: input.sortOrder ?? DEFAULT_ORDER[input.widgetType as WidgetType],
      },
      update: {
        ...(input.visible !== undefined ? { visible: input.visible } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      },
    }),
  );
}
