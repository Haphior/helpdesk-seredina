import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma, withTenantTx } from '@seredina/db';
import { getPublicTenantBranding, getTenantBranding, setTenantBranding } from '../src/modules/branding/service';

/**
 * Tenant branding / white-label v1 -- named in docs/ROADMAP.md's "Deep
 * customization" section and the explicit follow-up flagged out of scope by
 * ADR 0042 (the theme system covers internal-app neutral warmth only; this
 * covers a tenant's own logo/accent on the customer-facing self-service
 * portal and status page). The `requirePermission('tickets:manage_all')`
 * gate on PATCH /tenant-branding reuses the same, already-proven mechanism
 * as AI Settings/Appearance, so it's not re-tested here.
 */
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('Tenant branding', () => {
  let tenantId: string;
  let tenantSlug: string;

  beforeEach(async () => {
    tenantId = randomUUID();
    tenantSlug = `brand-${tenantId.slice(0, 8)}`;
    await withTenantTx(prisma, tenantId, (tx) =>
      tx.tenant.create({ data: { id: tenantId, slug: tenantSlug, name: 'Branding Tenant' } }),
    );
  });

  it('a fresh tenant with no branding set has both fields null', async () => {
    const branding = await getTenantBranding(tenantId);
    expect(branding).toEqual({ logoUrl: null, accentColor: null });
  });

  it('setting logoUrl and accentColor persists both and GET reflects the change', async () => {
    await setTenantBranding(tenantId, { logoUrl: 'https://acme.example.com/logo.png', accentColor: '#ff6600' });
    const branding = await getTenantBranding(tenantId);
    expect(branding).toEqual({ logoUrl: 'https://acme.example.com/logo.png', accentColor: '#ff6600' });
  });

  it('setting only one field leaves the other untouched (merge, not replace)', async () => {
    await setTenantBranding(tenantId, { logoUrl: 'https://acme.example.com/logo.png', accentColor: '#ff6600' });
    await setTenantBranding(tenantId, { accentColor: '#00ff66' });
    const branding = await getTenantBranding(tenantId);
    expect(branding).toEqual({ logoUrl: 'https://acme.example.com/logo.png', accentColor: '#00ff66' });
  });

  it('an explicit null clears just that field', async () => {
    await setTenantBranding(tenantId, { logoUrl: 'https://acme.example.com/logo.png', accentColor: '#ff6600' });
    await setTenantBranding(tenantId, { logoUrl: null });
    const branding = await getTenantBranding(tenantId);
    expect(branding).toEqual({ logoUrl: null, accentColor: '#ff6600' });
  });

  it('rejects a non-URL logoUrl', async () => {
    await expect(setTenantBranding(tenantId, { logoUrl: 'not-a-url' })).rejects.toThrow('logoUrl must be a valid URL');
  });

  it('rejects a non-hex accentColor', async () => {
    await expect(setTenantBranding(tenantId, { accentColor: 'orange' })).rejects.toThrow('accentColor must be a hex color');
  });

  it('branding set for one tenant is invisible to another -- RLS scoping applies here like any other tenant-owned field', async () => {
    await setTenantBranding(tenantId, { logoUrl: 'https://acme.example.com/logo.png', accentColor: '#ff6600' });

    const otherTenantId = randomUUID();
    await withTenantTx(prisma, otherTenantId, (tx) =>
      tx.tenant.create({ data: { id: otherTenantId, slug: `brand-other-${otherTenantId.slice(0, 8)}`, name: 'Other Branding Tenant' } }),
    );

    const otherBranding = await getTenantBranding(otherTenantId);
    expect(otherBranding).toEqual({ logoUrl: null, accentColor: null });
  });

  it('the public-by-slug lookup returns the same branding an authenticated tenant would see', async () => {
    await setTenantBranding(tenantId, { logoUrl: 'https://acme.example.com/logo.png', accentColor: '#ff6600' });
    const publicBranding = await getPublicTenantBranding(tenantSlug);
    expect(publicBranding).toEqual({ logoUrl: 'https://acme.example.com/logo.png', accentColor: '#ff6600' });
  });

  it('the public-by-slug lookup returns null for an unknown slug', async () => {
    const publicBranding = await getPublicTenantBranding('no-such-tenant-slug');
    expect(publicBranding).toBeNull();
  });
});
