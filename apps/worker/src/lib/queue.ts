import IORedis from 'ioredis';
import { Queue } from 'bullmq';
import {
  ESCALATION_ADVANCE_QUEUE_NAME,
  NOTIFICATION_EMAIL_QUEUE_NAME,
  WEBHOOK_DELIVERY_QUEUE_NAME,
  type EscalationAdvanceJobPayload,
  type NotificationEmailJobPayload,
  type WebhookDeliveryJobPayload,
} from '@seredina/shared';

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  throw new Error('REDIS_URL env var is required');
}

// A second IORedis client, separate from index.ts's Worker connection -- this one
// is for ENQUEUEING (Queue), that one for CONSUMING (Worker); BullMQ wants each
// its own client rather than sharing one across both roles.
const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: true });

export const webhookDeliveryQueue = new Queue<WebhookDeliveryJobPayload>(WEBHOOK_DELIVERY_QUEUE_NAME, { connection });

/**
 * The worker is both producer and consumer of this one queue -- it schedules its
 * own follow-up "check the next tier" job after notifying each escalation tier,
 * exactly the "consumes the same breach-check delayed-job mechanism already built
 * rather than a second scheduler" reuse the roadmap called for. See
 * docs/adr/0020-oncall-escalation.md for why this lives here rather than in
 * apps/api's queue module (apps/worker never depends on apps/api).
 */
export const escalationAdvanceQueue = new Queue<EscalationAdvanceJobPayload>(ESCALATION_ADVANCE_QUEUE_NAME, { connection });

/**
 * apps/api also produces onto this same queue name (from updateTicket, for
 * TICKET_ASSIGNED) -- this worker-side producer instance is only used for
 * NEW_REPLY, enqueued from the worker's own inbound-email ingest. Only
 * apps/worker ever consumes it (it's the only place nodemailer/EmailChannel
 * wiring exists). See docs/adr/0022-notifications.md.
 */
export const notificationEmailQueue = new Queue<NotificationEmailJobPayload>(NOTIFICATION_EMAIL_QUEUE_NAME, { connection });
