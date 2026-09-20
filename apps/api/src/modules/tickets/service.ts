import { prisma, withTenantTx, type MessageAuthorType, type Prisma, type TicketPriority, type TicketStatusCategory } from '@seredina/db';
import { emailSendQueue, telegramSendQueue } from '../../lib/queue';
import { dispatchWebhookEvent } from '../../lib/webhookDispatch';
import { computeSlaDueAts, scheduleSlaBreachChecks } from '../sla/service';
import { getActiveEscalationForTicket } from '../oncall/service';
import { notifyUser } from '../notifications/service';

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
  // Defaults to 'api' -- the Service Catalog (docs/adr/0016-service-catalog.md)
  // reuses this same function with channel: 'catalog' rather than duplicating
  // ticket-creation logic for a second internal channel; the widget channel
  // (docs/adr/0040-embeddable-widget.md) does the same with channel: 'widget'.
  channel?: string;
  customFields?: Record<string, unknown>;
  // Set only by the widget channel -- see modules/widget/service.ts.
  widgetToken?: string;
  // Set only by the telegram channel -- the chat id, used the same way alert's
  // externalId is (see modules/telegram/service.ts and the Ticket.externalId
  // comment in schema.prisma), to fold a follow-up message into the same open
  // ticket instead of starting a new one each time.
  externalId?: string;
}

/** The API channel: POST /v1/tickets, authenticated by ApiKey -- see plugins/apiKeyAuth.ts. */
export async function createTicketFromApi(tenantId: string, input: CreateTicketFromApiInput) {
  const ticket = await withTenantTx(prisma, tenantId, async (tx) => {
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

    const priority = input.priority ?? 'NORMAL';
    const createdAt = new Date();
    const dueAts = await computeSlaDueAts(tx, tenantId, priority, createdAt);

    const ticket = await tx.ticket.create({
      data: {
        tenantId,
        number: tenant.lastTicketNumber,
        subject: input.subject,
        priority,
        statusId: openStatus.id,
        contactId: contact.id,
        channel: input.channel ?? 'api',
        widgetToken: input.widgetToken,
        externalId: input.externalId,
        customFields: input.customFields as Prisma.InputJsonValue | undefined,
        createdAt,
        firstResponseDueAt: dueAts.firstResponseDueAt,
        resolutionDueAt: dueAts.resolutionDueAt,
      },
    });

    await tx.message.create({
      data: { tenantId, ticketId: ticket.id, authorType: 'CONTACT', body: input.body, isPrivateNote: false },
    });

    return ticket;
  });

  await dispatchWebhookEvent(tenantId, 'ticket.created', { ticketId: ticket.id, number: ticket.number, subject: ticket.subject, channel: ticket.channel });
  await scheduleSlaBreachChecks(tenantId, ticket.id, { firstResponseDueAt: ticket.firstResponseDueAt, resolutionDueAt: ticket.resolutionDueAt });
  return ticket;
}

export type AlertSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

const SEVERITY_TO_PRIORITY: Record<AlertSeverity, TicketPriority> = {
  CRITICAL: 'URGENT',
  HIGH: 'HIGH',
  MEDIUM: 'NORMAL',
  LOW: 'LOW',
  INFO: 'LOW',
};

export interface IngestAlertInput {
  source: string;
  severity?: AlertSeverity;
  title: string;
  description?: string;
  externalId?: string;
}

/**
 * The NOC/SOC integration point: a monitoring or security tool (Zabbix, Wazuh,
 * Grafana, ...) POSTs here -- same ApiKey as the ticket-creation API channel, see
 * plugins/apiKeyAuth.ts -- and the alert becomes a Ticket. Deliberately reuses
 * Ticket rather than a separate Incident model: see
 * docs/adr/0003-alert-ingestion.md for why (the lifecycle and every mechanism that
 * already exists for it -- RBAC, status categories, assignment -- is identical;
 * duplicating all of that for a "different-looking" ticket would be two systems
 * pretending to be one). Severity is a normalized 5-value scale, not any specific
 * tool's native scheme (Zabbix's "Disaster".."Not classified", Wazuh's 0-15 rule
 * levels, ...) -- mapping a tool's own severity into this is the integrator's job,
 * kept out of Seredina to stay tool-agnostic.
 */
