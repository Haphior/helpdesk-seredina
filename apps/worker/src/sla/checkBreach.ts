import { prisma, withTenantTx } from '@seredina/db';
import type { SlaBreachCheckJobPayload } from '@seredina/shared';
import { dispatchWebhookEvent } from '../lib/webhookDispatch';
import { startEscalationIfConfigured } from '../oncall/escalate';

/**
 * Fires once, at the due-at timestamp captured when this job was scheduled (see
 * apps/api/src/modules/sla/service.ts's scheduleSlaBreachChecks). Re-reads the
 * ticket fresh rather than trusting anything captured at schedule time, because
 * a lot can change during the delay: the milestone might already be met, or the
 * ticket's priority (and so its due-at) might have moved -- in either case this
 * is a silent no-op, not an error. A priority change re-schedules its own fresh
 * check against the new due-at (see updateTicket), so this job never needs to
 * reschedule itself.
 */
export async function checkSlaBreach(payload: SlaBreachCheckJobPayload): Promise<void> {
  const ticket = await withTenantTx(prisma, payload.tenantId, (tx) => tx.ticket.findUnique({ where: { id: payload.ticketId } }));
  if (!ticket) return;

  if (payload.milestone === 'FIRST_RESPONSE') {
    if (ticket.firstRespondedAt) return; // already met
    if (!ticket.firstResponseDueAt || ticket.firstResponseDueAt.getTime() > Date.now()) return; // due-at moved later, or cleared
    await dispatchWebhookEvent(payload.tenantId, 'sla.first_response_breached', {
      ticketId: ticket.id,
      number: ticket.number,
      subject: ticket.subject,
      firstResponseDueAt: ticket.firstResponseDueAt.toISOString(),
    });
    await startEscalationIfConfigured(payload.tenantId, ticket.id);
    return;
  }

  // RESOLUTION
  if (ticket.resolvedAt || ticket.closedAt) return; // already met
  if (!ticket.resolutionDueAt || ticket.resolutionDueAt.getTime() > Date.now()) return;
  await dispatchWebhookEvent(payload.tenantId, 'sla.resolution_breached', {
    ticketId: ticket.id,
    number: ticket.number,
    subject: ticket.subject,
    resolutionDueAt: ticket.resolutionDueAt.toISOString(),
  });
  await startEscalationIfConfigured(payload.tenantId, ticket.id);
}
