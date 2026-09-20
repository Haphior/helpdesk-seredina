import { Prisma, prisma, withTenantTx } from '@seredina/db';
import { resolveTenantIdBySlug } from '../tenants/service';

export interface TenantBranding {
  logoUrl: string | null;
  accentColor: string | null;
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function parseBranding(raw: unknown): TenantBranding {
  const b = (raw ?? {}) as { logoUrl?: string; accentColor?: string };
  return { logoUrl: b.logoUrl ?? null, accentColor: b.accentColor ?? null };
}

export async function getTenantBranding(tenantId: string): Promise<TenantBranding> {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { branding: true } });
    return parseBranding(tenant?.branding);
  });
}

// No auth/tenant context exists yet at this call site -- same "resolve the slug
// first, then scope" shape as the public KB routes (modules/kb/routes.ts).
export async function getPublicTenantBranding(tenantSlug: string): Promise<TenantBranding | null> {
  const tenantId = await resolveTenantIdBySlug(tenantSlug);
  if (!tenantId) return null;
  return getTenantBranding(tenantId);
}

export interface SetTenantBrandingInput {
  logoUrl?: string | null;
  accentColor?: string | null;
}

// Merges into the existing blob rather than replacing it wholesale: an explicit
// `null` for a field clears just that field, an omitted field is left untouched.
export async function setTenantBranding(tenantId: string, input: SetTenantBrandingInput): Promise<TenantBranding> {
  if (input.logoUrl) {
    let parsed: URL;
    try {
      parsed = new URL(input.logoUrl);
    } catch {
      throw new Error('logoUrl must be a valid URL');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('logoUrl must be an http(s) URL');
    }
  }
  if (input.accentColor && !HEX_COLOR.test(input.accentColor)) {
    throw new Error('accentColor must be a hex color, e.g. #4f46e5');
  }

  return withTenantTx(prisma, tenantId, async (tx) => {
    const existing = await tx.tenant.findUnique({ where: { id: tenantId }, select: { branding: true } });
    const current = parseBranding(existing?.branding);

    const next: TenantBranding = {
      logoUrl: input.logoUrl === undefined ? current.logoUrl : input.logoUrl,
      accentColor: input.accentColor === undefined ? current.accentColor : input.accentColor,
    };

    const hasAny = Boolean(next.logoUrl || next.accentColor);
    const tenant = await tx.tenant.update({
      where: { id: tenantId },
      data: { branding: hasAny ? (next as unknown as Prisma.InputJsonValue) : Prisma.JsonNull },
      select: { branding: true },
    });
    return parseBranding(tenant.branding);
  });
}
