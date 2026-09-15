import IORedis from 'ioredis';
import { Worker } from 'bullmq';
import {
  DISCOVERY_QUEUE_NAME,
  EMAIL_SEND_QUEUE_NAME,
  type DiscoveryJobPayload,
  type EmailSendJobPayload,
} from '@seredina/shared';
import { runDiscoveryJob } from './discovery/processor';
import { pollActiveEmailChannels } from './email/poll';
import { sendEmailMessage } from './email/send';

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  throw new Error('REDIS_URL env var is required');
}

// BullMQ's own requirement, not a stylistic choice: it manages retries itself and
// will throw if the underlying ioredis client also retries commands on its own.
const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });

const discoveryWorker = new Worker<DiscoveryJobPayload>(
  DISCOVERY_QUEUE_NAME,
  async (job) => {
    const { tenantId, discoveryJobId, cidrRange } = job.data;
    await runDiscoveryJob(tenantId, discoveryJobId, cidrRange);
  },
  { connection, concurrency: 1 }, // one scan at a time -- each already fans out internally (see SCAN_CONCURRENCY)
);

const emailSendWorker = new Worker<EmailSendJobPayload>(
  EMAIL_SEND_QUEUE_NAME,
  async (job) => {
    const { tenantId, ticketId, messageId } = job.data;
    await sendEmailMessage(tenantId, ticketId, messageId);
  },
  { connection, concurrency: 4 },
);

discoveryWorker.on('failed', (job, err) => console.error(`[worker] discovery job ${job?.id} failed:`, err));
emailSendWorker.on('failed', (job, err) => console.error(`[worker] email-send job ${job?.id} failed:`, err));

// Inbound email is a plain interval loop across every tenant's channels, not a
// per-channel BullMQ repeatable job -- see docs/adr/0004-email-channel.md for why
// (mainly: registering/deregistering repeatable jobs in step with channel CRUD is
// real complexity this v1 doesn't need yet with one worker instance). Known
// consequence, not an oversight: running multiple worker replicas would double-poll
// every mailbox -- fine for now, a real problem only once horizontal scaling matters
// (Phase 4).
const EMAIL_POLL_INTERVAL_MS = Number(process.env.EMAIL_POLL_INTERVAL_MS ?? 30_000);

async function pollLoop() {
  try {
    await pollActiveEmailChannels();
  } catch (err) {
    console.error('[worker] email poll cycle failed:', err);
  } finally {
    setTimeout(pollLoop, EMAIL_POLL_INTERVAL_MS);
  }
}

pollLoop();

console.log('[worker] listening on queues:', DISCOVERY_QUEUE_NAME, EMAIL_SEND_QUEUE_NAME);
console.log('[worker] polling email channels every', EMAIL_POLL_INTERVAL_MS, 'ms');
