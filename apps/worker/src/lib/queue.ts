import IORedis from 'ioredis';
import { Queue } from 'bullmq';
import { WEBHOOK_DELIVERY_QUEUE_NAME, type WebhookDeliveryJobPayload } from '@seredina/shared';

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  throw new Error('REDIS_URL env var is required');
}

// A second IORedis client, separate from index.ts's Worker connection -- this one
// is for ENQUEUEING (Queue), that one for CONSUMING (Worker); BullMQ wants each
// its own client rather than sharing one across both roles.
const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: true });

export const webhookDeliveryQueue = new Queue<WebhookDeliveryJobPayload>(WEBHOOK_DELIVERY_QUEUE_NAME, { connection });
