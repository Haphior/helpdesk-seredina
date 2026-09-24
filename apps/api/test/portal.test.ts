import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma, withTenantTx } from '@seredina/db';
import { buildApp } from '../src/index';
import { contactEmailQueue } from '../src/lib/queue';
import { addMessage, createTicketFromApi, seedDefaultTicketStatuses } from '../src/modules/tickets/service';

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('customer portal', () => {
  const app = buildApp();
  const slug = `portal-${randomUUID().slice(0, 8)}`;
  let tenantId: string;
  let anaTicketId: string;
  let bobTicketId: string;
  let anaSession: string;
  let ip = 0;
  const nextIp = () => `10.95.${Math.floor(++ip / 250)}.${ip % 250}`;
  const base = `/public/${slug}/portal`;
  const as = (token: string) => ({ authorization: `Bearer ${token}` });

  /** The link the worker would have emailed: pulled from the queued job. */
  async function linkTokenFor(email: string): Promise<string> {
    const jobs = await contactEmailQueue.getJobs(['waiting', 'delayed', 'active', 'completed', 'failed']);
    const job = jobs.filter((j) => j.data.tenantId === tenantId && j.data.to === email).sort((a, b) => b.timestamp - a.timestamp)[0];
    const match = job?.data.text.match(/\/auth#(\S+)/);
    if (!match) throw new Error(`no sign-in link queued for ${email}`);
    return match[1];
  }

  async function signIn(email: string): Promise<string> {
    const res = await app.inject({ method: 'POST', url: `${base}/request-link`, remoteAddress: nextIp(), payload: { email } });
    expect(res.statusCode).toBe(202);
    const token = await linkTokenFor(email);
    const redeemed = await app.inject({ method: 'POST', url: `${base}/redeem`, remoteAddress: nextIp(), payload: { token } });
    expect(redeemed.statusCode).toBe(200);
    return redeemed.json().sessionToken;
  }

  beforeAll(async () => {
    process.env.WEB_ORIGIN = 'https://desk.example.com';
    await app.ready();
    tenantId = randomUUID();
    await withTenantTx(prisma, tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, slug, name: 'Portal Co', customerPortalEnabled: false } });
      await seedDefaultTicketStatuses(tx, tenantId);
    });
    anaTicketId = (await createTicketFromApi(tenantId, { subject: 'Ana printer', body: 'Broken', contactEmail: 'ana@x.test', contactName: 'Ana' })).id;
    bobTicketId = (await createTicketFromApi(tenantId, { subject: 'Bob laptop', body: 'Slow', contactEmail: 'bob@x.test', contactName: 'Bob' })).id;
    const agent = await withTenantTx(prisma, tenantId, (tx) => tx.user.create({ data: { tenantId, email: 'agent@x.test', name: 'Agent', passwordHash: 'x' } }));
    await addMessage(tenantId, anaTicketId, { authorUserId: agent.id, body: 'We are on it', isPrivateNote: false });
    await addMessage(tenantId, anaTicketId, { authorUserId: agent.id, body: 'SECRET internal note', isPrivateNote: true });
  });

  afterAll(async () => {
    await app.close();
  });

  it('is invisible while disabled', async () => {
    const res = await app.inject({ method: 'POST', url: `${base}/request-link`, remoteAddress: nextIp(), payload: { email: 'ana@x.test' } });
    expect(res.statusCode).toBe(404);
    await withTenantTx(prisma, tenantId, (tx) => tx.tenant.update({ where: { id: tenantId }, data: { customerPortalEnabled: true } }));
  });

  it('signs in with an emailed link that works exactly once', async () => {
    await app.inject({ method: 'POST', url: `${base}/request-link`, remoteAddress: nextIp(), payload: { email: 'ANA@x.test' } });
    const token = await linkTokenFor('ana@x.test');
    expect(token).toBeTruthy();
    const first = await app.inject({ method: 'POST', url: `${base}/redeem`, remoteAddress: nextIp(), payload: { token } });
    expect(first.statusCode).toBe(200);
    anaSession = first.json().sessionToken;
    const again = await app.inject({ method: 'POST', url: `${base}/redeem`, remoteAddress: nextIp(), payload: { token } });
    expect(again.statusCode).toBe(401);

    // A portal session is not a console session.
    expect((await app.inject({ method: 'GET', url: '/auth/me', headers: as(anaSession) })).statusCode).toBe(401);
  });

  it('shows a contact only their own tickets, and only the public conversation', async () => {
    const list = await app.inject({ method: 'GET', url: `${base}/tickets`, headers: as(anaSession) });
    expect(list.json().tickets.map((t: { id: string }) => t.id)).toEqual([anaTicketId]);

    const detail = await app.inject({ method: 'GET', url: `${base}/tickets/${anaTicketId}`, headers: as(anaSession) });
    const bodies = detail.json().messages.map((m: { body: string }) => m.body);
    expect(bodies).toContain('We are on it');
    expect(bodies.join()).not.toContain('SECRET');

    const bobs = await app.inject({ method: 'GET', url: `${base}/tickets/${bobTicketId}`, headers: as(anaSession) });
    expect(bobs.statusCode).toBe(404);
    const replyToBob = await app.inject({ method: 'POST', url: `${base}/tickets/${bobTicketId}/messages`, headers: as(anaSession), payload: { body: 'hi' } });
    expect(replyToBob.statusCode).toBe(404);
  });

  it('lets a contact open a ticket and reply, and a reply reopens a closed ticket', async () => {
    const created = await app.inject({ method: 'POST', url: `${base}/tickets`, headers: as(anaSession), payload: { subject: 'New one', body: 'Please help' } });
    expect(created.statusCode).toBe(201);
    const ticket = await withTenantTx(prisma, tenantId, (tx) =>
      tx.ticket.findUniqueOrThrow({ where: { id: created.json().id }, include: { contact: true } }),
    );
    expect(ticket.channel).toBe('portal');
    expect(ticket.contact.email).toBe('ana@x.test');

    await withTenantTx(prisma, tenantId, async (tx) => {
      const closed = await tx.ticketStatus.findFirstOrThrow({ where: { category: 'CLOSED' } });
      await tx.ticket.update({ where: { id: anaTicketId }, data: { statusId: closed.id, closedAt: new Date() } });
    });
    const reply = await app.inject({ method: 'POST', url: `${base}/tickets/${anaTicketId}/messages`, headers: as(anaSession), payload: { body: 'Still broken' } });
    expect(reply.statusCode).toBe(201);
    const reopened = await withTenantTx(prisma, tenantId, (tx) => tx.ticket.findUniqueOrThrow({ where: { id: anaTicketId }, include: { status: true } }));
    expect(reopened.status.category).toBe('OPEN');
    expect(reopened.closedAt).toBeNull();
  });

  it('creates a contact on first sign-in, and a session only works on its own portal', async () => {
    const newSession = await signIn('new.person@x.test');
    const list = await app.inject({ method: 'GET', url: `${base}/tickets`, headers: as(newSession) });
    expect(list.json().tickets).toEqual([]);

    const otherSlug = `portal-o-${randomUUID().slice(0, 8)}`;
    const otherId = randomUUID();
    await withTenantTx(prisma, otherId, async (tx) => {
      await tx.tenant.create({ data: { id: otherId, slug: otherSlug, name: 'Other', customerPortalEnabled: true } });
    });
    const cross = await app.inject({ method: 'GET', url: `/public/${otherSlug}/portal/tickets`, headers: as(anaSession) });
    expect(cross.statusCode).toBe(401);
  });

  it('never tells a caller whether an address is a customer, and caps links per address', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({ method: 'POST', url: `${base}/request-link`, remoteAddress: nextIp(), payload: { email: 'flood@x.test' } });
      expect(res.statusCode).toBe(202);
    }
    const jobs = await contactEmailQueue.getJobs(['waiting', 'delayed', 'active', 'completed', 'failed']);
    expect(jobs.filter((j) => j.data.tenantId === tenantId && j.data.to === 'flood@x.test')).toHaveLength(3);
  });
});
