import { randomBytes } from 'node:crypto';
import IORedis from 'ioredis';

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  throw new Error('REDIS_URL env var is required');
}

// Own connection, lazily opened: BullMQ's (index.ts) is configured for BullMQ's
// requirements, and importing this module mustn't need a live Redis.
const redis = new IORedis(redisUrl, { maxRetriesPerRequest: 1, lazyConnect: true });

// Delete only if we still hold it -- never release a lock that expired and was
// taken over by another replica in the meantime.
const RELEASE_SCRIPT = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

export interface Lock {
  /** Runs `fn` only if the lock was free; returns false (without running) otherwise. */
  runExclusive(key: string, ttlMs: number, fn: () => Promise<void>): Promise<boolean>;
}

/**
 * A plain SET NX PX lock, one Redis key per resource -- enough to stop two
 * worker replicas from working on the same mailbox at once (see
 * docs/adr/0059-email-poll-lock.md). The TTL is a safety net for a replica
 * that dies mid-poll, not the expected release path.
 */
export const redisLock: Lock = {
  async runExclusive(key, ttlMs, fn) {
    const token = randomBytes(16).toString('hex');
    const acquired = await redis.set(key, token, 'PX', ttlMs, 'NX');
    if (acquired !== 'OK') return false;
    try {
      await fn();
    } finally {
      await redis.eval(RELEASE_SCRIPT, 1, key, token).catch(() => undefined);
    }
    return true;
  },
};
