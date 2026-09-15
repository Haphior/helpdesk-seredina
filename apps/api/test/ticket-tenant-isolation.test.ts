import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma, uncheckedPrisma } from '../src/lib/prisma';
import { withTenantTx } from '../src/lib/tenant-context';
import { createTicketFromApi, seedDefaultTicketStatuses } from '../src/modules/tickets/service';

/**
 * Proportional extension of test/tenant-isolation.test.ts's mandatory coverage to the
 * Phase 1 ticketing models: the isolation MECHANISM (RLS + the Prisma extension,
 * bound via withTenantTx) is identical for every tenant-scoped table, already proven
 * generically there, so this only re-checks the two production-relevant cases against
 * a model with real relations (Ticket -> TicketStatus/Contact) instead of duplicating
 * all five scenarios again.
 */
const hasDb = Boolean(process.env.DATABASE_URL && process.env.TEST_ADMIN_DATABASE_URL);

describe.skipIf(!hasDb)('ticket cross-tenant isolation', () => {
  let tenantAId: string;
  let tenantBId: string;
  let ticketAId: string;
  let ticketBId: string;

  async function createTenantWithTicket(label: string) {
    const tenantId = randomUUID();
    await withTenantTx(prisma, tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, slug: `tix-${label}-${tenantId.slice(0, 8)}`, name: label } });
      await seedDefaultTicketStatuses(tx, tenantId);
    });
    const created = await createTicketFromApi(tenantId, {
      subject: `${label} subject`,
      body: `${label} body`,
      contactEmail: `${label}@example.com`,
      contactName: label,
    });
    return { tenantId, ticketId: created.id };
  }

  beforeAll(async () => {
    const a = await createTenantWithTicket('tenant-a');
    const b = await createTenantWithTicket('tenant-b');
    tenantAId = a.tenantId;
    ticketAId = a.ticketId;
    tenantBId = b.tenantId;
    ticketBId = b.ticketId;
  });

  it('both layers active: tenant A cannot see tenant B ticket via the normal guarded client', async () => {
    await withTenantTx(prisma, tenantAId, async (tx) => {
      const tickets = await tx.ticket.findMany();
      expect(tickets.map((t) => t.id)).toEqual([ticketAId]);

      const crossTenantRead = await tx.ticket.findUnique({ where: { id: ticketBId } });
      expect(crossTenantRead).toBeNull();
    });
  });

  it('both layers active: RLS WITH CHECK rejects a forged cross-tenant ticket write', async () => {
    const { statusId, contactId } = await withTenantTx(prisma, tenantAId, async (tx) => {
      const [status, contact] = await Promise.all([
        tx.ticketStatus.findFirstOrThrow({ where: { key: 'open' } }),
        tx.contact.findFirstOrThrow(),
      ]);
      return { statusId: status.id, contactId: contact.id };
    });

    await expect(
      withTenantTx(uncheckedPrisma, tenantAId, async (rawTx) =>
        // uncheckedPrisma has no extension; forging tenantId directly is exactly
        // the bug RLS's WITH CHECK exists to catch even when app code is wrong.
        // (statusId/contactId are real tenant-A rows -- FK checks bypass RLS, so
        // this must fail on the tenant_id mismatch alone, not a dangling FK.)
        rawTx.ticket.create({
          data: { tenantId: tenantBId, number: 999, subject: 'forged', statusId, contactId, channel: 'api' },
        }),
      ),
    ).rejects.toThrow();
  });
});
