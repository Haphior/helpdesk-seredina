import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma, withTenantTx } from '@seredina/db';
import { createTicketFromApi, getTicket, seedDefaultTicketStatuses, updateTicket } from '../src/modules/tickets/service';
import { getPublicCsatSurvey, submitCsatResponse } from '../src/modules/csat/service';
import { getCsatSummary } from '../src/modules/reporting/service';

/**
 * CSAT surveys (docs/adr/0045-csat-surveys.md): a ticket's first-ever
 * resolution posts a survey link as a SYSTEM message via addMessage -- which
 * is also what makes it reach the customer for free through whichever
 * outbound mechanism the ticket's channel already has. WEB_ORIGIN must be
 * set for the link to be created at all (see createCsatSurveyLink); these
 * tests set it themselves rather than depending on the test runner's env.
 */
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('CSAT surveys', () => {
  let tenantId: string;
  let tenantSlug: string;
  let statusIds: Record<string, string>;

  beforeEach(async () => {
    tenantId = randomUUID();
    tenantSlug = `csat-${tenantId.slice(0, 8)}`;
    process.env.WEB_ORIGIN = 'https://app.example.test';

    await withTenantTx(prisma, tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, slug: tenantSlug, name: 'CSAT Test' } });
      const statuses = await seedDefaultTicketStatuses(tx, tenantId);
      statusIds = Object.fromEntries(statuses.map((s) => [s.key, s.id]));
    });
  });

  async function createResolvableTicket() {
    return createTicketFromApi(tenantId, {
      subject: 'Need help',
      body: 'Something is broken',
      contactEmail: 'contact@example.com',
      contactName: 'A Contact',
    });
  }

  it('resolving a ticket for the first time posts a SYSTEM message with a survey link', async () => {
    const ticket = await createResolvableTicket();
    await updateTicket(tenantId, ticket.id, { statusId: statusIds.resolved });

    const full = await getTicket(tenantId, ticket.id);
    const systemMessages = full.messages.filter((m) => m.authorType === 'SYSTEM');
    expect(systemMessages).toHaveLength(1);
    expect(systemMessages[0].body).toContain(`https://app.example.test/csat/${tenantSlug}/`);
  });

  it('does not create a second survey if the ticket is reopened and resolved again', async () => {
    const ticket = await createResolvableTicket();
    await updateTicket(tenantId, ticket.id, { statusId: statusIds.resolved });
    await updateTicket(tenantId, ticket.id, { statusId: statusIds.open });
    await updateTicket(tenantId, ticket.id, { statusId: statusIds.resolved });

    const full = await getTicket(tenantId, ticket.id);
    expect(full.messages.filter((m) => m.authorType === 'SYSTEM')).toHaveLength(1);

    const csat = await withTenantTx(prisma, tenantId, (tx) => tx.csatResponse.findMany({ where: { ticketId: ticket.id } }));
    expect(csat).toHaveLength(1);
  });

  it('closing a ticket directly (skipping resolved) also requests a survey', async () => {
    const ticket = await createResolvableTicket();
    await updateTicket(tenantId, ticket.id, { statusId: statusIds.closed });

    const csat = await withTenantTx(prisma, tenantId, (tx) => tx.csatResponse.findUnique({ where: { ticketId: ticket.id } }));
    expect(csat).not.toBeNull();
  });

  it('does not request a survey without WEB_ORIGIN configured', async () => {
    delete process.env.WEB_ORIGIN;
    const ticket = await createResolvableTicket();
    await updateTicket(tenantId, ticket.id, { statusId: statusIds.resolved });

    const csat = await withTenantTx(prisma, tenantId, (tx) => tx.csatResponse.findUnique({ where: { ticketId: ticket.id } }));
    expect(csat).toBeNull();
    const full = await getTicket(tenantId, ticket.id);
    expect(full.messages.filter((m) => m.authorType === 'SYSTEM')).toHaveLength(0);
  });

  // Regression: the SYSTEM survey message must never be mistaken for a real
  // agent/AI response for SLA purposes (see the addMessage fix in
  // tickets/service.ts's firstRespondedAt check).
  it('the survey SYSTEM message does not stamp firstRespondedAt', async () => {
    const ticket = await createResolvableTicket();
    await updateTicket(tenantId, ticket.id, { statusId: statusIds.resolved });

    const full = await getTicket(tenantId, ticket.id);
    expect(full.firstRespondedAt).toBeNull();
  });

  it('a resolved ticket with no contact email reachability still gets a real, submittable survey token', async () => {
    const ticket = await createResolvableTicket();
    await updateTicket(tenantId, ticket.id, { statusId: statusIds.resolved });

    const row = await withTenantTx(prisma, tenantId, (tx) => tx.csatResponse.findUniqueOrThrow({ where: { ticketId: ticket.id } }));
    const survey = await getPublicCsatSurvey(tenantSlug, row.token);
    expect(survey).toEqual({
      ticketNumber: ticket.number,
      ticketSubject: 'Need help',
      rating: null,
      comment: null,
      respondedAt: null,
    });
  });

  it('submitting a rating persists it and a second submission is idempotent, not overwritten', async () => {
    const ticket = await createResolvableTicket();
    await updateTicket(tenantId, ticket.id, { statusId: statusIds.resolved });
    const row = await withTenantTx(prisma, tenantId, (tx) => tx.csatResponse.findUniqueOrThrow({ where: { ticketId: ticket.id } }));

    const first = await submitCsatResponse(tenantSlug, row.token, { rating: 5, comment: 'Great support!' });
    expect(first.rating).toBe(5);
    expect(first.comment).toBe('Great support!');
    expect(first.respondedAt).not.toBeNull();

    const second = await submitCsatResponse(tenantSlug, row.token, { rating: 1, comment: 'changed my mind' });
    expect(second.rating).toBe(5); // unchanged -- the first answer wins
    expect(second.comment).toBe('Great support!');
  });

  it('rejects a rating outside 1-5', async () => {
    const ticket = await createResolvableTicket();
    await updateTicket(tenantId, ticket.id, { statusId: statusIds.resolved });
    const row = await withTenantTx(prisma, tenantId, (tx) => tx.csatResponse.findUniqueOrThrow({ where: { ticketId: ticket.id } }));

    await expect(submitCsatResponse(tenantSlug, row.token, { rating: 6 })).rejects.toThrow('rating must be');
    await expect(submitCsatResponse(tenantSlug, row.token, { rating: 0 })).rejects.toThrow('rating must be');
  });

  it('an unknown token or unknown tenant slug both 404 identically (not found)', async () => {
    const ticket = await createResolvableTicket();
    await updateTicket(tenantId, ticket.id, { statusId: statusIds.resolved });
    const row = await withTenantTx(prisma, tenantId, (tx) => tx.csatResponse.findUniqueOrThrow({ where: { ticketId: ticket.id } }));

    expect(await getPublicCsatSurvey(tenantSlug, 'not-a-real-token')).toBeNull();
    expect(await getPublicCsatSurvey('no-such-tenant', row.token)).toBeNull();
    await expect(submitCsatResponse('no-such-tenant', row.token, { rating: 5 })).rejects.toThrow('not found');
  });

  it('a survey token from one tenant is invisible under another tenant\'s slug -- RLS scoping', async () => {
    const ticket = await createResolvableTicket();
    await updateTicket(tenantId, ticket.id, { statusId: statusIds.resolved });
    const row = await withTenantTx(prisma, tenantId, (tx) => tx.csatResponse.findUniqueOrThrow({ where: { ticketId: ticket.id } }));

    const otherTenantId = randomUUID();
    const otherSlug = `csat-other-${otherTenantId.slice(0, 8)}`;
    await withTenantTx(prisma, otherTenantId, (tx) => tx.tenant.create({ data: { id: otherTenantId, slug: otherSlug, name: 'Other CSAT Tenant' } }));

    expect(await getPublicCsatSurvey(otherSlug, row.token)).toBeNull();
  });

  it('getCsatSummary averages only responded surveys within the window, ignoring unanswered ones', async () => {
    const t1 = await createResolvableTicket();
    await updateTicket(tenantId, t1.id, { statusId: statusIds.resolved });
    const r1 = await withTenantTx(prisma, tenantId, (tx) => tx.csatResponse.findUniqueOrThrow({ where: { ticketId: t1.id } }));
    await submitCsatResponse(tenantSlug, r1.token, { rating: 5 });

    const t2 = await createResolvableTicket();
    await updateTicket(tenantId, t2.id, { statusId: statusIds.resolved });
    const r2 = await withTenantTx(prisma, tenantId, (tx) => tx.csatResponse.findUniqueOrThrow({ where: { ticketId: t2.id } }));
    await submitCsatResponse(tenantSlug, r2.token, { rating: 3 });

    // A third ticket is resolved (survey requested) but never answered -- must
    // not count toward the average or the response total.
    const t3 = await createResolvableTicket();
    await updateTicket(tenantId, t3.id, { statusId: statusIds.resolved });

    const summary = await getCsatSummary(tenantId, 90);
    expect(summary.total).toBe(2);
    expect(summary.average).toBe(4);
    expect(summary.distribution).toEqual({ 1: 0, 2: 0, 3: 1, 4: 0, 5: 1 });
  });
});
