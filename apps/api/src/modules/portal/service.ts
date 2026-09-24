import { randomBytes } from 'node:crypto';
import { prisma, withTenantTx } from '@seredina/db';
import { sha256Hex } from '@seredina/shared';
import { signPurposeToken, verifyPurposeToken } from '../../lib/purposeToken';
import { contactEmailQueue } from '../../lib/queue';
import { rateLimitRedis } from '../../lib/rateLimitRedis';
import { webOrigin } from '../../lib/publicUrl';
import { resolveTenantIdBySlug } from '../tenants/service';
import { addMessage, createTicketFromApi } from '../tickets/service';
import { createTicketFromCatalogItem } from '../servicecatalog/service';
import { createAttachment, getAttachment } from '../attachments/service';
import { notifyUser } from '../notifications/service';

/**
 * The customer portal -- docs/adr/0065-customer-portal.md. Contacts never
 * have passwords: they prove they own their email address by clicking a
 * one-time link sent to it, and get a portal session that can only ever see
 * their own tickets' public conversation.
 */

const LOGIN_PURPOSE = 'portal-login';
const LOGIN_TTL_MS = 20 * 60 * 1000;
const SESSION_PURPOSE = 'portal-session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Per address, on top of the per-IP route limit: nobody gets to mail-bomb an inbox through us.
const LINKS_PER_EMAIL_PER_HOUR = 3;

export class PortalError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export interface PortalSession {
  tenantId: string;
  contactId: string;
}

/** The tenant behind a slug, if its portal is on. A disabled portal and a missing tenant look the same. */
export async function resolvePortalTenant(tenantSlug: string): Promise<string> {
  const tenantId = await resolveTenantIdBySlug(tenantSlug);
  if (!tenantId) throw new PortalError('not found', 404);
  const tenant = await withTenantTx(prisma, tenantId, (tx) =>
    tx.tenant.findUnique({ where: { id: tenantId }, select: { customerPortalEnabled: true } }),
  );
  if (!tenant?.customerPortalEnabled) throw new PortalError('not found', 404);
  return tenantId;
}

export async function getPortalSettings(tenantId: string) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { customerPortalEnabled: true, slug: true } });
    const channels = await tx.emailChannel.count({ where: { isActive: true, connectionStatus: 'connected' } });
    return {
      enabled: tenant.customerPortalEnabled,
      url: `${webOrigin()}/portal/${tenant.slug}`,
      // Sign-in links go out by email, so the portal is useless without a mailbox.
      hasEmailChannel: channels > 0,
    };
  });
}

export async function setPortalEnabled(tenantId: string, enabled: boolean) {
  await withTenantTx(prisma, tenantId, (tx) => tx.tenant.update({ where: { id: tenantId }, data: { customerPortalEnabled: enabled } }));
  return getPortalSettings(tenantId);
}

/**
 * Emails a sign-in link. Always "succeeds" from the caller's point of view,
 * whether or not the address has tickets, so the endpoint can't be used to
 * learn who's a customer. A first-time address becomes a contact only once
 * the link is clicked -- i.e. once they've proven it's theirs.
 */
export async function requestPortalLink(tenantSlug: string, rawEmail: string): Promise<void> {
  const tenantId = await resolvePortalTenant(tenantSlug);
  const email = rawEmail.trim().toLowerCase();

  const key = `seredina:portal-link:${tenantId}:${sha256Hex(email)}`;
  const count = await rateLimitRedis.incr(key);
  if (count === 1) await rateLimitRedis.pexpire(key, 60 * 60 * 1000);
  if (count > LINKS_PER_EMAIL_PER_HOUR) return;

  const tenant = await withTenantTx(prisma, tenantId, (tx) =>
    tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true } }),
  );
  const token = signPurposeToken(LOGIN_PURPOSE, { t: tenantId, e: email, n: randomBytes(8).toString('hex') }, LOGIN_TTL_MS);
  // A fragment, so the token never reaches a server log or a Referer header.
  const link = `${webOrigin()}/portal/${tenantSlug}/auth#${token}`;
  await contactEmailQueue.add(
    'send',
    {
      tenantId,
      to: email,
      subject: `Your sign-in link for ${tenant.name}`,
      text: `Use this link to see and reply to your requests with ${tenant.name}:\n\n${link}\n\nIt works once and expires in 20 minutes. If you didn't ask for it, you can ignore this email.`,
    },
    { attempts: 3, backoff: { type: 'exponential', delay: 5_000 } },
  );
}

/** Trades a clicked link for a portal session. Single use, across API replicas. */
export async function redeemPortalLink(tenantSlug: string, token: string): Promise<{ sessionToken: string; name: string; email: string }> {
  const tenantId = await resolvePortalTenant(tenantSlug);
  const payload = verifyPurposeToken<{ t: string; e: string }>(LOGIN_PURPOSE, token);
  if (!payload || payload.t !== tenantId) throw new PortalError('This link has expired. Ask for a new one.', 401);
  const first = await rateLimitRedis.set(`seredina:portal-link-used:${sha256Hex(token)}`, '1', 'PX', LOGIN_TTL_MS * 2, 'NX');
  if (first !== 'OK') throw new PortalError('This link was already used. Ask for a new one.', 401);

  const contact = await withTenantTx(prisma, tenantId, (tx) =>
    tx.contact.upsert({
      where: { tenantId_email: { tenantId, email: payload.e } },
      create: { tenantId, email: payload.e, name: payload.e },
      update: {},
    }),
  );
  const sessionToken = signPurposeToken(SESSION_PURPOSE, { t: tenantId, c: contact.id }, SESSION_TTL_MS);
  return { sessionToken, name: contact.name, email: contact.email };
}

