import { randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma, withTenantTx } from '@seredina/db';
import { PERMISSIONS, type LiveEvent } from '@seredina/shared';
import jwtPlugin from '../src/plugins/jwt';
import liveRoutes from '../src/modules/live/routes';
import { liveClientCount, MAX_STREAMS_PER_USER, publishLive } from '../src/lib/live';
import { createRole, createUser, updateUser } from '../src/modules/auth/service';
import { addMessage, createTicketFromApi } from '../src/modules/tickets/service';

/**
 * GET /events (docs/adr/0053-live-updates.md), against a real HTTP listener
 * and a real Redis -- app.inject() can't hold a streaming response open.
 */
const hasDb = Boolean(process.env.DATABASE_URL) && Boolean(process.env.REDIS_URL);

interface Stream {
  status: number;
  headers: http.IncomingHttpHeaders;
  events: LiveEvent[];
  ended: Promise<void>;
  /** Resolves with the first event matching `match`, or rejects after `ms`. */
  next(match: (e: LiveEvent) => boolean, ms?: number): Promise<LiveEvent>;
  close(): void;
}

describe.skipIf(!hasDb)('Live updates stream', () => {
  let app: FastifyInstance;
  let baseUrl: string;
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  let agentA: { id: string; token: string };
  let otherAgentA: { id: string; token: string };
  let agentB: { id: string; token: string };

  async function makeAgent(tenantId: string) {
    const user = await createUser(
      tenantId,
      { email: `${randomUUID()}@example.com`, name: 'Agent', password: 'password123', roleKey: 'agent' },
      PERMISSIONS,
    );
    return { id: user.id, token: app.jwt.sign({ sub: user.id, tenantId, permissions: [] }) };
  }

  function open(token?: string): Promise<Stream> {
    return new Promise((resolve, reject) => {
      const req = http.get(`${baseUrl}/events`, { headers: token ? { authorization: `Bearer ${token}`, origin: 'http://console.test' } : {} }, (res) => {
        const events: LiveEvent[] = [];
        const waiters: { match: (e: LiveEvent) => boolean; resolve: (e: LiveEvent) => void }[] = [];
        let buffer = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          buffer += chunk;
          let idx;
          while ((idx = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const data = block.split('\n').find((l) => l.startsWith('data: '));
            if (!data || block.includes('event: ready')) continue;
            const event = JSON.parse(data.slice('data: '.length)) as LiveEvent;
            events.push(event);
            for (const w of [...waiters]) {
              if (w.match(event)) {
                waiters.splice(waiters.indexOf(w), 1);
                w.resolve(event);
              }
            }
          }
        });
        const ended = new Promise<void>((r) => res.on('close', () => r()));
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          events,
          ended,
          next: (match, ms = 3000) =>
            new Promise((res2, rej2) => {
              const hit = events.find(match);
              if (hit) return res2(hit);
              const timer = setTimeout(() => rej2(new Error('no matching event')), ms);
              waiters.push({ match, resolve: (e) => { clearTimeout(timer); res2(e); } });
            }),
          close: () => req.destroy(),
        });
      });
      req.on('error', (err) => (err.message.includes('socket hang up') ? undefined : reject(err)));
    });
  }

  /** Lets a just-opened stream finish registering with the hub. */
  const settle = () => new Promise((r) => setTimeout(r, 150));

  beforeAll(async () => {
    process.env.JWT_SECRET ??= 'test-jwt-secret';
    app = Fastify();
    await app.register(cors, { origin: true });
    await app.register(jwtPlugin);
    await app.register(liveRoutes, { revalidateMs: 300 });
    await app.listen({ port: 0, host: '127.0.0.1' });
    baseUrl = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;

    for (const [tenantId, slug] of [[tenantA, 'live-a'], [tenantB, 'live-b']]) {
      await withTenantTx(prisma, tenantId, async (tx) => {
        await tx.tenant.create({ data: { id: tenantId, slug: `${slug}-${tenantId.slice(0, 8)}`, name: slug } });
        await tx.ticketStatus.create({ data: { tenantId, key: 'open', label: 'Open', category: 'OPEN', sortOrder: 0 } });
      });
      await createRole(tenantId, { key: 'agent', name: 'Agent', permissions: ['tickets:read', 'tickets:write'] });
      await createRole(tenantId, { key: 'no_tickets', name: 'No tickets', permissions: ['assets:read'] });
    }
    agentA = await makeAgent(tenantA);
    otherAgentA = await makeAgent(tenantA);
    agentB = await makeAgent(tenantB);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('requires a valid session', async () => {
    const stream = await open();
    expect(stream.status).toBe(401);
  });

  it('streams as text/event-stream and keeps the CORS headers set before hijacking', async () => {
    const stream = await open(agentA.token);
    expect(stream.status).toBe(200);
    expect(stream.headers['content-type']).toContain('text/event-stream');
    expect(stream.headers['access-control-allow-origin']).toBe('http://console.test');
    stream.close();
  });

  it("delivers a real ticket change as ids only -- never the subject or a message's body", async () => {
    const stream = await open(agentA.token);
    await settle();

    const ticket = await createTicketFromApi(tenantA, {
      subject: 'Secret subject',
      body: 'Secret body',
      contactEmail: 'c@example.com',
      contactName: 'C',
    });
    expect(await stream.next((e) => e.type === 'ticket.created')).toEqual({ type: 'ticket.created', ticketId: ticket.id });

    await addMessage(tenantA, ticket.id, { authorUserId: agentA.id, body: 'private note text', isPrivateNote: true });
    const message = await stream.next((e) => e.type === 'message.created');
    expect(message).toEqual({ type: 'message.created', ticketId: ticket.id });

    const everything = JSON.stringify(stream.events);
    expect(everything).not.toContain('Secret');
    expect(everything).not.toContain('private note text');
    stream.close();
  });

  it("never delivers another tenant's events", async () => {
    const streamB = await open(agentB.token);
    const streamA = await open(agentA.token);
    await settle();

    const ticketId = randomUUID();
    await publishLive(tenantA, { type: 'ticket.updated', ticketId });
    await streamA.next((e) => 'ticketId' in e && e.ticketId === ticketId);
    await new Promise((r) => setTimeout(r, 200));
    expect(streamB.events.some((e) => 'ticketId' in e && e.ticketId === ticketId)).toBe(false);
    streamA.close();
    streamB.close();
  });

  it("delivers a notification only to that user's own streams", async () => {
    const mine = await open(agentA.token);
    const colleague = await open(otherAgentA.token);
    await settle();

    await publishLive(tenantA, { type: 'notification.created', userId: agentA.id });
    await mine.next((e) => e.type === 'notification.created');
    await new Promise((r) => setTimeout(r, 200));
    expect(colleague.events.some((e) => e.type === 'notification.created')).toBe(false);
    mine.close();
    colleague.close();
  });

  it('drops a malformed or unknown message instead of relaying it', async () => {
    const stream = await open(agentA.token);
    await settle();
    // Straight onto the channel, bypassing publishLive's own typing.
    const { liveChannel } = await import('@seredina/shared');
    const IORedis = (await import('ioredis')).default;
    const raw = new IORedis(process.env.REDIS_URL!);
    await raw.publish(liveChannel(tenantA), JSON.stringify({ type: 'ticket.updated', ticketId: 'x', subject: 'leak me' }));
    await raw.publish(liveChannel(tenantA), JSON.stringify({ type: 'admin.pwned' }));
    await raw.publish(liveChannel(tenantA), 'not json');
    await stream.next((e) => 'ticketId' in e && e.ticketId === 'x');
    await raw.quit();
    await new Promise((r) => setTimeout(r, 200));
    expect(JSON.stringify(stream.events)).not.toContain('leak me');
    expect(stream.events.some((e) => (e.type as string) === 'admin.pwned')).toBe(false);
    stream.close();
  });

  it('closes the stream once the user is deactivated', async () => {
    const agent = await makeAgent(tenantA);
    const stream = await open(agent.token);
    await settle();
    await updateUser(tenantA, agent.id, { isActive: false });
    await expect(Promise.race([stream.ended, new Promise((_, rej) => setTimeout(() => rej(new Error('still open')), 3000))])).resolves.toBeUndefined();
  });

  it('closes the stream once the user loses tickets:read', async () => {
    const agent = await makeAgent(tenantA);
    const stream = await open(agent.token);
    await settle();
    await updateUser(tenantA, agent.id, { roleKey: 'no_tickets' });
    await expect(Promise.race([stream.ended, new Promise((_, rej) => setTimeout(() => rej(new Error('still open')), 3000))])).resolves.toBeUndefined();
  });

  it(`caps open streams per user at ${MAX_STREAMS_PER_USER}, closing the oldest`, async () => {
    const agent = await makeAgent(tenantB);
    const before = liveClientCount(tenantB);
    const streams: Stream[] = [];
    for (let i = 0; i < MAX_STREAMS_PER_USER + 1; i++) {
      streams.push(await open(agent.token));
      await settle();
    }
    await streams[0].ended; // the oldest was closed to make room
    expect(liveClientCount(tenantB) - before).toBe(MAX_STREAMS_PER_USER);
    streams.forEach((s) => s.close());
  });
});
