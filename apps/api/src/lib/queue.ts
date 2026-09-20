import IORedis from 'ioredis';
import { Queue } from 'bullmq';
import {
  DISCOVERY_QUEUE_NAME,
  EMAIL_SEND_QUEUE_NAME,
  EMBED_KB_ARTICLE_QUEUE_NAME,
  NOTIFICATION_EMAIL_QUEUE_NAME,
  SLA_BREACH_QUEUE_NAME,
  TELEGRAM_SEND_QUEUE_NAME,
  WEBHOOK_DELIVERY_QUEUE_NAME,
  type DiscoveryJobPayload,
  type EmailSendJobPayload,
  type EmbedKbArticleJobPayload,
  type NotificationEmailJobPayload,
  type SlaBreachCheckJobPayload,
  type TelegramSendJobPayload,
  type WebhookDeliveryJobPayload,
} from '@seredina/shared';

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  throw new Error('REDIS_URL env var is required');
}

// maxRetriesPerRequest: null is BullMQ's own requirement, not a stylistic choice --
// see apps/worker/src/index.ts. lazyConnect: true means this module loads (and a
// missing/unreachable Redis stays silent) until the first actual enqueue -- without
// it, every test file that merely imports modules/tickets/service.ts (which imports
// this file for the email-send queue) would need a live Redis just to run, even
// tests that never touch a queue at all.
const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: true });

export const discoveryQueue = new Queue<DiscoveryJobPayload>(DISCOVERY_QUEUE_NAME, { connection });
export const emailSendQueue = new Queue<EmailSendJobPayload>(EMAIL_SEND_QUEUE_NAME, { connection });
export const webhookDeliveryQueue = new Queue<WebhookDeliveryJobPayload>(WEBHOOK_DELIVERY_QUEUE_NAME, { connection });
export const slaBreachQueue = new Queue<SlaBreachCheckJobPayload>(SLA_BREACH_QUEUE_NAME, { connection });
export const notificationEmailQueue = new Queue<NotificationEmailJobPayload>(NOTIFICATION_EMAIL_QUEUE_NAME, { connection });
export const embedKbArticleQueue = new Queue<EmbedKbArticleJobPayload>(EMBED_KB_ARTICLE_QUEUE_NAME, { connection });
export const telegramSendQueue = new Queue<TelegramSendJobPayload>(TELEGRAM_SEND_QUEUE_NAME, { connection });
