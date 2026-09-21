// Outbound direction -- the opposite of POST /v1/alerts (something else notifying
// Seredina). Shared between apps/api (enqueues on ticket/message events) and
// apps/worker (delivers), same reasoning as email.ts.

export const WEBHOOK_DELIVERY_QUEUE_NAME = 'webhook-delivery';

export const WEBHOOK_EVENTS = [
  'ticket.created',
  'ticket.updated',
  'message.created',
  'sla.first_response_breached',
  'sla.resolution_breached',
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

// docs/adr/0048-chat-notifications.md. 'generic' is the original shape above
// (a tenant's own receiver, HMAC-signed); 'slack'/'teams' post a plain
// {"text": "..."} message to a URL the tenant generates themselves in their
// own workspace (Slack's Incoming Webhooks, Teams' Workflows app) -- no
// signature, since neither platform's webhook has that concept.
export const WEBHOOK_KINDS = ['generic', 'slack', 'teams'] as const;
export type WebhookKind = (typeof WEBHOOK_KINDS)[number];

// A deliberately narrower set than WEBHOOK_EVENTS for chat-kind webhooks:
// ticket.updated's payload is mostly UUIDs (statusId, assigneeId) with nothing
// human-readable to show without an extra lookup, and message.created's raw
// body could leak an internal note or a customer's own message into a
// possibly-public channel without the tenant curating what's shown. The
// roadmap's own framing -- "a new ticket/an SLA breach posts to a channel" --
// named exactly these three scenarios, not all five events.
export const CHAT_WEBHOOK_EVENTS = ['ticket.created', 'sla.first_response_breached', 'sla.resolution_breached'] as const;
export type ChatWebhookEvent = (typeof CHAT_WEBHOOK_EVENTS)[number];

export interface WebhookDeliveryJobPayload {
  webhookId: string;
  tenantId: string;
  event: WebhookEvent;
  occurredAt: string;
  data: Record<string, unknown>;
}
