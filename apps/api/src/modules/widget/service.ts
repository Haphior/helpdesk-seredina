import { randomBytes } from 'node:crypto';
import { prisma, withTenantTx } from '@seredina/db';
import { addMessage, createTicketFromApi } from '../tickets/service';

const SUBJECT_MAX_LENGTH = 80;

function subjectFromMessage(body: string): string {
  const firstLine = body.split('\n')[0].trim();
  if (!firstLine) return 'New conversation from website chat';
  return firstLine.length > SUBJECT_MAX_LENGTH ? `${firstLine.slice(0, SUBJECT_MAX_LENGTH)}…` : firstLine;
}

/**
 * The widget channel (Phase 4, docs/adr/0040-embeddable-widget.md) reuses
 * createTicketFromApi/addMessage rather than a third parallel ticket-creation
 * implementation -- channel: 'widget' plumbs through everything those
 * already do (webhook dispatch, SLA scheduling, contact upsert) for free.
 * `widgetToken` is the one genuinely new piece: a random bearer credential
 * an anonymous website visitor's browser holds (localStorage) to prove it's
 * the same visitor continuing the same conversation, since there's no login
 * for a widget visitor to prove that any other way.
 */
export interface StartWidgetConversationInput {
  name: string;
  email: string;
  message: string;
}

export async function startWidgetConversation(tenantId: string, input: StartWidgetConversationInput) {
  const widgetToken = randomBytes(32).toString('hex');

  const ticket = await createTicketFromApi(tenantId, {
    subject: subjectFromMessage(input.message),
    body: input.message,
    contactEmail: input.email,
    contactName: input.name,
    channel: 'widget',
    widgetToken,
  });

  return { ticketId: ticket.id, ticketNumber: ticket.number, widgetToken };
}

/** Looks up the ticket a widgetToken belongs to, scoped to this tenant -- never trusts a token without also checking it against the caller's own resolved tenantId. */
async function findTicketByWidgetToken(tenantId: string, widgetToken: string) {
  const ticket = await withTenantTx(prisma, tenantId, (tx) => tx.ticket.findUnique({ where: { widgetToken } }));
  if (!ticket) throw new Error('conversation not found');
  return ticket;
}

export async function addWidgetMessage(tenantId: string, widgetToken: string, body: string) {
  const ticket = await findTicketByWidgetToken(tenantId, widgetToken);
  return addMessage(tenantId, ticket.id, { authorType: 'CONTACT', body, isPrivateNote: false });
}

export interface WidgetConversationView {
  ticketNumber: number;
  statusCategory: string;
  messages: { authorType: string; body: string; createdAt: Date }[];
}

/**
 * Public-safe view of the conversation -- select only `authorType`/`body`
 * created At, and (critically) filters `isPrivateNote` out at the query
 * itself, not just by convention -- an internal agent note must never reach
 * an anonymous website visitor's browser, the same trust boundary
 * suggestReply's own thread-building and the public KB portal already
 * enforce for their own callers.
 */
export async function getWidgetConversation(tenantId: string, widgetToken: string): Promise<WidgetConversationView> {
  const ticket = await withTenantTx(prisma, tenantId, (tx) =>
    tx.ticket.findUnique({
      where: { widgetToken },
      include: {
        status: { select: { category: true } },
        messages: {
          where: { isPrivateNote: false },
          orderBy: { createdAt: 'asc' },
          select: { authorType: true, body: true, createdAt: true },
        },
      },
    }),
  );
  if (!ticket) throw new Error('conversation not found');

  return { ticketNumber: ticket.number, statusCategory: ticket.status.category, messages: ticket.messages };
}
