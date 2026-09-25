import { anonymizeContactInTx, Prisma, prisma, withTenantTx, type ContactErasureResult } from '@seredina/db';

/**
 * Contacts and their data rights -- docs/adr/0066-contact-data-rights.md.
 * The people who write in (never console users). An admin can see what's
 * stored about one, correct it, hand them a copy, or erase it; a tenant can
 * also have inactive contacts erased automatically after a retention period.
 */

export class ContactError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export const MIN_RETENTION_DAYS = 30;
export const MAX_RETENTION_DAYS = 3650;

const PAGE_SIZE = 50;

export async function listContacts(tenantId: string, opts: { search?: string; cursor?: string }) {
  const search = opts.search?.trim();
  return withTenantTx(prisma, tenantId, async (tx) => {
    const rows = await tx.contact.findMany({
      where: search
        ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { email: { contains: search, mode: 'insensitive' } }] }
        : undefined,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: PAGE_SIZE + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
      select: { id: true, name: true, email: true, createdAt: true, anonymizedAt: true, _count: { select: { tickets: true } } },
    });
    const page = rows.slice(0, PAGE_SIZE);
    return {
      contacts: page.map(({ _count, ...c }) => ({ ...c, ticketCount: _count.tickets })),
      nextCursor: rows.length > PAGE_SIZE ? page[page.length - 1].id : null,
    };
  });
}

export async function getContact(tenantId: string, id: string) {
  const contact = await withTenantTx(prisma, tenantId, (tx) =>
    tx.contact.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
        anonymizedAt: true,
        tickets: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            number: true,
            subject: true,
            channel: true,
            createdAt: true,
            status: { select: { label: true, category: true } },
          },
        },
      },
    }),
  );
  if (!contact) throw new ContactError('contact not found', 404);
  return contact;
}

/** Rectification: fix a misspelled name or an outdated address. */
export async function updateContact(tenantId: string, id: string, input: { name?: string; email?: string }) {
  try {
    return await withTenantTx(prisma, tenantId, async (tx) => {
      const existing = await tx.contact.findUnique({ where: { id } });
      if (!existing) throw new ContactError('contact not found', 404);
      if (existing.anonymizedAt) throw new ContactError('This contact was anonymized and can no longer be edited.', 409);
      return tx.contact.update({
        where: { id },
        data: { name: input.name, email: input.email?.toLowerCase() },
        select: { id: true, name: true, email: true, createdAt: true, anonymizedAt: true },
      });
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ContactError('Another contact already uses that email address.', 409);
    }
    throw err;
  }
}

/**
 * Access and portability: everything stored about the contact, as JSON.
 * Internal notes are left out unless asked for -- they're the team's working
 * notes, and an admin should read them before handing them over.
 */
export async function exportContactData(tenantId: string, id: string, opts: { includeInternalNotes: boolean }) {
  const contact = await withTenantTx(prisma, tenantId, (tx) =>
    tx.contact.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
        anonymizedAt: true,
        tickets: {
          orderBy: { createdAt: 'asc' },
          select: {
            number: true,
            subject: true,
            channel: true,
            priority: true,
            createdAt: true,
            resolvedAt: true,
            closedAt: true,
            customFields: true,
            status: { select: { label: true } },
            csatResponse: { select: { rating: true, comment: true, respondedAt: true } },
            messages: {
              where: opts.includeInternalNotes ? undefined : { isPrivateNote: false },
              orderBy: { createdAt: 'asc' },
              select: {
                createdAt: true,
                authorType: true,
                isPrivateNote: true,
                body: true,
                attachments: { select: { filename: true, mimeType: true, sizeBytes: true } },
              },
            },
          },
        },
      },
    }),
  );
  if (!contact) throw new ContactError('contact not found', 404);

  const { tickets, ...person } = contact;
  return {
    exportedAt: new Date().toISOString(),
    includesInternalNotes: opts.includeInternalNotes,
    contact: person,
    tickets: tickets.map(({ status, csatResponse, messages, ...t }) => ({
      ...t,
      status: status.label,
      satisfaction: csatResponse?.respondedAt ? csatResponse : null,
      messages: messages.map(({ authorType, ...m }) => ({ ...m, from: authorType === 'CONTACT' ? 'contact' : 'support team' })),
    })),
  };
}

/** Erasure. Irreversible: see anonymizeContactInTx for exactly what is removed. */
export async function anonymizeContact(tenantId: string, id: string, confirmEmail: string): Promise<ContactErasureResult> {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const contact = await tx.contact.findUnique({ where: { id }, select: { email: true, anonymizedAt: true } });
    if (!contact) throw new ContactError('contact not found', 404);
    if (contact.anonymizedAt) throw new ContactError('This contact was already anonymized.', 409);
    // Typing the address back is the confirmation: there's no undo.
    if (confirmEmail.trim().toLowerCase() !== contact.email.toLowerCase()) {
      throw new ContactError('Type the contact’s email address exactly to confirm.', 400);
    }
    return anonymizeContactInTx(tx, id);
  });
}

export async function getRetentionSettings(tenantId: string) {
  const tenant = await withTenantTx(prisma, tenantId, (tx) =>
    tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { contactRetentionDays: true } }),
  );
  return { days: tenant.contactRetentionDays, minDays: MIN_RETENTION_DAYS, maxDays: MAX_RETENTION_DAYS };
}

export async function setRetentionSettings(tenantId: string, days: number | null) {
  await withTenantTx(prisma, tenantId, (tx) =>
    tx.tenant.update({ where: { id: tenantId }, data: { contactRetentionDays: days } }),
  );
  return getRetentionSettings(tenantId);
}