export async function ingestAlert(tenantId: string, input: IngestAlertInput) {
  let refiredMessageEvent: { ticketId: string; body: string } | null = null;

  const ticket = await withTenantTx(prisma, tenantId, async (tx) => {
    // A re-fired alert for a problem that's still open folds into the existing
    // ticket instead of spawning a duplicate -- without this, an alert storm (a
    // flapping service re-notifying every few minutes) would be unusable. A CLOSED
    // ticket with the same externalId legitimately gets a fresh one: whatever was
    // wrong was declared resolved and closed, so a new occurrence is a new incident.
    if (input.externalId) {
      const existing = await tx.ticket.findFirst({
        where: { channel: 'alert', externalId: input.externalId, status: { category: { not: 'CLOSED' } } },
        orderBy: { createdAt: 'desc' },
      });

      if (existing) {
        const body = `Alert re-triggered by ${input.source}: ${input.title}${input.description ? `\n\n${input.description}` : ''}`;
        await tx.message.create({
          data: { tenantId, ticketId: existing.id, authorType: 'SYSTEM', body, isPrivateNote: false },
        });
        refiredMessageEvent = { ticketId: existing.id, body };
        return existing;
      }
    }

    const contact = await tx.contact.upsert({
      where: { tenantId_email: { tenantId, email: `${input.source}@alerts.local` } },
      create: { tenantId, email: `${input.source}@alerts.local`, name: input.source },
      update: {},
    });

    const openStatus = await tx.ticketStatus.findFirst({ where: { key: 'open' } });
    if (!openStatus) throw new Error('tenant has no "open" ticket status configured');

    const tenant = await tx.tenant.update({ where: { id: tenantId }, data: { lastTicketNumber: { increment: 1 } } });

    const priority = input.severity ? SEVERITY_TO_PRIORITY[input.severity] : 'NORMAL';
    const createdAt = new Date();
    const dueAts = await computeSlaDueAts(tx, tenantId, priority, createdAt);

    const ticket = await tx.ticket.create({
      data: {
        tenantId,
        number: tenant.lastTicketNumber,
        subject: input.title,
        priority,
        statusId: openStatus.id,
        contactId: contact.id,
        channel: 'alert',
        externalId: input.externalId,
        createdAt,
        firstResponseDueAt: dueAts.firstResponseDueAt,
        resolutionDueAt: dueAts.resolutionDueAt,
      },
    });

    await tx.message.create({
      data: {
        tenantId,
        ticketId: ticket.id,
        authorType: 'SYSTEM',
        body: input.description ?? input.title,
        isPrivateNote: false,
      },
    });

    return ticket;
  });

  if (refiredMessageEvent) {
    await dispatchWebhookEvent(tenantId, 'message.created', refiredMessageEvent);
  } else {
    await dispatchWebhookEvent(tenantId, 'ticket.created', { ticketId: ticket.id, number: ticket.number, subject: ticket.subject, channel: ticket.channel });
    await scheduleSlaBreachChecks(tenantId, ticket.id, { firstResponseDueAt: ticket.firstResponseDueAt, resolutionDueAt: ticket.resolutionDueAt });
  }
  return ticket;
}

export async function listTicketStatuses(tenantId: string) {
  return withTenantTx(prisma, tenantId, async (tx) => tx.ticketStatus.findMany({ orderBy: { sortOrder: 'asc' } }));
}

export interface CreateTicketStatusInput {
  key: string;
  label: string;
  category: TicketStatusCategory;
}

export async function createTicketStatus(tenantId: string, input: CreateTicketStatusInput) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const existing = await tx.ticketStatus.findUnique({ where: { tenantId_key: { tenantId, key: input.key } } });
    if (existing) throw new Error('a status with this key already exists');
    const count = await tx.ticketStatus.count();
    return tx.ticketStatus.create({ data: { tenantId, ...input, sortOrder: count } });
  });
}

