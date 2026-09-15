import { prisma, withTenantTx, type Prisma, type TicketPriority, type TicketStatusCategory } from '@seredina/db';

const DEFAULT_TICKET_STATUSES: { key: string; label: string; category: TicketStatusCategory; sortOrder: number }[] = [
  { key: 'open', label: 'Open', category: 'OPEN', sortOrder: 0 },
  { key: 'pending', label: 'Pending', category: 'PENDING', sortOrder: 1 },
  { key: 'resolved', label: 'Resolved', category: 'RESOLVED', sortOrder: 2 },
  { key: 'closed', label: 'Closed', category: 'CLOSED', sortOrder: 3 },
];

/** Called from auth/service.ts's registerTenant, inside its own tenant transaction -- not a standalone entry point. */
export async function seedDefaultTicketStatuses(tx: Prisma.TransactionClient, tenantId: string) {
  const statuses = [];
  for (const status of DEFAULT_TICKET_STATUSES) {
    statuses.push(await tx.ticketStatus.create({ data: { tenantId, ...status } }));
  }
  return statuses;
}

export interface CreateTicketFromApiInput {
  subject: string;
  body: string;
  contactEmail: string;
  contactName: string;
  priority?: TicketPriority;
}

/** The API channel: POST /v1/tickets, authenticated by ApiKey -- see plugins/apiKeyAuth.ts. */
export async function createTicketFromApi(tenantId: string, input: CreateTicketFromApiInput) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const contact = await tx.contact.upsert({
      where: { tenantId_email: { tenantId, email: input.contactEmail } },
      create: { tenantId, email: input.contactEmail, name: input.contactName },
      update: { name: input.contactName },
    });

    const openStatus = await tx.ticketStatus.findFirst({ where: { key: 'open' } });
    if (!openStatus) throw new Error('tenant has no "open" ticket status configured');

    const tenant = await tx.tenant.update({
      where: { id: tenantId },
      data: { lastTicketNumber: { increment: 1 } },
    });

    const ticket = await tx.ticket.create({
      data: {
        tenantId,
        number: tenant.lastTicketNumber,
        subject: input.subject,
        priority: input.priority ?? 'NORMAL',
        statusId: openStatus.id,
        contactId: contact.id,
        channel: 'api',
      },
    });

    await tx.message.create({
      data: { tenantId, ticketId: ticket.id, authorType: 'CONTACT', body: input.body, isPrivateNote: false },
    });

    return ticket;
  });
}

export async function listTicketStatuses(tenantId: string) {
  return withTenantTx(prisma, tenantId, async (tx) => tx.ticketStatus.findMany({ orderBy: { sortOrder: 'asc' } }));
}

export interface ListTicketsFilter {
  statusCategory?: TicketStatusCategory;
}

export async function listTickets(tenantId: string, filter: ListTicketsFilter = {}) {
  return withTenantTx(prisma, tenantId, async (tx) =>
    tx.ticket.findMany({
      where: filter.statusCategory ? { status: { category: filter.statusCategory } } : undefined,
      include: { status: true, contact: true, assignee: { select: { id: true, name: true } }, team: true },
      orderBy: { createdAt: 'desc' },
    }),
  );
}

export async function getTicket(tenantId: string, ticketId: string) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const ticket = await tx.ticket.findUnique({
      where: { id: ticketId },
      include: {
        status: true,
        contact: true,
        assignee: { select: { id: true, name: true } },
        team: true,
        messages: { orderBy: { createdAt: 'asc' }, include: { authorUser: { select: { id: true, name: true } } } },
        assets: { include: { asset: { select: { id: true, name: true, ipAddress: true, assetType: true } } } },
      },
    });
    if (!ticket) throw new Error('ticket not found');
    return ticket;
  });
}

export interface AddMessageInput {
  authorUserId: string;
  body: string;
  isPrivateNote: boolean;
}

export async function addMessage(tenantId: string, ticketId: string, input: AddMessageInput) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const ticket = await tx.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new Error('ticket not found');

    return tx.message.create({
      data: {
        tenantId,
        ticketId,
        authorType: 'AGENT',
        authorUserId: input.authorUserId,
        body: input.body,
        isPrivateNote: input.isPrivateNote,
      },
    });
  });
}

export interface UpdateTicketInput {
  statusId?: string;
  assigneeId?: string | null;
  priority?: TicketPriority;
  teamId?: string | null;
}

export async function updateTicket(tenantId: string, ticketId: string, input: UpdateTicketInput) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const ticket = await tx.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new Error('ticket not found');

    const data: Prisma.TicketUpdateInput = {
      priority: input.priority,
      assignee: input.assigneeId === undefined ? undefined : input.assigneeId ? { connect: { id: input.assigneeId } } : { disconnect: true },
      team: input.teamId === undefined ? undefined : input.teamId ? { connect: { id: input.teamId } } : { disconnect: true },
    };

    if (input.statusId) {
      const newStatus = await tx.ticketStatus.findUnique({ where: { id: input.statusId } });
      if (!newStatus) throw new Error('ticket status not found');

      data.status = { connect: { id: input.statusId } };
      if (newStatus.category === 'RESOLVED' && !ticket.resolvedAt) {
        data.resolvedAt = new Date();
      }
      if (newStatus.category === 'CLOSED') {
        data.closedAt = new Date();
        if (!ticket.resolvedAt) data.resolvedAt = new Date();
      }
    }

    return tx.ticket.update({ where: { id: ticketId }, data });
  });
}
