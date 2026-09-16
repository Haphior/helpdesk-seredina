import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma, withTenantTx } from '@seredina/db';
import { createTicketFromApi, seedDefaultTicketStatuses, updateTicket, addMessage } from '../src/modules/tickets/service';
import { upsertSlaPolicy, deleteSlaPolicy, upsertBusinessHours } from '../src/modules/sla/service';

// No hasRedis guard needed, same reasoning as test/macros.test.ts: dispatchWebhookEvent
// (and now scheduleSlaBreachChecks, which only enqueues -- never awaits a live worker)
// is a no-op against a tenant with zero webhooks/never-checked jobs.
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('SLA engine', () => {
  let tenantId: string;
  let agentUserId: string;

  beforeAll(async () => {
    tenantId = randomUUID();
    await withTenantTx(prisma, tenantId, (tx) =>
      tx.tenant.create({ data: { id: tenantId, slug: `sla-${tenantId.slice(0, 8)}`, name: 'SLA Test' } }),
    );
    await withTenantTx(prisma, tenantId, (tx) => seedDefaultTicketStatuses(tx, tenantId));

    agentUserId = await withTenantTx(prisma, tenantId, async (tx) => {
      const user = await tx.user.create({ data: { tenantId, email: 'sla-agent@example.com', name: 'Agent', passwordHash: 'x' } });
      return user.id;
    });
  });

  it('rejects a non-positive target', async () => {
    await expect(
      upsertSlaPolicy(tenantId, { priority: 'URGENT', firstResponseMinutes: 0, resolutionMinutes: 60, businessHoursOnly: false }),
    ).rejects.toThrow('SLA targets must be positive numbers of minutes');
  });

  it('a ticket created with no matching SlaPolicy gets no due-ats (opt-in by default)', async () => {
    const ticket = await createTicketFromApi(tenantId, {
      subject: 'No SLA configured',
      body: 'body',
      contactEmail: 'no-sla@example.com',
      contactName: 'No Sla',
      priority: 'LOW',
    });
    expect(ticket.firstResponseDueAt).toBeNull();
    expect(ticket.resolutionDueAt).toBeNull();
  });

  it('a ticket created after a matching SlaPolicy exists gets calendar-time due-ats', async () => {
    await upsertSlaPolicy(tenantId, { priority: 'HIGH', firstResponseMinutes: 30, resolutionMinutes: 240, businessHoursOnly: false });

    const before = Date.now();
    const ticket = await createTicketFromApi(tenantId, {
      subject: 'Has SLA configured',
      body: 'body',
      contactEmail: 'has-sla@example.com',
      contactName: 'Has Sla',
      priority: 'HIGH',
    });

    expect(ticket.firstResponseDueAt).not.toBeNull();
    expect(ticket.resolutionDueAt).not.toBeNull();
    const firstResponseMinutesActual = (ticket.firstResponseDueAt!.getTime() - before) / 60_000;
    const resolutionMinutesActual = (ticket.resolutionDueAt!.getTime() - before) / 60_000;
    // Within a small tolerance of "now" -- the exact instant `before` was captured
    // differs by a few ms from the service's own `new Date()`.
    expect(firstResponseMinutesActual).toBeGreaterThan(29.9);
    expect(firstResponseMinutesActual).toBeLessThan(30.1);
    expect(resolutionMinutesActual).toBeGreaterThan(239.9);
    expect(resolutionMinutesActual).toBeLessThan(240.1);
  });

  it('changing priority recomputes due-ats from now, not from the original creation time', async () => {
    await upsertSlaPolicy(tenantId, { priority: 'URGENT', firstResponseMinutes: 5, resolutionMinutes: 15, businessHoursOnly: false });

    const ticket = await createTicketFromApi(tenantId, {
      subject: 'Starts low, escalated to urgent',
      body: 'body',
      contactEmail: 'escalate@example.com',
      contactName: 'Escalate',
      priority: 'LOW', // no SlaPolicy for LOW in this test -> starts with null due-ats
    });
    expect(ticket.resolutionDueAt).toBeNull();

    const before = Date.now();
    const updated = await updateTicket(tenantId, ticket.id, { priority: 'URGENT' });
    expect(updated.resolutionDueAt).not.toBeNull();
    const minutesActual = (updated.resolutionDueAt!.getTime() - before) / 60_000;
    expect(minutesActual).toBeGreaterThan(14.9);
    expect(minutesActual).toBeLessThan(15.1);

    // Patching something unrelated (no priority change) must never touch the
    // clock that's already running.
    const dueAtBefore = updated.resolutionDueAt!.getTime();
    const untouched = await updateTicket(tenantId, ticket.id, { assigneeId: agentUserId });
    expect(untouched.resolutionDueAt!.getTime()).toBe(dueAtBefore);
  });

  it('a business-hours-gated policy respects the configured schedule', async () => {
    await upsertBusinessHours(tenantId, {
      timezone: 'UTC',
      schedule: { mon: [{ start: '09:00', end: '17:00' }], tue: [{ start: '09:00', end: '17:00' }], wed: [{ start: '09:00', end: '17:00' }], thu: [{ start: '09:00', end: '17:00' }], fri: [{ start: '09:00', end: '17:00' }] },
    });
    await upsertSlaPolicy(tenantId, { priority: 'NORMAL', firstResponseMinutes: 60, resolutionMinutes: 60, businessHoursOnly: true });

    const ticket = await createTicketFromApi(tenantId, {
      subject: 'Business-hours ticket',
      body: 'body',
      contactEmail: 'bh@example.com',
      contactName: 'BH',
      priority: 'NORMAL',
    });

    // The due-at must fall on a weekday between 09:00 and 17:00 UTC, whatever
    // "now" happens to be when the test runs.
    const due = ticket.resolutionDueAt!;
    expect(due.getUTCDay()).toBeGreaterThanOrEqual(1);
    expect(due.getUTCDay()).toBeLessThanOrEqual(5);
    const minutesIntoDay = due.getUTCHours() * 60 + due.getUTCMinutes();
    expect(minutesIntoDay).toBeGreaterThanOrEqual(9 * 60);
    expect(minutesIntoDay).toBeLessThanOrEqual(17 * 60);
  });

  it('firstRespondedAt is stamped once, on the first public agent reply, never by an internal note or a later reply', async () => {
    const ticket = await createTicketFromApi(tenantId, {
      subject: 'First response tracking',
      body: 'body',
      contactEmail: 'fr@example.com',
      contactName: 'FR',
    });

    await addMessage(tenantId, ticket.id, { authorUserId: agentUserId, body: 'Internal note first', isPrivateNote: true });
    let current = await withTenantTx(prisma, tenantId, (tx) => tx.ticket.findUniqueOrThrow({ where: { id: ticket.id } }));
    expect(current.firstRespondedAt).toBeNull();

    await addMessage(tenantId, ticket.id, { authorUserId: agentUserId, body: 'First public reply', isPrivateNote: false });
    current = await withTenantTx(prisma, tenantId, (tx) => tx.ticket.findUniqueOrThrow({ where: { id: ticket.id } }));
    expect(current.firstRespondedAt).not.toBeNull();
    const stampedAt = current.firstRespondedAt!.getTime();

    await addMessage(tenantId, ticket.id, { authorUserId: agentUserId, body: 'Second public reply', isPrivateNote: false });
    current = await withTenantTx(prisma, tenantId, (tx) => tx.ticket.findUniqueOrThrow({ where: { id: ticket.id } }));
    expect(current.firstRespondedAt!.getTime()).toBe(stampedAt);
  });

  it('throws deleting an SLA policy that does not exist', async () => {
    await expect(deleteSlaPolicy(tenantId, randomUUID())).rejects.toThrow('SLA policy not found');
  });
});
