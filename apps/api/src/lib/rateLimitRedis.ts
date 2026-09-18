import IORedis from 'ioredis';

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  throw new Error('REDIS_URL env var is required');
}

/**
 * A dedicated connection, not a shared import of lib/queue.ts's own client --
 * that one is configured for BullMQ's specific requirements
 * (maxRetriesPerRequest: null is BullMQ's own constraint, not a general
 * Redis-client default), and there's no reason to couple the rate limiter's
 * connection lifecycle to the job queues' at all.
 *
 * Without this, @fastify/rate-limit defaults to an in-process Map (see
 * store/LocalStore.js in the package) -- correct for a single instance, but
 * silently wrong the moment `api` runs as more than one replica behind a load
 * balancer: each replica would count requests independently, so the real
 * effective limit becomes (configured limit) x (replica count) instead of
 * the configured value, weakening exactly the kind of limit
 * (/auth/login's brute-force throttle) that matters most under real load.
 * See docs/adr/0038-multi-replica-hardening.md.
 */
// No maxRetriesPerRequest override here -- that's specifically BullMQ's own
// requirement (see lib/queue.ts), not a general one; ioredis's own default
// retry cap is the right behavior for a plain rate-limit check.
export const rateLimitRedis = new IORedis(redisUrl, { lazyConnect: true });
