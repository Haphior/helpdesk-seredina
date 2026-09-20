import { randomBytes } from 'node:crypto';
import { prisma, withTenantTx } from '@seredina/db';
import { resolveTenantIdBySlug } from '../tenants/service';

const RATING_MIN = 1;
const RATING_MAX = 5;

export interface CsatSurveyView {
  ticketNumber: number;
  ticketSubject: string;
  rating: number | null;
  comment: string | null;
  respondedAt: Date | null;
}

/**
 * Creates the CsatResponse row and returns the public survey link, for
 * modules/tickets/service.ts's updateTicket to post as a SYSTEM message on
 * the ticket -- deliberately does NOT call addMessage itself, to avoid a
 * circular import with tickets/service.ts (which this module's own public
 * routes below never need). Returns null, a silent no-op, when a survey
 * already exists for this ticket (requested at most once, ever -- see the
 * schema comment on CsatResponse) or when WEB_ORIGIN isn't configured, same
 * "best-effort, no channel configured" posture as sendNotificationEmail.
 */
export async function createCsatSurveyLink(tenantId: string, ticketId: string): Promise<string | null> {
  const webOrigin = process.env.WEB_ORIGIN;
  if (!webOrigin) return null;

  return withTenantTx(prisma, tenantId, async (tx) => {
    const existing = await tx.csatResponse.findUnique({ where: { ticketId } });
    if (existing) return null;

    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { slug: true } });
    const token = randomBytes(24).toString('hex');
    await tx.csatResponse.create({ data: { tenantId, ticketId, token } });
    return `${webOrigin.replace(/\/$/, '')}/csat/${tenant.slug}/${token}`;
  });
}

function toView(row: {
  rating: number | null;
  comment: string | null;
  respondedAt: Date | null;
  ticket: { number: number; subject: string };
}): CsatSurveyView {
  return { ticketNumber: row.ticket.number, ticketSubject: row.ticket.subject, rating: row.rating, comment: row.comment, respondedAt: row.respondedAt };
}

/** No auth -- the token itself is the credential, same shape as the widget's widgetToken. */
export async function getPublicCsatSurvey(tenantSlug: string, token: string): Promise<CsatSurveyView | null> {
  const tenantId = await resolveTenantIdBySlug(tenantSlug);
  if (!tenantId) return null;
  return withTenantTx(prisma, tenantId, async (tx) => {
    const row = await tx.csatResponse.findUnique({ where: { token }, include: { ticket: { select: { number: true, subject: true } } } });
    return row ? toView(row) : null;
  });
}

export interface SubmitCsatInput {
  rating: number;
  comment?: string;
}

export async function submitCsatResponse(tenantSlug: string, token: string, input: SubmitCsatInput): Promise<CsatSurveyView> {
  if (!Number.isInteger(input.rating) || input.rating < RATING_MIN || input.rating > RATING_MAX) {
    throw new Error(`rating must be an integer between ${RATING_MIN} and ${RATING_MAX}`);
  }
  const tenantId = await resolveTenantIdBySlug(tenantSlug);
  if (!tenantId) throw new Error('not found');

  return withTenantTx(prisma, tenantId, async (tx) => {
    const existing = await tx.csatResponse.findUnique({ where: { token }, include: { ticket: { select: { number: true, subject: true } } } });
    if (!existing) throw new Error('not found');
    // Idempotent, not an error: a double-click or a page reload after
    // submitting must never risk overwriting the contact's own recorded
    // answer with a different one.
    if (existing.respondedAt) return toView(existing);

    const updated = await tx.csatResponse.update({
      where: { token },
      data: { rating: input.rating, comment: input.comment?.trim() || null, respondedAt: new Date() },
      include: { ticket: { select: { number: true, subject: true } } },
    });
    return toView(updated);
  });
}
