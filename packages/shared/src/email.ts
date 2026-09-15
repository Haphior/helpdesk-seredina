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
