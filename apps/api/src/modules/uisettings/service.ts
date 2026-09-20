import { prisma, withTenantTx } from '@seredina/db';

// "middle" (Meet in the Middle -- warm-stone neutral, the channel glyph) is
// the default; "refined" is the original look, preserved as a real,
// selectable option, not deleted. See docs/adr/0042-tenant-theme-system.md
// for the CSS-variable mechanism these two names switch between.
export const UI_THEMES = [
  {
    key: 'middle',
    name: 'Meet in the Middle',
    description: 'Warm, on-brand default. A stone-warm neutral palette and a channel glyph on each ticket showing how it arrived.',
  },
  {
    key: 'refined',
    name: 'Refined',
    description: 'The original look: a cool slate neutral palette, no channel glyph.',
  },
] as const;
export type UiTheme = (typeof UI_THEMES)[number]['key'];

function isValidTheme(value: string): value is UiTheme {
  return UI_THEMES.some((t) => t.key === value);
}

export interface TenantUiSettingsView {
  theme: UiTheme;
}

/** null/missing row both resolve to the default -- same "no row = default" shape as TenantAiSettings. */
export async function getTenantUiTheme(tenantId: string): Promise<TenantUiSettingsView> {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const row = await tx.tenantUiSettings.findUnique({ where: { tenantId } });
    const theme = row?.theme;
    return { theme: theme && isValidTheme(theme) ? theme : 'middle' };
  });
}

export async function setTenantUiTheme(tenantId: string, theme: string): Promise<TenantUiSettingsView> {
  if (!isValidTheme(theme)) {
    throw new Error(`theme must be one of ${UI_THEMES.map((t) => t.key).join(', ')}`);
  }
  const row = await withTenantTx(prisma, tenantId, (tx) =>
    tx.tenantUiSettings.upsert({
      where: { tenantId },
      create: { tenantId, theme },
      update: { theme },
    }),
  );
  return { theme: row.theme as UiTheme };
}
