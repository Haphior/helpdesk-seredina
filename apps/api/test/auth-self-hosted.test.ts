import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma, withTenantTx } from '@seredina/db';
import { registerTenant } from '../src/modules/auth/service';

/**
 * SEREDINA_MODE=self_hosted's single-tenant enforcement (Phase 4) -- see
 * docs/adr/0036-phase-4-self-hosted-signup-byok-custom-roles.md. Live
 * Postgres, same skip convention as this codebase's other DATABASE_URL-gated
 * suites.
 *
 * This shared dev/test database always already has other tenants (every
 * other integration test file creates its own via a direct tx.tenant.create,
 * and nothing here or elsewhere cleans up after itself) -- so "the very
 * first registration on a truly empty self-hosted instance succeeds" isn't
 * independently testable against it; that branch is a single `> 0` check
 * falling through to the exact same code path cloud mode already exercises
 * below, not a separately risky path. What IS tested, and is the actual
 * product invariant that matters, is that self_hosted mode refuses a SECOND
 * tenant once at least one already exists -- true by construction in this
 * shared database without needing a clean slate.
 */
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('registerTenant + SEREDINA_MODE', () => {
  const ORIGINAL_MODE = process.env.SEREDINA_MODE;

  beforeEach(() => {
    delete process.env.SEREDINA_MODE;
  });

  afterEach(() => {
    if (ORIGINAL_MODE === undefined) delete process.env.SEREDINA_MODE;
    else process.env.SEREDINA_MODE = ORIGINAL_MODE;
  });

  it('cloud mode (default, unset) allows unlimited tenants, each tagged mode="cloud"', async () => {
    const rand = Math.random().toString(36).slice(2, 8);
    const first = await registerTenant({
      tenantSlug: `cloud-a-${rand}`,
      tenantName: 'Cloud Tenant A',
      adminEmail: `a-${rand}@example.com`,
      adminName: 'Admin A',
      password: 'SuperSecret123!',
    });
    const second = await registerTenant({
      tenantSlug: `cloud-b-${rand}`,
      tenantName: 'Cloud Tenant B',
      adminEmail: `b-${rand}@example.com`,
      adminName: 'Admin B',
      password: 'SuperSecret123!',
    });

    const tenantA = await withTenantTx(prisma, first.tenantId, (tx) => tx.tenant.findUnique({ where: { id: first.tenantId } }));
    const tenantB = await withTenantTx(prisma, second.tenantId, (tx) => tx.tenant.findUnique({ where: { id: second.tenantId } }));
    expect(tenantA?.mode).toBe('cloud');
    expect(tenantB?.mode).toBe('cloud');
  });

  it('self_hosted mode refuses a second tenant once one already exists', async () => {
    // Guarantee at least one tenant exists, independent of this database's
    // current state, via a direct create (bypassing registerTenant) --
    // exactly like every other integration test's own tenant fixture setup.
    const existingId = randomUUID();
    await withTenantTx(prisma, existingId, (tx) =>
      tx.tenant.create({ data: { id: existingId, slug: `sh-existing-${existingId.slice(0, 8)}`, name: 'Existing Tenant' } }),
    );

    process.env.SEREDINA_MODE = 'self_hosted';
    await expect(
      registerTenant({
        tenantSlug: `sh-second-${existingId.slice(0, 8)}`,
        tenantName: 'Second Tenant',
        adminEmail: `sh2-${existingId.slice(0, 8)}@example.com`,
        adminName: 'Second Admin',
        password: 'SuperSecret123!',
      }),
    ).rejects.toThrow('this self-hosted instance already has a tenant');
  });
});