export interface UpdateTicketStatusInput {
  label?: string;
  category?: TicketStatusCategory;
  sortOrder?: number;
}

/**
 * `key` is deliberately never editable: createTicketFromApi/ingestAlert both
 * look up the tenant's initial status by the literal key 'open' (not by
 * category) when creating a new ticket -- renaming it out from under them
 * would break ticket creation for the whole tenant. See the matching
 * protection in deleteTicketStatus below.
 */
export async function updateTicketStatus(tenantId: string, id: string, input: UpdateTicketStatusInput) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const existing = await tx.ticketStatus.findUnique({ where: { id } });
    if (!existing) throw new Error('status not found');
    // Same "open" protection as deleteTicketStatus, checked server-side rather
    // than trusting the frontend's disabled dropdown alone: every new ticket
    // lands in this exact row, so recategorizing it away from OPEN would make
    // brand-new tickets immediately count as pending/resolved/closed in every
    // report and SLA calculation.
    if (existing.key === 'open' && input.category && input.category !== 'OPEN') {
      throw new Error('the "open" status must stay in the OPEN category');
    }
    return tx.ticketStatus.update({
      where: { id },
      data: { label: input.label, category: input.category, sortOrder: input.sortOrder },
    });
  });
}

export async function deleteTicketStatus(tenantId: string, id: string) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const existing = await tx.ticketStatus.findUnique({ where: { id } });
    if (!existing) throw new Error('status not found');
    if (existing.key === 'open') {
      throw new Error('the "open" status can\'t be deleted -- new tickets are created in it');
    }
    const ticketsInStatus = await tx.ticket.count({ where: { statusId: id } });
    if (ticketsInStatus > 0) {
      throw new Error(`${ticketsInStatus} ticket${ticketsInStatus === 1 ? ' is' : 's are'} currently in this status -- move them first`);
    }
    await tx.ticketStatus.delete({ where: { id } });
  });
}

export interface ListTicketsFilter {
  statusCategory?: TicketStatusCategory;
  // A real user id, or the literal 'unassigned' meaning assigneeId IS NULL --
  // see docs/adr/0021-saved-views.md for why there's no 'me' sentinel: a saved
  // view is only ever read back by the user who created it, so baking their
  // own id in at save time already means the same thing.
  assigneeId?: string;
  priority?: TicketPriority;
  // Case-insensitive match against subject or the contact's name/email --
  // deliberately not a full-text index: this is a helpdesk console search box,
  // not a search product, and `contains` is plenty at realistic tenant volumes.
  q?: string;
  limit?: number;
  offset?: number;
}

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

