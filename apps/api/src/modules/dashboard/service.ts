import { prisma, withTenantTx } from '@seredina/db';

/**
 * The fixed catalog of widget types -- validated here (zod at the route
 * layer references this array), not a DB enum, same posture as everywhere
 * else a fixed string set is checked in this codebase.
 */
export const WIDGET_TYPES = ['ticket_volume', 'priority_breakdown', 'sla_compliance', 'agent_workload', 'recent_activity'] as const;
export type WidgetType = (typeof WIDGET_TYPES)[number];

const DEFAULT_ORDER: Record<WidgetType, number> = {
  ticket_volume: 0,
  priority_breakdown: 1,
  sla_compliance: 2,
  agent_workload: 3,
  recent_activity: 4,
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
