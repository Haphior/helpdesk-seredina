import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ANONYMIZED_CONTACT_NAME, ANONYMIZED_MESSAGE_BODY, ANONYMIZED_TICKET_SUBJECT, prisma, withTenantTx } from '@seredina/db';
import { buildApp } from '../src/index';
import { createRole, createUser } from '../src/modules/auth/service';
import { addMessage, createTicketFromApi } from '../src/modules/tickets/service';
import { listAuditLogs } from '../src/modules/audit/service';
import { anonymizeContactsPastRetention } from '../../worker/src/contacts/retention';

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('contact data rights', () => {
  const app = buildApp();
  const slug = `contacts-${randomUUID().slice(0, 8)}`;
  let tenantId: string;
  let adminToken: string;
  let agentToken: string;
  let anaId: string;
  let anaTicketId: string;
  let bobId: string;
  let bobTicketId: string;
  let ip = 0;
  const nextIp = () => `10.97.${Math.floor(++ip / 250)}.${ip % 250}`;
  const as = (token: string) => ({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      remoteAddress: nextIp(),
      payload: { tenantSlug: slug, tenantName: 'Contacts', adminEmail: 'admin@c.test', adminName: 'Admin', password: 'admin-password-1' },
    });
    adminToken = res.json().token;
    tenantId = app.jwt.decode<{ tenantId: string }>(adminToken)!.tenantId;

    await createRole(tenantId, { key: 'plain_agent', name: 'Plain agent', permissions: ['tickets:read', 'tickets:write'] });
    const agent = await createUser(
      tenantId,
      { email: 'agent@c.test', name: 'Agent', password: 'agent-password-1', roleKey: 'plain_agent' },
      ['tickets:read', 'tickets:write'],
    );
    agentToken = app.jwt.sign({ sub: agent.id, tenantId, permissions: ['tickets:read', 'tickets:write'] });

    const ana = await createTicketFromApi(tenantId, {
      subject: 'Ana cannot print payslips',
      body: 'My RUT is 12.345.678-9, please call me at +56 9 1234 5678',
      contactEmail: 'ana@customer.test',
      contactName: 'Ana Pérez',
    });
    anaTicketId = ana.id;
    const bob = await createTicketFromApi(tenantId, { subject: 'Bob laptop', body: 'Slow', contactEmail: 'bob@customer.test', contactName: 'Bob' });
    bobTicketId = bob.id;

    await addMessage(tenantId, anaTicketId, { authorUserId: agent.id, body: 'Hi Ana, calling +56 9 1234 5678 now', isPrivateNote: false });
    await addMessage(tenantId, anaTicketId, { authorUserId: agent.id, body: 'Ana is on the payroll team', isPrivateNote: true });

    await withTenantTx(prisma, tenantId, async (tx) => {
      const ticket = await tx.ticket.findUniqueOrThrow({ where: { id: anaTicketId }, include: { messages: { orderBy: { createdAt: 'asc' } } } });
      anaId = ticket.contactId;
      bobId = (await tx.ticket.findUniqueOrThrow({ where: { id: bobTicketId } })).contactId;
      await tx.attachment.create({
        data: { tenantId, messageId: ticket.messages[0].id, filename: 'id-card.jpg', mimeType: 'image/jpeg', sizeBytes: 3, data: Buffer.from('abc') },
      });
      await tx.ticket.update({ where: { id: anaTicketId }, data: { customFields: { rut: '12.345.678-9' }, aiTriage: { reason: 'Ana mentions payroll' } } });
      await tx.csatResponse.create({ data: { tenantId, ticketId: anaTicketId, token: randomUUID(), rating: 4, comment: 'Thanks, Ana', respondedAt: new Date() } });
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('lets anyone who reads tickets find contacts, with their ticket count', async () => {
    const res = await app.inject({ method: 'GET', url: '/contacts?search=ANA@', headers: as(agentToken) });
    expect(res.statusCode).toBe(200);
    expect(res.json().contacts).toEqual([expect.objectContaining({ id: anaId, name: 'Ana Pérez', ticketCount: 1, anonymizedAt: null })]);

    const detail = await app.inject({ method: 'GET', url: `/contacts/${anaId}`, headers: as(agentToken) });
    expect(detail.json().tickets.map((t: { id: string }) => t.id)).toEqual([anaTicketId]);
  });

  it('keeps export, correction and erasure to contacts:manage', async () => {
    for (const req of [
      { method: 'GET' as const, url: `/contacts/${anaId}/export` },
      { method: 'PATCH' as const, url: `/contacts/${anaId}`, payload: { name: 'X' } },
      { method: 'POST' as const, url: `/contacts/${anaId}/anonymize`, payload: { confirmEmail: 'ana@customer.test' } },
      { method: 'PUT' as const, url: '/contact-retention', payload: { days: 365 } },
    ]) {
      expect((await app.inject({ ...req, headers: as(agentToken) })).statusCode).toBe(403);
    }
  });

  it('exports the contact’s data, leaving internal notes out unless asked', async () => {
    const res = await app.inject({ method: 'GET', url: `/contacts/${anaId}/export`, headers: as(adminToken) });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toContain(`contact-${anaId}.json`);
    const data = res.json();
    expect(data.contact.email).toBe('ana@customer.test');
    const bodies = data.tickets[0].messages.map((m: { body: string }) => m.body).join('\n');
    expect(bodies).toContain('12.345.678-9');
    expect(bodies).not.toContain('payroll team');
    expect(data.tickets[0].messages[0].attachments).toEqual([{ filename: 'id-card.jpg', mimeType: 'image/jpeg', sizeBytes: 3 }]);
    expect(data.tickets[0].satisfaction).toMatchObject({ rating: 4, comment: 'Thanks, Ana' });

    const withNotes = await app.inject({ method: 'GET', url: `/contacts/${anaId}/export?internalNotes=true`, headers: as(adminToken) });
    expect(JSON.stringify(withNotes.json())).toContain('payroll team');
  });

  it('corrects a contact, refusing an address another contact already has', async () => {
    const taken = await app.inject({ method: 'PATCH', url: `/contacts/${anaId}`, headers: as(adminToken), payload: { email: 'bob@customer.test' } });
    expect(taken.statusCode).toBe(409);
    const ok = await app.inject({ method: 'PATCH', url: `/contacts/${anaId}`, headers: as(adminToken), payload: { name: 'Ana María Pérez' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().name).toBe('Ana María Pérez');
  });

  it('anonymizes only after the email is typed back, and erases everything written on their tickets', async () => {
    const wrong = await app.inject({ method: 'POST', url: `/contacts/${anaId}/anonymize`, headers: as(adminToken), payload: { confirmEmail: 'bob@customer.test' } });
    expect(wrong.statusCode).toBe(400);

    const res = await app.inject({ method: 'POST', url: `/contacts/${anaId}/anonymize`, headers: as(adminToken), payload: { confirmEmail: ' ANA@customer.test ' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ tickets: 1, messages: 3, attachments: 1 });

    await withTenantTx(prisma, tenantId, async (tx) => {
      const contact = await tx.contact.findUniqueOrThrow({ where: { id: anaId } });
      expect(contact.name).toBe(ANONYMIZED_CONTACT_NAME);
      expect(contact.email).not.toContain('ana');
      expect(contact.anonymizedAt).not.toBeNull();

      const ticket = await tx.ticket.findUniqueOrThrow({
        where: { id: anaTicketId },
        include: { messages: { include: { attachments: true } }, csatResponse: true, status: true },
      });
      expect(ticket.subject).toBe(ANONYMIZED_TICKET_SUBJECT);
      expect(ticket.customFields).toBeNull();
      expect(ticket.aiTriage).toBeNull();
      expect(ticket.messages.every((m) => m.body === ANONYMIZED_MESSAGE_BODY && m.attachments.length === 0)).toBe(true);
      // The rating and the ticket's shape stay, so reports don't change.
      expect(ticket.csatResponse).toMatchObject({ rating: 4, comment: null });
      expect(ticket.number).toBeGreaterThan(0);

      const bob = await tx.ticket.findUniqueOrThrow({ where: { id: bobTicketId }, include: { contact: true, messages: true } });
      expect(bob.contact.name).toBe('Bob');
      expect(bob.messages[0].body).toBe('Slow');
    });

    // The audit entry names the contact by id only.
    const logs = await listAuditLogs(tenantId, { action: 'contact.anonymized' });
    expect(logs.entries).toHaveLength(1);
    expect(JSON.stringify(logs.entries)).not.toContain('ana@');
    expect(JSON.stringify(logs.entries)).not.toContain('Pérez');

    const again = await app.inject({ method: 'POST', url: `/contacts/${anaId}/anonymize`, headers: as(adminToken), payload: { confirmEmail: 'x' } });
    expect(again.statusCode).toBe(409);
    const edit = await app.inject({ method: 'PATCH', url: `/contacts/${anaId}`, headers: as(adminToken), payload: { name: 'Back' } });
    expect(edit.statusCode).toBe(409);
  });

  it('a new message from the same address starts a fresh contact', async () => {
    const t = await createTicketFromApi(tenantId, { subject: 'Hello again', body: 'Me again', contactEmail: 'ana@customer.test', contactName: 'Ana' });
    const fresh = await withTenantTx(prisma, tenantId, (tx) => tx.ticket.findUniqueOrThrow({ where: { id: t.id }, include: { contact: true } }));
    expect(fresh.contact.id).not.toBe(anaId);
    expect(fresh.contact.anonymizedAt).toBeNull();
  });

  it('anonymizes inactive contacts automatically once a retention period is set', async () => {
    const tooShort = await app.inject({ method: 'PUT', url: '/contact-retention', headers: as(adminToken), payload: { days: 7 } });
    expect(tooShort.statusCode).toBe(400);

    // Three contacts: an old one with only closed tickets, an old one with an
    // open ticket, and a recent one. Only the first is due.
    const old = await createTicketFromApi(tenantId, { subject: 'Old', body: 'old', contactEmail: 'old@customer.test', contactName: 'Old' });
    const oldOpen = await createTicketFromApi(tenantId, { subject: 'Still open', body: 'open', contactEmail: 'open@customer.test', contactName: 'Open' });
    await createTicketFromApi(tenantId, { subject: 'Recent', body: 'new', contactEmail: 'recent@customer.test', contactName: 'Recent' });
    const longAgo = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
    await withTenantTx(prisma, tenantId, async (tx) => {
      const closed = await tx.ticketStatus.findFirstOrThrow({ where: { category: 'CLOSED' } });
      for (const id of [old.id, oldOpen.id]) {
        const t = await tx.ticket.findUniqueOrThrow({ where: { id } });
        await tx.contact.update({ where: { id: t.contactId }, data: { createdAt: longAgo } });
        await tx.message.updateMany({ where: { ticketId: id }, data: { createdAt: longAgo } });
      }
      await tx.ticket.update({ where: { id: old.id }, data: { statusId: closed.id, closedAt: longAgo, updatedAt: longAgo } });
      await tx.ticket.update({ where: { id: oldOpen.id }, data: { updatedAt: longAgo } });
    });

    // Off by default: nothing is due.
    expect(await anonymizeContactsPastRetention()).toBe(0);

    const set = await app.inject({ method: 'PUT', url: '/contact-retention', headers: as(adminToken), payload: { days: 365 } });
    expect(set.json()).toMatchObject({ days: 365, minDays: 30 });
    expect(await anonymizeContactsPastRetention()).toBe(1);

    await withTenantTx(prisma, tenantId, async (tx) => {
      const byEmail = async (email: string) => (await tx.contact.findFirst({ where: { email } }))?.anonymizedAt ?? null;
      expect(await byEmail('old@customer.test')).toBeNull(); // renamed away
      expect(await byEmail('open@customer.test')).toBeNull();
      expect(await byEmail('recent@customer.test')).toBeNull();
      const oldTicket = await tx.ticket.findUniqueOrThrow({ where: { id: old.id }, include: { contact: true } });
      expect(oldTicket.contact.anonymizedAt).not.toBeNull();
    });
    const logs = await listAuditLogs(tenantId, { action: 'contact.anonymized' });
    expect(logs.entries.some((e: { actorType: string; actorLabel: string | null }) => e.actorType === 'system' && e.actorLabel === 'retention policy')).toBe(true);

    await app.inject({ method: 'PUT', url: '/contact-retention', headers: as(adminToken), payload: { days: null } });
  });
});
