import type { FastifyInstance } from 'fastify';
import type { LiveEvent } from '@seredina/shared';
import { addLiveClient } from '../../lib/live';
import { requirePermission } from '../rbac/permissions';
import { getActiveUserPermissions } from '../auth/service';

const HEARTBEAT_MS = 25_000; // under the ~30-60s idle timeout of common proxies/load balancers
const REVALIDATE_MS = 60_000;
const MAX_TIMER_MS = 2 ** 31 - 1; // setTimeout's own ceiling

/**
 * GET /events -- Server-Sent Events stream of live console updates
 * (docs/adr/0053-live-updates.md). The web app reads it with fetch() rather
 * than EventSource precisely so it can send the normal Authorization header:
 * no token ever goes in a URL, where proxies and access logs would keep it.
 *
 * A stream outlives the single authenticate() check that opened it, so it
 * re-checks the user every REVALIDATE_MS (deactivated, deleted or demoted ->
 * closed) and closes itself when the token expires.
 */
export interface LiveRoutesOptions {
  /** Overridable so tests don't have to wait a real minute. */
  revalidateMs?: number;
  heartbeatMs?: number;
}

export default async function liveRoutes(app: FastifyInstance, opts: LiveRoutesOptions = {}) {
  const revalidateMs = opts.revalidateMs ?? REVALIDATE_MS;
  const heartbeatMs = opts.heartbeatMs ?? HEARTBEAT_MS;

  app.get(
    '/events',
    {
      preHandler: [app.authenticate, requirePermission('tickets:read')],
      // Reconnects are normal (network blips, laptop sleep); a tight loop of them isn't.
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const { tenantId, sub: userId } = request.user;
      const expiresAt = (request.user as { exp?: number }).exp;
      const raw = reply.raw;

      let open = false;
      let closed = false;
      const timers: NodeJS.Timeout[] = [];
      let unregister: () => void = () => {};

      const write = (chunk: string) => {
        if (open && !closed) raw.write(chunk);
      };
      const close = () => {
        if (closed) return;
        closed = true;
        timers.forEach((t) => clearTimeout(t));
        unregister();
        raw.end();
      };

      try {
        unregister = await addLiveClient({
          tenantId,
          userId,
          send: (event: LiveEvent) => write(`data: ${JSON.stringify(event)}\n\n`),
          close,
        });
      } catch (err) {
        request.log.warn({ err }, 'live updates unavailable');
        return reply.code(503).send({ error: 'live updates are temporarily unavailable' });
      }

      reply.hijack();
      // Carries over what CORS/helmet already set on this reply -- hijacking
      // skips Fastify's own header serialization.
      for (const [name, value] of Object.entries(reply.getHeaders())) {
        if (value !== undefined) raw.setHeader(name, value);
      }
      raw.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no', // nginx: don't buffer the stream
      });
      open = true;
      write('retry: 5000\n\nevent: ready\ndata: {}\n\n');

      request.raw.on('close', close);
      timers.push(setInterval(() => write(': ping\n\n'), heartbeatMs));
      timers.push(
        setInterval(async () => {
          try {
            const permissions = await getActiveUserPermissions(tenantId, userId);
            if (!permissions?.includes('tickets:read')) close();
          } catch (err) {
            request.log.warn({ err }, 'live stream revalidation failed; keeping stream open');
          }
        }, revalidateMs),
      );
      if (expiresAt) {
        timers.push(setTimeout(close, Math.min(Math.max(expiresAt * 1000 - Date.now(), 0), MAX_TIMER_MS)));
      }
    },
  );
}
