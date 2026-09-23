// Shared between apps/api (producer of the send queue) and apps/worker (consumer of
// both) so queue names/payload shapes can't drift between the two processes -- same
// reasoning as discovery.ts.

/** Outbound: a ticket reply that needs to go out as an email. Inbound polling is a
 * plain interval loop inside the worker process, not a queue -- see
 * docs/adr/0004-email-channel.md for why. */
export const EMAIL_SEND_QUEUE_NAME = 'email-send';

export interface EmailSendJobPayload {
  tenantId: string;
  ticketId: string;
  messageId: string;
}

/**
 * Follow-up work on a ticket that was just created, handled by apps/api
 * (docs/adr/0061-ai-triage.md). `finalize` is for tickets the worker created
 * (inbound email): the SLA clock, the ticket.created webhook and live event,
 * which otherwise only apps/api's ticket service knows how to do. Every new
 * ticket also gets `triage`, a no-op unless the tenant turned AI triage on.
 */
export const TICKET_FOLLOWUP_QUEUE_NAME = 'ticket-followup';

export interface TicketFollowupJobPayload {
  tenantId: string;
  ticketId: string;
  finalize: boolean;
}