export function readPortalSession(tenantId: string, bearer: string | undefined): PortalSession {
  const token = bearer?.startsWith('Bearer ') ? bearer.slice(7) : null;
  const payload = token ? verifyPurposeToken<{ t: string; c: string }>(SESSION_PURPOSE, token) : null;
  // A session is only good on the portal it was issued for.
  if (!payload || payload.t !== tenantId) throw new PortalError('Sign in again.', 401);
  return { tenantId, contactId: payload.c };
}

async function contactOf(session: PortalSession) {
  const contact = await withTenantTx(prisma, session.tenantId, (tx) => tx.contact.findUnique({ where: { id: session.contactId } }));
  if (!contact) throw new PortalError('Sign in again.', 401);
  return contact;
}

export async function listMyTickets(session: PortalSession) {
  return withTenantTx(prisma, session.tenantId, (tx) =>
    tx.ticket.findMany({
      where: { contactId: session.contactId, mergedIntoId: null },
      select: {
        id: true,
        number: true,
        subject: true,
        createdAt: true,
        updatedAt: true,
        status: { select: { label: true, category: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    }),
  );
}

/** Only the public conversation: never internal notes, never who on staff did what beyond their display name. */
export async function getMyTicket(session: PortalSession, ticketId: string) {
  const ticket = await withTenantTx(prisma, session.tenantId, (tx) =>
    tx.ticket.findFirst({
      where: { id: ticketId, contactId: session.contactId },
      select: {
        id: true,
        number: true,
        subject: true,
        createdAt: true,
        status: { select: { label: true, category: true } },
        messages: {
          where: { isPrivateNote: false },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            authorType: true,
            body: true,
            createdAt: true,
            authorUser: { select: { name: true } },
            attachments: { select: { id: true, filename: true, sizeBytes: true, mimeType: true } },
          },
        },
      },
    }),
  );
  if (!ticket) throw new PortalError('not found', 404);
  return ticket;
}

export async function createMyTicket(session: PortalSession, input: { subject: string; body: string }) {
  const contact = await contactOf(session);
  const ticket = await createTicketFromApi(session.tenantId, {
    subject: input.subject,
    body: input.body,
    contactEmail: contact.email,
    contactName: contact.name,
    channel: 'portal',
  });
  return { id: ticket.id, number: ticket.number };
}

export async function listPortalCatalog(tenantId: string) {
  return withTenantTx(prisma, tenantId, (tx) =>
    tx.serviceCatalogItem.findMany({ select: { id: true, name: true, description: true, icon: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
  );
}

export async function requestFromCatalog(session: PortalSession, itemId: string, subject?: string) {
  const contact = await contactOf(session);
  try {
    const ticket = await createTicketFromCatalogItem(session.tenantId, itemId, {
      subject,
      contactEmail: contact.email,
      contactName: contact.name,
    });
    return { id: ticket.id, number: ticket.number };
  } catch {
    throw new PortalError('not found', 404);
  }
}

/** The contact's follow-up. A reply to a closed ticket reopens it, same as a reply by email. */
export async function replyToMyTicket(session: PortalSession, ticketId: string, body: string) {
  const ticket = await withTenantTx(prisma, session.tenantId, (tx) =>
    tx.ticket.findFirst({ where: { id: ticketId, contactId: session.contactId }, include: { status: true } }),
  );
  if (!ticket) throw new PortalError('not found', 404);

  const message = await addMessage(session.tenantId, ticketId, { authorType: 'CONTACT', body, isPrivateNote: false });
  if (ticket.status.category === 'CLOSED') {
    await withTenantTx(prisma, session.tenantId, async (tx) => {
      const open = await tx.ticketStatus.findFirst({ where: { key: 'open' } });
      if (open) await tx.ticket.update({ where: { id: ticketId }, data: { statusId: open.id, closedAt: null } });
    });
  }
  if (ticket.assigneeId) {
    await notifyUser(session.tenantId, ticket.assigneeId, 'NEW_REPLY', {
      ticketId,
      body: `New reply on #${ticket.number}: ${ticket.subject}`,
      subject: `[#${ticket.number}] New reply: ${ticket.subject}`,
    });
  }
  return { id: message.id };
}

/** A file on the contact's own message -- the only place a contact can attach one. */
export async function attachToMyMessage(session: PortalSession, messageId: string, file: { filename: string; mimeType: string; data: Buffer }) {
  const own = await withTenantTx(prisma, session.tenantId, (tx) =>
    tx.message.findFirst({ where: { id: messageId, authorType: 'CONTACT', ticket: { contactId: session.contactId } } }),
  );
  if (!own) throw new PortalError('not found', 404);
  return createAttachment(session.tenantId, messageId, file);
}

/** Downloads only from the public conversation of the contact's own tickets. */
export async function getMyAttachment(session: PortalSession, attachmentId: string) {
  const allowed = await withTenantTx(prisma, session.tenantId, (tx) =>
    tx.attachment.findFirst({
      where: { id: attachmentId, message: { isPrivateNote: false, ticket: { contactId: session.contactId } } },
      select: { id: true },
    }),
  );
  if (!allowed) throw new PortalError('not found', 404);
  return getAttachment(session.tenantId, attachmentId);
}
