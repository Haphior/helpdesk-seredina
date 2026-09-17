// Notification emails are delivered by apps/worker regardless of which app
// decided to send one: apps/api enqueues from updateTicket (TICKET_ASSIGNED),
// apps/worker enqueues from its own inbound-email ingest (NEW_REPLY) -- see
// docs/adr/0022-notifications.md for why apps/worker never calls into apps/api
// (the same reason ADR 0020's escalation engine duplicates a little logic
// rather than sharing it). Both producers target this one queue name; only
// apps/worker consumes it (it's the only place nodemailer/EmailChannel wiring
// exists).

export const NOTIFICATION_EMAIL_QUEUE_NAME = 'notification-email';

export interface NotificationEmailJobPayload {
  tenantId: string;
  userId: string;
  subject: string;
  body: string;
}