export async function listTickets(tenantId: string, filter: ListTicketsFilter = {}) {
  const limit = Math.min(filter.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
  const offset = filter.offset ?? 0;

  return withTenantTx(prisma, tenantId, async (tx) => {
    const where: Prisma.TicketWhereInput = {
      status: filter.statusCategory ? { category: filter.statusCategory } : undefined,
      assigneeId: filter.assigneeId ? (filter.assigneeId === 'unassigned' ? null : filter.assigneeId) : undefined,
      priority: filter.priority,
      OR: filter.q
        ? [
            { subject: { contains: filter.q, mode: 'insensitive' } },
            { contact: { name: { contains: filter.q, mode: 'insensitive' } } },
            { contact: { email: { contains: filter.q, mode: 'insensitive' } } },
          ]
        : undefined,
    };

    const [tickets, total] = await Promise.all([
      tx.ticket.findMany({
        where,
        include: { status: true, contact: true, assignee: { select: { id: true, name: true } }, team: true },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      tx.ticket.count({ where }),
    ]);

    return { tickets, total };
  });
}

export async function getTicket(tenantId: string, ticketId: string) {
  const ticket = await withTenantTx(prisma, tenantId, async (tx) => {
    const ticket = await tx.ticket.findUnique({
      where: { id: ticketId },
      include: {
        status: true,
        contact: true,
        assignee: { select: { id: true, name: true } },
        team: true,
        messages: {
          orderBy: { createdAt: 'asc' },
          include: {
            authorUser: { select: { id: true, name: true } },
            // Metadata only, never `data` -- the file bytes have no business
            // riding along on every ticket load; GET /attachments/:id fetches
            // the actual blob only when someone clicks to download it.
            attachments: { select: { id: true, filename: true, mimeType: true, sizeBytes: true, createdAt: true } },
          },
        },
        assets: {
          include: {
            asset: {
              select: {
                id: true,
                name: true,
                ipAddress: true,
                assetType: true,
                services: { include: { service: { select: { id: true, name: true } } } },
              },
            },
          },
        },
        problem: { select: { id: true, number: true, title: true } },
        mergedInto: { select: { id: true, number: true, subject: true } },
        mergedTickets: { select: { id: true, number: true, subject: true } },
      },
    });
    if (!ticket) throw new Error('ticket not found');

    // Flatten the ServiceAsset join rows into a plain services[] per asset --
    // "this affects: Payroll" (docs/adr/0017-service-configuration-management.md)
    // shouldn't require the frontend to know a join table exists.
    return {
      ...ticket,
      assets: ticket.assets.map((ta) => ({
        ...ta,
        asset: { ...ta.asset, services: ta.asset.services.map((sa) => sa.service) },
      })),
    };
  });

  // A separate transaction, not nested inside the one above -- getActiveEscalationForTicket
  // opens its own withTenantTx. See docs/adr/0020-oncall-escalation.md.
  const escalation = await getActiveEscalationForTicket(tenantId, ticketId);
  return { ...ticket, escalation };
}

export interface AddMessageInput {
  // Required when authorType is 'AGENT' (the default) -- a human agent's reply
  // always has one. Omitted for authorType: 'AI' (see modules/ai-tools/catalog.ts's
  // add_ticket_reply): an AI-authored message speaks for the tenant's AI agent
  // as a whole, not any one human, the same reason MessageAuthorType.AI exists
  // as its own value rather than reusing AGENT with a null author.
  authorUserId?: string;
  authorType?: MessageAuthorType;
  body: string;
  isPrivateNote: boolean;
}

export async function addMessage(tenantId: string, ticketId: string, input: AddMessageInput) {
  const authorType = input.authorType ?? 'AGENT';
  if (authorType === 'AGENT' && !input.authorUserId) {
    throw new Error('authorUserId is required for an AGENT-authored message');
  }

  // The DB write happens inside withTenantTx as usual; the Redis enqueue is
  // deliberately outside it (network I/O doesn't belong inside a tenant transaction
  // -- see docs/adr/0001-multi-tenancy-rls.md), so the transaction closes first and
  // only then do we tell the worker there's an email to send.
  const { message, shouldEmail, shouldTelegram } = await withTenantTx(prisma, tenantId, async (tx) => {
    const ticket = await tx.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new Error('ticket not found');

    const message = await tx.message.create({
      data: {
        tenantId,
        ticketId,
        authorType,
        authorUserId: input.authorUserId,
        body: input.body,
        isPrivateNote: input.isPrivateNote,
      },
    });

    // The SLA "first response" milestone is the first public (non-internal-note)
    // reply an AGENT or AI posts -- stamped once, never overwritten by later
    // replies. authorType !== 'CONTACT' matters now that addMessage is a real
    // code path for a contact's own follow-up messages too (the widget
    // channel's conversation-continuation -- see docs/adr/0040-embeddable-
    // widget.md): before that, every CONTACT-authored message was the
    // ticket's own opening message, created via a direct tx.message.create in
    // createTicketFromApi/ingestAlert, never through this function, so this
    // check was never exercised by a contact message before now.
    if (!input.isPrivateNote && authorType !== 'CONTACT' && !ticket.firstRespondedAt) {
      await tx.ticket.update({ where: { id: ticketId }, data: { firstRespondedAt: new Date() } });
    }

    // Internal notes never leave Seredina; only a public REPLY (an agent or AI,
    // never the contact's own message coming back at them) on an email- or
    // telegram-sourced ticket needs to actually go out to the customer.
    // authorType !== 'CONTACT' is load-bearing here, not defensive fluff: the
    // telegram channel's own follow-up messages (handleTelegramUpdate, see
    // docs/adr/0044-telegram-channel.md) call this exact function with
    // authorType: 'CONTACT', same as the widget channel already does -- caught
    // live in dev (a real telegram-send job enqueued for a customer's own
    // inbound message) before this guard was added, not just reasoned about.
    const shouldNotifyCustomer = authorType !== 'CONTACT' && !input.isPrivateNote;
    return {
      message,
      shouldEmail: ticket.channel === 'email' && shouldNotifyCustomer,
      shouldTelegram: ticket.channel === 'telegram' && shouldNotifyCustomer,
    };
  });

  if (shouldEmail) {
    await emailSendQueue.add('send', { tenantId, ticketId, messageId: message.id });
  }
  if (shouldTelegram) {
    await telegramSendQueue.add('send', { tenantId, ticketId, messageId: message.id });
  }

  // Internal notes are excluded here too, same reasoning as the AI copilot's
  // prompt-building -- a private note must never reach an external system a
  // tenant's own webhook receiver might not be trusted with.
  if (!message.isPrivateNote) {
    await dispatchWebhookEvent(tenantId, 'message.created', { ticketId, messageId: message.id, body: message.body });
  }

  return message;
}

export interface UpdateTicketInput {
  statusId?: string;
  assigneeId?: string | null;
  priority?: TicketPriority;
  teamId?: string | null;
  // Merged into the existing jsonb, never replaced -- a PATCH that only sets one
  // custom field shouldn't silently blank out every other one already stored.
  customFields?: Record<string, unknown>;
  // Links this ticket to the Problem it's a symptom of -- see
  // docs/adr/0015-problem-management.md. null disconnects.
  problemId?: string | null;
}

export async function updateTicket(tenantId: string, ticketId: string, input: UpdateTicketInput) {
  let priorityChanged = false;
  let newAssigneeId: string | null = null;

  const updated = await withTenantTx(prisma, tenantId, async (tx) => {
    const ticket = await tx.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new Error('ticket not found');

    // Captured here, acted on after the transaction closes -- notifyUser does
    // its own I/O (a queue enqueue for email), which never belongs inside
    // withTenantTx. Only a genuine change to a NEW, real assignee notifies --
    // clearing an assignee, or re-saving the same one, is not "assigned to you."
    if (input.assigneeId && input.assigneeId !== ticket.assigneeId) {
      newAssigneeId = input.assigneeId;
    }

    const data: Prisma.TicketUpdateInput = {
      priority: input.priority,
      assignee: input.assigneeId === undefined ? undefined : input.assigneeId ? { connect: { id: input.assigneeId } } : { disconnect: true },
      team: input.teamId === undefined ? undefined : input.teamId ? { connect: { id: input.teamId } } : { disconnect: true },
      problem: input.problemId === undefined ? undefined : input.problemId ? { connect: { id: input.problemId } } : { disconnect: true },
      customFields: input.customFields
        ? ({ ...((ticket.customFields as Record<string, unknown> | null) ?? {}), ...input.customFields } as Prisma.InputJsonValue)
        : undefined,
    };

    // A priority change restarts the SLA clock from now, not from the ticket's
    // original creation -- the ticket's urgency was just reclassified, so its
    // targets should measure from that reclassification. Only actually recomputed
    // when the priority is genuinely changing, so patching e.g. just the assignee
    // never touches an already-running clock.
    if (input.priority && input.priority !== ticket.priority) {
      priorityChanged = true;
      const dueAts = await computeSlaDueAts(tx, tenantId, input.priority, new Date());
      data.firstResponseDueAt = dueAts.firstResponseDueAt;
      data.resolutionDueAt = dueAts.resolutionDueAt;
    }

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

  await dispatchWebhookEvent(tenantId, 'ticket.updated', {
    ticketId: updated.id,
    number: updated.number,
    statusId: updated.statusId,
    priority: updated.priority,
    assigneeId: updated.assigneeId,
  });
  if (priorityChanged) {
    await scheduleSlaBreachChecks(tenantId, updated.id, { firstResponseDueAt: updated.firstResponseDueAt, resolutionDueAt: updated.resolutionDueAt });
  }
  if (newAssigneeId) {
    await notifyUser(tenantId, newAssigneeId, 'TICKET_ASSIGNED', {
      ticketId: updated.id,
      body: `You were assigned to #${updated.number}: ${updated.subject}`,
      subject: `[#${updated.number}] Assigned to you: ${updated.subject}`,
    });
  }
  return updated;
}

/**
 * Folds sourceTicketId's messages into intoTicketId and closes the source --
 * mechanically close to ingestAlert's re-fire-folding above, reused rather than
 * invented from scratch. See docs/adr/0019-collision-merge-bulk-actions.md.
 *
 * Order matters: existing messages move to the target FIRST, so the
 * "merged into #X" system message added to the source afterward is the one
 * message that stays there -- the one thing anyone opening the old ticket URL
 * needs to see. mergedIntoId records the redirect permanently; closing sets
 * resolvedAt too (if not already set), same as any other close.
 */
export async function mergeTicket(tenantId: string, sourceTicketId: string, intoTicketId: string) {
  if (sourceTicketId === intoTicketId) throw new Error('cannot merge a ticket into itself');

  const { source, targetMessage } = await withTenantTx(prisma, tenantId, async (tx) => {
    const [source, target] = await Promise.all([
      tx.ticket.findUnique({ where: { id: sourceTicketId } }),
      tx.ticket.findUnique({ where: { id: intoTicketId } }),
    ]);
    if (!source) throw new Error('source ticket not found');
    if (!target) throw new Error('target ticket not found');
    if (source.mergedIntoId) throw new Error('this ticket has already been merged into another one');
    if (target.mergedIntoId) throw new Error('cannot merge into a ticket that has itself been merged elsewhere');

    const closedStatus = await tx.ticketStatus.findFirst({ where: { category: 'CLOSED' }, orderBy: { sortOrder: 'asc' } });
    if (!closedStatus) throw new Error('tenant has no "closed" ticket status configured');

    await tx.message.updateMany({ where: { ticketId: sourceTicketId }, data: { ticketId: intoTicketId } });

    const targetMessage = await tx.message.create({
      data: {
        tenantId,
        ticketId: intoTicketId,
        authorType: 'SYSTEM',
        body: `Merged ticket #${source.number} ("${source.subject}") into this ticket.`,
        isPrivateNote: false,
      },
    });
    await tx.message.create({
      data: {
        tenantId,
        ticketId: sourceTicketId,
        authorType: 'SYSTEM',
        body: `This ticket was merged into #${target.number} ("${target.subject}").`,
        isPrivateNote: false,
      },
    });

    const now = new Date();
    const updatedSource = await tx.ticket.update({
      where: { id: sourceTicketId },
      data: {
        mergedIntoId: intoTicketId,
        statusId: closedStatus.id,
        closedAt: now,
        resolvedAt: source.resolvedAt ?? now,
      },
    });

    return { source: updatedSource, targetMessage };
  });

  await dispatchWebhookEvent(tenantId, 'ticket.updated', {
    ticketId: source.id,
    number: source.number,
    statusId: source.statusId,
    priority: source.priority,
    assigneeId: source.assigneeId,
  });
  await dispatchWebhookEvent(tenantId, 'message.created', {
    ticketId: targetMessage.ticketId,
    messageId: targetMessage.id,
    body: targetMessage.body,
  });

  return source;
}
