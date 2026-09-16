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

export interface WebhookDeliveryJobPayload {
  webhookId: string;
  tenantId: string;
  event: WebhookEvent;
  occurredAt: string;
  data: Record<string, unknown>;
}
